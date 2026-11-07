import { afterEach, expect, it, vi } from 'vitest';
import { defaultBrowserNetworkPolicy } from '../../agent/browser-network-policy.js';
import type { Context } from '../context.js';
import { tasksRouter } from './tasks.js';

const LEGACY_PUBLIC_LIMITATION =
  '已显式选择云端公开查询（无登录态）；可能遇到登录或反爬限制，无法读取个人信息。';

/**
 * D17-P1-02: tasks.ensureBrowserSession re-opens a terminal task's browser with
 * the stored policy, failing closed for legacy rows. Database rows and the pool
 * are synthetic; the router code is real.
 */
function caller(taskRow: Record<string, unknown>) {
  const sessions: unknown[] = [];
  const page = { url: () => 'https://shop.example.test/catalog' };
  const browserPool = {
    peek: () => null,
    allocate: async (...args: unknown[]) => {
      sessions.push(args[3]);
      return {
        executor: {
          resetPageForTask: async () => {},
          getPage: async () => page,
          navigate: async () => ({ ok: true }),
        },
      };
    },
    retain: () => true,
    release: async () => {},
  };
  const db = {
    select(projection: Record<string, unknown> = {}) {
      const rows = 'result' in projection ? [taskRow] : [{ id: 41 }];
      const query = {
        where: () => query,
        limit: async () => rows,
      };
      return { from: () => query };
    },
  };
  const logger = {
    child: () => logger,
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
  const ctx = {
    db,
    logger,
    userId: 'usr_restore',
    taskOrigin: 'user',
    browserPool,
  } as unknown as Context;
  return {
    call: () => tasksRouter.createCaller(ctx).ensureBrowserSession({ taskId: 'tsk_old' }),
    sessions,
  };
}
const row = (metadata: Record<string, unknown>, sourceContext: unknown = null) => ({
  status: 'completed',
  origin: 'user',
  sourceContext,
  result: {
    finalUrl: 'https://shop.example.test/catalog',
    metadata: { executionMode: 'browser', ...metadata },
  },
});
afterEach(() => vi.restoreAllMocks());

it.each([
  [
    'a legacy public task (logged-out promise, no policy field)',
    row({ browserLimitation: LEGACY_PUBLIC_LIMITATION }),
    'anonymous',
  ],
  ['a legacy task with no policy evidence', row({}), 'anonymous'],
  [
    'an identity task stored as vault_allowed',
    row({}, { browserSessionPolicy: 'vault_allowed' }),
    'vault_allowed',
  ],
  [
    'vault_allowed in sourceContext but a logged-out promise in the result',
    row({ browserLimitation: LEGACY_PUBLIC_LIMITATION }, { browserSessionPolicy: 'vault_allowed' }),
    'anonymous',
  ],
] as const)('restoring %s allocates with %s', async (_label, taskRow, policy) => {
  vi.spyOn(defaultBrowserNetworkPolicy, 'check').mockResolvedValue({ allowed: true } as never);
  const { call, sessions } = caller(taskRow);
  await expect(call()).resolves.toMatchObject({ status: 'ready', restored: true });
  expect(sessions).toEqual([
    expect.objectContaining({
      targetUrl: 'https://shop.example.test/catalog',
      sessionPolicy: policy,
    }),
  ]);
});
