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

describe('pending_confirm_payload + rehydration', () => {
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

  it('awaiting_user step persists pending_confirm_payload; rehydrateInFlight reconstructs it', async () => {
    const { newExternalId } = await import('@holaday/shared-types');
    const { db } = await import('../db/client.js');
    const { eq } = await import('drizzle-orm');
    const { users } = await import('../db/schema/users.js');
    const { taskSteps } = await import('../db/schema/task-steps.js');
    const { TaskRepository } = await import('./task-repository.js');
    const { TaskController } = await import('./task-controller.js');

    const email = `rehydrate+${Date.now()}@example.com`;
    await db.insert(users).values({
      externalId: newExternalId('user'),
      email,
      passwordHash: 'placeholder',
    });
    const user = must((await db.select().from(users).where(eq(users.email, email)))[0], 'user');

    const repo = new TaskRepository(db);
    const controller = new TaskController();

    const firstStepId = newExternalId('taskStep');
    const secondStepId = newExternalId('taskStep');
    const plan = [
      { id: firstStepId, kind: 'click' as const, risk: 'high' as const }, // high risk -> auto awaiting_user
      { id: secondStepId, kind: 'screenshot' as const, risk: 'low' as const },
    ];
    const { state: s0 } = controller.start({
      state: null,
      taskId: newExternalId('task'),
      plan,
    });
    await repo.insertTask(s0, { userId: user.id, intent: 'high-risk demo' });

    // ok result on high-risk step -> awaiting_user
    const { state: s1 } = controller.onStepResult(s0, {
      taskId: s0.taskId,
      stepId: firstStepId,
      status: 'ok',
    });
    expect(s1.status).toBe('awaiting_user');
    expect(s1.pendingConfirm).not.toBeNull();
    await repo.applyStepResult(s0, s1, { ok: true });

    // DB row reflects it
    const stepRows = await db.select().from(taskSteps).where(eq(taskSteps.externalId, firstStepId));
    expect(stepRows[0]?.status).toBe('awaiting_user');
    // MariaDB stores JSON as LONGTEXT -> may come back as string.
    const rawPayload = stepRows[0]?.pendingConfirmPayload;
    const payload = (typeof rawPayload === 'string' ? JSON.parse(rawPayload) : rawPayload) as {
      stepId: string;
      prompt: string;
      risk: string;
    } | null;
    expect(payload?.stepId).toBe(firstStepId);
    expect(payload?.risk).toBe('high');
    expect(payload?.prompt).toMatch(/确认/u);

    // Simulate orchestrator restart: fresh controller + repo -> rehydrate.
    const fresh = new TaskRepository(db);
    const rehydrated = await fresh.rehydrateInFlight();

    const hit = rehydrated.find((r) => r.state.taskId === s0.taskId);
    expect(hit).toBeDefined();
    expect(hit?.state.status).toBe('awaiting_user');
    expect(hit?.state.cursor).toBe(0);
    expect(hit?.state.plan).toHaveLength(2);
    expect(hit?.state.plan[0]?.risk).toBe('high');
    expect(hit?.state.pendingConfirm?.stepId).toBe(firstStepId);
    expect(hit?.pendingConfirm?.risk).toBe('high');
    expect(hit?.userExternalId).toMatch(/^usr_/);
  });

  it('userConfirm(approve) clears pending_confirm_payload in DB', async () => {
    const { newExternalId } = await import('@holaday/shared-types');
    const { db } = await import('../db/client.js');
    const { eq } = await import('drizzle-orm');
    const { users } = await import('../db/schema/users.js');
    const { taskSteps } = await import('../db/schema/task-steps.js');
    const { TaskRepository } = await import('./task-repository.js');
    const { TaskController } = await import('./task-controller.js');

    const email = `clear+${Date.now()}@example.com`;
    await db.insert(users).values({
      externalId: newExternalId('user'),
      email,
      passwordHash: 'placeholder',
    });
    const user = must((await db.select().from(users).where(eq(users.email, email)))[0], 'user');

    const repo = new TaskRepository(db);
    const controller = new TaskController();

    const firstStepId = newExternalId('taskStep');
    const { state: s0 } = controller.start({
      state: null,
      taskId: newExternalId('task'),
      plan: [
        { id: firstStepId, kind: 'click' as const, risk: 'high' as const },
        { id: newExternalId('taskStep'), kind: 'wait' as const, risk: 'low' as const },
      ],
    });
    await repo.insertTask(s0, { userId: user.id, intent: 'confirm clear' });

    const { state: s1 } = controller.onStepResult(s0, {
      taskId: s0.taskId,
      stepId: firstStepId,
      status: 'ok',
    });
    await repo.applyStepResult(s0, s1, null);

    // Approve -> controller resumes executing; repo must CLEAR the pending blob.
    const { state: s2 } = controller.userConfirm(s1, 'approve');
    // userConfirm does not go through applyStepResult directly; we emulate
    // the repo write-path by calling applyStepResult with prev=s1, next=s2.
    await repo.applyStepResult(s1, s2, null);

    const stepRows = await db.select().from(taskSteps).where(eq(taskSteps.externalId, firstStepId));
    expect(stepRows[0]?.pendingConfirmPayload).toBeNull();
  });

  it('rehydrateInFlight keeps cursor after a skipped step instead of replaying it', async () => {
    const { newExternalId } = await import('@holaday/shared-types');
    const { db } = await import('../db/client.js');
    const { eq } = await import('drizzle-orm');
    const { users } = await import('../db/schema/users.js');
    const { taskSteps } = await import('../db/schema/task-steps.js');
    const { TaskRepository } = await import('./task-repository.js');
    const { TaskController } = await import('./task-controller.js');

    const email = `rehydrate-skipped+${Date.now()}@example.com`;
    await db.insert(users).values({
      externalId: newExternalId('user'),
      email,
      passwordHash: 'placeholder',
    });
    const user = must((await db.select().from(users).where(eq(users.email, email)))[0], 'user');

    const repo = new TaskRepository(db);
    const controller = new TaskController();

    const skippedStepId = newExternalId('taskStep');
    const nextStepId = newExternalId('taskStep');
    const { state: s0 } = controller.start({
      state: null,
      taskId: newExternalId('task'),
      plan: [
        { id: skippedStepId, kind: 'screenshot' as const, risk: 'low' as const },
        { id: nextStepId, kind: 'extract' as const, risk: 'low' as const },
      ],
    });
    await repo.insertTask(s0, { userId: user.id, intent: 'skip then recover' });

    const { state: s1 } = controller.onStepResult(s0, {
      taskId: s0.taskId,
      stepId: skippedStepId,
      status: 'skipped',
    });
    expect(s1.status).toBe('executing');
    expect(s1.cursor).toBe(1);
    await repo.applyStepResult(s0, s1, { reason: 'optional screenshot unavailable' }, 'skipped');

    const stepRows = await db.select().from(taskSteps).where(eq(taskSteps.externalId, skippedStepId));
    expect(stepRows[0]?.status).toBe('skipped');

    const fresh = new TaskRepository(db);
    const rehydrated = await fresh.rehydrateInFlight();
    const hit = rehydrated.find((r) => r.state.taskId === s0.taskId);
    expect(hit).toBeDefined();
    expect(hit?.state.status).toBe('executing');
    expect(hit?.state.cursor).toBe(1);
    expect(hit?.state.plan[hit.state.cursor]?.id).toBe(nextStepId);
  });
});
