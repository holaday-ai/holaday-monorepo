import { afterAll, beforeAll, describe, expect, it } from 'vitest';

beforeAll(() => {
  process.env.DATABASE_URL ??= 'mysql://holaday:holaday-dev@127.0.0.1:3306/holaday';
  process.env.REDIS_URL ??= 'redis://127.0.0.1:6379/0';
  process.env.JWT_SECRET ??= 'integration-test-secret-must-be-32-chars-or-more-please';
});

function must<T>(value: T | null | undefined, name: string): T {
  if (value == null) throw new Error(`${name} missing`);
  return value;
}

describe('TaskRepository against real MySQL', () => {
  let cleanup: () => Promise<void> = async () => {};

  beforeAll(async () => {
    const { applyMigrations } = await import('../test/db-helper.js');
    await applyMigrations(process.env.DATABASE_URL as string);
    const { pool } = await import('../db/client.js');
    cleanup = async () => {
      await pool.end();
    };
  });

  afterAll(async () => {
    await cleanup();
  });

  it('insertTask persists task + task_steps + task.created event', async () => {
    const { newExternalId } = await import('@holaday/shared-types');
    const { db } = await import('../db/client.js');
    const { eq } = await import('drizzle-orm');
    const { users } = await import('../db/schema/users.js');
    const { tasks } = await import('../db/schema/tasks.js');
    const { taskSteps } = await import('../db/schema/task-steps.js');
    const { taskEvents } = await import('../db/schema/task-events.js');
    const { TaskRepository } = await import('./task-repository.js');
    const { TaskController } = await import('./task-controller.js');

    const email = `persist+${Date.now()}@example.com`;
    await db.insert(users).values({
      externalId: newExternalId('user'),
      email,
      passwordHash: 'placeholder',
    });
    const user = must((await db.select().from(users).where(eq(users.email, email)))[0], 'user');

    const repo = new TaskRepository(db);
    const controller = new TaskController();
    const { state } = controller.start({
      state: {
        taskId: newExternalId('task'),
        status: 'planning',
        plan: [
          {
            id: newExternalId('taskStep'),
            kind: 'goto',
            risk: 'low',
            payload: { url: 'https://example.com' },
          },
          { id: newExternalId('taskStep'), kind: 'click', risk: 'high' },
        ],
        cursor: 0,
        pendingConfirm: null,
      },
    });

    await repo.insertTask(state, { userId: user.id, intent: 'scrape example.com' });

    const taskRow = must(
      (await db.select().from(tasks).where(eq(tasks.externalId, state.taskId)))[0],
      'taskRow',
    );
    expect(taskRow.status).toBe('executing');
    expect(taskRow.intent).toBe('scrape example.com');

    const stepRows = await db.select().from(taskSteps).where(eq(taskSteps.taskId, taskRow.id));
    expect(stepRows).toHaveLength(2);
    expect(stepRows.find((r) => r.seq === 0)?.status).toBe('executing');
    expect(stepRows.find((r) => r.seq === 1)?.status).toBe('pending');
    expect(stepRows.find((r) => r.seq === 1)?.riskLevel).toBe('high');

    const events = await db.select().from(taskEvents).where(eq(taskEvents.taskId, taskRow.id));
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe('task.created');
  });

  it('applyStepResult advances task + step rows on ok; marks failed on error', async () => {
    const { newExternalId } = await import('@holaday/shared-types');
    const { db } = await import('../db/client.js');
    const { eq } = await import('drizzle-orm');
    const { users } = await import('../db/schema/users.js');
    const { tasks } = await import('../db/schema/tasks.js');
    const { taskSteps } = await import('../db/schema/task-steps.js');
    const { taskEvents } = await import('../db/schema/task-events.js');
    const { TaskRepository } = await import('./task-repository.js');
    const { TaskController } = await import('./task-controller.js');

    const email = `advance+${Date.now()}@example.com`;
    await db.insert(users).values({
      externalId: newExternalId('user'),
      email,
      passwordHash: 'placeholder',
    });
    const user = must((await db.select().from(users).where(eq(users.email, email)))[0], 'user');

    const repo = new TaskRepository(db);
    const controller = new TaskController();

    const plan = [
      { id: newExternalId('taskStep'), kind: 'goto' as const, risk: 'low' as const },
      { id: newExternalId('taskStep'), kind: 'click' as const, risk: 'low' as const },
      { id: newExternalId('taskStep'), kind: 'screenshot' as const, risk: 'low' as const },
    ];
    const firstStepId = must(plan[0], 'plan[0]').id;
    const secondStepId = must(plan[1], 'plan[1]').id;

    const { state: s0 } = controller.start({
      state: {
        taskId: newExternalId('task'),
        status: 'planning',
        plan,
        cursor: 0,
        pendingConfirm: null,
      },
    });
    await repo.insertTask(s0, { userId: user.id, intent: 'multi-step' });

    const { state: s1 } = controller.onStepResult(s0, {
      taskId: s0.taskId,
      stepId: firstStepId,
      status: 'ok',
    });
    await repo.applyStepResult(s0, s1, { note: 'arrived' });

    const afterOk = must(
      (await db.select().from(tasks).where(eq(tasks.externalId, s0.taskId)))[0],
      'afterOk',
    );
    expect(afterOk.status).toBe('executing');
    const steps1 = await db.select().from(taskSteps).where(eq(taskSteps.taskId, afterOk.id));
    expect(steps1.find((r) => r.seq === 0)?.status).toBe('completed');
    expect(steps1.find((r) => r.seq === 1)?.status).toBe('executing');

    const { state: s2 } = controller.onStepResult(s1, {
      taskId: s1.taskId,
      stepId: secondStepId,
      status: 'error',
      error: { code: 'CLICK_FAILED', message: 'timeout' },
    });
    await repo.applyStepResult(s1, s2, undefined);

    const afterFail = must(
      (await db.select().from(tasks).where(eq(tasks.externalId, s0.taskId)))[0],
      'afterFail',
    );
    expect(afterFail.status).toBe('failed');
    expect(afterFail.errorCode).toBe('CLICK_FAILED');
    expect(afterFail.completedAt).toBeTruthy();

    const steps2 = await db.select().from(taskSteps).where(eq(taskSteps.taskId, afterFail.id));
    expect(steps2.find((r) => r.seq === 1)?.status).toBe('failed');

    const events = await db.select().from(taskEvents).where(eq(taskEvents.taskId, afterFail.id));
    const types = events.map((e) => e.type);
    expect(types).toContain('task.created');
    expect(types).toContain('step.completed');
    expect(types).toContain('step.failed');
  });
});
