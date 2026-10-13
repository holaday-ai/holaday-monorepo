import { TRPCError } from '@trpc/server';

/**
 * "用公开云端继续（看不到你的个人信息）" re-submits an extension wait as a
 * logged-out cloud task (an identity task then runs without personal data). The SPA cancels the original first; the server then
 * allows at most one replacement per original, at any time:
 *
 * - the idempotency key is derived from the original task, so a double click,
 *   a network retry or a re-opened tab replays the same replacement within the
 *   claim TTL;
 * - independent of that TTL, the original row is claimed with a conditional
 *   update (`tasks.public_cloud_continuation_task_id IS NULL`) before anything
 *   is created, and the claim is swapped for the replacement id inside the
 *   replacement's own insert transaction. Concurrent or late requests lose the
 *   claim and create nothing; a failed link rolls the insert back and the
 *   consumed quota is refunded;
 * - only a wait whose stored `browserConnection.publicCloudAllowed` is true can
 *   continue (identity waits now allow it: the user explicitly gives up personal data).
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
  /** `tasks.public_cloud_continuation_task_id`: a claim token or the replacement id. */
  publicCloudContinuationTaskId?: string | null;
}

export const PUBLIC_CLOUD_CONTINUATION_CLAIM_PREFIX = 'claim:';

function metadataOf(result: unknown): Record<string, unknown> {
  if (typeof result !== 'object' || result === null) return {};
  const metadata = (result as { metadata?: unknown }).metadata;
  return typeof metadata === 'object' && metadata !== null
    ? (metadata as Record<string, unknown>)
    : {};
}

/** Legacy link written into result.metadata before the column existed. */
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
  const column = original.publicCloudContinuationTaskId ?? null;
  if (column?.startsWith(PUBLIC_CLOUD_CONTINUATION_CLAIM_PREFIX))
    throw new TRPCError({
      code: 'CONFLICT',
      message: '原任务的公开云端续作正在创建，不会重复创建。',
    });
  const existing = column ?? publicCloudContinuationTaskIdOf(original.result);
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

export interface ContinuationLink {
  originalTaskId: string;
  claimToken: string;
  /** Called once the replacement row and its link committed together. */
  onLinked: (replacementTaskId: string) => void;
}

/**
 * Claims the original, runs `create` (which must pass the link to the first
 * task insert), and gives the claim back when no replacement row was inserted.
 * Once a replacement is linked the claim is never released, so a later failure
 * of the same request cannot open the door to a second replacement.
 */
export async function runPublicCloudContinuation<T extends { taskId: string }>(deps: {
  originalTaskId: string;
  intent: string;
  loadOriginal: () => Promise<ContinuationOriginal | undefined>;
  claim: (claimToken: string) => Promise<boolean>;
  release: (claimToken: string) => Promise<void>;
  create: (link: ContinuationLink) => Promise<T>;
  newClaimToken: () => string;
  onReleaseFailure?: (err: unknown) => void;
}): Promise<T> {
  assertPublicCloudContinuationAllowed(await deps.loadOriginal(), deps.intent);
  const claimToken = `${PUBLIC_CLOUD_CONTINUATION_CLAIM_PREFIX}${deps.newClaimToken()}`;
  if (!(await deps.claim(claimToken))) {
    // Lost to another request, or the original changed: report the precise reason.
    assertPublicCloudContinuationAllowed(await deps.loadOriginal(), deps.intent);
    throw new TRPCError({ code: 'CONFLICT', message: '原任务的公开云端续作已由另一次请求处理。' });
  }
  let linked = false;
  const release = async () => {
    if (linked) return;
    try {
      await deps.release(claimToken);
    } catch (err) {
      // The claim stays: the original cannot be continued again, but no
      // second replacement can appear either.
      deps.onReleaseFailure?.(err);
    }
  };
  try {
    const response = await deps.create({
      originalTaskId: deps.originalTaskId,
      claimToken,
      onLinked: () => {
        linked = true;
      },
    });
    await release();
    return response;
  } catch (err) {
    await release();
    throw err;
  }
}

/**
 * Wraps the first task insert of a continuation request: the link rides in the
 * insert transaction, and a failed insert/link refunds the quota this request
 * already consumed so a rolled-back continuation is never charged.
 */
export async function insertWithContinuationLink(deps: {
  link: ContinuationLink;
  replacementTaskId: string;
  insert: (publicCloudContinuation: {
    originalTaskId: string;
    claimToken: string;
  }) => Promise<void>;
  refundPendingCharge: () => Promise<void>;
}): Promise<void> {
  try {
    await deps.insert({
      originalTaskId: deps.link.originalTaskId,
      claimToken: deps.link.claimToken,
    });
  } catch (err) {
    await deps.refundPendingCharge();
    throw err;
  }
  deps.link.onLinked(deps.replacementTaskId);
}
