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

/**
 * End-to-end batch confirm: seed a task whose cursor step is a batch
 * awaiting_user gate (populated via controller.onStepResult with
 * data.batch), then hit /trpc/tasks.confirm with each decision and
 * verify DB state + event log.
 */
describe('tasks.confirm batch flow (approve / skip / reject)', () => {
  let cleanup: () => Promise<void> = async () => {};

  beforeAll(async () => {
    const { applyMigrations } = await import('../../test/db-helper.js');
    await applyMigrations(process.env.DATABASE_URL as string);
    const { pool } = await import('../../db/client.js');
    cleanup = async () => {
      await pool.end();
    };
  });

  afterAll(async () => {
    await cleanup();
  });

  async function seedBatchAwaiting() {
    const { newExternalId } = await import('@holaday/shared-types');
    const { db } = await import('../../db/client.js');
    const { eq } = await import('drizzle-orm');
    const { users } = await import('../../db/schema/users.js');
    const { TaskController } = await import('../../agent/task-controller.js');
    const { TaskRepository } = await import('../../agent/task-repository.js');

    const email = `batch+${Date.now()}+${Math.random()}@example.com`;
    const userExternalId = newExternalId('user');
    await db.insert(users).values({
      externalId: userExternalId,
      email,
      passwordHash: 'placeholder',
    });
    const user = must((await db.select().from(users).where(eq(users.email, email)))[0], 'user');

    const repo = new TaskRepository(db);
    const controller = new TaskController();
    const stepBatchId = newExternalId('taskStep');
    const stepNextId = newExternalId('taskStep');
    const { state: s0 } = controller.start({
      state: {
        taskId: newExternalId('task'),
        status: 'planning',
        plan: [
          { id: stepBatchId, kind: 'click', risk: 'low' },
          { id: stepNextId, kind: 'wait', risk: 'low' },
        ],
        cursor: 0,
        pendingConfirm: null,
      },
    });
    await repo.insertTask(s0, { userId: user.id, intent: 'batch confirm e2e' });

    const { state: awaiting } = controller.onStepResult(s0, {
      taskId: s0.taskId,
      stepId: stepBatchId,
      status: 'awaiting_user',
      data: {
        batch: {
          batchIndex: 0,
          batchTotal: 2,
          summary: 'reply to 2 comments',
          items: [
            { label: '评论 #1', preview: '您好，感谢反馈' },
            { label: '评论 #2', preview: '抱歉，我们改进' },
          ],
        },
      },
    });
    expect(awaiting.pendingConfirm?.kind).toBe('batch');
    await repo.applyStepResult(s0, awaiting, null);

    return { userExternalId, taskId: s0.taskId, stepBatchId, stepNextId };
  }

  async function callConfirm(
    decision: 'approve' | 'skip' | 'reject',
    taskId: string,
    userExternalId: string,
  ) {
    const { signAccessToken } = await import('../../auth/jwt.js');
    const { createHttpApp } = await import('../../http.js');
    const { StubPlanner } = await import('../../agent/planners/stub.js');
    const http = await import('node:http');
    const app = createHttpApp({ planner: new StubPlanner() });
    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('no address');
    const port = address.port;

    try {
      const token = await signAccessToken({ sub: userExternalId, plan: 'free' });
      const res = await fetch(`http://127.0.0.1:${port}/trpc/tasks.confirm`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify({ taskId, decision }),
      });
      const json = (await res.json()) as {
        result?: { data: { status: string } };
        error?: { message: string };
      };
      return { status: res.status, json };
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }

  it('approve pins cursor on the batch step + clears pending_confirm + logs batch.approved', async () => {
    const { db } = await import('../../db/client.js');
    const { eq } = await import('drizzle-orm');
    const { tasks } = await import('../../db/schema/tasks.js');
    const { taskSteps } = await import('../../db/schema/task-steps.js');
    const { taskEvents } = await import('../../db/schema/task-events.js');

    const { userExternalId, taskId, stepBatchId } = await seedBatchAwaiting();
    const { status, json } = await callConfirm('approve', taskId, userExternalId);
    expect(status).toBe(200);
    expect(json.result?.data.status).toBe('executing');

    const taskRow = must(
      (await db.select().from(tasks).where(eq(tasks.externalId, taskId)))[0],
      'taskRow',
    );
    expect(taskRow.status).toBe('executing');

    const stepRow = must(
      (await db.select().from(taskSteps).where(eq(taskSteps.externalId, stepBatchId)))[0],
      'stepRow',
    );
    // Batch approve: cursor unchanged → step NOT completed; pending cleared.
    expect(stepRow.status).toBe('executing');
    expect(stepRow.pendingConfirmPayload).toBeNull();

    const events = await db.select().from(taskEvents).where(eq(taskEvents.taskId, taskRow.id));
    expect(events.map((e) => e.type)).toContain('batch.approved');
  });

  it('skip advances cursor past the batch step (treated as completed)', async () => {
    const { db } = await import('../../db/client.js');
    const { eq } = await import('drizzle-orm');
    const { tasks } = await import('../../db/schema/tasks.js');
    const { taskSteps } = await import('../../db/schema/task-steps.js');

    const { userExternalId, taskId, stepBatchId, stepNextId } = await seedBatchAwaiting();
    const { status, json } = await callConfirm('skip', taskId, userExternalId);
    expect(status).toBe(200);
    expect(json.result?.data.status).toBe('executing');

    const taskRow = must(
      (await db.select().from(tasks).where(eq(tasks.externalId, taskId)))[0],
      'taskRow',
    );
    const batchStep = must(
      (await db.select().from(taskSteps).where(eq(taskSteps.externalId, stepBatchId)))[0],
      'batchStep',
    );
    const nextStep = must(
      (await db.select().from(taskSteps).where(eq(taskSteps.externalId, stepNextId)))[0],
      'nextStep',
    );

    expect(taskRow.status).toBe('executing');
    expect(batchStep.status).toBe('completed');
    expect(nextStep.status).toBe('executing');
  });

  it('reject cancels the whole task', async () => {
    const { db } = await import('../../db/client.js');
    const { eq } = await import('drizzle-orm');
    const { tasks } = await import('../../db/schema/tasks.js');

    const { userExternalId, taskId } = await seedBatchAwaiting();
    const { status, json } = await callConfirm('reject', taskId, userExternalId);
    expect(status).toBe(200);
    expect(json.result?.data.status).toBe('cancelled');

    const taskRow = must(
      (await db.select().from(tasks).where(eq(tasks.externalId, taskId)))[0],
      'taskRow',
    );
    expect(taskRow.status).toBe('cancelled');
  });
});
