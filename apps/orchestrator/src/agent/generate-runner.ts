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
 *   - Calling concurrency-tracker.trackEnd in a finally block.
 *
 * We intentionally do NOT touch any of the above ourselves — the
 * caller already has the repo + WS broadcaster wired up, and keeping
 * this runner pure makes it easy to test and to swap the API for a
 * different model without touching task lifecycle code.
 */

import type Anthropic from '@anthropic-ai/sdk';
import type { Logger } from 'pino';
import { buildLayeredSystemPrompt, classifyRole } from './supercar/prompt-layers.js';

/** Content blocks for the user message — text/image/document blocks from
 *  parsed file attachments. Loose typing (just `{ type: string }`) so
 *  we don't pin to one SDK version's exact shape; the parser already
 *  produces SDK-compatible blocks and we just pass them through. */
type AttachmentBlock = { type: string };

export interface GenerateOutcome {
  status: 'completed' | 'failed';
  /** Final assembled text. Empty string when status='failed'. */
  summary: string;
  /** Failure reason — only set when status='failed'. */
  reason?: string;
  inputTokens: number;
  outputTokens: number;
  /** Wall-clock time including web_search round-trips. */
  durationMs: number;
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
}

const DEFAULT_MODEL = 'claude-sonnet-4-6';
const DEFAULT_MAX_TOKENS = 8192;
const DEFAULT_TIMEOUT_MS = 120_000;

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
  const system = buildLayeredSystemPrompt(roleId);

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

  try {
    const res = await opts.client.messages.create(
      {
        model: opts.model ?? DEFAULT_MODEL,
        max_tokens: opts.maxTokens ?? DEFAULT_MAX_TOKENS,
      // Cache the system addon — when 100 tasks fire under the same
      // role-id in a window, the role addon is a cache hit on every
      // request after the first.
      system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
      messages: [
        {
          role: 'user',
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
      },
      { signal: abortController.signal },
    );

    // Concatenate text blocks — anything that isn't text (server-tool-use
    // results, etc.) gets dropped silently. Most generate tasks will
    // just be one or two text blocks.
    const summary = res.content
      .map((b) => (b.type === 'text' ? b.text : ''))
      .join('')
      .trim();

    const inputTokens = res.usage?.input_tokens ?? 0;
    const outputTokens = res.usage?.output_tokens ?? 0;
    const durationMs = Date.now() - start;

    if (!summary) {
      log.warn(
        { stopReason: res.stop_reason, inputTokens, outputTokens, durationMs },
        'generate: empty response',
      );
      return {
        status: 'failed',
        summary: '',
        reason: 'AI 没有返回任何内容，请重试。',
        inputTokens,
        outputTokens,
        durationMs,
      };
    }

    log.info(
      {
        stopReason: res.stop_reason,
        inputTokens,
        outputTokens,
        durationMs,
        summaryLen: summary.length,
      },
      'generate: completed',
    );

    return {
      status: 'completed',
      summary,
      inputTokens,
      outputTokens,
      durationMs,
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
      { err: reason, durationMs, isAbort, timeoutMs },
      isAbort ? 'generate: timeout' : 'generate: api call failed',
    );
    return {
      status: 'failed',
      summary: '',
      reason,
      inputTokens: 0,
      outputTokens: 0,
      durationMs,
    };
  } finally {
    clearTimeout(timeoutTimer);
  }
}
