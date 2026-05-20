/**
 * Phase 21b — generate-mode task runner.
 *
 * For tasks the intent classifier flags as 'generate' (write / analyze /
 * translate / summarize — anything that needs no live web interaction),
 * skip the entire supercar agent loop and just make ONE Anthropic API
 * call with web_search available. No browser pool slot, no Playwright,
 * no Xvfb+Brave+x11vnc quartet, no plan-step state machine. Saves
 * time + money + browser inventory for tasks that don't need any of it.
 *
 * Caller (tasks.create) is responsible for:
 *   - Creating the task row (status='executing') BEFORE invoking us.
 *   - Persisting the outcome (persistVisionOutcome) AFTER we return.
 *   - Broadcasting the terminal frame to the user's WS connection.
 *
 * (Phase 24 dropped the in-memory concurrency tracker; per-user
 * concurrency is gated upstream via DB count of in-flight tasks.)
 *
 * We intentionally do NOT touch any of the above ourselves — the
 * caller already has the repo + WS broadcaster wired up, and keeping
 * this runner pure makes it easy to test and to swap the API for a
 * different model without touching task lifecycle code.
 */

import type Anthropic from '@anthropic-ai/sdk';
import type { Logger } from 'pino';
import { buildPromptSchemaSuffix } from '../execution/execution-contract.js';
import { buildLayeredSystemPrompt, classifyRole } from './supercar/prompt-layers.js';
// Phase 2 — typed expert workflow framework. When the
// EXPERT_WORKFLOW flag is on AND the intent matches a registered
// workflow, the runner runs deterministic intake (parse →
// validators) before invoking the model. Missing fields or
// arithmetic contradictions short-circuit to an awaiting_user
// park BEFORE any token cost.
import { getFeatureFlags } from '../execution/feature-flags.js';
import type { ExpertWorkflowContract } from '../execution/expert-workflow-contract.js';
import { runIntake } from '../execution/expert-workflow-intake.js';
import {
  buildFollowUpFooter,
  buildReportSystemPrompt,
} from '../execution/expert-workflow-prompt.js';
import { matchExpertWorkflow } from '../execution/expert-workflow-registry.js';

/** Content blocks for the user message — text/image/document blocks from
 *  parsed file attachments. Loose typing (just `{ type: string }`) so
 *  we don't pin to one SDK version's exact shape; the parser already
 *  produces SDK-compatible blocks and we just pass them through. */
type AttachmentBlock = { type: string };

export interface GenerateOutcome {
  status: 'completed' | 'failed' | 'awaiting_user';
  /**
   * Final assembled text. Empty string when status='failed'.
   * For status='awaiting_user' this is the visible question text
   * (with the `[AWAITING_USER_INPUT]` machine marker stripped).
   */
  summary: string;
  /** Failure reason — only set when status='failed'. */
  reason?: string;
  inputTokens: number;
  outputTokens: number;
  /** Wall-clock time including web_search round-trips. */
  durationMs: number;
}

/**
 * Detection helper for the `[AWAITING_USER_INPUT]` machine marker
 * the expert-workflow preamble injects. Mirrors the supercar agent
 * loop's `looksLikePendingQuestion`/`stripAwaitingUserMarker` pair —
 * generate has no agent loop so we check + strip here instead.
 */
const AWAITING_USER_MARKER_RE = /\[AWAITING[_ ]USER[_ ]INPUT\]/i;

function stripAwaitingUserMarker(text: string): string {
  return text.replace(/\s*\[AWAITING[_ ]USER[_ ]INPUT\]\s*/gi, ' ').trim();
}

export interface RunGenerateOpts {
  taskId: string;
  /** External user id — for logging only; runner doesn't talk to DB. */
  userId: string;
  intent: string;
  /**
   * Optional skill / role id chosen explicitly by the user. When
   * present and non-'none', overrides the keyword-based classifyRole
   * match for the system-prompt addon. The role library matches by
   * name, so this should be one of the ROLE_PROMPTS keys or the
   * matching role's `name` field.
   */
  skillId?: string;
  client: Anthropic;
  logger: Logger;
  /** Cap on response tokens. Default 8192 — enough for a long PRD. */
  maxTokens?: number;
  /** Override the default Sonnet 4.6. */
  model?: string;
  /**
   * File-attachment content blocks parsed by parseFileForPrompt.
   * Prepended to the user's message so the model sees attachments
   * before the intent text — same convention as runSupercarTask.
   * Empty / omitted = no attachments.
   */
  attachments?: ReadonlyArray<AttachmentBlock>;
  /**
   * Phase 22a — wall-clock cap on the API call. AbortController
   * fires when the timer expires; any in-flight messages.create
   * rejects with AbortError, which we catch + report as a failed
   * outcome. Without this, an SDK hang (rare but observed) leaves
   * the task at status='executing' forever.
   */
  timeoutMs?: number;
  /**
   * Phase 24 RC follow-up — streaming delta callback. Fired once
   * per text-delta event from the Anthropic stream. tasks.ts wires
   * this to `broadcastToUser({type:'server.task.stream', taskId,
   * delta})`. Optional — when omitted, the runner still streams
   * server-side (so retry-on-empty works) but the SPA won't see
   * incremental output.
   */
  onStreamDelta?: (delta: string) => void;
  /**
   * Phase 2b — when tasks.ts has already resolved the typed expert
   * workflow (via the registry's matchExpertWorkflow on the user's
   * raw input.intent), pass it through here so the runner doesn't
   * re-match against the combined parent-context-prefixed intent.
   *
   * Why: on a follow-up tasks.create, `opts.intent` is the
   * effectiveIntent string with parent context block prepended.
   * That parent context is the prior task's full report summary,
   * which incidentally contains tokens (诊断 / 直播 / 抖音 in some
   * cases) that can flip the matcher to a DIFFERENT workflow than
   * the one tasks.ts already locked in based on the user's actual
   * reply. Passing the resolved workflow keeps the decisions
   * consistent across the two layers.
   *
   * `null` / undefined = re-run the matcher inside (legacy / forward-
   * path behaviour, also fine for non-follow-up calls because
   * input.intent and effectiveIntent agree there).
   */
  workflowOverride?: ExpertWorkflowContract | null;
}

const DEFAULT_MODEL = 'claude-sonnet-4-6';
const DEFAULT_MAX_TOKENS = 8192;
// Phase 24 RC follow-up — bumped 120s → 300s after RC's V2 SOP-write
// task hit the wall on a long-form output. SOPs / contracts / detailed
// proposals routinely run 90-150s of streaming; the old 120s margin
// fired on the slowest 10% even when the model was making steady
// progress. 300s is the supercar's per-call cap, matched here so a
// single long generate never times out before its supercar cousin.
const DEFAULT_TIMEOUT_MS = 300_000;
// F2 — heartbeat cap. The 300s wall-clock above is a budget; if
// streaming sits idle (no text deltas, no stop_reason) for HEARTBEAT
// the call is presumed wedged — Anthropic occasionally ships an
// open SSE that never produces tokens, and waiting the full 300s
// just spins "正在启动…" with no progress. 45s is generous for the
// slow first-token lane (cold cache, large web_search round-trips
// take 15-30s) without leaving users staring at a dead screen.
const HEARTBEAT_TIMEOUT_MS = 45_000;
const HEARTBEAT_TICK_MS = 5_000;

/**
 * Run the task. Resolves with the outcome regardless of success — the
 * caller decides how to persist. Throws ONLY for programmer errors
 * (bad opts shape); API failures are reported as `status: 'failed'`.
 */
export async function runGenerateTask(opts: RunGenerateOpts): Promise<GenerateOutcome> {
  const start = Date.now();
  const log = opts.logger.child({ taskId: opts.taskId, runner: 'generate' });

  // Resolve role for the system-prompt addon. Prefer explicit skillId,
  // fall back to the keyword classifier (free, in-memory). 'none' is
  // the safe baseline — buildLayeredSystemPrompt handles it cleanly.
  const explicitRole = opts.skillId && opts.skillId !== 'none' ? opts.skillId : null;
  const roleId = explicitRole ?? classifyRole(opts.intent);

  // Phase 2 — expert-workflow intake gate. When the flag is on AND
  // the intent maps to a registered workflow (today: douyin-review),
  // run deterministic parse + validators BEFORE any model call.
  //
  // Three outcomes:
  //   missing       — required inputs absent → return awaiting_user
  //                   with the structured clarification question
  //   contradiction — arithmetic check failed (e.g. GMV ÷ orders ≠
  //                   declared 客单价 by > 20%) → return awaiting_user
  //                   asking the user to confirm which value is right
  //   ready         — all data + arithmetic clean → swap the role's
  //                   default system prompt for the workflow's
  //                   structured report prompt and let the rest of
  //                   the runner proceed
  //
  // Reply path is automatically covered: tasks.reply re-invokes
  // runGenerateTask with the original-intent + reply-message
  // combined, the matcher fires on the combined text, and the
  // intake re-runs against the merged data.
  let workflow: ExpertWorkflowContract | null = null;
  let workflowReportSystem: string | null = null;
  if (getFeatureFlags().EXPERT_WORKFLOW) {
    // If tasks.ts already locked in the workflow on the raw user
    // input, respect that. Otherwise (forward-path call where
    // tasks.ts didn't pre-resolve, or pre-Phase-2b callsites) run
    // the matcher inline.
    workflow =
      opts.workflowOverride !== undefined
        ? opts.workflowOverride
        : matchExpertWorkflow({ intent: opts.intent, roleId: opts.skillId ?? null });
    if (workflow) {
      const intake = runIntake(workflow, opts.intent);
      log.info(
        {
          workflowId: workflow.workflowId,
          intakeKind: intake.kind,
          missingRequired: intake.parseResult.missingRequired.map((i) => i.name),
          extracted: Object.keys(intake.parseResult.extracted),
        },
        'expert-workflow: intake decided',
      );
      if (intake.kind === 'missing') {
        // Park with the clarification question. tasks.ts persists
        // status=awaiting_user, awaitingQuestion=summary,
        // awaitingKind='clarification'.
        return {
          status: 'awaiting_user',
          summary: intake.question,
          inputTokens: 0,
          outputTokens: 0,
          durationMs: Date.now() - start,
        };
      }
      if (intake.kind === 'contradiction') {
        // Same persistence shape as missing — caller surfaces the
        // arithmetic-conflict question to the user.
        return {
          status: 'awaiting_user',
          summary: intake.question,
          inputTokens: 0,
          outputTokens: 0,
          durationMs: Date.now() - start,
        };
      }
      // intake.kind === 'ready' — build the structured report
      // prompt and use it INSTEAD OF the default role-layered prompt.
      workflowReportSystem = buildReportSystemPrompt({
        workflow,
        extracted: intake.parseResult.extracted,
        validatorResults: intake.validatorResults,
      });
    }
  }

  // Codex Pack C3 — JSON schema suffix. When the intent matches a
  // known kind (stock / ecommerce / comparison / general_with_links),
  // append a structured-output spec so the model produces a JSON
  // block alongside its prose. The verifier's url_count /
  // result_count / price_sort checks already validate the structure
  // post-run; this suffix gives the model a fighting chance of
  // producing valid output on the first try. Workflow tier already
  // has its own structured prompt (workflowReportSystem) so we only
  // augment the layered fallback path.
  const schemaSuffix = workflowReportSystem ? '' : buildPromptSchemaSuffix(opts.intent);
  const system = (workflowReportSystem ?? buildLayeredSystemPrompt(roleId)) + schemaSuffix;

  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  log.info(
    {
      roleId,
      model: opts.model ?? DEFAULT_MODEL,
      timeoutMs,
      intentPreview: opts.intent.slice(0, 80),
    },
    'generate: starting',
  );

  // Phase 22a — wall-clock timeout. AbortSignal aborts the in-flight
  // fetch; SDK rejects with AbortError, caught below.
  const abortController = new AbortController();
  const timeoutTimer = setTimeout(() => {
    log.warn({ timeoutMs }, 'generate: timeout — aborting');
    abortController.abort();
  }, timeoutMs);

  // Phase 24 RC follow-up — empty-content retry. RC data showed
  // 7/165 generate tasks landed an empty `text` block on the first
  // call (model returned a server_tool_use without producing visible
  // output). One retry usually resolves it. Bound at 2 attempts so
  // a genuinely-stuck prompt fails fast instead of looping.
  const MAX_ATTEMPTS = 2;
  const requestArgs = {
    model: opts.model ?? DEFAULT_MODEL,
    max_tokens: opts.maxTokens ?? DEFAULT_MAX_TOKENS,
    // Cache the system addon — when 100 tasks fire under the same
    // role-id in a window, the role addon is a cache hit on every
    // request after the first.
    system: [{ type: 'text' as const, text: system, cache_control: { type: 'ephemeral' as const } }],
    messages: [
      {
        role: 'user' as const,
        content:
          opts.attachments && opts.attachments.length > 0
            ? ([
                ...opts.attachments,
                { type: 'text', text: opts.intent },
              ] as unknown as never)
            : opts.intent,
      },
    ],
    // Allow but don't force web_search. Up to 5 server-side queries
    // per turn. The model uses zero for "translate this" and a few
    // for "give me a 2026 industry brief" — pay-per-use, not blocked.
    tools: [
      {
        type: 'web_search_20260209',
        name: 'web_search',
        max_uses: 5,
      } as unknown as never,
    ],
  };

  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  // F4 — auto-continue on max_tokens. Initial call + up to 2 follow-up
  // calls (so a long PRD / detailed report has up to 3 × maxTokens of
  // budget). Each continuation feeds the prior accumulation back as
  // assistant content + a "请继续上文，不要重复已有内容" user nudge.
  // After exhausting continuations, append a visible truncation
  // notice so the user knows to ask for the rest.
  const MAX_CONTINUATIONS = 2;
  const CONTINUE_PROMPT = '请继续上文，不要重复已有内容。';
  const TRUNCATION_NOTICE =
    '\n\n---\n⚠️ 内容因长度限制被截断，如需完整版请追问。';
  const baseMessages = requestArgs.messages;
  let accumulatedSummary = '';
  let truncatedAtCap = false;

  try {
    continuationLoop: for (
      let continuation = 0;
      continuation <= MAX_CONTINUATIONS;
      continuation++
    ) {
      // First call uses the original user message; continuations
      // append the prior assistant text + a continuation nudge so
      // the model picks up where it left off.
      const messages =
        continuation === 0
          ? baseMessages
          : ([
              ...baseMessages,
              { role: 'assistant' as const, content: accumulatedSummary },
              { role: 'user' as const, content: CONTINUE_PROMPT },
            ] as unknown as typeof baseMessages);

      // Empty-response retry inner loop. Anthropic occasionally
      // returns a server_tool_use without producing visible output
      // — one retry usually resolves it, two attempts is the cap.
      // F2 — also covers heartbeat aborts: 45s without ANY stream
      // event triggers a per-call abort that lands here as a normal
      // retry. Two failed attempts → heartbeat error message instead
      // of generic "empty response".
      let summary = '';
      let stopReason: string | null = null;
      let lastInputTokens = 0;
      let lastOutputTokens = 0;
      let lastFailureWasHeartbeat = false;
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        // Per-stream AbortController, chained to the outer wall-clock.
        // Outer abort cascades down (kills this stream too); heartbeat
        // aborts stay LOCAL — we want to retry the stream, not kill
        // the whole runner.
        const streamAbort = new AbortController();
        const onParentAbort = (): void => streamAbort.abort();
        if (abortController.signal.aborted) {
          streamAbort.abort();
        } else {
          abortController.signal.addEventListener('abort', onParentAbort, {
            once: true,
          });
        }

        let lastProgress = Date.now();
        let heartbeatFired = false;
        const heartbeatTimer = setInterval(() => {
          if (Date.now() - lastProgress > HEARTBEAT_TIMEOUT_MS) {
            heartbeatFired = true;
            log.warn(
              {
                attempt,
                continuation,
                heartbeatMs: HEARTBEAT_TIMEOUT_MS,
                idleMs: Date.now() - lastProgress,
              },
              'generate: heartbeat timeout — aborting stream for retry',
            );
            streamAbort.abort();
          }
        }, HEARTBEAT_TICK_MS);

        try {
          // Phase 24 RC follow-up — switched messages.create →
          // messages.stream so the SPA can render incrementally.
          // Continuations stream into the same onStreamDelta callback,
          // so the SPA's streamingByTask buffer naturally accumulates
          // the full multi-call output.
          const stream = opts.client.messages.stream(
            { ...requestArgs, messages },
            { signal: streamAbort.signal },
          );
          if (opts.onStreamDelta) {
            const cb = opts.onStreamDelta;
            stream.on('text', (delta: string): void => {
              if (delta) {
                lastProgress = Date.now();
                try {
                  cb(delta);
                } catch (err) {
                  log.warn(
                    { err: err instanceof Error ? err.message : String(err) },
                    'generate: onStreamDelta callback threw (swallowed)',
                  );
                }
              }
            });
          } else {
            // No delta callback wired but we still want progress
            // tracking; observe the underlying SSE event stream.
            stream.on('text', (delta: string): void => {
              if (delta) lastProgress = Date.now();
            });
          }
          // Any stream event counts as progress — covers tool_use /
          // content_block_start ticks where text deltas pause.
          stream.on('streamEvent', (): void => {
            lastProgress = Date.now();
          });

          const finalMessage = await stream.finalMessage();
          summary = finalMessage.content
            .map((b) => (b.type === 'text' ? b.text : ''))
            .join('')
            .trim();
          stopReason = finalMessage.stop_reason;
          lastInputTokens = finalMessage.usage?.input_tokens ?? 0;
          lastOutputTokens = finalMessage.usage?.output_tokens ?? 0;
          lastFailureWasHeartbeat = false;
          if (summary) {
            if (attempt > 1) {
              log.info(
                { attempt, continuation, summaryLen: summary.length },
                'generate: empty-response retry succeeded',
              );
            }
            break;
          }
          log.warn(
            {
              attempt,
              continuation,
              maxAttempts: MAX_ATTEMPTS,
              stopReason,
              inputTokens: lastInputTokens,
              outputTokens: lastOutputTokens,
            },
            attempt < MAX_ATTEMPTS
              ? 'generate: empty response — retrying'
              : 'generate: empty response (final attempt, giving up)',
          );
        } catch (err) {
          if (heartbeatFired) {
            // Local heartbeat abort — retry next attempt. NOT the
            // outer wall-clock; outer is still running.
            lastFailureWasHeartbeat = true;
            if (attempt === MAX_ATTEMPTS) {
              log.warn(
                { attempt, continuation, heartbeatMs: HEARTBEAT_TIMEOUT_MS },
                'generate: heartbeat timeout (final attempt, giving up)',
              );
            }
            // Fall through to next iteration of attempt loop.
          } else {
            // Outer wall-clock abort or genuine API failure — bubble
            // up to the outer try/catch which decides accumulated-
            // partial-vs-failed.
            throw err;
          }
        } finally {
          clearInterval(heartbeatTimer);
          abortController.signal.removeEventListener('abort', onParentAbort);
        }
      }

      totalInputTokens += lastInputTokens;
      totalOutputTokens += lastOutputTokens;

      if (!summary) {
        // Both attempts of this stream returned empty. Treat as fatal
        // for the WHOLE run — earlier accumulation is preserved if any
        // (rare: we already produced text and a follow-up returned
        // nothing). Surface that partial as the failure reason text.
        // F2 — distinguish heartbeat-timeout failures from generic
        // empty-response failures. Heartbeat means the API streamed
        // nothing for 45s on both tries — usually a wedged session
        // or upstream issue. Different reason text gives operators
        // a clearer signal in error_message.
        const partial = accumulatedSummary;
        let reason: string;
        if (partial) {
          reason = lastFailureWasHeartbeat
            ? `AI 续写时长时间无响应，已生成 ${partial.length} 字。`
            : `AI 在续写时返回空内容，已生成 ${partial.length} 字。`;
        } else if (lastFailureWasHeartbeat) {
          reason = 'AI 长时间没有响应，请简化任务后重试。';
        } else {
          reason = 'AI 连续两次返回空内容，请重试或简化任务。';
        }
        return {
          status: 'failed',
          summary: '',
          reason,
          inputTokens: totalInputTokens,
          outputTokens: totalOutputTokens,
          durationMs: Date.now() - start,
        };
      }

      // Expert-workflow intake park: the preamble instructs the
      // model to emit `[AWAITING_USER_INPUT]` on a dedicated line
      // when it needs more info before producing a real report.
      // supercar's agent loop catches the marker as a park signal;
      // generate has no loop, so we surface it as a distinct
      // outcome status. The marker can in theory appear during a
      // continuation; combine accumulation + this turn first.
      const combined = accumulatedSummary + summary;
      if (AWAITING_USER_MARKER_RE.test(combined)) {
        const visibleQuestion = stripAwaitingUserMarker(combined);
        log.info(
          {
            questionLen: visibleQuestion.length,
            continuation,
            durationMs: Date.now() - start,
            inputTokens: totalInputTokens,
            outputTokens: totalOutputTokens,
          },
          'generate: parking on awaiting_user marker',
        );
        return {
          status: 'awaiting_user',
          summary: visibleQuestion,
          inputTokens: totalInputTokens,
          outputTokens: totalOutputTokens,
          durationMs: Date.now() - start,
        };
      }

      accumulatedSummary = combined;

      if (stopReason !== 'max_tokens') {
        // Model finished naturally — stop continuing.
        log.info(
          {
            stopReason,
            continuation,
            inputTokens: totalInputTokens,
            outputTokens: totalOutputTokens,
            summaryLen: accumulatedSummary.length,
            streaming: true,
          },
          'generate: completed',
        );
        break continuationLoop;
      }

      // stopReason === 'max_tokens'.
      if (continuation === MAX_CONTINUATIONS) {
        // Last call also hit the cap — surface the truncation
        // notice and stop. Avoids unbounded continuation cost.
        truncatedAtCap = true;
        log.warn(
          {
            continuations: continuation + 1,
            totalLen: accumulatedSummary.length,
            inputTokens: totalInputTokens,
            outputTokens: totalOutputTokens,
          },
          'generate: still max_tokens after continuations — appending truncation notice',
        );
        break continuationLoop;
      }

      log.info(
        {
          continuation: continuation + 1,
          soFarLen: accumulatedSummary.length,
          inputTokens: totalInputTokens,
          outputTokens: totalOutputTokens,
        },
        'generate: max_tokens — continuing',
      );
    }

    const baseSummary = truncatedAtCap
      ? accumulatedSummary + TRUNCATION_NOTICE
      : accumulatedSummary;
    // Phase 2 — append the workflow's follow-up actions footer.
    // Empty string when no workflow matched (legacy generate path)
    // or when the workflow has no follow-ups configured. SPA renders
    // the marker block as a chip rail; default markdown renderers
    // fall through to a plain link list.
    const finalSummary = workflow
      ? baseSummary + buildFollowUpFooter(workflow)
      : baseSummary;

    return {
      status: 'completed',
      summary: finalSummary,
      inputTokens: totalInputTokens,
      outputTokens: totalOutputTokens,
      durationMs: Date.now() - start,
    };
  } catch (err) {
    const isAbort =
      abortController.signal.aborted ||
      (err instanceof Error &&
        (err.name === 'AbortError' || /aborted/i.test(err.message)));
    const reason = isAbort
      ? `生成超时（>${Math.round(timeoutMs / 1000)} 秒），请重试或简化任务。`
      : err instanceof Error
        ? err.message
        : String(err);
    const durationMs = Date.now() - start;
    log.warn(
      {
        err: reason,
        durationMs,
        isAbort,
        timeoutMs,
        accumulatedLen: accumulatedSummary.length,
      },
      isAbort ? 'generate: timeout' : 'generate: api call failed',
    );
    // F4 — preserve accumulated text when a continuation throws.
    // Better to deliver a truncated answer with a clear notice than
    // discard a 4000-char draft because the second stream call hit a
    // network blip.
    if (accumulatedSummary.length > 0) {
      // Phase 2 — same footer-append discipline as the happy path
      // so a partially-streamed report still ships with chips.
      const partialSummary =
        accumulatedSummary +
        '\n\n---\n⚠️ 内容因网络/超时被截断，如需完整版请追问。';
      return {
        status: 'completed',
        summary: workflow ? partialSummary + buildFollowUpFooter(workflow) : partialSummary,
        inputTokens: totalInputTokens,
        outputTokens: totalOutputTokens,
        durationMs,
      };
    }
    return {
      status: 'failed',
      summary: '',
      reason,
      inputTokens: totalInputTokens,
      outputTokens: totalOutputTokens,
      durationMs,
    };
  } finally {
    clearTimeout(timeoutTimer);
  }
}
