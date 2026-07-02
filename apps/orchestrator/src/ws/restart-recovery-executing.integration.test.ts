import { afterEach, beforeAll, describe, expect, it } from 'vitest';

beforeAll(() => {
  process.env.DATABASE_URL ??= 'mysql://holaday:holaday-dev@127.0.0.1:3306/holaday';
  process.env.REDIS_URL ??= 'redis://127.0.0.1:6379/0';
  process.env.JWT_SECRET ??= 'integration-test-secret-must-be-32-chars-or-more-please';
  process.env.WS_PORT ??= '38216';
});

function must<T>(v: T | null | undefined, n: string): T {
  if (v == null) throw new Error(`${n} missing`);
  return v;
}

/**
 * W1 rehearsal backlog b1: a task left in status='executing' across an
 * orchestrator restart must have its current step re-dispatched on
 * reconnect. Previously only awaiting_user and paused were re-emitted;
 * an executing task would sit idle until the user manually re-triggered
 * it — a real correctness gap for crash recovery.
 */
describe('restart recovery: executing re-emits server.task.dispatch', () => {
  let close: () => Promise<void> = async () => {};

  beforeAll(async () => {
    const { applyMigrations } = await import('../test/db-helper.js');
    await applyMigrations(process.env.DATABASE_URL as string);
  });

  afterEach(async () => {
    await close();
    close = async () => {};
  });

  it('reconnecting client resumes the in-flight executing step', async () => {
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

    // Seed: a user with an executing task at cursor=1 (first step completed,
    // second step is the one that should be re-dispatched on restart).
    const email = `executing-recovery+${Date.now()}@example.com`;
    const userExternalId = newExternalId('user');
    await db.insert(users).values({
      externalId: userExternalId,
      email,
      passwordHash: 'placeholder',
    });
    const user = must((await db.select().from(users).where(eq(users.email, email)))[0], 'user');

    const repo = new TaskRepository(db);
    const controller = new TaskController();

    const step1Id = newExternalId('taskStep');
    const step2Id = newExternalId('taskStep');
    const { state: s0 } = controller.start({
      state: {
        taskId: newExternalId('task'),
        status: 'planning',
        plan: [
          {
            id: step1Id,
            kind: 'goto',
            risk: 'low',
            payload: { url: 'https://example.com/a' },
          },
          {
            id: step2Id,
            kind: 'click',
            risk: 'low',
            selector: {
              description: 'continue button',
              strategies: [{ kind: 'text', value: 'Continue' }],
              scope: { timeoutMs: 5000 },
              selfHeal: true,
            },
          },
        ],
        cursor: 0,
        pendingConfirm: null,
      },
    });
    await repo.insertTask(s0, { userId: user.id, intent: 'executing-restart demo' });

    // First step completes OK → task advances to executing / cursor=1.
    const { state: s1 } = controller.onStepResult(s0, {
      taskId: s0.taskId,
      stepId: step1Id,
      status: 'ok',
    });
    expect(s1.status).toBe('executing');
    expect(s1.cursor).toBe(1);
    await repo.applyStepResult(s0, s1, { note: 'arrived' });

    // "Restart": fresh loadRehydratedTasks + fresh WS server + reconnect.
    const summary = await loadRehydratedTasks();
    expect(summary.taskCount).toBeGreaterThanOrEqual(1);

    const port = Number(process.env.WS_PORT);
    const ws = createWsServer(port);
    close = async () => {
      await ws.close();
    };

    const token = await signAccessToken({ sub: userExternalId, plan: 'free' });
    const client = new WebSocket(`ws://127.0.0.1:${port}`, [WS_SUBPROTOCOL, `jwt.${token}`]);

    const dispatchPromise = new Promise<{
      taskId: string;
      stepId: string;
      kind: string;
    }>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('no dispatch re-emitted')), 5_000);
      client.on('message', (raw) => {
        const parsed = parseServerMessage(raw.toString());
        if (parsed.success && parsed.data.type === 'server.task.dispatch') {
          clearTimeout(timer);
          resolve({
            taskId: parsed.data.taskId,
            stepId: parsed.data.stepId,
            kind: parsed.data.action.kind,
          });
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

    const dispatch = await dispatchPromise;
    expect(dispatch.taskId).toBe(s0.taskId);
    expect(dispatch.stepId).toBe(step2Id);
    expect(dispatch.kind).toBe('click');

    client.close();
  });

  it('does not re-emit executing steps to extension sockets before web hello resumes them', async () => {
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

    const email = `executing-extension-skip+${Date.now()}@example.com`;
    const userExternalId = newExternalId('user');
    await db.insert(users).values({
      externalId: userExternalId,
      email,
      passwordHash: 'placeholder',
    });
    const user = must((await db.select().from(users).where(eq(users.email, email)))[0], 'user');

    const repo = new TaskRepository(db);
    const controller = new TaskController();
    const step1Id = newExternalId('taskStep');
    const step2Id = newExternalId('taskStep');
    const { state: s0 } = controller.start({
      state: {
        taskId: newExternalId('task'),
        status: 'planning',
        plan: [
          {
            id: step1Id,
            kind: 'goto',
            risk: 'low',
            payload: { url: 'https://example.com/a' },
          },
          {
            id: step2Id,
            kind: 'click',
            risk: 'low',
            selector: {
              description: 'continue button',
              strategies: [{ kind: 'text', value: 'Continue' }],
              scope: { timeoutMs: 5000 },
              selfHeal: true,
            },
          },
        ],
        cursor: 0,
        pendingConfirm: null,
      },
    });
    await repo.insertTask(s0, { userId: user.id, intent: 'extension should not resume task' });

    const { state: s1 } = controller.onStepResult(s0, {
      taskId: s0.taskId,
      stepId: step1Id,
      status: 'ok',
    });
    await repo.applyStepResult(s0, s1, { note: 'arrived' });

    const summary = await loadRehydratedTasks();
    expect(summary.taskCount).toBeGreaterThanOrEqual(1);

    const port = Number(process.env.WS_PORT);
    const ws = createWsServer(port);
    close = async () => {
      await ws.close();
    };

    const token = await signAccessToken({ sub: userExternalId, plan: 'free' });
    const extension = new WebSocket(`ws://127.0.0.1:${port}`, [WS_SUBPROTOCOL, `jwt.${token}`]);
    const extensionDispatch = new Promise<never>((_, reject) => {
      extension.on('message', (raw) => {
        const parsed = parseServerMessage(raw.toString());
        if (parsed.success && parsed.data.type === 'server.task.dispatch') {
          reject(new Error('extension socket received executing task rehydration'));
        }
      });
    });

    await new Promise<void>((resolve, reject) => {
      extension.once('open', () => resolve());
      extension.once('error', reject);
    });
    extension.send(JSON.stringify({ type: 'client.hello', token, extensionVersion: '0.0.1' }));

    await Promise.race([
      new Promise((resolve) => setTimeout(resolve, 100)),
      extensionDispatch,
    ]);

    const web = new WebSocket(`ws://127.0.0.1:${port}`, [WS_SUBPROTOCOL, `jwt.${token}`]);
    const webDispatch = new Promise<{
      taskId: string;
      stepId: string;
      kind: string;
    }>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('no web dispatch re-emitted')), 5_000);
      web.on('message', (raw) => {
        const parsed = parseServerMessage(raw.toString());
        if (parsed.success && parsed.data.type === 'server.task.dispatch') {
          clearTimeout(timer);
          resolve({
            taskId: parsed.data.taskId,
            stepId: parsed.data.stepId,
            kind: parsed.data.action.kind,
          });
        }
      });
      web.on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });

    await new Promise<void>((resolve, reject) => {
      web.once('open', () => resolve());
      web.once('error', reject);
    });
    web.send(JSON.stringify({ type: 'client.hello', token, extensionVersion: 'web-workbench' }));

    const dispatch = await webDispatch;
    expect(dispatch.taskId).toBe(s0.taskId);
    expect(dispatch.stepId).toBe(step2Id);
    expect(dispatch.kind).toBe('click');

    extension.close();
    web.close();
  });

  it('fails an executing task whose step cursor cannot be recovered after restart', async () => {
    const { newExternalId, WS_SUBPROTOCOL, parseServerMessage } = await import(
      '@holaday/shared-types'
    );
    const { db } = await import('../db/client.js');
    const { and, eq } = await import('drizzle-orm');
    const { taskEvents } = await import('../db/schema/task-events.js');
    const { taskSteps } = await import('../db/schema/task-steps.js');
    const { tasks } = await import('../db/schema/tasks.js');
    const { users } = await import('../db/schema/users.js');
    const { TaskRepository } = await import('../agent/task-repository.js');
    const { signAccessToken } = await import('../auth/jwt.js');
    const { createWsServer, loadRehydratedTasks } = await import('./server.js');
    const { default: WebSocket } = await import('ws');

    const email = `executing-no-step+${Date.now()}@example.com`;
    const userExternalId = newExternalId('user');
    await db.insert(users).values({
      externalId: userExternalId,
      email,
      passwordHash: 'placeholder',
    });
    const user = must((await db.select().from(users).where(eq(users.email, email)))[0], 'user');

    const repo = new TaskRepository(db);
    const taskId = newExternalId('task');
    const stepId = newExternalId('taskStep');
    await repo.insertTask(
      {
        taskId,
        status: 'executing',
        plan: [
          {
            id: stepId,
            kind: 'goto',
            risk: 'low',
            payload: { url: 'https://example.com' },
          },
        ],
        cursor: 0,
        pendingConfirm: null,
      },
      { userId: user.id, intent: 'executing restart has no current step' },
    );
    await db
      .update(taskSteps)
      .set({ status: 'completed', completedAt: new Date() })
      .where(eq(taskSteps.externalId, stepId));

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
          id: tasks.id,
          status: tasks.status,
          errorCode: tasks.errorCode,
          errorMessage: tasks.errorMessage,
        })
        .from(tasks)
        .where(eq(tasks.externalId, taskId))
        .limit(1);
      if (!row) throw new Error('task row missing after no-step restart recovery');
      expect(row).toEqual({
        id: expect.any(Number),
        status: 'failed',
        errorCode: 'ORCHESTRATOR_RESTART',
        errorMessage: '服务重启导致任务中断，重新发送一次即可。',
      });

      const [event] = await db
        .select({
          type: taskEvents.type,
          actor: taskEvents.actor,
          payload: taskEvents.payload,
        })
        .from(taskEvents)
        .where(and(eq(taskEvents.taskId, row.id), eq(taskEvents.type, 'task.failed')))
        .limit(1);
      expect(event).toEqual({
        type: 'task.failed',
        actor: 'system',
        payload: {
          source: 'restart_rehydration',
          from: 'executing',
          to: 'failed',
          errorCode: 'ORCHESTRATOR_RESTART',
          reason: '服务重启导致任务中断，重新发送一次即可。',
        },
      });
    } finally {
      client.close();
    }
  });
});
