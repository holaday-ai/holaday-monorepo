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
import { VISION_TOOLS, type VisionAction, decodeToolUse } from './actions.js';
import { type ResizedImage, resizeForVisionModel } from './image.js';

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

const DEFAULT_MODEL = 'claude-sonnet-4-20250514';
const DEFAULT_MAX_TOKENS = 1_024;

export class AnthropicVisionLoopCommander implements VisionLoopCommander {
  private readonly client: Anthropic;
  private readonly model: string;
  private readonly maxTokens: number;

  constructor(opts: AnthropicVisionLoopCommanderOptions) {
    this.client = opts.client;
    this.model = opts.model ?? process.env.COMMANDER_MODEL ?? DEFAULT_MODEL;
    this.maxTokens = opts.maxTokens ?? DEFAULT_MAX_TOKENS;
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
      messages = await buildMessages(ctx, image);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return synthesiseGiveUp(`message build failed: ${message}`, startedAt, image);
    }

    // 3. Call Anthropic. `tool_choice: { type: 'any' }` forces the
    //    model to emit SOME tool_use every tick; that's the whole
    //    protocol — we never want a text-only response.
    let response: Anthropic.Message;
    try {
      response = await this.client.messages.create({
        model: this.model,
        max_tokens: this.maxTokens,
        system: VISION_SYSTEM_PROMPT,
        tools: VISION_TOOLS as unknown as Anthropic.Tool[],
        tool_choice: { type: 'any' },
        messages,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
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

    return {
      action,
      ...(reasoning ? { reasoning } : {}),
      image,
      toolUseId: toolUse.id,
      elapsedMs,
      ...usage,
    };
  }
}

/**
 * Build the Anthropic `messages[]` array from a VisionLoopContext.
 * Each historical turn becomes two content blocks on the wire:
 *
 *   assistant: [tool_use(name=mapFromKind(turn.action), id=turn.toolUseId)]
 *   user:      [tool_result(tool_use_id=turn.toolUseId, content=[image, text])]
 *
 * First tick has empty history; we emit a single user message with
 * [image, text(intent + url + title + skillHint?)] and let Claude
 * choose its first tool_use.
 */
async function buildMessages(
  ctx: VisionLoopContext,
  currentImage: ResizedImage,
): Promise<Anthropic.MessageParam[]> {
  const messages: Anthropic.MessageParam[] = [];

  // Initial user message — the goal + first screenshot. Always prepended.
  const initial = ctx.history[0];
  const firstObservation = initial ? initial.observation : ctx.observation;
  const firstImageB64 = initial
    ? (
        await resizeForVisionModel(
          firstObservation.screenshotBase64,
          firstObservation.viewportWidth,
          firstObservation.viewportHeight,
        )
      ).base64
    : currentImage.base64;
  messages.push({
    role: 'user',
    content: [
      {
        type: 'image',
        source: { type: 'base64', media_type: 'image/jpeg', data: firstImageB64 },
      },
      {
        type: 'text',
        text: initialUserText(ctx, firstObservation),
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

    // For each turn past the first, the OBSERVATION that belongs to it
    // (what Claude sees AFTER executing that turn's action) is the
    // NEXT turn's observation, or the current observation if this was
    // the last recorded turn.
    const nextTurn = ctx.history[i + 1];
    const nextObservation = nextTurn ? nextTurn.observation : ctx.observation;
    const nextImageB64 = nextTurn
      ? (
          await resizeForVisionModel(
            nextObservation.screenshotBase64,
            nextObservation.viewportWidth,
            nextObservation.viewportHeight,
          )
        ).base64
      : currentImage.base64;
    messages.push({
      role: 'user',
      content: [
        {
          type: 'tool_result',
          tool_use_id: turn.toolUseId,
          content: [
            {
              type: 'image',
              source: { type: 'base64', media_type: 'image/jpeg', data: nextImageB64 },
            },
            {
              type: 'text',
              text: followupUserText(turn, nextObservation),
            },
          ],
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

export const VISION_SYSTEM_PROMPT = `You are HOLA DAY's browser operating agent.

You control a real Chrome tab belonging to the user. Each turn you
receive a screenshot of the current viewport plus the user's goal.
Pick ONE action using the provided tools. The user WILL SEE every
action you take because it happens on their real screen.

Coordinate system:
- All (x, y) are in the screenshot's pixel space, top-left origin.
- The screenshot you see IS the model-space — click coordinates as
  they appear in the image. The executor handles scaling back to the
  user's real viewport.

Tool selection:
- computer_click — tap buttons, links, tabs, form fields. Click a
  text input BEFORE typing into it; computer_type does not focus.
- computer_type — type into the currently focused field. No shortcuts
  or special keys here — use computer_key for those.
- computer_key — single keys or chords: "Enter", "Tab", "Escape",
  "ctrl+a", "cmd+c". Use for form submit, field nav, common shortcuts.
- computer_scroll — dy positive scrolls down, negative up. Use when
  the target element is off-screen.
- computer_wait — only when a prior action is visibly still loading;
  not a default "wait between steps". Most transitions are instant.
- computer_screenshot — re-observe without acting. Rare; use when
  you know the page just changed but the last action wasn't yours
  (e.g. a popup appeared).
- task_done — fire when the user's goal is satisfied. Include a
  concise summary of what you accomplished.
- task_give_up — fire when you cannot proceed: captcha, login wall,
  missing button, ambiguous goal, >5 repeated failed attempts at the
  same element. Include a clear reason so the user knows what to do.

Rules:
- One tool call per turn. Never narrate a plan; execute the next step.
- If the goal has multiple sub-steps, do the FIRST visible one now;
  subsequent turns will handle the rest.
- Ground every click on what you SEE in the screenshot — never guess
  at a coordinate because the element "usually" is there.
- When an input field needs text, click it FIRST, then type.
- If you've taken >20 actions on what should be a simple goal, call
  task_give_up — something is structurally stuck.
- Never enter the user's password, 2FA code, or payment details, even
  if the field is focused. If those are required, task_give_up with
  reason "manual credential entry required".

Safety:
- You cannot see beyond the current viewport — scroll to explore.
- The user's tab may be on ANY site; trust only what's on screen.
- Do not click "unsubscribe", "delete account", or destructive
  buttons unless the user's goal explicitly asks for that action.`;

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
