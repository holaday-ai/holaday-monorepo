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

describe('tasks.confirm tRPC mutation (awaiting_user → executing | cancelled)', () => {
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

  async function makeUserWithAwaitingTask() {
    const { newExternalId } = await import('@holaday/shared-types');
    const { db } = await import('../../db/client.js');
    const { eq } = await import('drizzle-orm');
    const { users } = await import('../../db/schema/users.js');
    const { TaskController } = await import('../../agent/task-controller.js');
    const { TaskRepository } = await import('../../agent/task-repository.js');

    const email = `confirm+${Date.now()}+${Math.random()}@example.com`;
    const userExternalId = newExternalId('user');
    await db.insert(users).values({
      externalId: userExternalId,
      email,
      passwordHash: 'placeholder',
    });
    const user = must((await db.select().from(users).where(eq(users.email, email)))[0], 'user');

    const repo = new TaskRepository(db);
    const controller = new TaskController();
    const stepHigh = newExternalId('taskStep');
    const stepNext = newExternalId('taskStep');
    const { state: s0 } = controller.start({
      state: {
        taskId: newExternalId('task'),
        status: 'planning',
        plan: [
          { id: stepHigh, kind: 'click' as const, risk: 'high' as const },
          { id: stepNext, kind: 'wait' as const, risk: 'low' as const },
        ],
        cursor: 0,
        pendingConfirm: null,
      },
    });
    await repo.insertTask(s0, { userId: user.id, intent: 'confirm-flow' });
    const { state: s1 } = controller.onStepResult(s0, {
      taskId: s0.taskId,
      stepId: stepHigh,
      status: 'ok',
    });
    await repo.applyStepResult(s0, s1, null);
    expect(s1.status).toBe('awaiting_user');

    return { userExternalId, taskId: s0.taskId };
  }

  async function makeUserWithTaskStatus(status: string) {
    const { newExternalId } = await import('@holaday/shared-types');
    const { db } = await import('../../db/client.js');
    const { eq } = await import('drizzle-orm');
    const { users } = await import('../../db/schema/users.js');
    const { tasks } = await import('../../db/schema/tasks.js');

    const email = `confirm-${status}+${Date.now()}+${Math.random()}@example.com`;
    const userExternalId = newExternalId('user');
    await db.insert(users).values({
      externalId: userExternalId,
      email,
      passwordHash: 'placeholder',
    });
    const user = must((await db.select().from(users).where(eq(users.email, email)))[0], 'user');
    const taskId = newExternalId('task');
    await db.insert(tasks).values({
      externalId: taskId,
      userId: user.id,
      intent: `seeded ${status}`,
      status,
      plan: null,
      origin: 'user',
    });
    return { userExternalId, taskId };
  }

  async function makeUserWithVideoQuoteTask(status = 'awaiting_user') {
    const { newExternalId } = await import('@holaday/shared-types');
    const { db } = await import('../../db/client.js');
    const { eq } = await import('drizzle-orm');
    const { users } = await import('../../db/schema/users.js');
    const { tasks } = await import('../../db/schema/tasks.js');

    const email = `video-quote+${Date.now()}+${Math.random()}@example.com`;
    const userExternalId = newExternalId('user');
    await db.insert(users).values({
      externalId: userExternalId,
      email,
      passwordHash: 'placeholder',
    });
    const user = must((await db.select().from(users).where(eq(users.email, email)))[0], 'user');
    const taskId = newExternalId('task');
    await db.insert(tasks).values({
      externalId: taskId,
      userId: user.id,
      intent: '生成一个产品介绍视频',
      status,
      awaitingKind: 'video_quote',
      awaitingQuestion: '报价：确认制作 / 图片版 / 取消。',
      plan: null,
      origin: 'user',
      result: { summary: '报价：确认制作 / 图片版 / 取消。', metadata: { lane: 'video_creation_confirm' } },
      ...(status === 'completed' || status === 'cancelled' || status === 'failed'
        ? { completedAt: new Date() }
        : {}),
    });
    return { userExternalId, taskId };
  }

  async function callTrpc(
    route: 'abort' | 'confirm' | 'confirmVideo' | 'pause' | 'resume',
    body: unknown,
    userExternalId: string,
  ) {
    const { signAccessToken } = await import('../../auth/jwt.js');
    const { createHttpApp } = await import('../../http.js');
    const { StubPlanner } = await import('../../agent/planners/stub.js');
    const app = createHttpApp({ planner: new StubPlanner() });

    // Pick a free port; bind a transient server.
    const http = await import('node:http');
    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('no address');
    const port = address.port;

    try {
      const token = await signAccessToken({ sub: userExternalId, plan: 'free' });
      const res = await fetch(`http://127.0.0.1:${port}/trpc/tasks.${route}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      return { status: res.status, json };
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }

  it('approve advances cursor and sets status=executing', async () => {
    const { userExternalId, taskId } = await makeUserWithAwaitingTask();
    const { status, json } = await callTrpc('confirm', { taskId, approve: true }, userExternalId);
    expect(status).toBe(200);
    expect((json as { result: { data: { status: string } } }).result.data.status).toBe('executing');

    // DB reflects it.
    const { db } = await import('../../db/client.js');
    const { eq } = await import('drizzle-orm');
    const { tasks } = await import('../../db/schema/tasks.js');
    const taskRow = must(
      (await db.select().from(tasks).where(eq(tasks.externalId, taskId)))[0],
      'taskRow',
    );
    expect(taskRow.status).toBe('executing');
  });

  it('reject transitions to cancelled', async () => {
    const { userExternalId, taskId } = await makeUserWithAwaitingTask();
    const { status, json } = await callTrpc('confirm', { taskId, approve: false }, userExternalId);
    expect(status).toBe(200);
    expect((json as { result: { data: { status: string } } }).result.data.status).toBe('cancelled');

    const { db } = await import('../../db/client.js');
    const { eq } = await import('drizzle-orm');
    const { tasks } = await import('../../db/schema/tasks.js');
    const taskRow = must(
      (await db.select().from(tasks).where(eq(tasks.externalId, taskId)))[0],
      'taskRow',
    );
    expect(taskRow.status).toBe('cancelled');
  });

  it('abort cancels a durable awaiting_user task without an in-memory supercar handle', async () => {
    const { userExternalId, taskId } = await makeUserWithAwaitingTask();
    const { status, json } = await callTrpc('abort', { taskId }, userExternalId);
    expect(status).toBe(200);
    expect((json as { result: { data: { state: string } } }).result.data.state).toBe('cancelled');

    const { db } = await import('../../db/client.js');
    const { eq } = await import('drizzle-orm');
    const { tasks } = await import('../../db/schema/tasks.js');
    const taskRow = must(
      (await db.select().from(tasks).where(eq(tasks.externalId, taskId)))[0],
      'taskRow',
    );
    expect(taskRow.status).toBe('cancelled');
    expect(taskRow.completedAt).not.toBeNull();
  });

  it('abort cancels a queued task before it starts executing', async () => {
    const { userExternalId, taskId } = await makeUserWithTaskStatus('queued');
    const { status, json } = await callTrpc('abort', { taskId }, userExternalId);
    expect(status).toBe(200);
    expect((json as { result: { data: { state: string } } }).result.data.state).toBe('cancelled');

    const { db } = await import('../../db/client.js');
    const { eq } = await import('drizzle-orm');
    const { tasks } = await import('../../db/schema/tasks.js');
    const taskRow = must(
      (await db.select().from(tasks).where(eq(tasks.externalId, taskId)))[0],
      'taskRow',
    );
    expect(taskRow.status).toBe('cancelled');
    expect(taskRow.completedAt).not.toBeNull();
  });

  it('confirmVideo unclear keeps video quotes parked and persists the next prompt', async () => {
    const { userExternalId, taskId } = await makeUserWithVideoQuoteTask();
    const { status, json } = await callTrpc('confirmVideo', { taskId, text: '好' }, userExternalId);
    expect(status).toBe(200);
    expect((json as { result: { data: { status: string } } }).result.data.status).toBe(
      'awaiting_user',
    );

    const { db } = await import('../../db/client.js');
    const { eq } = await import('drizzle-orm');
    const { tasks } = await import('../../db/schema/tasks.js');
    const taskRow = must(
      (await db.select().from(tasks).where(eq(tasks.externalId, taskId)))[0],
      'taskRow',
    );
    expect(taskRow.status).toBe('awaiting_user');
    expect(taskRow.awaitingKind).toBe('video_quote');
    expect(taskRow.awaitingQuestion).toBe('请点按钮选择：确认制作 / 图片版 / 取消。');
    expect(taskRow.completedAt).toBeNull();
  });

  it('confirmVideo cancel refuses stale non-awaiting video quote rows without mutating them', async () => {
    const { userExternalId, taskId } = await makeUserWithVideoQuoteTask('completed');
    const { status } = await callTrpc('confirmVideo', { taskId, choice: 'cancel' }, userExternalId);
    expect(status).toBe(404);

    const { db } = await import('../../db/client.js');
    const { eq } = await import('drizzle-orm');
    const { tasks } = await import('../../db/schema/tasks.js');
    const taskRow = must(
      (await db.select().from(tasks).where(eq(tasks.externalId, taskId)))[0],
      'taskRow',
    );
    expect(taskRow.status).toBe('completed');
    expect(taskRow.result).toMatchObject({
      metadata: { lane: 'video_creation_confirm' },
    });
  });
});
