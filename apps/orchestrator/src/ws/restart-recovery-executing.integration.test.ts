import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { DrainController } from '../execution/drain-controller.js';

const WS_TEST_PORT = Number(process.env.WS_PORT ?? '38200') + 16;

beforeAll(() => {
  process.env.DATABASE_URL ??= 'mysql://holaday:holaday-dev@127.0.0.1:3306/holaday';
  process.env.REDIS_URL ??= 'redis://127.0.0.1:6379/0';
  process.env.JWT_SECRET ??= 'integration-test-secret-must-be-32-chars-or-more-please';
});

async function authenticateSignedTestToken(token: string): Promise<string | null> {
  const { verifyAccessToken } = await import('../auth/jwt.js');
  return (await verifyAccessToken(token))?.sub ?? null;
}

function must<T>(v: T | null | undefined, n: string): T {
  if (v == null) throw new Error(`${n} missing`);
  return v;
}

/**
 * W1 rehearsal backlog b1: a task left in status='executing' across an
 * legacy orchestrator restart has its current step re-dispatched on
 * reconnect. A controlled candidate must not recreate that authority.
 * Previously only awaiting_user and paused were re-emitted;
 * an executing task would sit idle until the user manually re-triggered
 * it — a real correctness gap for crash recovery.
 */
describe('restart recovery: executing re-emits server.task.dispatch', () => {
  let close: () => Promise<void> = async () => {};
  let control: DrainController | undefined;
  let controlDirectory: string | undefined;

  beforeAll(async () => {
    const { applyMigrations } = await import('../test/db-helper.js');
    await applyMigrations(process.env.DATABASE_URL as string);
  });

  afterEach(async () => {
    try {
      await close();
    } finally {
      close = async () => {};
      control?.state.abandon();
      control = undefined;
      if (controlDirectory) rmSync(controlDirectory, { recursive: true });
      controlDirectory = undefined;
    }
  });

  // Removing server.ts's strict rehydration guard must fail the strict case;
  // removing all legacy dispatch must fail the paired legacy case.
  it.each([false, true])('reconnect obeys execution authority (strict=%s)', async (strict) => {
    const { newExternalId, WS_SUBPROTOCOL, parseServerMessage } = await import(
      '@holaday/shared-types'
    );
    const { db } = await import('../db/client.js');
    const { eq } = await import('drizzle-orm');
    const { users } = await import('../db/schema/users.js');
    const { tasks } = await import('../db/schema/tasks.js');
    const { taskSteps } = await import('../db/schema/task-steps.js');
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
      state: null,
      taskId: newExternalId('task'),
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
    const taskBefore = must(
      (await db.select().from(tasks).where(eq(tasks.externalId, s0.taskId)))[0],
      'persisted task',
    );
    const stepsBefore = await db
      .select()
      .from(taskSteps)
      .where(eq(taskSteps.taskId, taskBefore.id))
      .orderBy(taskSteps.id);

    // "Restart": fresh loadRehydratedTasks + fresh WS server + reconnect.
    const summary = await loadRehydratedTasks();
    expect(summary.taskCount).toBeGreaterThanOrEqual(1);

    if (strict) {
      controlDirectory = realpathSync(mkdtempSync(join(tmpdir(), 'hd-ws-recovery-')));
      const identity = { epoch: 'a'.repeat(32), candidate: 'b'.repeat(40), bootId: 'c'.repeat(32) };
      writeFileSync(
        join(controlDirectory, 'state.json'),
        `${JSON.stringify({
          schemaVersion: 1,
          ...identity,
          bootId: 'd'.repeat(32),
          sequence: 1,
          mode: 'closed',
          dirty: false,
        })}\n`,
        { mode: 0o600 },
      );
      // Opening authorization is synthetic here; state storage, controller,
      // DB rehydration, JWT authentication and WS delivery remain real.
      control = new DrainController(controlDirectory, identity, async () => {});
      const session = control.connect();
      const opened = await control.execute(
        session,
        Buffer.from(
          `${JSON.stringify({
            protocol: 1,
            op: 'open',
            ...identity,
            version: 2,
            serial: 1,
            expiresAt: Date.now() + 10_000,
          })}\n`,
        ),
      );
      expect(opened.ok).toBe(true);
    }
    const port = WS_TEST_PORT;
    const ws = createWsServer(port, {
      authenticateToken: authenticateSignedTestToken,
      executionDrain: control,
    });
    close = async () => {
      for (const socket of ws.wss.clients) socket.terminate();
      await ws.close();
    };

    const token = await signAccessToken({ sub: userExternalId, plan: 'free' });
    const client = new WebSocket(`ws://127.0.0.1:${port}`, [WS_SUBPROTOCOL, `jwt.${token}`]);

    const frames: string[] = [];
    const dispatches: Array<{ taskId: string; stepId: string; kind: string }> = [];
    client.on('message', (raw) => {
      frames.push(JSON.parse(raw.toString()).type);
      const parsed = parseServerMessage(raw.toString());
      if (parsed.success && parsed.data.type === 'server.task.dispatch')
        dispatches.push({
          taskId: parsed.data.taskId,
          stepId: parsed.data.stepId,
          kind: parsed.data.action.kind,
        });
    });

    await new Promise<void>((resolve, reject) => {
      client.once('open', () => resolve());
      client.once('error', reject);
    });
    client.send(JSON.stringify({ type: 'client.hello', token, extensionVersion: 'web-workbench' }));

    await vi.waitFor(() => expect(frames).toContain('server.welcome'));
    // Ordered server-to-client marker avoids treating a short sleep or an
    // unauthenticated/closed socket as proof of no replay. Executing hydration
    // has no awaited DB write on this valid-cursor path.
    must([...ws.wss.clients][0], 'server socket').send(
      JSON.stringify({ type: 'synthetic.recovery.marker' }),
    );
    await vi.waitFor(() => expect(frames).toContain('synthetic.recovery.marker'));
    expect(dispatches).toEqual(
      strict ? [] : [{ taskId: s0.taskId, stepId: step2Id, kind: 'click' }],
    );
    expect(frames).not.toContain('server.error');
    expect((await db.select().from(tasks).where(eq(tasks.id, taskBefore.id)))[0]).toEqual(
      taskBefore,
    );
    expect(
      await db
        .select()
        .from(taskSteps)
        .where(eq(taskSteps.taskId, taskBefore.id))
        .orderBy(taskSteps.id),
    ).toEqual(stepsBefore);

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
      state: null,
      taskId: newExternalId('task'),
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

    const port = WS_TEST_PORT;
    const ws = createWsServer(port, { authenticateToken: authenticateSignedTestToken });
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

    await Promise.race([new Promise((resolve) => setTimeout(resolve, 100)), extensionDispatch]);

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

    const port = WS_TEST_PORT;
    const ws = createWsServer(port, { authenticateToken: authenticateSignedTestToken });
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
      client.send(
        JSON.stringify({ type: 'client.hello', token, extensionVersion: 'web-workbench' }),
      );

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
