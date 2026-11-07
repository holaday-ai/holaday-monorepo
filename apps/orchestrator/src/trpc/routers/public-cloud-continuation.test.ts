import { describe, expect, it } from 'vitest';
import {
  type ContinuationLink,
  type ContinuationOriginal,
  assertPublicCloudContinuationRequest,
  insertWithContinuationLink,
  publicCloudContinuationRequestId,
  runPublicCloudContinuation,
} from './public-cloud-continuation.js';
import { runTaskCreateIdempotently } from './tasks.js';

const INTENT = '在京东查一下 iPhone 价格';
const cancelledPublic = (extra: Record<string, unknown> = {}): ContinuationOriginal => ({
  status: 'cancelled',
  intent: INTENT,
  result: {
    executionMode: 'browser',
    metadata: {
      browserSource: 'local-chrome',
      browserConnection: { reason: 'extension_offline', publicCloudAllowed: true },
      ...extra,
    },
  },
});

describe('public-cloud continuation request shape', () => {
  const ok = {
    publicCloudContinuationOf: 'task_orig1',
    clientRequestId: 'cloud-continue:task_orig1',
    browserPreference: 'cloud-public',
    hasLocalChrome: false,
  };
  it('accepts the key derived from the original task', () => {
    expect(() => assertPublicCloudContinuationRequest(ok)).not.toThrow();
    expect(publicCloudContinuationRequestId('task_orig1')).toBe(ok.clientRequestId);
  });
  it.each([
    { clientRequestId: 'local_pending_abc123' },
    { clientRequestId: undefined },
    { clientRequestId: 'cloud-continue:task_other' },
    { browserPreference: undefined },
    { hasLocalChrome: true },
  ])('rejects %o', (patch) => {
    expect(() => assertPublicCloudContinuationRequest({ ...ok, ...patch })).toThrow(
      expect.objectContaining({ code: 'BAD_REQUEST' }),
    );
  });
});

/**
 * In-memory model of the two database operations the router relies on, with the
 * same semantics as the SQL in TaskRepository:
 * - claim: `UPDATE … SET continuation = token WHERE status = 'cancelled' AND continuation IS NULL`
 *   (single-row atomic; at most one concurrent caller wins);
 * - insert: the replacement row and `continuation = replacementId WHERE continuation = token`
 *   commit together or not at all.
 * The real-MySQL version of these guarantees is in
 * public-cloud-continuation.mysql.integration.test.ts.
 */
function store(original: ContinuationOriginal | undefined) {
  const row = original
    ? { ...original, publicCloudContinuationTaskId: original.publicCloudContinuationTaskId ?? null }
    : undefined;
  const rows: string[] = [];
  let charged = 0;
  let failNextLink = false;
  let failNextRelease = false;
  let tokenSeq = 0;
  let nextId = 0;
  const releaseFailures: unknown[] = [];
  const api = {
    get row() {
      return row;
    },
    rows,
    get charged() {
      return charged;
    },
    releaseFailures,
    failLinkOnce() {
      failNextLink = true;
    },
    failReleaseOnce() {
      failNextRelease = true;
    },
    run(
      opts: {
        intent?: string;
        afterInsert?: () => Promise<void>;
        beforeInsert?: () => Promise<void>;
      } = {},
    ) {
      return runPublicCloudContinuation({
        originalTaskId: 'task_orig1',
        intent: opts.intent ?? INTENT,
        loadOriginal: async () => (row ? { ...row } : undefined),
        claim: async (token) => {
          await Promise.resolve();
          if (!row || row.status !== 'cancelled' || row.publicCloudContinuationTaskId !== null)
            return false;
          row.publicCloudContinuationTaskId = token;
          return true;
        },
        release: async (token) => {
          if (failNextRelease) {
            failNextRelease = false;
            throw new Error('db down');
          }
          if (row && row.publicCloudContinuationTaskId === token)
            row.publicCloudContinuationTaskId = null;
        },
        newClaimToken: () => `t${++tokenSeq}`,
        onReleaseFailure: (err) => releaseFailures.push(err),
        create: async (link: ContinuationLink) => {
          charged += 1; // quota admission happens before the task insert
          await opts.beforeInsert?.();
          const replacementTaskId = `task_cloud${++nextId}`;
          await insertWithContinuationLink({
            link,
            replacementTaskId,
            insert: async ({ claimToken }) => {
              await Promise.resolve();
              // One transaction: the row and the link, or neither.
              if (failNextLink) {
                failNextLink = false;
                throw new Error('link write failed');
              }
              if (!row || row.publicCloudContinuationTaskId !== claimToken)
                throw new Error('claim lost');
              rows.push(replacementTaskId);
              row.publicCloudContinuationTaskId = replacementTaskId;
            },
            refundPendingCharge: async () => {
              charged -= 1;
            },
          });
          await opts.afterInsert?.();
          return { taskId: replacementTaskId };
        },
      });
    },
  };
  return api;
}

describe('public-cloud continuation preconditions', () => {
  it('creates once and links the replacement on the original', async () => {
    const db = store(cancelledPublic());
    await expect(db.run()).resolves.toEqual({ taskId: 'task_cloud1' });
    expect(db.rows).toEqual(['task_cloud1']);
    expect(db.row?.publicCloudContinuationTaskId).toBe('task_cloud1');
    expect(db.charged).toBe(1);
  });
  it.each([
    [
      'original not cancelled (cancel unconfirmed)',
      { ...cancelledPublic(), status: 'awaiting_user' },
      'PRECONDITION_FAILED',
    ],
    [
      'identity-required wait',
      {
        ...cancelledPublic(),
        result: {
          metadata: {
            browserConnection: { reason: 'extension_offline', publicCloudAllowed: false },
          },
        },
      },
      'FORBIDDEN',
    ],
    ['wait without a connection marker', { ...cancelledPublic(), result: {} }, 'FORBIDDEN'],
    [
      'already linked (column)',
      { ...cancelledPublic(), publicCloudContinuationTaskId: 'task_cloud0' },
      'CONFLICT',
    ],
    [
      'claimed by a request still creating',
      { ...cancelledPublic(), publicCloudContinuationTaskId: 'claim:other' },
      'CONFLICT',
    ],
    [
      'already linked (legacy result.metadata)',
      cancelledPublic({ publicCloudContinuationTaskId: 'task_cloud0' }),
      'CONFLICT',
    ],
    ['unknown original', undefined, 'NOT_FOUND'],
  ] as const)('%s → %s, nothing created or charged', async (_label, original, code) => {
    const db = store(original);
    await expect(db.run()).rejects.toMatchObject({ code });
    expect(db.rows).toEqual([]);
    expect(db.charged).toBe(0);
  });
  it('rejects a different intent', async () => {
    const db = store(cancelledPublic());
    await expect(db.run({ intent: '查看我的京东订单' })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
    expect(db.rows).toEqual([]);
    expect(db.row?.publicCloudContinuationTaskId).toBeNull();
  });
});

describe('one original → at most one replacement, at any time', () => {
  it('two concurrent requests (no shared idempotency key): one creates, the other loses the claim', async () => {
    const db = store(cancelledPublic());
    const results = await Promise.allSettled([db.run(), db.run()]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.find((r) => r.status === 'rejected')).toMatchObject({
      reason: { code: 'CONFLICT' },
    });
    expect(db.rows).toHaveLength(1);
    expect(db.charged).toBe(1);
  });
  it('a retry after the idempotency TTL is refused by the linked column', async () => {
    const db = store(cancelledPublic());
    await db.run();
    await expect(db.run()).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(db.rows).toEqual(['task_cloud1']);
    expect(db.charged).toBe(1);
  });
  it('a failed link write rolls the insert back, refunds the charge and frees the claim', async () => {
    const db = store(cancelledPublic());
    db.failLinkOnce();
    await expect(db.run()).rejects.toThrow('link write failed');
    expect(db.rows).toEqual([]);
    expect(db.charged).toBe(0);
    expect(db.row?.publicCloudContinuationTaskId).toBeNull();
    // A later retry creates exactly one replacement.
    await expect(db.run()).resolves.toEqual({ taskId: 'task_cloud2' });
    expect(db.rows).toEqual(['task_cloud2']);
    expect(db.charged).toBe(1);
  });
  it('a failure before any insert frees the claim', async () => {
    const db = store(cancelledPublic());
    await expect(
      db.run({
        beforeInsert: async () => {
          throw new Error('model preflight unavailable');
        },
      }),
    ).rejects.toThrow('model preflight unavailable');
    expect(db.rows).toEqual([]);
    expect(db.row?.publicCloudContinuationTaskId).toBeNull();
  });
  it('a failure after the replacement was inserted keeps the link (no second replacement)', async () => {
    const db = store(cancelledPublic());
    await expect(
      db.run({
        afterInsert: async () => {
          throw new Error('dispatch failed');
        },
      }),
    ).rejects.toThrow('dispatch failed');
    expect(db.row?.publicCloudContinuationTaskId).toBe('task_cloud1');
    await expect(db.run()).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(db.rows).toEqual(['task_cloud1']);
  });
  it('an unreleasable claim blocks further attempts instead of risking a duplicate', async () => {
    const db = store(cancelledPublic());
    db.failReleaseOnce();
    await expect(
      db.run({
        beforeInsert: async () => {
          throw new Error('quota exhausted');
        },
      }),
    ).rejects.toThrow('quota exhausted');
    expect(db.releaseFailures).toHaveLength(1);
    await expect(db.run()).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(db.rows).toEqual([]);
  });
});

/**
 * The router also runs the continuation inside the task-create idempotency
 * claim (claimed → in_flight → replay): a double click or a network retry
 * replays the first replacement without even reaching the database claim.
 */
describe('idempotency claim on top of the database claim', () => {
  it('double click and network retry: one replacement, one charge', async () => {
    const db = store(cancelledPublic());
    const claims = new Map<string, { response?: { taskId: string } }>();
    const key = `spa_task:${publicCloudContinuationRequestId('task_orig1')}`;
    const submit = () =>
      runTaskCreateIdempotently({
        clientRequestId: publicCloudContinuationRequestId('task_orig1'),
        claim: async () => {
          const claim = claims.get(key);
          if (!claim) {
            claims.set(key, {});
            return { kind: 'claimed' as const };
          }
          return claim.response
            ? {
                kind: 'replay' as const,
                conflictsWith: false,
                taskId: claim.response.taskId,
                response: claim.response,
              }
            : { kind: 'in_flight' as const, claimedAt: new Date() };
        },
        finalize: async (_taskId, response) => {
          claims.set(key, { response });
          return true;
        },
        release: async () => claims.delete(key),
        run: () => db.run(),
      });
    const [first, second] = await Promise.allSettled([submit(), submit()]);
    expect(first).toMatchObject({ status: 'fulfilled', value: { taskId: 'task_cloud1' } });
    expect(second).toMatchObject({ status: 'rejected', reason: { code: 'CONFLICT' } });
    await expect(submit()).resolves.toEqual({ taskId: 'task_cloud1' });
    expect(db.rows).toEqual(['task_cloud1']);
    expect(db.charged).toBe(1);
  });
});
