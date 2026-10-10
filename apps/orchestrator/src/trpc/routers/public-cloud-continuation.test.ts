import { describe, expect, it, vi } from 'vitest';
import {
  type ContinuationOriginal,
  assertPublicCloudContinuationRequest,
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

describe('public-cloud continuation preconditions', () => {
  const run = (original: ContinuationOriginal | undefined, intent = INTENT) => {
    const create = vi.fn(async () => ({ taskId: 'task_cloud1', status: 'executing' }));
    const recordReplacement = vi.fn(async () => {});
    const pending = runPublicCloudContinuation({
      intent,
      loadOriginal: async () => original,
      recordReplacement,
      create,
    });
    return { pending, create, recordReplacement };
  };
  it('creates once and records the replacement on the original', async () => {
    const { pending, create, recordReplacement } = run(cancelledPublic());
    await expect(pending).resolves.toEqual({ taskId: 'task_cloud1', status: 'executing' });
    expect(create).toHaveBeenCalledTimes(1);
    expect(recordReplacement).toHaveBeenCalledWith({
      executionMode: 'browser',
      metadata: {
        browserSource: 'local-chrome',
        browserConnection: { reason: 'extension_offline', publicCloudAllowed: true },
        publicCloudContinuationTaskId: 'task_cloud1',
      },
    });
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
      'already continued (after the claim TTL)',
      cancelledPublic({ publicCloudContinuationTaskId: 'task_cloud0' }),
      'CONFLICT',
    ],
    ['unknown original', undefined, 'NOT_FOUND'],
  ] as const)('%s → %s, nothing created', async (_label, original, code) => {
    const { pending, create, recordReplacement } = run(original);
    await expect(pending).rejects.toMatchObject({ code });
    expect(create).not.toHaveBeenCalled();
    expect(recordReplacement).not.toHaveBeenCalled();
  });
  it('rejects a different intent', async () => {
    const { pending, create } = run(cancelledPublic(), '查看我的京东订单');
    await expect(pending).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(create).not.toHaveBeenCalled();
  });
  it('still returns the created task when the link write fails', async () => {
    const onRecordFailure = vi.fn();
    const create = vi.fn(async () => ({ taskId: 'task_cloud1' }));
    await expect(
      runPublicCloudContinuation({
        intent: INTENT,
        loadOriginal: async () => cancelledPublic(),
        recordReplacement: async () => {
          throw new Error('db down');
        },
        create,
        onRecordFailure,
      }),
    ).resolves.toEqual({ taskId: 'task_cloud1' });
    expect(onRecordFailure).toHaveBeenCalledTimes(1);
  });
});

/**
 * The router runs the continuation inside the task-create idempotency claim.
 * Model that claim table in memory (claimed → in_flight → replay) and drive the
 * same composition: one original task yields one replacement and one charge,
 * however often the request is repeated.
 */
describe('one original → at most one replacement and one charge', () => {
  function harness(original: ContinuationOriginal) {
    const claims = new Map<string, { response?: { taskId: string } }>();
    let row = original;
    let created = 0;
    let charged = 0;
    const submit = () => {
      const key = `spa_task:${publicCloudContinuationRequestId('task_orig1')}`;
      return runTaskCreateIdempotently({
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
        run: () =>
          runPublicCloudContinuation({
            intent: INTENT,
            loadOriginal: async () => row,
            recordReplacement: async (result) => {
              row = { ...row, result };
            },
            create: async () => {
              charged += 1; // quota admission happens inside the ordinary create path
              await Promise.resolve();
              created += 1;
              return { taskId: `task_cloud${created}` };
            },
          }),
      });
    };
    return {
      submit,
      claims,
      get created() {
        return created;
      },
      get charged() {
        return charged;
      },
      expireClaims: () => claims.clear(),
    };
  }

  it('a double click while the first request is in flight creates one task', async () => {
    const h = harness(cancelledPublic());
    const results = await Promise.allSettled([h.submit(), h.submit()]);
    expect(results[0]).toMatchObject({ status: 'fulfilled', value: { taskId: 'task_cloud1' } });
    expect(results[1]).toMatchObject({ status: 'rejected', reason: { code: 'CONFLICT' } });
    expect(h.created).toBe(1);
    expect(h.charged).toBe(1);
  });

  it('a network retry after success replays the same task without a second charge', async () => {
    const h = harness(cancelledPublic());
    await expect(h.submit()).resolves.toEqual({ taskId: 'task_cloud1' });
    await expect(h.submit()).resolves.toEqual({ taskId: 'task_cloud1' });
    expect(h.created).toBe(1);
    expect(h.charged).toBe(1);
  });

  it('a retry after the claim expired is refused by the link on the original', async () => {
    const h = harness(cancelledPublic());
    await h.submit();
    h.expireClaims();
    await expect(h.submit()).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(h.created).toBe(1);
  });

  it('an unconfirmed cancel creates nothing and leaves the key retryable', async () => {
    const h = harness({ ...cancelledPublic(), status: 'awaiting_user' });
    await expect(h.submit()).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
    expect(h.created).toBe(0);
    expect(h.charged).toBe(0);
    expect(h.claims.size).toBe(0);
  });
});
