import { TRPCError } from '@trpc/server';

/**
 * FIX-PR259-2 — "用公开云端（无登录态）继续" re-submits a non-identity extension
 * wait as a logged-out cloud task. The SPA cancels the original first; the
 * server then allows exactly one replacement per original task:
 *
 * - the idempotency key is derived from the original task, so a double click,
 *   a network retry or a re-opened tab replays the same replacement instead of
 *   creating (and charging) another task within the claim TTL;
 * - the replacement id is also written onto the original row, so a retry after
 *   the TTL is refused rather than creating a second task;
 * - identity-required waits are refused here too, not only in the UI.
 */
export const PUBLIC_CLOUD_CONTINUATION_PREFIX = 'cloud-continue:';

export function publicCloudContinuationRequestId(originalTaskId: string): string {
  return `${PUBLIC_CLOUD_CONTINUATION_PREFIX}${originalTaskId}`;
}

/** Shape checks that need no database read. Throws BAD_REQUEST. */
export function assertPublicCloudContinuationRequest(input: {
  publicCloudContinuationOf: string;
  clientRequestId?: string;
  browserPreference?: string;
  hasLocalChrome: boolean;
}): void {
  if (input.clientRequestId !== publicCloudContinuationRequestId(input.publicCloudContinuationOf))
    throw new TRPCError({ code: 'BAD_REQUEST', message: '公开云端续作缺少对应原任务的去重标识。' });
  if (input.browserPreference !== 'cloud-public' || input.hasLocalChrome)
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: '公开云端续作只能在无登录态的公开云端执行。',
    });
}

export interface ContinuationOriginal {
  status: string;
  intent: string;
  result: unknown;
}

function metadataOf(result: unknown): Record<string, unknown> {
  if (typeof result !== 'object' || result === null) return {};
  const metadata = (result as { metadata?: unknown }).metadata;
  return typeof metadata === 'object' && metadata !== null
    ? (metadata as Record<string, unknown>)
    : {};
}

export function publicCloudContinuationTaskIdOf(result: unknown): string | null {
  const id = metadataOf(result).publicCloudContinuationTaskId;
  return typeof id === 'string' && id.length > 0 ? id : null;
}

/** Preconditions on the original task, checked under the idempotency claim. */
export function assertPublicCloudContinuationAllowed(
  original: ContinuationOriginal | undefined,
  intent: string,
): asserts original is ContinuationOriginal {
  if (!original) throw new TRPCError({ code: 'NOT_FOUND', message: '找不到原任务。' });
  const connection = metadataOf(original.result).browserConnection as
    | { publicCloudAllowed?: unknown }
    | undefined;
  if (connection?.publicCloudAllowed !== true)
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: '这个任务需要你的登录状态，不能改用无登录态的公开云端。',
    });
  const existing = publicCloudContinuationTaskIdOf(original.result);
  if (existing)
    throw new TRPCError({
      code: 'CONFLICT',
      message: `原任务已经改用公开云端继续（${existing}），不会重复创建。`,
    });
  if (original.status !== 'cancelled')
    throw new TRPCError({
      code: 'PRECONDITION_FAILED',
      message: '原任务还没有确认取消，未创建新任务。',
    });
  if (original.intent !== intent)
    throw new TRPCError({ code: 'BAD_REQUEST', message: '公开云端续作必须使用原任务的描述。' });
}

/** The original row's result with the replacement recorded on it. */
export function withPublicCloudContinuation(
  result: unknown,
  replacementTaskId: string,
): Record<string, unknown> {
  const base =
    typeof result === 'object' && result !== null ? (result as Record<string, unknown>) : {};
  return {
    ...base,
    metadata: { ...metadataOf(result), publicCloudContinuationTaskId: replacementTaskId },
  };
}

/**
 * Runs `create` only after the original passes the preconditions, then records
 * the replacement on the original. The caller runs this inside the task-create
 * idempotency claim, so concurrent duplicates never reach `create`.
 */
export async function runPublicCloudContinuation<T extends { taskId: string }>(deps: {
  intent: string;
  loadOriginal: () => Promise<ContinuationOriginal | undefined>;
  recordReplacement: (result: Record<string, unknown>) => Promise<void>;
  create: () => Promise<T>;
  onRecordFailure?: (err: unknown) => void;
}): Promise<T> {
  const original = await deps.loadOriginal();
  assertPublicCloudContinuationAllowed(original, deps.intent);
  const response = await deps.create();
  try {
    await deps.recordReplacement(withPublicCloudContinuation(original.result, response.taskId));
  } catch (err) {
    // The idempotency claim still replays this response for its TTL.
    deps.onRecordFailure?.(err);
  }
  return response;
}
