import { afterEach, beforeAll, describe, expect, it } from 'vitest';

beforeAll(() => {
  process.env.DATABASE_URL ??= 'mysql://holaday:holaday-dev@127.0.0.1:3306/holaday';
  process.env.REDIS_URL ??= 'redis://127.0.0.1:6379/0';
  process.env.JWT_SECRET ??= 'integration-test-secret-must-be-32-chars-or-more-please';
  process.env.WS_PORT ??= '38217';
});

function must<T>(v: T | null | undefined, n: string): T {
  if (v == null) throw new Error(`${n} missing`);
  return v;
}

describe('restart recovery: transient queued tasks fail visibly', () => {
  let close: () => Promise<void> = async () => {};

  beforeAll(async () => {
    const { applyMigrations } = await import('../test/db-helper.js');
    await applyMigrations(process.env.DATABASE_URL as string);
  });

  afterEach(async () => {
    await close();
    close = async () => {};
  });

  it('marks a rehydrated queued task failed instead of silently draining it', async () => {
    const { newExternalId, WS_SUBPROTOCOL, parseServerMessage } = await import(
      '@holaday/shared-types'
    );
    const { db } = await import('../db/client.js');
    const { eq } = await import('drizzle-orm');
    const { users } = await import('../db/schema/users.js');
    const { tasks } = await import('../db/schema/tasks.js');
    const { TaskRepository } = await import('../agent/task-repository.js');
    const { signAccessToken } = await import('../auth/jwt.js');
    const { createWsServer, loadRehydratedTasks } = await import('./server.js');
    const { default: WebSocket } = await import('ws');

    const email = `queued-restart+${Date.now()}@example.com`;
    const userExternalId = newExternalId('user');
    await db.insert(users).values({
      externalId: userExternalId,
      email,
      passwordHash: 'placeholder',
    });
    const user = must((await db.select().from(users).where(eq(users.email, email)))[0], 'user');

    const repo = new TaskRepository(db);
    const taskId = newExternalId('task');
    await repo.insertTask(
      {
        taskId,
        status: 'queued',
        plan: [
          {
            id: newExternalId('taskStep'),
            kind: 'goto',
            risk: 'low',
            payload: { url: 'https://example.com' },
          },
        ],
        cursor: 0,
        pendingConfirm: null,
      },
      { userId: user.id, intent: 'queued restart should fail visibly' },
    );

    const summary = await loadRehydratedTasks();
    expect(summary.taskCount).toBeGreaterThanOrEqual(1);

    const port = Number(process.env.WS_PORT);
    const ws = createWsServer(port);
    close = async () => {
      await ws.close();
    };

    const token = await signAccessToken({ sub: userExternalId, plan: 'free' });
    const client = new WebSocket(`ws://127.0.0.1:${port}`, [WS_SUBPROTOCOL, `jwt.${token}`]);
    try {

      const terminalPromise = new Promise<{
        taskId: string;
        status: string;
        reason?: string;
      }>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('no terminal received')), 5_000);
        client.on('message', (raw) => {
          const parsed = parseServerMessage(raw.toString());
          if (parsed.success && parsed.data.type === 'server.task.terminal') {
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

      const terminal = await terminalPromise;
      expect(terminal).toEqual({
        type: 'server.task.terminal',
        taskId,
        status: 'failed',
        reason: '服务重启导致任务中断，重新发送一次即可。',
      });

      const [row] = await db
        .select({
          status: tasks.status,
          errorCode: tasks.errorCode,
          errorMessage: tasks.errorMessage,
        })
        .from(tasks)
        .where(eq(tasks.externalId, taskId))
        .limit(1);
      expect(row).toEqual({
        status: 'failed',
        errorCode: 'ORCHESTRATOR_RESTART',
        errorMessage: '服务重启导致任务中断，重新发送一次即可。',
      });
    } finally {
      client.close();
    }
  });
});
