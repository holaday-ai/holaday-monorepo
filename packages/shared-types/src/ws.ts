import { z } from 'zod';
import { resilientSelectorSchema } from './selector.js';

// ---------- Protocol constants ----------

export const WS_PROTOCOL_VERSION = 1 as const;
export const WS_SUBPROTOCOL = `holaday.v${WS_PROTOCOL_VERSION}` as const;
export const HEARTBEAT_INTERVAL_MS = 30_000;
export const HEARTBEAT_TIMEOUT_MS = 90_000;

// ---------- Client → Server ----------

export const clientHelloSchema = z.object({
  type: z.literal('client.hello'),
  token: z.string().min(1),
  extensionVersion: z.string().optional(),
  userAgent: z.string().optional(),
});

export const clientPongSchema = z.object({
  type: z.literal('client.pong'),
  at: z.number().int(),
});

export const clientTaskAckSchema = z.object({
  type: z.literal('client.task.ack'),
  taskId: z.string(),
  stepId: z.string().optional(),
});

export const clientStepResultSchema = z.object({
  type: z.literal('client.step.result'),
  taskId: z.string(),
  stepId: z.string(),
  status: z.enum(['ok', 'error', 'awaiting_user', 'skipped']),
  data: z.unknown().optional(),
  error: z
    .object({
      code: z.string(),
      message: z.string(),
    })
    .optional(),
});

export const clientScreenshotSchema = z.object({
  type: z.literal('client.screenshot'),
  taskId: z.string(),
  stepId: z.string(),
  key: z.string(), // S3 object key
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});

// ---------- Vision-loop: SW ↔ orchestrator per-tick frames ----------

/**
 * Vision action the SW is asked to execute. Matches the orchestrator-
 * side `VisionAction` discriminated union one-for-one. Coordinates in
 * `click.x/y` are REAL viewport pixels — the orchestrator has already
 * translated them from Claude's model-space via `modelCoordToReal`.
 */
export const visionActionSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('click'),
    x: z.number().int(),
    y: z.number().int(),
    button: z.enum(['left', 'right', 'middle']).optional(),
  }),
  z.object({ kind: z.literal('type'), text: z.string() }),
  z.object({ kind: z.literal('key'), key: z.string().min(1) }),
  z.object({ kind: z.literal('scroll'), dy: z.number().int() }),
  z.object({ kind: z.literal('navigate'), url: z.string().url().max(2048) }),
  z.object({ kind: z.literal('wait_for_human'), reason: z.string().min(1).max(512) }),
  z.object({
    kind: z.literal('wait'),
    ms: z.number().int().min(100).max(10_000),
  }),
  z.object({ kind: z.literal('screenshot') }),
  z.object({ kind: z.literal('done'), summary: z.string() }),
  z.object({ kind: z.literal('give_up'), reason: z.string() }),
]);

export type VisionAction = z.infer<typeof visionActionSchema>;

/**
 * SW → orchestrator: observation for the current loop tick. Raw
 * viewport JPEG (base64, no data: prefix) + dims + url + title.
 * Orchestrator will resize server-side before shipping to Claude.
 *
 * If capture failed at the SW layer (debugger attach denied, target
 * closed, CDP timeout), SW sets `error` to a diagnostic string and
 * leaves the other fields best-effort (empty string / 0). The
 * orchestrator treats a populated `error` as a failed tick and exits
 * the loop with `status='failed'`.
 */
export const clientVisionObservationSchema = z.object({
  type: z.literal('client.vision.observation'),
  taskId: z.string(),
  tickIndex: z.number().int().nonnegative(),
  screenshotBase64: z.string(),
  viewportWidth: z.number().int().nonnegative(),
  viewportHeight: z.number().int().nonnegative(),
  url: z.string(),
  title: z.string(),
  error: z.string().optional(),
});

/**
 * SW → orchestrator: confirmation the VisionAction executed. `ok=false`
 * with `message` carries the CDP error back so Claude can see it on
 * the next tick.
 */
export const clientVisionActedSchema = z.object({
  type: z.literal('client.vision.acted'),
  taskId: z.string(),
  tickIndex: z.number().int().nonnegative(),
  ok: z.boolean(),
  message: z.string().optional(),
});

/**
 * Web workbench → orchestrator: a user interaction inside the right-
 * side screencast panel (click / scroll / type / key). Orchestrator
 * dispatches it straight to PlaywrightExecutor so the user can nudge
 * the browser — captcha solves, filling a field the agent missed, or
 * plain manual driving when no task is running ("免 VPN 海外浏览器").
 *
 * Coordinates are in REAL viewport pixels; the frontend is responsible
 * for scaling from the screencast canvas to the actual page size
 * before sending.
 *
 * `taskId` is optional — when the panel is in free-drive mode (no
 * task), the orchestrator still accepts events and drives whatever
 * tab activePage points at.
 */
export const clientVisionUserInputSchema = z.object({
  type: z.literal('client.vision.user_input'),
  taskId: z.string().optional(),
  kind: z.enum(['click', 'scroll', 'type', 'key', 'insert_text']),
  x: z.number().int().optional(),
  y: z.number().int().optional(),
  /**
   * For kind=type: the literal text to type via simulated keystrokes
   *   (page.keyboard.type). Does NOT work for CJK / non-Latin —
   *   chrome's input layer can't synthesise composed characters
   *   without an IME on the X server.
   * For kind=insert_text: text inserted atomically via
   *   page.keyboard.insertText, bypassing keyboard simulation.
   *   This is the path the SPA's CJK input bar uses — user types
   *   in their LOCAL IME (macOS / Windows / Linux), then the
   *   composed text is shipped here and atomic-inserted into the
   *   focused element on the remote Brave.
   */
  text: z.string().max(4_000).optional(),
  /** For kind=key: named key or chord ("Enter", "ctrl+a"). */
  key: z.string().min(1).max(64).optional(),
  /** For kind=scroll: dy in CSS px (positive=down). */
  scrollDeltaY: z.number().int().min(-5_000).max(5_000).optional(),
  /** For kind=click: button. Default 'left'. */
  button: z.enum(['left', 'right', 'middle']).optional(),
});

/**
 * Phase 14 — Chrome extension login-state report. Extension's cookie
 * bridge reads the user's cookies for tracked sites every ~5 minutes
 * (alarms-driven) and ships a domain → boolean map. Server stashes
 * this in a per-user state so the playbook router can log "user is
 * logged into X on their Chrome" when the matched playbook flags
 * that domain as login-required.
 *
 * Domain keys are bare hosts (no scheme, no www) — same shape as
 * `extractDomain()` produces server-side. Cap at 32 entries to keep
 * the message tractable; cookie reads are bounded by a curated
 * `TRACKED_DOMAINS` list in the extension.
 */
export const clientExtensionLoginStatesSchema = z.object({
  type: z.literal('client.extension.login_states'),
  states: z
    .record(z.string().min(1).max(64), z.boolean())
    .refine((rec) => Object.keys(rec).length <= 32, {
      message: 'too many domains in login_states (max 32)',
    }),
});

/**
 * Phase 25 — extension-driven tool execution (Mode B v0.1).
 *
 * When the user has the Chrome extension connected and Mode B is
 * enabled, the orchestrator routes browser tool calls through the
 * extension instead of a cloud Brave instance. The extension drives
 * the user's own Chrome (which inherits all their cookies / sessions)
 * via chrome.tabs / chrome.scripting APIs.
 *
 * Tool result reports back via this frame. `requestId` matches the
 * `requestId` field on the corresponding `server.extension.tool_call`.
 *
 * Shape:
 *   - `ok=true`:  call succeeded — `result` carries kind-specific
 *                 payload (url + title + text for navigate, base64
 *                 PNG for screenshot, etc.)
 *   - `ok=false`: call failed — `error` carries a short Chinese
 *                 message + optional Chromium error code
 *
 * Cap the payload at ~200KB per frame: that's enough for a full
 * page-text extract (~10 pages of dense text) without blowing past
 * typical WS frame limits. Larger payloads chunk into multiple frames
 * (future work; v0.1 single-frame only).
 */
export const clientExtensionToolResultSchema = z.object({
  type: z.literal('client.extension.tool_result'),
  taskId: z.string().min(1).max(64),
  requestId: z.string().min(1).max(64),
  ok: z.boolean(),
  // result is an arbitrary kind-specific object; the orchestrator
  // narrows it at the consumer site based on the original tool kind.
  // Stringified payloads (e.g. base64 screenshots) keep the wire size
  // tractable.
  result: z.unknown().optional(),
  error: z
    .object({
      message: z.string().max(2000),
      code: z.string().max(64).optional(),
    })
    .optional(),
  /** ms since unix epoch — used for latency telemetry. */
  at: z.number().int().nonnegative(),
});

export const clientMessageSchema = z.discriminatedUnion('type', [
  clientHelloSchema,
  clientPongSchema,
  clientTaskAckSchema,
  clientStepResultSchema,
  clientScreenshotSchema,
  clientVisionObservationSchema,
  clientVisionActedSchema,
  clientVisionUserInputSchema,
  clientExtensionLoginStatesSchema,
  clientExtensionToolResultSchema,
]);

export type ClientMessage = z.infer<typeof clientMessageSchema>;

// ---------- Server → Client ----------

export const serverWelcomeSchema = z.object({
  type: z.literal('server.welcome'),
  clientId: z.string(),
  heartbeatMs: z.number().int().positive(),
});

export const serverErrorSchema = z.object({
  type: z.literal('server.error'),
  code: z.string(),
  message: z.string(),
});

export const serverPingSchema = z.object({
  type: z.literal('server.ping'),
  at: z.number().int(),
});

export const serverTaskDispatchSchema = z.object({
  type: z.literal('server.task.dispatch'),
  taskId: z.string(),
  stepId: z.string(),
  action: z.object({
    kind: z.enum(['goto', 'click', 'type', 'key', 'extract', 'wait', 'eval', 'screenshot']),
    selector: resilientSelectorSchema.optional(),
    payload: z.record(z.string(), z.unknown()).optional(),
  }),
  /**
   * Origin allowlist from the task's matched Skill manifest(s). Empty
   * or omitted means unrestricted. The extension SW hands this to the
   * driver which blocks any goto with an out-of-allowlist URL AND any
   * non-goto action whose current page URL is out of allowlist (catches
   * redirects off the approved origin).
   */
  allowedOrigins: z.array(z.string()).optional(),
  deadlineMs: z.number().int().positive().optional(),
});

export const serverTaskControlSchema = z.object({
  type: z.literal('server.task.control'),
  taskId: z.string(),
  command: z.enum(['pause', 'resume', 'cancel']),
  /** Why the task paused — populated on pause commands. */
  reason: z.enum(['user', 'retries_exhausted', 'quota_exceeded']).optional(),
  /** Free-form detail the UI can render (e.g. last error on retries_exhausted). */
  detail: z.record(z.string(), z.unknown()).optional(),
});

export const serverUserConfirmSchema = z.object({
  type: z.literal('server.user.confirm'),
  taskId: z.string(),
  stepId: z.string(),
  prompt: z.string(),
  risk: z.enum(['low', 'medium', 'high']),
});

/**
 * A single item in a batch confirm preview. `label` is the short
 * disambiguator ("评论 #3 · 张三 · ★1"), `preview` is the content the
 * agent plans to act on (e.g. draft reply text). `meta` is free-form so
 * Skills can attach commentId / rating / replyDraft without widening
 * the protocol.
 */
export const batchItemSchema = z.object({
  label: z.string().min(1).max(256),
  preview: z.string().min(1).max(2048),
  meta: z.record(z.string(), z.unknown()).optional(),
});

/**
 * Batch confirm: commander plans a write-heavy step in batches of 3-5
 * items. For each batch, the server emits this frame; popup shows
 * "确认第 <index>/<total> 批" with item previews and Confirm / Skip /
 * Cancel. Skip advances past the batch without executing; Cancel stops
 * the whole task.
 */
export const serverBatchConfirmRequiredSchema = z.object({
  type: z.literal('server.batch_confirm_required'),
  taskId: z.string(),
  stepId: z.string(),
  batchIndex: z.number().int().nonnegative(),
  batchTotal: z.number().int().positive(),
  items: z.array(batchItemSchema).min(1).max(10),
  risk: z.enum(['low', 'medium', 'high']),
  /** Short explanation of what the batch does. */
  summary: z.string().min(1).max(512).optional(),
});

// ---------- Vision-loop: orchestrator → SW per-tick frames ----------

/**
 * Orchestrator → SW: "I need an observation for tick N". SW takes a
 * screenshot of the active tab, gets the viewport dims + url + title,
 * and replies with `client.vision.observation`.
 */
export const serverVisionObserveSchema = z.object({
  type: z.literal('server.vision.observe'),
  taskId: z.string(),
  tickIndex: z.number().int().nonnegative(),
  /** Optional deadline in ms. SW aborts capture if exceeded. */
  deadlineMs: z.number().int().positive().optional(),
});

/**
 * Orchestrator → SW: "Execute this action, then reply with
 * client.vision.acted". Coordinates in `action` (for click) are REAL
 * viewport pixels — the SW dispatches them via CDP without any
 * further scaling.
 */
export const serverVisionActSchema = z.object({
  type: z.literal('server.vision.act'),
  taskId: z.string(),
  tickIndex: z.number().int().nonnegative(),
  action: visionActionSchema,
  deadlineMs: z.number().int().positive().optional(),
});

/**
 * Orchestrator → SW: task has reached a terminal state. Fired for
 * vision-loop tasks after `persistVisionOutcome` lands, so the SW
 * can update its in-memory view and the popup shows the final result
 * even when a task ended while the popup was closed.
 *
 *   completed → `summary` populated (task_done's summary text)
 *   failed    → `reason` populated (task_give_up reason or
 *                orchestrator-synthesised message)
 *   paused    → `reason` populated (e.g. max_steps_reached)
 *   cancelled → both optional
 *
 * Legacy plan-once tasks use server.task.control(pause) /
 * persistence, not this frame.
 */
export const serverTaskTerminalSchema = z.object({
  type: z.literal('server.task.terminal'),
  taskId: z.string(),
  // Codex Pack A3 — `partial_success` is a new terminal status fired
  // when the deterministic verifier's verdict comes back as
  // `passed=false, failureLevel='fixable'`. The task produced a
  // visible answer but failed at least one structural check
  // (url_count / result_count / price_sort). SPA renders a yellow
  // banner above the summary; `summary` is still populated.
  status: z.enum(['completed', 'failed', 'paused', 'cancelled', 'partial_success']),
  summary: z.string().optional(),
  reason: z.string().optional(),
  /**
   * F4 — backend-orchestrated handoff. When the reply handler spawns
   * a follow-up task (e.g. user's clarification revealed the workflow
   * needs a browser lane), it includes the new task's id here. The
   * SPA's only job: navigate to `?task=handoffTaskId`. The new task
   * row + its supercar dispatch are already kicked off server-side
   * via tRPC's createCaller, so the SPA does NOT call createTask
   * (would otherwise double-create + double-charge quota).
   *
   * Earlier draft of this field carried `autoHandoff: { intent }` and
   * relied on the SPA to fire createTask — that was racy on WS
   * replay and lost atomicity. Schema retired in favour of the id-
   * only handoffTaskId.
   */
  handoffTaskId: z.string().optional(),
});

/**
 * Per-tick progress frames — G4 streaming step rendering.
 *
 * `server.vision.tick.start` fires as soon as the runner has captured
 * the observation for tick N and is about to ask the commander. The
 * web workbench uses this to append a new step card in the "进行中"
 * state.
 *
 * `server.vision.tick.end` fires once the tick completes — either
 * after the driver reports back (`acted`) or after a terminal action
 * (done / give_up) is recorded. The UI uses it to flip the step card
 * to "完成" / "失败" and stamp the duration. `actionKind` is the
 * VisionAction / A11yAction kind string; `actionSummary` is a short
 * Chinese human-readable label pre-derived by the orchestrator.
 */
export const serverVisionTickStartSchema = z.object({
  type: z.literal('server.vision.tick.start'),
  taskId: z.string(),
  tickIndex: z.number().int().nonnegative(),
  mode: z.enum(['screenshot', 'accessibility']),
});

/**
 * Anti-bot signal attached to a tick.end frame — Layer 3 of the
 * anti-detection stack. Populated when the orchestrator's detector
 * matches a captcha / verify / block / Cloudflare marker in the
 * action error OR in the accessibility snapshot text.
 *
 *   confidence='high'   — strong match (explicit captcha/cloudflare
 *                         keyword). UI shows the orange warning badge
 *                         and the Layer 4 captcha_detected flow fires.
 *   confidence='medium' — ambiguous match (e.g. generic "verify"
 *                         substring). UI shows a softer hint; no
 *                         Layer 4 pause.
 */
export const antiBotSignalSchema = z.object({
  type: z.enum(['captcha', 'verify', 'block', 'cloudflare']),
  confidence: z.enum(['high', 'medium']),
  message: z.string(),
});

export const serverVisionTickEndSchema = z.object({
  type: z.literal('server.vision.tick.end'),
  taskId: z.string(),
  tickIndex: z.number().int().nonnegative(),
  mode: z.enum(['screenshot', 'accessibility']),
  actionKind: z.string(),
  actionSummary: z.string(),
  durationMs: z.number().int().nonnegative(),
  ok: z.boolean(),
  /** Driver / commander detail surfaced on !ok. */
  message: z.string().optional(),
  /** Layer 3 anti-bot classification, populated when detected. */
  antiBot: antiBotSignalSchema.optional(),
});

/**
 * Layer 4 — fired when the orchestrator's anti-bot detector returns
 * a high-confidence signal mid-task. The runner pauses the vision
 * loop, starts polling the page for the captcha to clear (a11y
 * snapshot every 3 s), and relies on the user finishing the
 * challenge in the attached Chrome window. `message` carries the
 * same Chinese description the step card shows so the UI can keep
 * the two in sync without re-deriving.
 */
export const serverVisionCaptchaDetectedSchema = z.object({
  type: z.literal('server.vision.captcha_detected'),
  taskId: z.string(),
  antiBotType: z.enum(['captcha', 'verify', 'block', 'cloudflare']),
  message: z.string(),
  /** How long the runner will wait before giving up, in ms. */
  waitTimeoutMs: z.number().int().positive(),
});

/**
 * Layer 4 — fired when the pause ended. `reason='auto'` means we
 * polled and the anti-bot markers disappeared (user finished the
 * captcha); `reason='timeout'` means the configured wait elapsed and
 * the task is about to terminate as failed.
 */
export const serverVisionCaptchaResolvedSchema = z.object({
  type: z.literal('server.vision.captcha_resolved'),
  taskId: z.string(),
  reason: z.enum(['auto', 'timeout']),
});

/**
 * Layer 5 — fired when the orchestrator runs out of patience with
 * Playwright in the face of anti-bot walls and swaps the task's
 * transport mid-flight to the extension's legacy WS/SW path.
 *
 *   available=true  → extension is connected for this user; the
 *                     runner just switched. Next tick executes via
 *                     the extension's cdp-actions.ts.
 *   available=false → no SW client connected; fallback could NOT
 *                     take effect. UI shows "请打开 HOLA DAY 扩展".
 */
export const serverVisionExecutorFallbackSchema = z.object({
  type: z.literal('server.vision.executor_fallback'),
  taskId: z.string(),
  reason: z.literal('anti-bot'),
  available: z.boolean(),
});

/**
 * DegradationChain attempted a tier after Layer 4 timed out. UI shows
 * "正在尝试替代方案 (level N)" so the user knows the agent is
 * escalating without task-level failure. `handoffToExtension=true`
 * means the chain reached the last tier and the task is about to
 * switch to the Chrome extension transport; `ok=false` means the
 * strategy tried but couldn't apply (e.g. proxy swap is a stub).
 */
export const serverVisionDegradeSchema = z.object({
  type: z.literal('server.vision.degrade'),
  taskId: z.string(),
  level: z.number().int().positive(),
  strategy: z.string(),
  ok: z.boolean(),
  message: z.string(),
  handoffToExtension: z.boolean().optional(),
  nextUrl: z.string().optional(),
});

/**
 * Task queued behind earlier work (Phase F F3 per-user FIFO). Fires
 * once on enqueue when the task lands at position > 1 — position 1
 * means it started immediately and the UI never needs a "queued"
 * badge for it. Position is *stable at enqueue time*: as earlier
 * tasks drain, we don't re-broadcast updates, we just rely on the
 * first `server.vision.tick.start` to signal the task is now
 * actually running.
 */
export const serverTaskQueuedSchema = z.object({
  type: z.literal('server.task.queued'),
  taskId: z.string(),
  /** 1 = currently running; 2+ = queued N-1 tasks ahead. */
  position: z.number().int().positive(),
});

/**
 * Phase 13 Dim 1 — first-frame plan emitted before any tool call.
 * Carries the markdown-ish plan body and a parallel status array
 * the SPA renders as a step list with state icons. Updates land
 * via subsequent vision/tick events that drive plan_status entries
 * client-side; this initial frame just bootstraps the UI.
 */
export const serverTaskPlanSchema = z.object({
  type: z.literal('server.task.plan'),
  taskId: z.string(),
  planText: z.string(),
  planStatus: z.array(
    z.object({
      idx: z.number().int().nonnegative(),
      status: z.enum(['pending', 'running', 'done', 'failed']),
      note: z.string().optional(),
    }),
  ),
});

/**
 * Phase 13 Dim 1 follow-up — incremental plan-step status update.
 * Fires whenever the agent loop parses a `[STEP N status]` marker
 * out of the model's text. Carries the WHOLE updated array (not a
 * delta) so the SPA's reducer can replace state in one shot
 * without merging partial diffs.
 */
export const serverTaskPlanStepSchema = z.object({
  type: z.literal('server.task.plan_step'),
  taskId: z.string(),
  planStatus: z.array(
    z.object({
      idx: z.number().int().nonnegative(),
      status: z.enum(['pending', 'running', 'done', 'failed']),
      note: z.string().optional(),
    }),
  ),
});

/**
 * Per-tick screencast frame — G5. Sends the raw JPEG the runner
 * already captured to drive the commander, so the web workbench can
 * render a poor-man's screencast in the right-hand panel. Only fires
 * in screenshot mode; accessibility mode has no image to ship.
 *
 * The payload is large (a few tens of KB per tick) but fires at most
 * once every ~2–5 s per task, so the WS channel absorbs it. `imageBase64`
 * carries no `data:` prefix — callers prepend `data:image/jpeg;base64,`
 * themselves.
 */
export const serverVisionScreencastSchema = z.object({
  type: z.literal('server.vision.screencast'),
  taskId: z.string(),
  /**
   * Real ticks are 0+; the orchestrator also fires off-loop refresh
   * frames after a panel-user-input lands and uses tickIndex=-1 as
   * the sentinel for "not part of any agent tick — just paint this".
   * Hence `int()` not `nonnegative()`.
   */
  tickIndex: z.number().int(),
  imageBase64: z.string(),
  url: z.string(),
  viewport: z.object({
    width: z.number().int().nonnegative(),
    height: z.number().int().nonnegative(),
  }),
  /** ISO-8601 capture timestamp so clients can dedupe + show freshness. */
  timestamp: z.string(),
});

/**
 * Supercar-specific frames. The supercar agent loop reuses
 * `server.vision.tick.*` and `server.vision.screencast` for iteration
 * progress, but three things don't map cleanly to the vision shapes:
 *
 *   `server.supercar.web_search` — server-side web search invocation,
 *     no DOM action and no screencast. Carries the query so the UI can
 *     render "正在搜索：<q>".
 *
 *   `server.supercar.awaiting_user` — model paused on a clarifying
 *     question. UI renders yellow-highlighted card + enables the reply
 *     composer; `tasks.reply` mutation unblocks the loop.
 *
 *   `server.supercar.thinking` — summarised extended-thinking output
 *     for the current turn. Shown as a subtle, collapsed step card so
 *     operators can see Claude's reasoning without cluttering the
 *     primary flow.
 */
export const serverSupercarWebSearchSchema = z.object({
  type: z.literal('server.supercar.web_search'),
  taskId: z.string(),
  iteration: z.number().int().nonnegative(),
  query: z.string(),
  /**
   * Optional sources extracted from the paired
   * `web_search_tool_result` content block. Lets the UI render
   * favicon/title/snippet cards beneath the "正在搜索：X" line.
   */
  sources: z
    .array(
      z.object({
        title: z.string(),
        url: z.string(),
        snippet: z.string().optional(),
      }),
    )
    .optional(),
});

export const serverSupercarAwaitingUserSchema = z.object({
  type: z.literal('server.supercar.awaiting_user'),
  taskId: z.string(),
  question: z.string(),
  /**
   * P2-A — what KIND of input the agent is waiting on. Drives the
   * BrowserPanel's verify banner / auto-expand: only the
   * non-`clarification` kinds need the panel to take over the screen.
   * Older orchestrator builds omit the field; SPA defaults to
   * 'clarification' so missing == safe (chat composer only).
   */
  awaitingKind: z
    .enum(['clarification', 'login', 'captcha', 'permission', 'browser_action'])
    .optional(),
});

/**
 * Backend-generated follow-up suggestions, broadcast after a task
 * reaches `completed`. Replaces the prior reliance on the model
 * emitting an in-summary JSON suggestions block (which it sometimes
 * skipped). Frontend stashes the array and TaskStream renders it as
 * `→ <text>` rows beneath the terminal summary.
 */
export const serverSupercarSuggestionsSchema = z.object({
  type: z.literal('server.supercar.suggestions'),
  taskId: z.string(),
  suggestions: z.array(z.string()).max(5),
});

export const serverSupercarThinkingSchema = z.object({
  type: z.literal('server.supercar.thinking'),
  taskId: z.string(),
  summary: z.string(),
});

/**
 * Phase 24 RC follow-up — generate / scrape streaming deltas. Fires
 * once per content_block_delta from the Anthropic stream so the SPA
 * can render the model's output as it generates instead of waiting
 * for the full message. Each `delta` is the raw new text (not a
 * cumulative snapshot) — the SPA accumulates client-side.
 *
 * Browser-mode tasks DO NOT use this channel — they have screencast
 * frames + step events instead. Only generate-runner and the LLM-
 * synthesis phase of scrape-runner emit these.
 */
export const serverTaskStreamSchema = z.object({
  type: z.literal('server.task.stream'),
  taskId: z.string(),
  delta: z.string(),
});

/**
 * Phase 24 RC follow-up — coarse progress messages for runners that
 * have a non-streaming pre-phase. Today: scrape-runner emits one
 * "正在抓取网页数据..." before Firecrawl returns and (optionally) a
 * "正在分析整理..." between Firecrawl and the LLM-stream. SPA shows
 * this as a small caption above the streaming output.
 */
export const serverTaskProgressSchema = z.object({
  type: z.literal('server.task.progress'),
  taskId: z.string(),
  message: z.string(),
});

/**
 * Phase 5b — batch task progress. Fires whenever a batch's parent
 * counters change (item dispatched / completed / failed) OR the
 * batch's status flips (pending → running → completed / partial /
 * cancelled). The SPA's batch list/detail view updates its progress
 * bar + item rows from these events without re-fetching.
 *
 * `item` is included on every event for the row that triggered the
 * fire (or null for a status-only change with no item delta).
 */
export const serverBatchProgressSchema = z.object({
  type: z.literal('server.batch.progress'),
  batchId: z.string(),
  status: z.enum(['pending', 'running', 'completed', 'partial', 'cancelled']),
  itemsTotal: z.number().int().nonnegative(),
  itemsDone: z.number().int().nonnegative(),
  itemsFailed: z.number().int().nonnegative(),
  item: z
    .object({
      batchItemId: z.string(),
      seq: z.number().int().nonnegative(),
      status: z.enum(['pending', 'running', 'completed', 'failed', 'cancelled']),
      taskId: z.string().optional(),
      errorMessage: z.string().optional(),
    })
    .optional(),
});

/**
 * Phase 25 — extension tool call (Mode B v0.1).
 *
 * Sent from orchestrator to a connected extension WS client when the
 * agent's tool dispatcher decides this user's task should run in the
 * user's local Chrome (login state inherited). Extension SW handles
 * the call via chrome.tabs / chrome.scripting / chrome.tabs.captureVisibleTab
 * and posts a `client.extension.tool_result` back with the matching
 * requestId.
 *
 * Kinds supported in v0.1:
 *   - 'navigate'    → navigate the active tab to `url`, return final url + title + body text
 *   - 'screenshot'  → capture visible viewport, return base64 PNG (capped)
 *
 * Future kinds (v0.2+): click, type, scroll. For v0.1 the orchestrator
 * only emits navigate (single-shot URL fetch) — proves the auth
 * inheritance + protocol roundtrip without committing to the full
 * vision-loop integration.
 */
export const serverExtensionToolCallSchema = z.object({
  type: z.literal('server.extension.tool_call'),
  taskId: z.string().min(1).max(64),
  requestId: z.string().min(1).max(64),
  kind: z.enum(['navigate', 'screenshot']),
  /** Per-kind args. `url` populated for navigate; ignored for screenshot. */
  args: z
    .object({
      url: z.string().url().optional(),
      /**
       * Optional ms to wait after navigation before reading body text.
       * Default 1500 in the extension if omitted. Range guarded
       * client-side to [0, 10000].
       */
      waitMs: z.number().int().nonnegative().max(10_000).optional(),
    })
    .optional(),
  /** Orchestrator-side deadline; if no result arrives by then we time out. */
  timeoutMs: z.number().int().positive().max(60_000).default(30_000),
});

export const serverMessageSchema = z.discriminatedUnion('type', [
  serverWelcomeSchema,
  serverErrorSchema,
  serverPingSchema,
  serverTaskDispatchSchema,
  serverTaskControlSchema,
  serverUserConfirmSchema,
  serverBatchConfirmRequiredSchema,
  serverVisionObserveSchema,
  serverVisionActSchema,
  serverTaskTerminalSchema,
  serverVisionTickStartSchema,
  serverVisionTickEndSchema,
  serverVisionScreencastSchema,
  serverTaskQueuedSchema,
  serverTaskPlanSchema,
  serverTaskPlanStepSchema,
  serverVisionCaptchaDetectedSchema,
  serverVisionCaptchaResolvedSchema,
  serverVisionExecutorFallbackSchema,
  serverVisionDegradeSchema,
  serverSupercarWebSearchSchema,
  serverSupercarAwaitingUserSchema,
  serverSupercarSuggestionsSchema,
  serverSupercarThinkingSchema,
  serverTaskStreamSchema,
  serverTaskProgressSchema,
  serverBatchProgressSchema,
  serverExtensionToolCallSchema,
]);

export type ServerMessage = z.infer<typeof serverMessageSchema>;

// ---------- Parse helpers ----------

export type ParseResult<T> = { success: true; data: T } | { success: false; error: string };

export function parseClientMessage(raw: string): ParseResult<ClientMessage> {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (err) {
    return { success: false, error: `invalid json: ${(err as Error).message}` };
  }
  const parsed = clientMessageSchema.safeParse(json);
  if (!parsed.success) {
    return { success: false, error: parsed.error.message };
  }
  return { success: true, data: parsed.data };
}

export function parseServerMessage(raw: string): ParseResult<ServerMessage> {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (err) {
    return { success: false, error: `invalid json: ${(err as Error).message}` };
  }
  const parsed = serverMessageSchema.safeParse(json);
  if (!parsed.success) {
    return { success: false, error: parsed.error.message };
  }
  return { success: true, data: parsed.data };
}
