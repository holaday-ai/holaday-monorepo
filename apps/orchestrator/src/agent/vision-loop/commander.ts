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
import type { VisionAction } from './actions.js';
import type { ResizedImage } from './image.js';

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
}

export interface VisionLoopContext {
  /** Original user intent (free-form text). Never mutated mid-loop. */
  intent: string;
  /** For llm_calls accounting + per-user rate limits. */
  userId?: string;
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
  elapsedMs: number;
  inputTokens: number;
  outputTokens: number;
  /** If Anthropic returned cache hits on the system prompt, report them so
   *  cost accounting is honest. Phase A we don't yet exploit prompt cache. */
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
}

// ---------------------------------------------------------------------------
// AnthropicVisionLoopCommander — real impl. Phase A skeleton: constructor
// + method signature, body stubbed. Real Anthropic call + tool_use decode
// lands in the next commit so we can iterate against the integration test.
// ---------------------------------------------------------------------------

export interface AnthropicVisionLoopCommanderOptions {
  client: Anthropic;
  /** Default `claude-opus-4-7`. Env `COMMANDER_MODEL` overrides. */
  model?: string;
  maxTokens?: number;
}

const DEFAULT_MODEL = 'claude-opus-4-7';
const DEFAULT_MAX_TOKENS = 4_000;

export class AnthropicVisionLoopCommander implements VisionLoopCommander {
  private readonly client: Anthropic;
  private readonly model: string;
  private readonly maxTokens: number;

  constructor(opts: AnthropicVisionLoopCommanderOptions) {
    this.client = opts.client;
    this.model = opts.model ?? process.env.COMMANDER_MODEL ?? DEFAULT_MODEL;
    this.maxTokens = opts.maxTokens ?? DEFAULT_MAX_TOKENS;
  }

  async decideNextAction(_ctx: VisionLoopContext): Promise<VisionDecision> {
    // TODO Phase A next commit:
    //   1. resizeForVisionModel(ctx.observation.screenshotBase64, w, h)
    //   2. Build messages[]:
    //      - system: VISION_SYSTEM_PROMPT (role, constraints, coord conv)
    //      - user:  [image(resized.base64), text(intent + url + title + skillHint)]
    //      - for each prior turn in ctx.history, append {role:'assistant',
    //        content:[tool_use]} + {role:'user', content:[image, executionResult]}
    //   3. client.messages.create({ model, max_tokens, system, tools: VISION_TOOLS,
    //                              tool_choice: { type: 'any' }, messages })
    //   4. Find the FIRST tool_use block in response.content (ignore any
    //      narrative text that came before it; log it into `reasoning`)
    //   5. decodeToolUse(block.name, block.input) → VisionAction
    //   6. Return VisionDecision{action, image: resized, usage…}
    //
    // Error-handling contract: any throw from the SDK is caught and
    // converted to a `give_up` action. The loop driver pauses the
    // task with that reason — no retries, no silent failures.
    void this.client;
    void this.model;
    void this.maxTokens;
    throw new Error(
      'AnthropicVisionLoopCommander.decideNextAction: not implemented (Phase A skeleton)',
    );
  }
}

// ---------------------------------------------------------------------------
// System prompt lives in its own const so it's cacheable (prefix cache)
// once we wire it up, and so it's easy to iterate on without rebuilding
// the whole class. Body stubbed for skeleton; real prompt — with coord
// conventions, tool guidance, refusal rules — lands with the impl.
// ---------------------------------------------------------------------------

export const VISION_SYSTEM_PROMPT = `You are HOLA DAY's browser operating agent.

You control a real Chrome tab belonging to the user. Each turn you will
receive a screenshot of the current viewport plus the user's intent.
Pick ONE action using the provided tools. Coordinates are in screenshot
pixels, top-left origin.

<TODO: flesh out in Phase A impl commit — refusal rules, scroll guidance,
multi-step decomposition, "when to screenshot vs when to click", "how
to handle login walls / captchas" (call task_give_up with a clear
reason), done-criteria for common intents.>`;

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
