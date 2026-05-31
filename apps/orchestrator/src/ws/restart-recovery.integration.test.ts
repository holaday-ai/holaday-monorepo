import { afterAll, beforeAll, describe, expect, it } from 'vitest';

beforeAll(() => {
  process.env.DATABASE_URL ??= 'mysql://holaday:holaday-dev@127.0.0.1:3306/holaday';
  process.env.REDIS_URL ??= 'redis://127.0.0.1:6379/0';
  process.env.JWT_SECRET ??= 'integration-test-secret-must-be-32-chars-or-more-please';
  process.env.WS_PORT ??= '38215';
});

function must<T>(v: T | null | undefined, n: string): T {
  if (v == null) throw new Error(`${n} missing`);
  return v;
}

describe('restart recovery: awaiting_user re-emits server.user.confirm', () => {
  let close: () => Promise<void> = async () => {};

  beforeAll(async () => {
    const { applyMigrations } = await import('../test/db-helper.js');
    await applyMigrations(process.env.DATABASE_URL as string);
  });

  afterAll(async () => {
    await close();
  });

  it('reconnecting web client receives the persisted confirm prompt after hello', async () => {
    const { newExternalId, WS_SUBPROTOCOL, parseServerMessage } = await import(
      '@holaday/shared-types'
    );
    const { db } = await import('../db/client.js');
    const { eq } = await import('drizzle-orm');
    const { users } = await import('../db/schema/users.js');
    const { TaskController } = await import('../agent/task-controller.js');
    const { TaskRepository } = await import('../agent/task-repository.js');
    const { signAccessToken } = await import('../auth/jwt.js');
    const { createWsServer, loadRehydratedTasks } = await import('./server.js');
    const { default: WebSocket } = await import('ws');

    // 1) Seed: a real user owns one awaiting_user task with a high-risk step.
    const email = `recovery+${Date.now()}@example.com`;
    const userExternalId = newExternalId('user');
    await db.insert(users).values({
      externalId: userExternalId,
      email,
      passwordHash: 'placeholder',
    });
    const user = must((await db.select().from(users).where(eq(users.email, email)))[0], 'user');

    const repo = new TaskRepository(db);
    const controller = new TaskController();
    const stepIdHigh = newExternalId('taskStep');
    const { state: s0 } = controller.start({
      state: {
        taskId: newExternalId('task'),
        status: 'planning',
        plan: [
          { id: stepIdHigh, kind: 'click' as const, risk: 'high' as const },
          { id: newExternalId('taskStep'), kind: 'wait' as const, risk: 'low' as const },
        ],
        cursor: 0,
        pendingConfirm: null,
      },
    });
    await repo.insertTask(s0, { userId: user.id, intent: 'recovery demo' });
    const { state: s1 } = controller.onStepResult(s0, {
      taskId: s0.taskId,
      stepId: stepIdHigh,
      status: 'ok',
    });
    expect(s1.status).toBe('awaiting_user');
    await repo.applyStepResult(s0, s1, null);

    // 2) "Restart": call loadRehydratedTasks fresh, start a new WS server.
    const summary = await loadRehydratedTasks();
    expect(summary.taskCount).toBeGreaterThanOrEqual(1);
    expect(summary.userCount).toBeGreaterThanOrEqual(1);

    const port = Number(process.env.WS_PORT);
    const ws = createWsServer(port);
    close = async () => {
      await ws.close();
    };

    // 3) Connect a client as the same user.
    const token = await signAccessToken({ sub: userExternalId, plan: 'free' });
    const client = new WebSocket(`ws://127.0.0.1:${port}`, [WS_SUBPROTOCOL, `jwt.${token}`]);

    const confirmPromise = new Promise<{
      taskId: string;
      stepId: string;
      prompt: string;
      risk: string;
    }>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('no confirm received')), 5_000);
      client.on('message', (raw) => {
        const parsed = parseServerMessage(raw.toString());
        if (parsed.success && parsed.data.type === 'server.user.confirm') {
          clearTimeout(timer);
          resolve(parsed.data);
        }
      });
      client.on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });

    await new Promise<void>((resolve, reject) => {
      client.once('open', () => resolve());
      client.once('error', reject);
    });
    client.send(JSON.stringify({ type: 'client.hello', token, extensionVersion: 'web-workbench' }));

    const confirm = await confirmPromise;
    expect(confirm.taskId).toBe(s0.taskId);
    expect(confirm.stepId).toBe(stepIdHigh);
    expect(confirm.risk).toBe('high');
    expect(confirm.prompt).toMatch(/确认/u);

    client.close();
  });
});
