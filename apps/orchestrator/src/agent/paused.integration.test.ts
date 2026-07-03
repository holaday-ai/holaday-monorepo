import { afterAll, beforeAll, describe, expect, it } from 'vitest';

beforeAll(() => {
  process.env.DATABASE_URL ??= 'mysql://holaday:holaday-dev@127.0.0.1:3306/holaday';
  process.env.REDIS_URL ??= 'redis://127.0.0.1:6379/0';
  process.env.JWT_SECRET ??= 'integration-test-secret-must-be-32-chars-or-more-please';
});

function must<T>(v: T | null | undefined, n: string): T {
  if (v == null) throw new Error(`${n} missing`);
  return v;
}

describe('paused state persistence + rehydration', () => {
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

  it('user pause -> persisted (status, pause_reason, event); resume re-dispatches', async () => {
    const { newExternalId } = await import('@holaday/shared-types');
    const { db } = await import('../db/client.js');
    const { eq } = await import('drizzle-orm');
    const { users } = await import('../db/schema/users.js');
    const { tasks } = await import('../db/schema/tasks.js');
    const { taskEvents } = await import('../db/schema/task-events.js');
    const { TaskController } = await import('./task-controller.js');
    const { TaskRepository } = await import('./task-repository.js');

    const email = `pause+${Date.now()}@example.com`;
    await db.insert(users).values({
      externalId: newExternalId('user'),
      email,
      passwordHash: 'placeholder',
    });
    const user = must((await db.select().from(users).where(eq(users.email, email)))[0], 'user');

    const controller = new TaskController();
    const repo = new TaskRepository(db);

    const stepId = newExternalId('taskStep');
    const { state: s0 } = controller.start({
      state: {
        taskId: newExternalId('task'),
        status: 'planning',
        plan: [{ id: stepId, kind: 'goto' as const, risk: 'low' as const }],
        cursor: 0,
        pendingConfirm: null,
      },
    });
    await repo.insertTask(s0, { userId: user.id, intent: 'pause demo' });

    // Pause
    const { state: paused } = controller.pause(s0, 'user');
    await repo.applyControlTransition(s0, paused);

    const taskRow = must(
      (await db.select().from(tasks).where(eq(tasks.externalId, s0.taskId)))[0],
      'taskRow',
    );
    expect(taskRow.status).toBe('paused');
    expect(taskRow.pauseReason).toBe('user');

    const events = await db.select().from(taskEvents).where(eq(taskEvents.taskId, taskRow.id));
    expect(events.map((e) => e.type)).toContain('task.paused');

    // Resume
    const { state: resumed } = controller.resume(paused);
    await repo.applyControlTransition(paused, resumed);
    const after = must(
      (await db.select().from(tasks).where(eq(tasks.externalId, s0.taskId)))[0],
      'after',
    );
    expect(after.status).toBe('executing');
    expect(after.pauseReason).toBeNull();
    const eventsAfter = await db.select().from(taskEvents).where(eq(taskEvents.taskId, taskRow.id));
    expect(eventsAfter.map((e) => e.type)).toContain('task.resumed');
  });

  it('error->retry->error escalates to paused (retries_exhausted) + step.retry_count', async () => {
    const { newExternalId } = await import('@holaday/shared-types');
    const { db } = await import('../db/client.js');
    const { eq } = await import('drizzle-orm');
    const { users } = await import('../db/schema/users.js');
    const { tasks } = await import('../db/schema/tasks.js');
    const { taskSteps } = await import('../db/schema/task-steps.js');
    const { TaskController } = await import('./task-controller.js');
    const { TaskRepository } = await import('./task-repository.js');

    const email = `retry+${Date.now()}@example.com`;
    await db.insert(users).values({
      externalId: newExternalId('user'),
      email,
      passwordHash: 'placeholder',
    });
    const user = must((await db.select().from(users).where(eq(users.email, email)))[0], 'user');

    const controller = new TaskController();
    const repo = new TaskRepository(db);
    const stepId = newExternalId('taskStep');
    const { state: s0 } = controller.start({
      state: {
        taskId: newExternalId('task'),
        status: 'planning',
        plan: [
          { id: stepId, kind: 'click' as const, risk: 'low' as const },
          { id: newExternalId('taskStep'), kind: 'wait' as const, risk: 'low' as const },
        ],
        cursor: 0,
        pendingConfirm: null,
      },
    });
    await repo.insertTask(s0, { userId: user.id, intent: 'retry escalation' });

    // First error -> retry
    const { state: s1 } = controller.onStepResult(s0, {
      taskId: s0.taskId,
      stepId,
      status: 'error',
      error: { code: 'X', message: 'first' },
    });
    expect(s1.status).toBe('executing');
    expect(s1.retryCount?.[stepId]).toBe(1);
    await repo.applyStepResult(s0, s1, undefined);

    // Second error -> paused(retries_exhausted)
    const { state: s2 } = controller.onStepResult(s1, {
      taskId: s1.taskId,
      stepId,
      status: 'error',
      error: { code: 'X', message: 'second' },
    });
    expect(s2.status).toBe('paused');
    expect(s2.pauseReason).toBe('retries_exhausted');
    await repo.applyStepResult(s1, s2, undefined);

    const taskRow = must(
      (await db.select().from(tasks).where(eq(tasks.externalId, s0.taskId)))[0],
      'taskRow',
    );
    expect(taskRow.status).toBe('paused');
    expect(taskRow.pauseReason).toBe('retries_exhausted');
    expect(taskRow.errorCode).toBe('X');

    const stepRow = must(
      (await db.select().from(taskSteps).where(eq(taskSteps.externalId, stepId)))[0],
      'stepRow',
    );
    expect(stepRow.status).toBe('failed');
    expect(stepRow.retryCount).toBe(1);
  });

  it('rehydrateInFlight returns paused tasks with pauseReason + retryCount', async () => {
    const { newExternalId } = await import('@holaday/shared-types');
    const { db } = await import('../db/client.js');
    const { eq } = await import('drizzle-orm');
    const { users } = await import('../db/schema/users.js');
    const { TaskController } = await import('./task-controller.js');
    const { TaskRepository } = await import('./task-repository.js');

    const email = `rehydrate-paused+${Date.now()}@example.com`;
    await db.insert(users).values({
      externalId: newExternalId('user'),
      email,
      passwordHash: 'placeholder',
    });
    const user = must((await db.select().from(users).where(eq(users.email, email)))[0], 'user');

    const controller = new TaskController();
    const repo = new TaskRepository(db);
    const stepId = newExternalId('taskStep');
    const { state: s0 } = controller.start({
      state: {
        taskId: newExternalId('task'),
        status: 'planning',
        plan: [{ id: stepId, kind: 'goto' as const, risk: 'low' as const }],
        cursor: 0,
        pendingConfirm: null,
      },
    });
    await repo.insertTask(s0, { userId: user.id, intent: 'rehydrate paused' });
    const { state: paused } = controller.pause(s0, 'quota_exceeded');
    await repo.applyControlTransition(s0, paused);

    const all = await repo.rehydrateInFlight();
    const hit = all.find((r) => r.state.taskId === s0.taskId);
    expect(hit).toBeDefined();
    expect(hit?.state.status).toBe('paused');
    expect(hit?.state.pauseReason).toBe('quota_exceeded');
    expect(hit?.pauseReason).toBe('quota_exceeded');
  });

  it('rehydrateInFlight preserves max_steps_reached pause reasons from vision outcomes', async () => {
    const { newExternalId } = await import('@holaday/shared-types');
    const { db } = await import('../db/client.js');
    const { eq } = await import('drizzle-orm');
    const { users } = await import('../db/schema/users.js');
    const { TaskRepository } = await import('./task-repository.js');

    const email = `rehydrate-max-steps+${Date.now()}@example.com`;
    await db.insert(users).values({
      externalId: newExternalId('user'),
      email,
      passwordHash: 'placeholder',
    });
    const user = must((await db.select().from(users).where(eq(users.email, email)))[0], 'user');

    const repo = new TaskRepository(db);
    const taskId = newExternalId('task');
    await repo.insertTask(
      {
        taskId,
        status: 'executing',
        plan: [],
        cursor: 0,
        pendingConfirm: null,
      },
      { userId: user.id, intent: 'max steps demo' },
    );
    const paused = await repo.persistVisionOutcome(taskId, {
      status: 'paused',
      reason: 'max_steps_reached (25)',
      tickCount: 25,
    });
    expect(paused.persisted).toBe(true);

    const all = await repo.rehydrateInFlight();
    const hit = all.find((r) => r.state.taskId === taskId);
    expect(hit).toBeDefined();
    expect(hit?.state.status).toBe('paused');
    expect(hit?.state.pauseReason).toBe('max_steps_reached');
    expect(hit?.pauseReason).toBe('max_steps_reached');
  });

  it('rehydrateInFlight returns queued tasks so restart recovery can resolve them visibly', async () => {
    const { newExternalId } = await import('@holaday/shared-types');
    const { db } = await import('../db/client.js');
    const { eq } = await import('drizzle-orm');
    const { users } = await import('../db/schema/users.js');
    const { TaskRepository } = await import('./task-repository.js');

    const email = `rehydrate-queued+${Date.now()}@example.com`;
    await db.insert(users).values({
      externalId: newExternalId('user'),
      email,
      passwordHash: 'placeholder',
    });
    const user = must((await db.select().from(users).where(eq(users.email, email)))[0], 'user');

    const repo = new TaskRepository(db);
    const stepId = newExternalId('taskStep');
    const taskId = newExternalId('task');
    await repo.insertTask(
      {
        taskId,
        status: 'queued',
        plan: [{ id: stepId, kind: 'goto' as const, risk: 'low' as const }],
        cursor: 0,
        pendingConfirm: null,
      },
      { userId: user.id, intent: 'rehydrate queued' },
    );

    const all = await repo.rehydrateInFlight();
    const hit = all.find((r) => r.state.taskId === taskId);
    expect(hit).toBeDefined();
    expect(hit?.state.status).toBe('queued');
    expect(hit?.state.cursor).toBe(0);
    expect(hit?.state.plan).toHaveLength(1);
  });
});
