import { type MockInstance, afterEach, beforeEach, expect, it, vi } from 'vitest';
import { TaskRepository } from '../../agent/task-repository.js';
import * as idempotency from '../../api-keys/webhook-idempotency-service.js';
import { QuotaService } from '../../quota/quota-service.js';
import type { Context } from '../context.js';
import { tasksRouter } from './tasks.js';

vi.mock('../../api-keys/webhook-idempotency-service.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api-keys/webhook-idempotency-service.js')>()),
  recordClaim: vi.fn(),
  finalizeClaim: vi.fn(async () => true),
  releaseClaim: vi.fn(async () => true),
}));

const INTENT = '在京东查一下 iPhone 价格';
let original: Record<string, unknown> | undefined;
const originalReads = vi.fn();

function readOriginal(): unknown[] {
  originalReads();
  return original ? [original] : [];
}
function caller() {
  const logger = {
    child: () => logger,
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
  const db = {
    select(projection: Record<string, unknown> = {}) {
      const rows =
        'plan' in projection
          ? [{ id: 41, plan: 'pro', selectedRoles: [], selectedSkills: [], modelDataRegion: 'cn' }]
          : 'intent' in projection && 'result' in projection
            ? readOriginal()
            : [];
      const query = {
        where: () => query,
        orderBy: () => query,
        limit: async () => rows,
        // biome-ignore lint/suspicious/noThenProperty: Drizzle query builders are awaitable; database boundary fixture.
        then: (resolve: (value: unknown[]) => unknown) => Promise.resolve(rows).then(resolve),
      };
      return { from: () => query };
    },
    update: () => ({ set: () => ({ where: async () => [] }) }),
    insert: () => ({ values: async () => [] }),
  };
  const ctx = {
    db,
    logger,
    userId: 'usr_cloud_continue',
    taskOrigin: 'user',
    req: {},
    res: {},
    planner: {},
    playwrightExecutor: null,
    executionRouter: null,
    browserPool: null,
    taskQueue: null,
  } as unknown as Context;
  return tasksRouter.createCaller(ctx);
}
const request = (patch: Record<string, unknown> = {}) => ({
  intent: INTENT,
  mode: 'auto' as const,
  expertMode: 'normal' as const,
  browserPreference: 'cloud-public' as const,
  publicCloudContinuationOf: 'task_orig1',
  clientRequestId: 'cloud-continue:task_orig1',
  ...patch,
});

let consume: MockInstance<QuotaService['tryConsume']>;
let insert: MockInstance<TaskRepository['insertTask']>;
beforeEach(() => {
  original = {
    status: 'cancelled',
    intent: INTENT,
    result: {
      metadata: { browserConnection: { reason: 'extension_offline', publicCloudAllowed: true } },
    },
  };
  originalReads.mockClear();
  vi.mocked(idempotency.recordClaim).mockReset().mockResolvedValue({ kind: 'claimed' });
  vi.mocked(idempotency.releaseClaim).mockClear();
  consume = vi.spyOn(QuotaService.prototype, 'tryConsume').mockResolvedValue({ ok: true });
  insert = vi.spyOn(TaskRepository.prototype, 'insertTask').mockResolvedValue();
});
afterEach(() => {
  consume.mockRestore();
  insert.mockRestore();
});

it('rejects a continuation whose idempotency key is not bound to the original task', async () => {
  await expect(
    caller().create(request({ clientRequestId: 'local_pending_abc123' })),
  ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  expect(idempotency.recordClaim).not.toHaveBeenCalled();
  expect(consume).not.toHaveBeenCalled();
});

it.each([
  ['the original cancel is unconfirmed', { status: 'awaiting_user' }, 'PRECONDITION_FAILED'],
  [
    'the original needs the user login',
    {
      result: {
        metadata: { browserConnection: { reason: 'extension_offline', publicCloudAllowed: false } },
      },
    },
    'FORBIDDEN',
  ],
  [
    'the original already has a replacement',
    {
      result: {
        metadata: {
          browserConnection: { reason: 'extension_offline', publicCloudAllowed: true },
          publicCloudContinuationTaskId: 'task_cloud0',
        },
      },
    },
    'CONFLICT',
  ],
] as const)('creates nothing and charges nothing when %s', async (_label, patch, code) => {
  original = { ...original, ...patch };
  await expect(caller().create(request())).rejects.toMatchObject({ code });
  expect(originalReads).toHaveBeenCalledTimes(1);
  expect(idempotency.releaseClaim).toHaveBeenCalledTimes(1);
  expect(consume).not.toHaveBeenCalled();
  expect(insert).not.toHaveBeenCalled();
});

it('replays the first replacement for a repeated or retried continuation', async () => {
  vi.mocked(idempotency.recordClaim).mockResolvedValue({
    kind: 'replay',
    conflictsWith: false,
    taskId: 'task_cloud1',
    response: { taskId: 'task_cloud1', status: 'executing', steps: [] },
  });
  await expect(caller().create(request())).resolves.toMatchObject({ taskId: 'task_cloud1' });
  expect(originalReads).not.toHaveBeenCalled();
  expect(consume).not.toHaveBeenCalled();
  expect(insert).not.toHaveBeenCalled();
});

it('a concurrent duplicate is refused while the first continuation is creating', async () => {
  vi.mocked(idempotency.recordClaim).mockResolvedValue({
    kind: 'in_flight',
    claimedAt: new Date(),
  });
  await expect(caller().create(request())).rejects.toMatchObject({ code: 'CONFLICT' });
  expect(originalReads).not.toHaveBeenCalled();
  expect(consume).not.toHaveBeenCalled();
});
