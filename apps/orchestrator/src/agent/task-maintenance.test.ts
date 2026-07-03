import { describe, expect, it } from 'vitest';

import type { DB } from '../db/client.js';
import { failStaleTasksWithEvents, failTaskWithEventIfStatus } from './task-maintenance.js';

function fakeDbForMaintenance(candidates: Array<{ id: number; externalId: string; status: string }>, affectedRows: number[]) {
  const captured = {
    eventPayloads: [] as Record<string, unknown>[],
    updatePayloads: [] as Record<string, unknown>[],
    selectWhere: null as unknown,
    updateWhereClauses: [] as unknown[],
    transactions: 0,
  };

  const select = () => ({
    from: () => ({
      where: async (condition: unknown) => {
        captured.selectWhere = condition;
        return candidates;
      },
    }),
  });

  const update = () => ({
    set: (payload: Record<string, unknown>) => ({
      where: async (condition: unknown) => {
        captured.updatePayloads.push(payload);
        captured.updateWhereClauses.push(condition);
        return [{ affectedRows: affectedRows.shift() ?? 0 }];
      },
    }),
  });

  const insert = () => ({
    values: async (payload: Record<string, unknown>) => {
      captured.eventPayloads.push(payload);
      return undefined;
    },
  });

  const transaction = async (cb: (tx: unknown) => Promise<void>) => {
    captured.transactions += 1;
    await cb({ update, insert });
  };

  return {
    db: { select, transaction } as unknown as DB,
    captured,
  };
}

function fakeDbForSingleTaskMaintenance(
  taskRow: { id: number; externalId: string; status: string } | undefined,
  affectedRows: number[],
) {
  const captured = {
    eventPayloads: [] as Record<string, unknown>[],
    updatePayloads: [] as Record<string, unknown>[],
    selectWhere: null as unknown,
    updateWhereClauses: [] as unknown[],
    transactions: 0,
  };

  const select = () => ({
    from: () => ({
      where: (condition: unknown) => {
        captured.selectWhere = condition;
        return {
          limit: async () => (taskRow ? [{ id: taskRow.id }] : []),
        };
      },
    }),
  });

  const update = () => ({
    set: (payload: Record<string, unknown>) => ({
      where: async (condition: unknown) => {
        captured.updatePayloads.push(payload);
        captured.updateWhereClauses.push(condition);
        return [{ affectedRows: affectedRows.shift() ?? 0 }];
      },
    }),
  });

  const insert = () => ({
    values: async (payload: Record<string, unknown>) => {
      captured.eventPayloads.push(payload);
      return undefined;
    },
  });

  const transaction = async (cb: (tx: unknown) => Promise<void>) => {
    captured.transactions += 1;
    await cb({ update, insert });
  };

  return {
    db: { select, transaction } as unknown as DB,
    captured,
  };
}

describe('failStaleTasksWithEvents', () => {
  it('marks stale in-flight tasks failed and records one task.failed event per changed row', async () => {
    const { db, captured } = fakeDbForMaintenance(
      [{ id: 42, externalId: 'tsk_exec', status: 'executing' }],
      [1],
    );

    const changed = await failStaleTasksWithEvents(db, {
      source: 'runtime_zombie_reaper',
      sourceStatuses: ['executing'],
      staleBy: 'updatedAt',
      cutoff: new Date('2026-07-02T10:00:00.000Z'),
      errorCode: 'EXECUTION_TIMEOUT',
      errorMessage: '任务执行超过 20 分钟未更新，已自动标记失败。',
    });

    expect(changed).toBe(1);
    expect(captured.transactions).toBe(1);
    expect(captured.updatePayloads[0]).toMatchObject({
      status: 'failed',
      errorCode: 'EXECUTION_TIMEOUT',
      errorMessage: '任务执行超过 20 分钟未更新，已自动标记失败。',
    });
    expect(captured.eventPayloads).toHaveLength(1);
    expect(captured.eventPayloads[0]).toMatchObject({
      taskId: 42,
      type: 'task.failed',
      actor: 'system',
      payload: {
        source: 'runtime_zombie_reaper',
        from: 'executing',
        to: 'failed',
        errorCode: 'EXECUTION_TIMEOUT',
        reason: '任务执行超过 20 分钟未更新，已自动标记失败。',
      },
    });
  });

  it('clears awaiting_user fields when timing out parked tasks', async () => {
    const { db, captured } = fakeDbForMaintenance(
      [{ id: 7, externalId: 'tsk_awaiting', status: 'awaiting_user' }],
      [1],
    );

    const changed = await failStaleTasksWithEvents(db, {
      source: 'boot_sweep',
      sourceStatuses: ['awaiting_user'],
      staleBy: 'updatedAt',
      cutoff: new Date('2026-07-02T10:00:00.000Z'),
      errorCode: 'AWAITING_USER_TIMEOUT',
      errorMessage: '等待用户响应超时（>35分钟），任务已自动释放。',
      clearAwaiting: true,
    });

    expect(changed).toBe(1);
    expect(captured.updatePayloads[0]).toMatchObject({
      status: 'failed',
      errorCode: 'AWAITING_USER_TIMEOUT',
      awaitingQuestion: null,
      awaitingKind: null,
    });
    expect(captured.eventPayloads[0]).toMatchObject({
      taskId: 7,
      type: 'task.failed',
      payload: {
        source: 'boot_sweep',
        from: 'awaiting_user',
        errorCode: 'AWAITING_USER_TIMEOUT',
      },
    });
  });

  it('clears pauseReason when a stale task is marked terminal failed', async () => {
    const { db, captured } = fakeDbForMaintenance(
      [{ id: 8, externalId: 'tsk_paused', status: 'paused' }],
      [1],
    );

    const changed = await failStaleTasksWithEvents(db, {
      source: 'runtime_zombie_reaper',
      sourceStatuses: ['paused'],
      staleBy: 'updatedAt',
      cutoff: new Date('2026-07-02T10:00:00.000Z'),
      errorCode: 'PAUSE_EXPIRED',
      errorMessage: '暂停任务已过期，重新发送一次即可。',
    });

    expect(changed).toBe(1);
    expect(captured.updatePayloads[0]).toMatchObject({
      status: 'failed',
      pauseReason: null,
      errorCode: 'PAUSE_EXPIRED',
    });
  });

  it('does not write task.failed when the guarded update loses the race', async () => {
    const { db, captured } = fakeDbForMaintenance(
      [{ id: 99, externalId: 'tsk_done_elsewhere', status: 'executing' }],
      [0],
    );

    const changed = await failStaleTasksWithEvents(db, {
      source: 'runtime_zombie_reaper',
      sourceStatuses: ['executing'],
      staleBy: 'updatedAt',
      cutoff: new Date('2026-07-02T10:00:00.000Z'),
      errorCode: 'EXECUTION_TIMEOUT',
      errorMessage: '任务执行超过 20 分钟未更新，已自动标记失败。',
    });

    expect(changed).toBe(0);
    expect(captured.updatePayloads).toHaveLength(1);
    expect(captured.eventPayloads).toHaveLength(0);
  });
});

describe('failTaskWithEventIfStatus', () => {
  it('clears pauseReason when restart recovery marks a task terminal failed', async () => {
    const { db, captured } = fakeDbForSingleTaskMaintenance(
      { id: 11, externalId: 'tsk_rehydrate', status: 'planning' },
      [1],
    );

    const result = await failTaskWithEventIfStatus(db, {
      source: 'restart_rehydration',
      taskExternalId: 'tsk_rehydrate',
      fromStatus: 'planning',
      errorCode: 'ORCHESTRATOR_RESTART',
      errorMessage: '服务重启导致任务中断，重新发送一次即可。',
    });

    expect(result.persisted).toBe(true);
    expect(captured.updatePayloads[0]).toMatchObject({
      status: 'failed',
      pauseReason: null,
      errorCode: 'ORCHESTRATOR_RESTART',
    });
    expect(captured.eventPayloads[0]).toMatchObject({
      taskId: 11,
      type: 'task.failed',
    });
  });
});
