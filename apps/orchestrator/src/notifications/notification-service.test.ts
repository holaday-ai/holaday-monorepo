import { describe, expect, it, vi } from 'vitest';
import { notify, type NotifyDeps } from './notification-service.js';
import type { sendWebhook } from './webhook-sender.js';

/**
 * Codex Pack C2 — vitest Mock generic. Vitest 2.x changed `vi.fn`'s
 * generic from `vi.fn<TArgs, TReturn>()` to `vi.fn<TFn>()`. The test
 * mocks `send` which has the same call signature as `sendWebhook`,
 * so we re-export the signature once + reuse it everywhere instead
 * of inlining the tuple form (which Vitest 2 rejects).
 */
type SendFn = typeof sendWebhook;

/**
 * Minimal drizzle-shaped stub that captures inserts + returns canned
 * channel rows. Mirrors the chain shapes notify() actually calls.
 */
function makeDbStub(opts: {
  channels?: Array<{
    externalId: string;
    platform: string;
    webhookUrl: string;
    customTemplate: unknown;
  }>;
  insertThrows?: Error;
  selectThrows?: Error;
}) {
  const inserted: Array<{
    externalId: string;
    userId: number;
    type: string;
    plannedTaskId?: number | null;
  }> = [];
  let selectCount = 0;
  const db = {
    insert: () => ({
      values: (row: { externalId: string; userId: number; type: string }) => {
        if (opts.insertThrows) return Promise.reject(opts.insertThrows);
        inserted.push(row);
        return Promise.resolve();
      },
    }),
    select: () => ({
      from: () => ({
        where: () => {
          selectCount += 1;
          if (opts.selectThrows) return Promise.reject(opts.selectThrows);
          return Promise.resolve(opts.channels ?? []);
        },
      }),
    }),
  } as unknown as NotifyDeps['db'];
  return { db, inserted, selectCount: () => selectCount };
}

const NOOP_LOGGER = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

describe('notify', () => {
  it('writes stock alerts in-app without enumerating or sending webhook channels', async () => {
    const { db, inserted, selectCount } = makeDbStub({
      channels: [
        { externalId: 'nch_1', platform: 'wecom', webhookUrl: 'u1', customTemplate: null },
      ],
    });
    const sendMock = vi.fn();
    const result = await notify(
      { db, logger: NOOP_LOGGER, send: sendMock },
      {
        userInternalId: 42,
        type: 'task_complete',
        title: '多伦科技风险发生变化',
        message: '数据日期 2026-08-19：升级 1 条',
        plannedTaskInternalId: 77,
        delivery: 'in_app_only',
      },
    );
    expect(inserted).toEqual([
      expect.objectContaining({ userId: 42, plannedTaskId: 77 }),
    ]);
    expect(result.channelResults).toEqual([]);
    expect(result.inAppStored).toBe(true);
    expect(selectCount()).toBe(0);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('writes inbox row + skips webhooks when user has no channels', async () => {
    const { db, inserted } = makeDbStub({ channels: [] });
    const sendMock = vi.fn();
    const res = await notify(
      { db, logger: NOOP_LOGGER, send: sendMock },
      {
        userInternalId: 42,
        type: 'task_complete',
        title: '完成',
        message: '任务成功执行',
      },
    );
    expect(inserted).toHaveLength(1);
    expect(inserted[0]?.userId).toBe(42);
    expect(inserted[0]?.type).toBe('task_complete');
    expect(res.channelResults).toEqual([]);
    expect(res.inAppStored).toBe(true);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('writes inbox row + fires every enabled channel in parallel', async () => {
    const { db } = makeDbStub({
      channels: [
        { externalId: 'nch_1', platform: 'wecom', webhookUrl: 'u1', customTemplate: null },
        { externalId: 'nch_2', platform: 'feishu', webhookUrl: 'u2', customTemplate: null },
      ],
    });
    const sendMock = vi
      .fn<SendFn>()
      .mockResolvedValue({ ok: true, status: 200, attempt: 1 });
    const res = await notify(
      { db, logger: NOOP_LOGGER, send: sendMock },
      {
        userInternalId: 42,
        type: 'task_complete',
        title: '完成',
        message: 'ok',
      },
    );
    expect(sendMock).toHaveBeenCalledTimes(2);
    expect(res.channelResults).toHaveLength(2);
    expect(res.channelResults.every((c) => c.result.ok)).toBe(true);
  });

  it('captures structured failure when one channel fails', async () => {
    const { db } = makeDbStub({
      channels: [
        { externalId: 'nch_1', platform: 'wecom', webhookUrl: 'u1', customTemplate: null },
        { externalId: 'nch_2', platform: 'feishu', webhookUrl: 'u2', customTemplate: null },
      ],
    });
    const sendMock = vi
      .fn<SendFn>()
      .mockResolvedValueOnce({ ok: true, status: 200, attempt: 1 })
      .mockResolvedValueOnce({ ok: false, status: 500, attempt: 2, error: 'boom' });
    const res = await notify(
      { db, logger: NOOP_LOGGER, send: sendMock },
      {
        userInternalId: 42,
        type: 'task_failed',
        title: '失败',
        message: 'err',
      },
    );
    expect(res.channelResults.map((c) => c.result.ok)).toEqual([true, false]);
    expect(res.channelResults[1]?.result.error).toBe('boom');
  });

  it('survives a send() that rejects (allSettled wrap)', async () => {
    const { db } = makeDbStub({
      channels: [
        { externalId: 'nch_1', platform: 'wecom', webhookUrl: 'u1', customTemplate: null },
      ],
    });
    const sendMock = vi
      .fn<SendFn>()
      .mockRejectedValueOnce(new Error('unexpected throw'));
    const res = await notify(
      { db, logger: NOOP_LOGGER, send: sendMock },
      {
        userInternalId: 42,
        type: 'task_complete',
        title: 't',
        message: 'm',
      },
    );
    expect(res.channelResults).toHaveLength(1);
    expect(res.channelResults[0]?.result.ok).toBe(false);
    expect(res.channelResults[0]?.result.error).toBe('unexpected throw');
  });

  it('inbox insert failure returns gracefully (no throw)', async () => {
    const { db } = makeDbStub({
      insertThrows: new Error('ER_DUP_ENTRY'),
      channels: [],
    });
    const sendMock = vi.fn();
    const res = await notify(
      { db, logger: NOOP_LOGGER, send: sendMock },
      {
        userInternalId: 42,
        type: 'task_complete',
        title: 't',
        message: 'm',
      },
    );
    expect(res.channelResults).toEqual([]);
    expect(res.inAppStored).toBe(false);
    expect(NOOP_LOGGER.error).toHaveBeenCalled();
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('channel select failure leaves the inbox row intact', async () => {
    const { db, inserted } = makeDbStub({
      selectThrows: new Error('ER_NO_SUCH_TABLE'),
    });
    const sendMock = vi.fn();
    const res = await notify(
      { db, logger: NOOP_LOGGER, send: sendMock },
      {
        userInternalId: 42,
        type: 'task_complete',
        title: 't',
        message: 'm',
      },
    );
    expect(inserted).toHaveLength(1);
    expect(res.channelResults).toEqual([]);
    expect(NOOP_LOGGER.warn).toHaveBeenCalled();
  });

  it('passes taskName + status into webhook context', async () => {
    const { db } = makeDbStub({
      channels: [
        { externalId: 'nch_1', platform: 'wecom', webhookUrl: 'u1', customTemplate: null },
      ],
    });
    const sendMock = vi
      .fn<SendFn>()
      .mockResolvedValue({ ok: true, status: 200, attempt: 1 });
    await notify(
      { db, logger: NOOP_LOGGER, send: sendMock },
      {
        userInternalId: 42,
        type: 'task_failed',
        title: '失败',
        message: 'm',
        taskName: '每日新闻',
      },
    );
    const ctxArg = sendMock.mock.calls[0]?.[1];
    if (!ctxArg) throw new Error('expected webhook context');
    expect(ctxArg.taskName).toBe('每日新闻');
    expect(ctxArg.status).toBe('failed');
  });

  it('maps task_started to a started webhook status, not success', async () => {
    const { db } = makeDbStub({
      channels: [
        { externalId: 'nch_1', platform: 'wecom', webhookUrl: 'u1', customTemplate: null },
      ],
    });
    const sendMock = vi
      .fn<SendFn>()
      .mockResolvedValue({ ok: true, status: 200, attempt: 1 });
    await notify(
      { db, logger: NOOP_LOGGER, send: sendMock },
      {
        userInternalId: 42,
        type: 'task_started',
        title: '定时任务已启动',
        message: '已按计划开始执行。',
        taskName: '每日新闻',
      },
    );
    const ctxArg = sendMock.mock.calls[0]?.[1];
    if (!ctxArg) throw new Error('expected webhook context');
    expect(ctxArg.status).toBe('started');
  });

  it('maps task_reminder to a reminder webhook status, not success', async () => {
    const { db } = makeDbStub({
      channels: [
        { externalId: 'nch_1', platform: 'wecom', webhookUrl: 'u1', customTemplate: null },
      ],
    });
    const sendMock = vi
      .fn<SendFn>()
      .mockResolvedValue({ ok: true, status: 200, attempt: 1 });
    await notify(
      { db, logger: NOOP_LOGGER, send: sendMock },
      {
        userInternalId: 42,
        type: 'task_reminder',
        title: '定时任务提醒',
        message: '任务即将开始。',
        taskName: '每日新闻',
      },
    );
    const ctxArg = sendMock.mock.calls[0]?.[1];
    if (!ctxArg) throw new Error('expected webhook context');
    expect(ctxArg.status).toBe('reminder');
  });

  it('maps task_skipped to a skipped webhook status, not success', async () => {
    const { db } = makeDbStub({
      channels: [
        { externalId: 'nch_1', platform: 'wecom', webhookUrl: 'u1', customTemplate: null },
      ],
    });
    const sendMock = vi
      .fn<SendFn>()
      .mockResolvedValue({ ok: true, status: 200, attempt: 1 });
    await notify(
      { db, logger: NOOP_LOGGER, send: sendMock },
      {
        userInternalId: 42,
        type: 'task_skipped',
        title: '定时任务已跳过',
        message: '非交易日，未生成简报。',
        taskName: '每日简报',
      },
    );
    const ctxArg = sendMock.mock.calls[0]?.[1];
    if (!ctxArg) throw new Error('expected webhook context');
    expect(ctxArg.status).toBe('skipped');
  });
});
