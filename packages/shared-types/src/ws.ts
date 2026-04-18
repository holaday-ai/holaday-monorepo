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
  status: z.enum(['ok', 'error', 'awaiting_user']),
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

export const clientMessageSchema = z.discriminatedUnion('type', [
  clientHelloSchema,
  clientPongSchema,
  clientTaskAckSchema,
  clientStepResultSchema,
  clientScreenshotSchema,
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
    kind: z.enum(['goto', 'click', 'type', 'extract', 'wait', 'eval', 'screenshot']),
    selector: resilientSelectorSchema.optional(),
    payload: z.record(z.string(), z.unknown()).optional(),
  }),
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

export const serverMessageSchema = z.discriminatedUnion('type', [
  serverWelcomeSchema,
  serverErrorSchema,
  serverPingSchema,
  serverTaskDispatchSchema,
  serverTaskControlSchema,
  serverUserConfirmSchema,
  serverBatchConfirmRequiredSchema,
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
