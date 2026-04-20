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

const DEFAULT_MODEL = 'claude-sonnet-4-20250514';
const DEFAULT_MAX_TOKENS = 1_024;

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
        purpose: 'commander.vision',
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
- 不要点击 "注销/删除账户/退订" 等破坏性按钮，除非用户的目标明确要求这个动作。`;

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
