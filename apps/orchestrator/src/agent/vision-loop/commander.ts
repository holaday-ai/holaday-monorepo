/**
 * VisionLoopCommander — the new control plane for HOLA DAY after the
 * 2026-04-19 architecture pivot (see docs/MIGRATION_PLAN.md).
 *
 * Replaces `AnthropicPlanner`'s plan-once + selector-heal model with a
 * tick-by-tick vision loop:
 *
 *   loop {
 *     observation = driver.screenshot() + url + title
 *     decision    = commander.decideNextAction({intent, observation, history})
 *     if decision.action.kind === 'done' | 'give_up' → exit
 *     driver.execute(decision.action) // CDP: click(x,y), type, key, scroll
 *     history.push({observation, action})
 *   }
 *
 * No ResilientSelector. No Skill catalogue routing. No origin guard.
 * Claude looks at the actual pixels, picks one action, the driver
 * executes it. Loop exits on `task_done` / `task_give_up` or when
 * `maxSteps` (30 at Phase A) is reached.
 *
 * Skills become optional hint strings — docs/SKILL.md bodies are
 * still useful to Claude as context ("here's what the Douyin creator
 * dashboard looks like, here's the usual flow") but selection is the
 * user's / Claude's call, not a DB join. That scaffolding lands Phase B.
 */

import type Anthropic from '@anthropic-ai/sdk';
import { type LlmCallRecorder, NoopLlmCallRecorder } from '../llm-call-recorder.js';
import { A11Y_TOOLS, type A11yAction, decodeA11yToolUse } from './actions-a11y.js';
import { VISION_TOOLS, type VisionAction, decodeToolUse } from './actions.js';
import { type ResizedImage, resizeForVisionModel } from './image.js';
import type { AccessibilityNodeRef } from './playwright-executor.js';
import { isRetryableAnthropicError, retryAsync } from './retry.js';

/**
 * Live state of the page as seen by the commander at the start of
 * a loop tick. The driver produces this after every action and hands
 * it back to the orchestrator, which feeds it into `decideNextAction`.
 */
export interface VisionObservation {
  /**
   * Base64 JPEG of the viewport BEFORE resize for the model — we ship
   * real-pixel bytes through the WS channel and the commander resizes
   * server-side so it knows the exact model-space scale.
   */
  screenshotBase64: string;
  /** Real viewport dimensions (driver-measured, not window.devicePixelRatio). */
  viewportWidth: number;
  viewportHeight: number;
  /** Live URL of the active tab. Grounds the model in what site it's on. */
  url: string;
  /** <title> — helps disambiguate "is this the login page or the dashboard". */
  title: string;
  /** Monotonic step counter (0-indexed). Included in log lines / traces. */
  tickIndex: number;
}

/**
 * One prior loop turn fed back into the next Claude call so the model
 * sees its own chain of reasoning. Phase A: we send every prior turn's
 * screenshot; Phase B: we may prune older observations (keep only the
 * last N or summarise with a tool_result wrapper) to cap token spend.
 */
export interface VisionLoopTurn {
  observation: VisionObservation;
  action: VisionAction;
  /**
   * Driver's report of what happened when the action ran. `ok=false`
   * means the driver couldn't execute the action (e.g. the SW lost
   * the tab, the coordinate was off-screen) — Claude sees this on
   * the next turn and can adjust.
   */
  executionResult?: { ok: boolean; message?: string };
  /**
   * `tool_use_id` Claude assigned when it emitted THIS turn's action.
   * We need to round-trip it on the next tick: Anthropic's protocol
   * requires a `tool_result` block with matching `tool_use_id` to pair
   * the new observation with the prior tool_use. The runner captures
   * it from `VisionDecision.toolUseId` and writes it here when it
   * records the completed turn.
   */
  toolUseId?: string;
}

export interface VisionLoopContext {
  /** Original user intent (free-form text). Never mutated mid-loop. */
  intent: string;
  /** External user id (usr_…). Required for llm_calls attribution. */
  userId?: string;
  /**
   * External task id (tsk_…). Stamped on every llm_calls row the
   * commander writes so operators can group rows by task. Absent in
   * unit tests that don't care about persistence.
   */
  taskExternalId?: string;
  /** Observation that triggered THIS tick. */
  observation: VisionObservation;
  /**
   * Prior turns. First tick: `[]`. Phase A keeps them all; if we see
   * token-budget issues, Phase B compacts.
   */
  history: VisionLoopTurn[];
  /** Loop cap; default 30 per Phase A plan. */
  maxSteps: number;
  /**
   * Optional free-form hint pulled from a Skill's SKILL.md body when
   * the user opted into one at task creation time. Null / missing =
   * no hint; the model figures out the site from the screenshot.
   * Skills being *mandatory routing* is what we're leaving behind;
   * Skills as *context strings* stays useful.
   */
  skillHint?: string;
  /**
   * Optional timeout warning appended to the user prompt. The runner
   * sets this on the tick where the task deadline has been reached,
   * asking the model to call task_done or task_give_up rather than
   * continuing. Presence = the next tick MUST be terminal; runner
   * enforces this with a force-finalise after the call.
   */
  timeoutHint?: string;
}

/**
 * The commander's per-tick output: an action plus the usage metadata
 * the caller persists on the llm_calls row.
 */
export interface VisionDecision {
  action: VisionAction;
  /** Optional free text the model emitted alongside the tool_use (for logs). */
  reasoning?: string;
  /** Resize descriptor actually sent this tick — caller uses scaleX/Y
   *  to translate click coordinates back to real viewport pixels. */
  image: ResizedImage;
  /** Anthropic's tool_use_id for THIS turn's action. Undefined when the
   *  action was synthesised (e.g. model returned no tool_use → give_up). */
  toolUseId?: string;
  elapsedMs: number;
  inputTokens: number;
  outputTokens: number;
  /** If Anthropic returned cache hits on the system prompt, report them so
   *  cost accounting is honest. Phase A we don't yet exploit prompt cache. */
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
}

/**
 * Accessibility-mode analogue of VisionLoopContext. Payload is the
 * annotated ariaSnapshot text (carries `[ref=eN]` markers) rather
 * than a screenshot. Cheaper to send — Claude reasons about the
 * page as a screen-reader does — and sidesteps the coordinate
 * arithmetic that keeps producing NaN clicks in screenshot mode.
 */
export interface AccessibilityLoopContext {
  intent: string;
  userId?: string;
  taskExternalId?: string;
  /** Annotated snapshot text. `[ref=eN]` markers are what Claude cites. */
  snapshot: string;
  /** Parallel lookup: ref → (role, name). Commander doesn't read this,
   *  but the runner carries it through for audit / operator logs. */
  refs: AccessibilityNodeRef[];
  url: string;
  title: string;
  tickIndex: number;
  history: AccessibilityLoopTurn[];
  maxSteps: number;
  skillHint?: string;
  timeoutHint?: string;
}

export interface AccessibilityLoopTurn {
  snapshot: string;
  url: string;
  title: string;
  action: A11yAction;
  executionResult?: { ok: boolean; message?: string };
  toolUseId?: string;
}

/**
 * Accessibility-mode decision. Parallels VisionDecision, minus the
 * `image` field (no resize in a11y mode) and carrying A11yAction
 * (ref-based) instead of VisionAction (coord-based).
 */
export interface AccessibilityDecision {
  action: A11yAction;
  reasoning?: string;
  toolUseId?: string;
  elapsedMs: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
}

/**
 * Abstract commander interface so integration tests can stub without
 * hitting Anthropic. `AnthropicVisionLoopCommander` is the production
 * implementation; a `StubVisionLoopCommander` (returns a scripted
 * sequence of actions) lands alongside the first real integration
 * test in Phase A.
 */
export interface VisionLoopCommander {
  /**
   * Observe → decide. MUST NOT throw; on API errors, schema parse
   * failures, or rate-limit hits, returns `{action: {kind: 'give_up',
   * reason}}` with the error surfaced in `reason`. Loop caller treats
   * that as a clean exit so the task pauses with a useful message.
   */
  decideNextAction(ctx: VisionLoopContext): Promise<VisionDecision>;
  /**
   * Accessibility-mode variant. Same contract (never throws, returns
   * a `give_up` action on any failure). Optional on the interface so
   * screenshot-only test stubs keep working without being forced to
   * implement both paths.
   */
  decideNextActionAccessibility?(ctx: AccessibilityLoopContext): Promise<AccessibilityDecision>;
}

// ---------------------------------------------------------------------------
// AnthropicVisionLoopCommander — real impl. Phase A skeleton: constructor
// + method signature, body stubbed. Real Anthropic call + tool_use decode
// lands in the next commit so we can iterate against the integration test.
// ---------------------------------------------------------------------------

export interface AnthropicVisionLoopCommanderOptions {
  client: Anthropic;
  /** Default `claude-sonnet-4-20250514`. Env `COMMANDER_MODEL` overrides. */
  model?: string;
  maxTokens?: number;
  /**
   * LLM accounting sink — one row per decideNextAction call lands as
   * `purpose: 'commander.vision'`. Default NoopLlmCallRecorder so
   * tests don't need a DB; production boot wires DrizzleLlmCallRecorder.
   */
  recorder?: LlmCallRecorder;
}

const DEFAULT_MODEL = 'claude-sonnet-4-6';
const DEFAULT_MAX_TOKENS = 1_024;

/**
 * How many of the most recent observation screenshots to keep as real
 * image blocks in the Anthropic request. Older ticks collapse to a
 * text placeholder ("[tick N 的截图已省略…]") so the tool_use + the
 * URL/title text of every turn survive, but the image payload — by
 * far the biggest chunk of context — only persists for the last N
 * ticks. With N=3 and a 1568px JPEG (≈70 KB base64), peak context
 * stays around 3 × 70 KB ≈ 210 KB image + ≪10 KB text per request,
 * independent of loop length. Pre-fix, a 10-tick loop shipped ~700 KB
 * of images and usually blew Anthropic's request size / latency budget.
 *
 * Override via env `COMMANDER_SCREENSHOT_WINDOW` at runtime (useful
 * for ablation).
 */
export const VISION_SCREENSHOT_WINDOW = 3;

function readScreenshotWindow(): number {
  const raw = process.env.COMMANDER_SCREENSHOT_WINDOW;
  if (!raw) return VISION_SCREENSHOT_WINDOW;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n >= 1 ? n : VISION_SCREENSHOT_WINDOW;
}

export class AnthropicVisionLoopCommander implements VisionLoopCommander {
  private readonly client: Anthropic;
  private readonly model: string;
  private readonly maxTokens: number;
  private readonly recorder: LlmCallRecorder;

  constructor(opts: AnthropicVisionLoopCommanderOptions) {
    this.client = opts.client;
    this.model = opts.model ?? process.env.COMMANDER_MODEL ?? DEFAULT_MODEL;
    this.maxTokens = opts.maxTokens ?? DEFAULT_MAX_TOKENS;
    this.recorder = opts.recorder ?? new NoopLlmCallRecorder();
  }

  async decideNextAction(ctx: VisionLoopContext): Promise<VisionDecision> {
    const startedAt = Date.now();
    // 1. Resize the current observation to ≤1568px long edge. The
    //    resulting `image` descriptor travels with the VisionDecision
    //    so callers can translate Claude's click coords back to real
    //    viewport pixels via `modelCoordToReal`.
    let image: ResizedImage;
    try {
      image = await resizeForVisionModel(
        ctx.observation.screenshotBase64,
        ctx.observation.viewportWidth,
        ctx.observation.viewportHeight,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return synthesiseGiveUp(
        `image resize failed: ${message}`,
        startedAt,
        emptyResizedImage(ctx.observation),
      );
    }

    // 2. Build Anthropic messages[]. For each prior turn we emit an
    //    assistant tool_use block (recreated from VisionLoopTurn.action
    //    + toolUseId) plus a user tool_result block that wraps the
    //    observation Claude received AFTER executing that action.
    //    Current tick's observation goes last as a user message.
    let messages: Anthropic.MessageParam[];
    try {
      messages = await buildMessages(ctx, image, readScreenshotWindow());
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return synthesiseGiveUp(`message build failed: ${message}`, startedAt, image);
    }

    // 3. Call Anthropic. `tool_choice: { type: 'any' }` forces the
    //    model to emit SOME tool_use every tick; that's the whole
    //    protocol — we never want a text-only response.
    let response: Anthropic.Message;
    try {
      response = await retryAsync(
        () =>
          this.client.messages.create({
            model: this.model,
            max_tokens: this.maxTokens,
            system: VISION_SYSTEM_PROMPT,
            tools: VISION_TOOLS as unknown as Anthropic.Tool[],
            tool_choice: { type: 'any' },
            messages,
          }),
        { isRetryable: isRetryableAnthropicError, maxAttempts: 3 },
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // Record the failed call so cost accounting stays honest — we
      // don't know token counts on API failure, so they're zero.
      await this.recordCall({
        userExternalId: ctx.userId,
        taskExternalId: ctx.taskExternalId,
        latencyMs: Date.now() - startedAt,
        status: 'error',
        inputTokens: 0,
        outputTokens: 0,
        cacheReadInputTokens: 0,
        cacheCreationInputTokens: 0,
        errorMessage: message.slice(0, 512),
      });
      return synthesiseGiveUp(`Anthropic API error: ${message}`, startedAt, image);
    }

    const elapsedMs = Date.now() - startedAt;
    const usage = {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      cacheReadInputTokens: response.usage.cache_read_input_tokens ?? 0,
      cacheCreationInputTokens: response.usage.cache_creation_input_tokens ?? 0,
    };

    // 4. Extract narrative text (for logs) + the first tool_use block.
    //    Models sometimes emit a short "I'll click the search button"
    //    before the tool_use; keep it as `reasoning` rather than drop.
    let reasoning: string | undefined;
    let toolUse: Anthropic.ToolUseBlock | undefined;
    for (const block of response.content) {
      if (block.type === 'text' && !reasoning) reasoning = block.text.slice(0, 2_000);
      if (block.type === 'tool_use' && !toolUse) toolUse = block;
    }

    // 5. Decode tool_use → VisionAction. decodeToolUse never throws —
    //    unknown tool names / bad inputs become a `give_up` action so
    //    the loop exits cleanly.
    if (!toolUse) {
      await this.recordCall({
        userExternalId: ctx.userId,
        taskExternalId: ctx.taskExternalId,
        latencyMs: elapsedMs,
        status: 'error',
        ...usage,
        errorMessage: `no tool_use; stop_reason=${response.stop_reason}`,
        requestMeta: { tickIndex: ctx.observation.tickIndex },
      });
      return {
        action: {
          kind: 'give_up',
          reason: `Claude returned no tool_use block; stop_reason=${response.stop_reason}`,
        },
        ...(reasoning ? { reasoning } : {}),
        image,
        elapsedMs,
        ...usage,
      };
    }
    const action = decodeToolUse(toolUse.name, toolUse.input);

    await this.recordCall({
      userExternalId: ctx.userId,
      taskExternalId: ctx.taskExternalId,
      latencyMs: elapsedMs,
      status: 'ok',
      ...usage,
      requestMeta: {
        tickIndex: ctx.observation.tickIndex,
        toolName: toolUse.name,
        actionKind: action.kind,
      },
    });

    return {
      action,
      ...(reasoning ? { reasoning } : {}),
      image,
      toolUseId: toolUse.id,
      elapsedMs,
      ...usage,
    };
  }

  /**
   * Accessibility-mode counterpart of `decideNextAction`. Text-only:
   * no screenshot resize, no image blocks, no sliding window —
   * sending a fresh a11y snapshot every tick is cheap enough
   * (≈1-4KB/tick vs ≈70KB for a JPEG, ~20× cheaper).
   *
   * Same contract: never throws; on failure returns a `give_up`
   * action via the shared AccessibilityDecision shape.
   */
  async decideNextActionAccessibility(
    ctx: AccessibilityLoopContext,
  ): Promise<AccessibilityDecision> {
    const startedAt = Date.now();
    let messages: Anthropic.MessageParam[];
    try {
      messages = buildA11yMessages(ctx);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return synthesiseA11yGiveUp(`message build failed: ${message}`, startedAt);
    }

    let response: Anthropic.Message;
    try {
      response = await retryAsync(
        () =>
          this.client.messages.create({
            model: this.model,
            max_tokens: this.maxTokens,
            system: A11Y_SYSTEM_PROMPT,
            tools: A11Y_TOOLS as unknown as Anthropic.Tool[],
            tool_choice: { type: 'any' },
            messages,
          }),
        { isRetryable: isRetryableAnthropicError, maxAttempts: 3 },
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await this.recordCall({
        userExternalId: ctx.userId,
        taskExternalId: ctx.taskExternalId,
        latencyMs: Date.now() - startedAt,
        status: 'error',
        inputTokens: 0,
        outputTokens: 0,
        cacheReadInputTokens: 0,
        cacheCreationInputTokens: 0,
        errorMessage: message.slice(0, 512),
        purpose: 'commander.accessibility',
      });
      return synthesiseA11yGiveUp(`Anthropic API error: ${message}`, startedAt);
    }

    const elapsedMs = Date.now() - startedAt;
    const usage = {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      cacheReadInputTokens: response.usage.cache_read_input_tokens ?? 0,
      cacheCreationInputTokens: response.usage.cache_creation_input_tokens ?? 0,
    };

    let reasoning: string | undefined;
    let toolUse: Anthropic.ToolUseBlock | undefined;
    for (const block of response.content) {
      if (block.type === 'text' && !reasoning) reasoning = block.text.slice(0, 2_000);
      if (block.type === 'tool_use' && !toolUse) toolUse = block;
    }

    if (!toolUse) {
      await this.recordCall({
        userExternalId: ctx.userId,
        taskExternalId: ctx.taskExternalId,
        latencyMs: elapsedMs,
        status: 'error',
        ...usage,
        errorMessage: `no tool_use; stop_reason=${response.stop_reason}`,
        requestMeta: { tickIndex: ctx.tickIndex },
        purpose: 'commander.accessibility',
      });
      return {
        action: {
          kind: 'give_up',
          reason: `Claude returned no tool_use block; stop_reason=${response.stop_reason}`,
        },
        ...(reasoning ? { reasoning } : {}),
        elapsedMs,
        ...usage,
      };
    }

    const action = decodeA11yToolUse(toolUse.name, toolUse.input);
    await this.recordCall({
      userExternalId: ctx.userId,
      taskExternalId: ctx.taskExternalId,
      latencyMs: elapsedMs,
      status: 'ok',
      ...usage,
      requestMeta: {
        tickIndex: ctx.tickIndex,
        toolName: toolUse.name,
        actionKind: action.kind,
      },
      purpose: 'commander.accessibility',
    });

    return {
      action,
      ...(reasoning ? { reasoning } : {}),
      toolUseId: toolUse.id,
      elapsedMs,
      ...usage,
    };
  }

  /**
   * Shared helper to record one llm_calls row per decideNextAction
   * call. Purpose is always `commander.vision`; provider is always
   * `anthropic`. Wraps the record call in a try so a DB miss never
   * kills the loop — the recorder itself also logs on failure.
   */
  private async recordCall(row: {
    userExternalId?: string;
    taskExternalId?: string;
    latencyMs: number;
    status: 'ok' | 'error';
    inputTokens: number;
    outputTokens: number;
    cacheReadInputTokens: number;
    cacheCreationInputTokens: number;
    errorMessage?: string;
    requestMeta?: Record<string, unknown>;
    /** Default `commander.vision`. A11y path passes `commander.accessibility`. */
    purpose?: 'commander.vision' | 'commander.accessibility';
  }): Promise<void> {
    // Recorder requires userExternalId (llm_calls.user_id NOT NULL).
    // Skip persistence entirely when the caller didn't pass one —
    // keeps the commander usable from test contexts without making
    // the column nullable.
    if (!row.userExternalId) return;
    try {
      await this.recorder.record({
        userExternalId: row.userExternalId,
        ...(row.taskExternalId ? { taskExternalId: row.taskExternalId } : {}),
        provider: 'anthropic',
        model: this.model,
        purpose: row.purpose ?? 'commander.vision',
        inputTokens: row.inputTokens,
        outputTokens: row.outputTokens,
        cacheReadInputTokens: row.cacheReadInputTokens,
        cacheCreationInputTokens: row.cacheCreationInputTokens,
        latencyMs: row.latencyMs,
        status: row.status,
        ...(row.errorMessage ? { errorMessage: row.errorMessage } : {}),
        ...(row.requestMeta ? { requestMeta: row.requestMeta } : {}),
      });
    } catch {
      // recorder has its own onError logger; swallow here so the
      // loop never dies on an audit row failure.
    }
  }
}

/**
 * Build the Anthropic `messages[]` array from a VisionLoopContext.
 * Each historical turn becomes two content blocks on the wire:
 *
 *   assistant: [tool_use(name=mapFromKind(turn.action), id=turn.toolUseId)]
 *   user:      [tool_result(tool_use_id=turn.toolUseId, content=[image|placeholder, text])]
 *
 * First tick has empty history; we emit a single user message with
 * [image, text(intent + url + title + skillHint?)] and let Claude
 * choose its first tool_use.
 *
 * Sliding screenshot window: observations older than the last
 * `screenshotWindow` ticks have their image block replaced with a
 * short text placeholder. The tool_use payload, URL, title, and
 * text reasoning all stay — only the bitmap is elided. See
 * `VISION_SCREENSHOT_WINDOW` for motivation.
 */
async function buildMessages(
  ctx: VisionLoopContext,
  currentImage: ResizedImage,
  screenshotWindow: number,
): Promise<Anthropic.MessageParam[]> {
  const messages: Anthropic.MessageParam[] = [];
  // Total observations this turn: one per historical turn (the
  // frame Claude saw BEFORE each recorded action) + one for the
  // current tick. Keep the last `screenshotWindow` of those as real
  // images; elide everything before.
  const totalObservations = ctx.history.length + 1;
  const keepFromIndex = Math.max(0, totalObservations - screenshotWindow);

  // Resolve the bytes for an observation. The current observation is
  // already resized (the commander did it at the top of decideNextAction);
  // historical ones go through resizeForVisionModel at build time.
  async function imageDataFor(obsIndex: number, observation: VisionObservation): Promise<string> {
    if (obsIndex === ctx.history.length) return currentImage.base64;
    const resized = await resizeForVisionModel(
      observation.screenshotBase64,
      observation.viewportWidth,
      observation.viewportHeight,
    );
    return resized.base64;
  }

  // Return the content block that represents an observation's image
  // in the wire format — real image when within window, text
  // placeholder when older. Single function so both call sites
  // (initial user message + tool_result) use the same rule.
  async function imageOrElision(
    obsIndex: number,
    observation: VisionObservation,
  ): Promise<Anthropic.TextBlockParam | Anthropic.ImageBlockParam> {
    if (obsIndex < keepFromIndex) {
      return {
        type: 'text',
        text: `[tick ${observation.tickIndex} 截图已省略以节省 context; URL/title 与操作历史保留]`,
      };
    }
    const data = await imageDataFor(obsIndex, observation);
    return {
      type: 'image',
      source: { type: 'base64', media_type: 'image/jpeg', data },
    };
  }

  // Initial user message — the goal + observation 0.
  const initialObs = ctx.history[0]?.observation ?? ctx.observation;
  const initialImageBlock = await imageOrElision(0, initialObs);
  messages.push({
    role: 'user',
    content: [
      initialImageBlock,
      {
        type: 'text',
        text: initialUserText(ctx, initialObs),
      },
    ],
  });

  // Walk history from the oldest completed turn forward.
  for (let i = 0; i < ctx.history.length; i++) {
    const turn = ctx.history[i];
    if (!turn || !turn.toolUseId) continue; // skip unpaired (should not happen)
    messages.push({
      role: 'assistant',
      content: [toolUseBlockFor(turn.action, turn.toolUseId)],
    });

    // Tool_result carries the observation that came AFTER this turn's
    // action — observation index (i + 1). If there's a turn[i+1],
    // that's its observation; otherwise the current tick's observation.
    const nextObsIndex = i + 1;
    const nextObs = ctx.history[i + 1]?.observation ?? ctx.observation;
    const nextImageBlock = await imageOrElision(nextObsIndex, nextObs);
    messages.push({
      role: 'user',
      content: [
        {
          type: 'tool_result',
          tool_use_id: turn.toolUseId,
          content: [nextImageBlock, { type: 'text', text: followupUserText(turn, nextObs) }],
        },
      ],
    });
  }

  return messages;
}

function initialUserText(ctx: VisionLoopContext, obs: VisionObservation): string {
  const lines: string[] = [];
  lines.push(`User intent: ${ctx.intent}`);
  lines.push(`Current URL: ${obs.url || '(blank)'}`);
  lines.push(`Current page title: ${obs.title || '(blank)'}`);
  lines.push(
    `Viewport (model-space): ${ctx.observation.viewportWidth}×${ctx.observation.viewportHeight}; screenshot below is the current state of the tab.`,
  );
  lines.push(`Tick ${obs.tickIndex} of at most ${ctx.maxSteps}.`);
  if (ctx.skillHint) {
    lines.push('');
    lines.push('Context for this site (optional hint, may be stale):');
    lines.push(ctx.skillHint);
  }
  if (ctx.timeoutHint) {
    lines.push('');
    lines.push(`⚠ ${ctx.timeoutHint}`);
  }
  lines.push('');
  lines.push(
    'Pick ONE tool call. Call task_done when the intent is satisfied, task_give_up when you cannot proceed.',
  );
  return lines.join('\n');
}

function followupUserText(turn: VisionLoopTurn, obs: VisionObservation): string {
  const lines: string[] = [];
  if (turn.executionResult) {
    lines.push(
      turn.executionResult.ok
        ? `Previous action executed.${
            turn.executionResult.message ? ` ${turn.executionResult.message}` : ''
          }`
        : `Previous action FAILED: ${turn.executionResult.message ?? 'no detail'}`,
    );
  }
  lines.push(`URL: ${obs.url || '(blank)'}   Title: ${obs.title || '(blank)'}`);
  lines.push(`Tick ${obs.tickIndex}.`);
  return lines.join('\n');
}

/**
 * Translate a VisionAction back into the shape Anthropic expects for
 * an assistant `tool_use` block. This is the reverse of `decodeToolUse`
 * and we keep the names in sync with VISION_TOOLS.
 */
function toolUseBlockFor(action: VisionAction, id: string): Anthropic.ToolUseBlockParam {
  const base = { type: 'tool_use' as const, id };
  switch (action.kind) {
    case 'click':
      return {
        ...base,
        name: 'computer_click',
        input: { x: action.x, y: action.y, button: action.button ?? 'left' },
      };
    case 'type':
      return { ...base, name: 'computer_type', input: { text: action.text } };
    case 'key':
      return { ...base, name: 'computer_key', input: { key: action.key } };
    case 'scroll':
      return { ...base, name: 'computer_scroll', input: { dy: action.dy } };
    case 'wait':
      return { ...base, name: 'computer_wait', input: { ms: action.ms } };
    case 'screenshot':
      return { ...base, name: 'computer_screenshot', input: {} };
    case 'done':
      return { ...base, name: 'task_done', input: { summary: action.summary } };
    case 'give_up':
      return { ...base, name: 'task_give_up', input: { reason: action.reason } };
  }
}

function emptyResizedImage(obs: VisionObservation): ResizedImage {
  return {
    base64: obs.screenshotBase64,
    originalWidth: obs.viewportWidth,
    originalHeight: obs.viewportHeight,
    resizedWidth: obs.viewportWidth,
    resizedHeight: obs.viewportHeight,
    scaleX: 1,
    scaleY: 1,
  };
}

function synthesiseA11yGiveUp(reason: string, startedAt: number): AccessibilityDecision {
  return {
    action: { kind: 'give_up', reason },
    elapsedMs: Date.now() - startedAt,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadInputTokens: 0,
    cacheCreationInputTokens: 0,
  };
}

/**
 * Build Anthropic messages[] for accessibility mode. Text-only — no
 * images. Each historical turn becomes an assistant `tool_use` block
 * paired with a user `tool_result` carrying the post-action
 * snapshot text. Current tick goes last as a user message with the
 * intent + live snapshot.
 *
 * No sliding window: a11y snapshots are ~1-4KB so we can keep every
 * tick's payload without ballooning the request.
 */
function buildA11yMessages(ctx: AccessibilityLoopContext): Anthropic.MessageParam[] {
  const messages: Anthropic.MessageParam[] = [];
  const initialSnapshot = ctx.history[0]?.snapshot ?? ctx.snapshot;
  const initialUrl = ctx.history[0]?.url ?? ctx.url;
  const initialTitle = ctx.history[0]?.title ?? ctx.title;
  messages.push({
    role: 'user',
    content: [
      {
        type: 'text',
        text: initialA11yUserText(ctx, initialUrl, initialTitle, initialSnapshot),
      },
    ],
  });

  for (let i = 0; i < ctx.history.length; i++) {
    const turn = ctx.history[i];
    if (!turn || !turn.toolUseId) continue;
    messages.push({
      role: 'assistant',
      content: [toolUseBlockForA11y(turn.action, turn.toolUseId)],
    });
    const nextSnap = ctx.history[i + 1]?.snapshot ?? ctx.snapshot;
    const nextUrl = ctx.history[i + 1]?.url ?? ctx.url;
    const nextTitle = ctx.history[i + 1]?.title ?? ctx.title;
    messages.push({
      role: 'user',
      content: [
        {
          type: 'tool_result',
          tool_use_id: turn.toolUseId,
          content: [
            {
              type: 'text',
              text: followupA11yUserText(turn, nextUrl, nextTitle, nextSnap),
            },
          ],
        },
      ],
    });
  }

  return messages;
}

function initialA11yUserText(
  ctx: AccessibilityLoopContext,
  url: string,
  title: string,
  snapshot: string,
): string {
  const lines: string[] = [];
  lines.push(`User intent: ${ctx.intent}`);
  lines.push(`Current URL: ${url || '(blank)'}`);
  lines.push(`Current page title: ${title || '(blank)'}`);
  lines.push(`Tick ${ctx.tickIndex} of at most ${ctx.maxSteps}.`);
  if (ctx.skillHint) {
    lines.push('');
    lines.push('Context for this site (optional hint, may be stale):');
    lines.push(ctx.skillHint);
  }
  if (ctx.timeoutHint) {
    lines.push('');
    lines.push(`⚠ ${ctx.timeoutHint}`);
  }
  lines.push('');
  lines.push('Accessibility snapshot (interactive elements carry [ref=eN] markers):');
  lines.push(snapshot || '(empty — page may be chrome:// or loading)');
  lines.push('');
  lines.push(
    'Pick ONE tool call, referencing elements by their ref. Call a11y_task_done when the intent is satisfied, a11y_task_give_up when you cannot proceed.',
  );
  return lines.join('\n');
}

function followupA11yUserText(
  turn: AccessibilityLoopTurn,
  url: string,
  title: string,
  snapshot: string,
): string {
  const lines: string[] = [];
  if (turn.executionResult) {
    lines.push(
      turn.executionResult.ok
        ? `Previous action executed.${
            turn.executionResult.message ? ` ${turn.executionResult.message}` : ''
          }`
        : `Previous action FAILED: ${turn.executionResult.message ?? 'no detail'}`,
    );
  }
  lines.push(`URL: ${url || '(blank)'}   Title: ${title || '(blank)'}`);
  lines.push('Updated accessibility snapshot:');
  lines.push(snapshot || '(empty)');
  return lines.join('\n');
}

/**
 * Reverse of `decodeA11yToolUse` — turn an A11yAction back into the
 * tool_use block Anthropic expects when we replay history.
 */
function toolUseBlockForA11y(action: A11yAction, id: string): Anthropic.ToolUseBlockParam {
  const base = { type: 'tool_use' as const, id };
  switch (action.kind) {
    case 'click_ref':
      return { ...base, name: 'a11y_click_ref', input: { ref: action.ref } };
    case 'type_in_ref':
      return {
        ...base,
        name: 'a11y_type_in_ref',
        input: { ref: action.ref, text: action.text },
      };
    case 'press_key':
      return { ...base, name: 'a11y_press_key', input: { key: action.key } };
    case 'scroll':
      return { ...base, name: 'a11y_scroll', input: { dy: action.dy } };
    case 'wait':
      return { ...base, name: 'a11y_wait', input: { ms: action.ms } };
    case 'screenshot':
      return { ...base, name: 'a11y_screenshot', input: {} };
    case 'navigate':
      return { ...base, name: 'a11y_navigate', input: { url: action.url } };
    case 'done':
      return { ...base, name: 'a11y_task_done', input: { summary: action.summary } };
    case 'give_up':
      return { ...base, name: 'a11y_task_give_up', input: { reason: action.reason } };
  }
}

function synthesiseGiveUp(reason: string, startedAt: number, image: ResizedImage): VisionDecision {
  return {
    action: { kind: 'give_up', reason },
    image,
    elapsedMs: Date.now() - startedAt,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadInputTokens: 0,
    cacheCreationInputTokens: 0,
  };
}

// ---------------------------------------------------------------------------
// System prompt lives in its own const so it's cacheable (prefix cache)
// once we wire it up, and so it's easy to iterate on without rebuilding
// the whole class. Body stubbed for skeleton; real prompt — with coord
// conventions, tool guidance, refusal rules — lands with the impl.
// ---------------------------------------------------------------------------

export const VISION_SYSTEM_PROMPT = `你是一个浏览器自动化助手。你通过截图理解页面，并使用提供的工具直接操作用户的 Chrome 浏览器。每一轮你会收到当前视口的截图和用户的目标；你选 ONE action 执行下一步。

# 工作方式

1. **先理解用户意图**，把任务分解成步骤，然后逐步执行（但每轮只做一步）。
2. **每一步操作后等待页面加载再观察结果**。除非 UI 变化是即时的（比如菜单展开），否则在点击/回车/导航类动作后用 \`computer_wait { ms }\` 给页面 500–1500ms 的时间，然后下一轮的截图会反映新状态。
3. **如果当前页面不适合完成任务（空白页 / 新标签页 / 错误页 / 404 / 不相关的站点），你应该主动导航**：
   - 点击地址栏（Chrome 里地址栏在顶部，通常 y ≈ 50–80），全选（\`computer_key "ctrl+a"\` 或 Mac 上 \`"cmd+a"\`）然后 \`computer_type\` 目标 URL，最后 \`computer_key "Enter"\`。
   - 不要因为当前页不对就 give_up — 先尝试导航到正确的起点。
4. **遇到弹窗 / 登录框 / Cookie 提示**，先尝试关闭或跳过：找 "关闭/×/Dismiss/稍后/拒绝/取消" 按钮。只有当登录是必须的、且你没有凭据时才 give_up。
5. **确信任务完成时**，调用 \`task_done\` 并在 \`summary\` 里用**中文**简要描述做了什么 + 结果（1–3 句）。
6. **只有在技术上无法完成**（需要登录但没有凭据、captcha 持续出现、目标站点结构性无法访问）时才 \`task_give_up\`。陌生页面 / 不确定从哪开始 / 多次点击失败，这些都不是 give_up 的理由 — 先尝试导航或换策略。

# 坐标系

- 所有 (x, y) 都是截图的像素坐标，左上角原点。
- 你看到的截图就是 model-space — 直接用你看到的坐标点击，执行器会按比例换算到用户的真实视口。

# 工具

- \`computer_click { x, y, button? }\` — 点击按钮 / 链接 / 标签 / 输入框。点击输入框 **之前** 不会自动聚焦 — 先 click 再 type。
- \`computer_type { text }\` — 向当前聚焦的字段输入文字。不能输入快捷键。
- \`computer_key { key }\` — 单键或组合键："Enter" / "Tab" / "Escape" / "ctrl+a" / "cmd+c"。用于提交表单、字段切换、地址栏全选。
- \`computer_scroll { dy }\` — dy 正值向下，负值向上（像素）。目标不在视口内时用。
- \`computer_wait { ms }\` — 等待页面加载。点击/导航后几乎总要 wait 500–1500ms 再观察。不要当作"步骤间默认停顿"滥用。
- \`computer_screenshot\` — 不执行动作只重新观察。罕用；主要用在你知道页面已经变化但不是你触发的（例如系统弹窗）。
- \`task_done { summary }\` — 任务完成。\`summary\` 必须是**中文**。
- \`task_give_up { reason }\` — 技术上无法完成。\`reason\` 简洁说明原因。

# 规则

- 每轮只调用一个工具。不要先说"我打算怎么做"，直接执行下一步。
- 每次点击都要基于**你在截图里真实看到的内容**，不要因为"通常在那个位置"就猜坐标。
- 给输入框输入文字前必须先 \`computer_click\` 聚焦。
- 导航后 / 提交表单后 / 点击可能触发加载的链接后 → **下一步用 \`computer_wait\`**，再下一轮观察。
- 如果超过 25 轮还没进展，调用 \`task_give_up\` 并说明卡在哪里。
- **永远不要输入用户的密码、2FA 验证码、支付信息**，即使对应字段已聚焦。遇到这类字段 → \`task_give_up\` reason="需要用户手动输入凭据"。

# 安全

- 视口外的内容你看不到 — 需要时 \`computer_scroll\` 探索。
- 当前标签页可能在任何站点 — 只相信截图里真实可见的。
- 不要点击 "注销/删除账户/退订" 等破坏性按钮，除非用户的目标明确要求这个动作。

# 上下文说明

注意：为节省 context，较早的截图已被省略，但操作历史（tool_use + URL + title + 你之前的推理）保留完整。你总能看到最近 3 轮的完整截图，更早的截图会显示为 "[tick N 截图已省略…]" 占位文本。需要回顾更早状态时，依靠已保留的文本操作记录即可；不要因为看不到某张旧截图就怀疑任务进度。`;

/**
 * Accessibility-mode system prompt. Model receives a screen-reader-
 * grade tree (role + name per line) with `[ref=eN]` markers on
 * interactive nodes. It operates by ref — no coordinates — which
 * removes the coord-NaN class of bugs entirely.
 */
export const A11Y_SYSTEM_PROMPT = `你是一个浏览器自动化助手。你通过页面的可访问性树（accessibility tree）理解页面，并使用提供的工具操作用户的 Chrome 浏览器。每一轮你会收到当前页面的 accessibility snapshot 和用户的目标；你选 ONE action 执行下一步。

# 输入格式

Accessibility snapshot 是 YAML-ish 文本，一行一个节点。交互元素（link / button / textbox / checkbox / combobox / tab 等）带有 [ref=eN] 标记，你通过 ref 操作它们：

    - generic:
      - heading "百度一下，你就知道" [level=1]
      - textbox "搜索" [ref=e5]
      - button "百度一下" [ref=e6]
      - link "新闻" [ref=e1]:
        - /url: "http://news.baidu.com"

**只有带 [ref=eN] 的节点能被直接操作。** 静态文本 (heading / generic / img / paragraph 等) 是页面结构提示，不能点也不能输入。

# 工作方式

1. **先理解用户意图**，拆成步骤，逐步执行（每轮一步）。
2. **每次操作后页面会变化**，你会在下一轮看到新的 snapshot — 如果刚做了点击 / 导航 / 提交，snapshot 可能还没反映变化，用 a11y_wait 500–1500ms 再下一轮观察。
3. **如果当前页面不适合完成任务** (空白页 / 错误页 / 404 / 不相关)，用 a11y_navigate 直接跳到正确 URL — 不要硬点。
4. **遇到弹窗 / Cookie 提示 / 登录框**，先尝试 dismiss（找 "关闭/×/稍后/拒绝/取消" ref）。仅在登录必须且无凭据时才 give_up。
5. **任务完成时**调 a11y_task_done，summary 用**中文**（1-3 句说明做了什么 + 结果）。
6. **只有技术上无法完成**（需登录但没凭据 / captcha 反复 / 站点结构性不可用）才 a11y_task_give_up。

# 工具

- a11y_click_ref { ref } — 点击指定 ref 的元素。输入框点击一次聚焦，按钮点击一次触发。
- a11y_type_in_ref { ref, text } — 先点击 ref 聚焦，再输入文字。一步完成 "点击输入框再输入" 的常见模式。
- a11y_press_key { key } — 给当前聚焦元素发键盘事件："Enter"/"Tab"/"Escape"/"ctrl+a"/"cmd+c"。
- a11y_scroll { dy } — dy 正值向下，负值向上。目标节点不在 snapshot 里时可能滚动后出现。
- a11y_wait { ms } — 等页面更新。点击 / 导航后 500-1500ms 再观察。
- a11y_screenshot — 不操作，只重新观察。罕用。
- a11y_navigate { url } — 直接导航到 URL（等价于地址栏输入+回车）。优于 "点地址栏-清空-打字-回车" 这一长串。
- a11y_task_done { summary } — 完成。summary 必须中文。
- a11y_task_give_up { reason } — 放弃并说明原因。

# 规则

- 每轮只调一个工具。不要在 tool_use 之前长篇解释。
- 只操作 snapshot 里真实出现的 ref。看不到 ref 时先 scroll / wait，不要猜。
- 输入框要用 a11y_type_in_ref（自带聚焦），不要 click_ref + type 两步走。
- 超过 25 轮仍无进展 → a11y_task_give_up 并说明卡点。
- **永远不要输入密码、2FA 码、支付信息** — 遇到这类字段直接 give_up reason="需要用户手动输入凭据"。
- 不要触发破坏性操作（注销/删除账户/退订），除非用户明确要求。`;

/**
 * Hard cap on loop iterations per task. Phase A: 30. Most real flows
 * land in 8-15 actions; 30 is enough headroom for exploration without
 * runaway Anthropic spend if Claude gets stuck in a loop.
 */
export const DEFAULT_MAX_VISION_STEPS = 30;

/**
 * Env flag: when truthy, tasks created via `tasks.create` still go
 * through the old `AnthropicPlanner` plan-once path. Default = vision
 * loop. Kept for Phase A as a rollback switch while we validate the
 * new path on live dogfood.
 *
 *   HOLADAY_USE_LEGACY_PLANNER=1 pnpm start  → old architecture
 *   (unset / 0)                              → vision loop (new default)
 */
export function shouldUseLegacyPlanner(): boolean {
  const v = process.env.HOLADAY_USE_LEGACY_PLANNER;
  return v === '1' || v === 'true';
}
