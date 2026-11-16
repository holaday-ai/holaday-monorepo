import { USER_BROWSER_PROTOCOL } from '@holaday/shared-types';
import { type SQL, getTableName } from 'drizzle-orm';
import { MySqlDialect } from 'drizzle-orm/mysql-core';
import { afterEach, expect, it, vi } from 'vitest';
import * as capabilities from '../../config/browser-capabilities.js';
import * as ws from '../../ws/server.js';
import type { Context } from '../context.js';
import { tasksRouter } from './tasks.js';

const clientRequestId = '6488c303-9880-44d9-885e-51e13755933b';
function fixture(receipt?: Record<string, unknown>, task?: Record<string, unknown>) {
  vi.stubEnv('BROWSER_TASK_TABS_ENABLED', 'true');
  vi.stubEnv('BROWSER_LAUNCH_RECOVERY_ENABLED', 'true');
  vi.spyOn(capabilities, 'browserCapabilities').mockReturnValue({
    viewportV2: true,
    observationV2: true,
    replayV1: false,
    routingV2: true,
  });
  const queries: Array<{ table: string; sql: string; params: unknown[] }> = [];
  const db = {
    select: () => ({
      from: (table: Parameters<typeof getTableName>[0]) => ({
        where: (condition: SQL) => ({
          limit: async () => {
            const name = getTableName(table);
            queries.push({ table: name, ...new MySqlDialect().sqlToQuery(condition) });
            const value = name === 'users' ? { id: 7 } : name === 'tasks' ? task : receipt;
            return value ? [value] : [];
          },
        }),
      }),
    }),
  };
  return {
    queries,
    caller: tasksRouter.createCaller({
      userId: 'alice',
      taskOrigin: 'eval',
      db,
    } as unknown as Context),
  };
}
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

it('recovers only the actual owned task status, independently of a stale client selection or cached response', async () => {
  const h = fixture(
    {
      taskId: 'tsk_recovered',
      expiresAt: new Date(Date.now() + 60_000),
      responseJson: { status: 'completed', secret: 'never return this' },
    },
    { status: 'awaiting_user' },
  );
  expect(await h.caller.localChromeLaunchReceipt({ clientRequestId })).toEqual({
    state: 'created',
    taskId: 'tsk_recovered',
    status: 'awaiting_user',
  });
  const claim = h.queries.find((q) => q.table === 'webhook_idempotency')!;
  expect(claim.params).toEqual([7, `spa_task:${clientRequestId}`]);
  const task = h.queries.find((q) => q.table === 'tasks')!;
  expect(task.sql).toContain('`tasks`.`user_id` = ?');
  expect(task.sql).toContain('`tasks`.`origin` = ?');
  expect(task.params).toEqual(['tsk_recovered', 7, 'eval']);
});

it.each([
  { receipt: undefined, task: undefined, expected: 'absent' },
  {
    receipt: { taskId: '', expiresAt: new Date(Date.now() + 60_000) },
    task: undefined,
    expected: 'pending',
  },
  {
    receipt: { taskId: 'tsk_recovered', expiresAt: new Date(0) },
    task: { status: 'completed' },
    expected: 'unknown',
  },
  {
    receipt: { taskId: 'tsk_recovered', expiresAt: new Date(Date.now() + 60_000) },
    task: undefined,
    expected: 'unknown',
  },
])(
  'reports $expected without inventing a replacement task',
  async ({ receipt, task, expected }) => {
    const h = fixture(receipt, task);
    expect(await h.caller.localChromeLaunchReceipt({ clientRequestId })).toEqual({
      state: expected,
    });
  },
);

it('keeps receipt recovery unavailable behind the default-off rollout gate', async () => {
  const h = fixture();
  vi.stubEnv('BROWSER_LAUNCH_RECOVERY_ENABLED', 'false');
  await expect(h.caller.localChromeLaunchReceipt({ clientRequestId })).rejects.toMatchObject({
    code: 'PRECONDITION_FAILED',
  });
  expect(h.queries).toEqual([]);
});
it('rejects old current-page clients before admission or database work when recovery is required', async () => {
  const h = fixture();
  await expect(
    h.caller.create({
      intent: '处理当前页',
      clientRequestId,
      localChrome: {
        extensionClientId: 'connection',
        tabId: 42,
        expectedUrl: 'https://work.example',
        selectionId: clientRequestId,
      },
    }),
  ).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
  expect(h.queries).toEqual([]);
});

it('refuses arbitrary task IDs or injected lookup scopes in the receipt request', async () => {
  const h = fixture();
  await expect(
    h.caller.localChromeLaunchReceipt({ clientRequestId: 'tsk_other' }),
  ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  await expect(
    h.caller.localChromeLaunchReceipt({ clientRequestId, userId: 'bob' } as never),
  ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  expect(h.queries).toEqual([]);
});

it('acknowledges only an owned task in the exact original Chrome session', async () => {
  const h = fixture(undefined, { id: 19 });
  const launchBrowserSessionId = '82cf0bca-b78c-4f12-af23-035421ab959c';
  vi.spyOn(ws, 'getConnectedExtensionClientIds').mockReturnValue(['connection']);
  const send = vi.spyOn(ws, 'sendExtensionToolCall').mockResolvedValueOnce({
    ok: true,
    extensionClientId: 'connection',
    result: {
      launchBrowserSessionId,
      userBrowserProtocol: {
        ...USER_BROWSER_PROTOCOL,
        capabilities: [...USER_BROWSER_PROTOCOL.capabilities, 'task_launch_recovery_v1'],
      },
    },
  });
  send.mockResolvedValueOnce({
    ok: true,
    extensionClientId: 'connection',
    result: { released: true },
  });
  expect(
    await h.caller.localChromeLaunchAcknowledge({
      taskId: 'tsk_recovered',
      preparationId: clientRequestId,
      extensionClientId: 'connection',
      launchBrowserSessionId,
    }),
  ).toEqual({ acknowledged: true });
  expect(h.queries.find((q) => q.table === 'tasks')?.params).toEqual(['tsk_recovered', 7, 'eval']);
  expect(send).toHaveBeenLastCalledWith(
    'alice',
    expect.objectContaining({
      kind: 'task_tab_release',
      args: { preparationId: clientRequestId, launchBrowserSessionId },
    }),
  );
});
it('never releases preparation records from a different browser session or a missing task', async () => {
  const h = fixture(undefined, { id: 19 });
  vi.spyOn(ws, 'getConnectedExtensionClientIds').mockReturnValue(['connection']);
  const send = vi.spyOn(ws, 'sendExtensionToolCall').mockResolvedValue({
    ok: true,
    extensionClientId: 'connection',
    result: {
      launchBrowserSessionId: 'a924f85c-8070-4020-a30c-7226bd95b415',
      userBrowserProtocol: {
        ...USER_BROWSER_PROTOCOL,
        capabilities: [...USER_BROWSER_PROTOCOL.capabilities, 'task_launch_recovery_v1'],
      },
    },
  });
  await expect(
    h.caller.localChromeLaunchAcknowledge({
      taskId: 'tsk_recovered',
      preparationId: clientRequestId,
      extensionClientId: 'connection',
      launchBrowserSessionId: '82cf0bca-b78c-4f12-af23-035421ab959c',
    }),
  ).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
  expect(send).toHaveBeenCalledTimes(1);
  const missing = fixture();
  await expect(
    missing.caller.localChromeLaunchAcknowledge({
      taskId: 'tsk_other',
      preparationId: clientRequestId,
      extensionClientId: 'connection',
      launchBrowserSessionId: '82cf0bca-b78c-4f12-af23-035421ab959c',
    }),
  ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  expect(send).toHaveBeenCalledTimes(1);
});
