import { rm } from 'node:fs/promises';
import { pino } from 'pino';
import { afterEach, expect, it, vi } from 'vitest';
import { createExternalBrowserPark } from '../../agent/supercar/agent-loop.js';
import { supercarReply } from '../../agent/supercar/qwen-only-agent-loop.js';
import { TaskRepository } from '../../agent/task-repository.js';
import { env } from '../../config/env.js';
import { _resetSharedStorageProviderForTesting } from '../../files/storage-provider.js';
import { browserOutputFixture } from '../../files/testing/browser-output-fixture.js';
import type { Context } from '../context.js';
import { tasksRouter } from './tasks.js';

const original = { ...env };
afterEach(() => {
  Object.assign(env, original);
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  _resetSharedStorageProviderForTesting();
});

it('rejects oversized Chrome reply material before releasing the persisted task wait', async () => {
  const f = await browserOutputFixture();
  vi.stubEnv('HOLADAY_FILES_ROOT', f.root);
  vi.stubEnv('STORAGE_PROVIDER', 'local');
  _resetSharedStorageProviderForTesting();
  Object.assign(env, { AGENT_MODE: 'legacy', BROWSER_TASK_FILES_V1: false });
  const row = f.taskRecords[0]!;
  Object.assign(row, {
    status: 'awaiting_user',
    intent: 'Inspect this report',
    executionId: null,
    executionRevision: 0,
    coreRecordVersion: 0,
    awaitingKind: 'clarification',
    awaitingQuestion: 'Please supply the report',
    result: { executionMode: 'browser' },
  });
  const mark = vi
    .spyOn(TaskRepository.prototype, 'markAwaitingReplyResumed')
    .mockImplementation(async () => {
      row.status = 'executing';
      return { persisted: true };
    });
  const parking = createExternalBrowserPark({
    taskId: 'tsk_alice',
    intent: 'Inspect this report',
    aborted: () => false,
  });
  const pending = parking.park('Please supply the report', 'clarification');
  try {
    const file = await f.service.storeUpload({
      userIdInternal: 7,
      userExternalId: 'usr_alice',
      filename: 'report.png',
      mimetype: 'image/png',
      buffer: Buffer.alloc(3_000_001, 1),
    });
    const caller = tasksRouter.createCaller({
      db: f.db,
      userId: 'usr_alice',
      taskOrigin: 'user',
      logger: pino({ level: 'silent' }),
      req: {},
      res: {},
      planner: {},
      browserPool: null,
    } as unknown as Context);
    await expect(
      caller.reply({
        taskId: 'tsk_alice',
        message: 'Here is the report.',
        fileIds: [file.externalId],
      }),
    ).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      message: '补充材料超过当前浏览器任务范围或预算，请缩小后重试；任务仍在等待。',
    });
    expect(mark).not.toHaveBeenCalled();
    expect(row.status).toBe('awaiting_user');
    expect(
      supercarReply('tsk_alice', 'Smaller reply', [{ type: 'text', text: 'ACTUAL-SMALLER-731' }]),
    ).toBe(true);
    expect(await pending).toBe('Smaller reply');
    expect(JSON.stringify(parking.takeReply())).toContain('ACTUAL-SMALLER-731');
  } finally {
    parking.close();
    await pending;
    await rm(f.root, { recursive: true, force: true });
  }
});
