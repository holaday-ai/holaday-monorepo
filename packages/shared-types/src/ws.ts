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

export const clientMessageSchema = z.discriminatedUnion('type', [
  clientHelloSchema,
  clientPongSchema,
  clientTaskAckSchema,
  clientStepResultSchema,
  clientScreenshotSchema,
  clientVisionObservationSchema,
  clientVisionActedSchema,
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
  status: z.enum(['completed', 'failed', 'paused', 'cancelled']),
  summary: z.string().optional(),
  reason: z.string().optional(),
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
