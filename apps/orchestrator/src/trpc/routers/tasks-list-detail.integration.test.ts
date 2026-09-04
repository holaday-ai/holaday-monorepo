import { afterAll, beforeAll, describe, expect, it } from 'vitest';

beforeAll(() => {
  process.env.DATABASE_URL ??= 'mysql://holaday:holaday-dev@127.0.0.1:3306/holaday';
  process.env.REDIS_URL ??= 'redis://127.0.0.1:6379/0';
  process.env.JWT_SECRET ??= 'integration-test-secret-must-be-32-chars-or-more-please';
});

/**
 * Integration cover for P1.2 tasks.list + tasks.detail:
 *   - list is scoped to the caller (no cross-user leak)
 *   - list returns rows in DESC id order with working cursor pagination
 *   - detail returns steps in seq order with normalised output blob
 *   - detail rejects unknown/other-user taskIds with NOT_FOUND
 *
 * Uses the transient Express + tRPC server pattern already used by
 * llm-calls.integration.test.ts.
 */

function must<T>(v: T | null | undefined, n: string): T {
  if (v == null) throw new Error(`${n} missing`);
  return v;
}

describe('tRPC tasks.list + tasks.detail', () => {
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

  async function seedUser() {
    const { newExternalId } = await import('@holaday/shared-types');
    const { db } = await import('../../db/client.js');
    const { eq } = await import('drizzle-orm');
    const { users } = await import('../../db/schema/users.js');
    const email = `tasks-list+${Date.now()}+${Math.random()}@example.com`;
    const externalId = newExternalId('user');
    await db.insert(users).values({ externalId, email, passwordHash: 'placeholder' });
    const user = must((await db.select().from(users).where(eq(users.email, email)))[0], 'user');
    return { external: externalId, internalId: user.id };
  }

  async function seedTask(
    userInternalId: number,
    intent: string,
    stepKinds: string[] = ['goto', 'extract'],
    status = 'completed',
    origin: 'user' | 'eval' = 'user',
  ): Promise<string> {
    const { newExternalId } = await import('@holaday/shared-types');
    const { db } = await import('../../db/client.js');
    const { tasks } = await import('../../db/schema/tasks.js');
    const { taskSteps } = await import('../../db/schema/task-steps.js');
    const { eq } = await import('drizzle-orm');
    const externalId = newExternalId('task');
    await db.insert(tasks).values({
      externalId,
      userId: userInternalId,
      status,
      origin,
      intent,
      plan: null,
    });
    const [task] = await db.select().from(tasks).where(eq(tasks.externalId, externalId));
    if (!task) throw new Error('task insert failed');
    for (let i = 0; i < stepKinds.length; i++) {
      await db.insert(taskSteps).values({
        externalId: newExternalId('taskStep'),
        taskId: task.id,
        seq: i,
        kind: stepKinds[i] as string,
        status: 'completed',
        riskLevel: 'low',
        output: { matched: `step ${i}`, texts: [`text-${i}-a`, `text-${i}-b`] },
      });
    }
    return externalId;
  }

  async function bootTrpcServer() {
    const { signAccessToken } = await import('../../auth/jwt.js');
    const { createHttpApp } = await import('../../http.js');
    const { StubPlanner } = await import('../../agent/planners/stub.js');
    const http = await import('node:http');
    const app = createHttpApp({ planner: new StubPlanner() });
    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('no address');
    return {
      port: address.port,
      signAccessToken,
      close: () => new Promise<void>((resolve) => server.close(() => resolve())),
    };
  }

  it('tasks.list returns caller-owned tasks newest-first with cursor pagination', async () => {
    const user = await seedUser();
    const other = await seedUser();
    // 3 tasks for the caller, 1 for someone else (must not leak).
    const t1 = await seedTask(user.internalId, 'intent 1');
    const t2 = await seedTask(user.internalId, 'intent 2');
    const t3 = await seedTask(user.internalId, 'intent 3');
    await seedTask(other.internalId, 'OTHER intent — must not leak');

    const { port, signAccessToken, close } = await bootTrpcServer();
    try {
      const token = await signAccessToken({ sub: user.external, plan: 'free' });
      const res1 = await fetch(
        `http://127.0.0.1:${port}/trpc/tasks.list?input=${encodeURIComponent(
          JSON.stringify({ limit: 2 }),
        )}`,
        { headers: { authorization: `Bearer ${token}` } },
      );
      expect(res1.status).toBe(200);
      const body1 = (await res1.json()) as {
        result: {
          data: { tasks: { taskId: string; intent: string }[]; nextCursor: number | null };
        };
      };
      // DESC by id → most recently inserted first → t3 before t2.
      expect(body1.result.data.tasks).toHaveLength(2);
      expect(body1.result.data.tasks[0]?.taskId).toBe(t3);
      expect(body1.result.data.tasks[1]?.taskId).toBe(t2);
      expect(body1.result.data.nextCursor).toBeTypeOf('number');

      // Other user's task must NOT appear.
      const ids = body1.result.data.tasks.map((t) => t.taskId);
      expect(ids.some((id) => id.startsWith('OTHER'))).toBe(false);

      // Page 2 via cursor.
      const cursor = body1.result.data.nextCursor;
      const res2 = await fetch(
        `http://127.0.0.1:${port}/trpc/tasks.list?input=${encodeURIComponent(
          JSON.stringify({ limit: 2, cursor }),
        )}`,
        { headers: { authorization: `Bearer ${token}` } },
      );
      const body2 = (await res2.json()) as typeof body1;
      expect(body2.result.data.tasks).toHaveLength(1);
      expect(body2.result.data.tasks[0]?.taskId).toBe(t1);
    } finally {
      await close();
    }
  });

  it('isolates product history from eval history while keeping eval polling readable', async () => {
    const user = await seedUser();
    const productTask = await seedTask(user.internalId, 'product task');
    const evalTask = await seedTask(user.internalId, 'eval task', ['extract'], 'completed', 'eval');

    const { port, signAccessToken, close } = await bootTrpcServer();
    const listUrl = `http://127.0.0.1:${port}/trpc/tasks.list?input=${encodeURIComponent(
      JSON.stringify({ limit: 10 }),
    )}`;
    const detailUrl = (taskId: string) =>
      `http://127.0.0.1:${port}/trpc/tasks.detail?input=${encodeURIComponent(
        JSON.stringify({ taskId }),
      )}`;
    try {
      const productToken = await signAccessToken({ sub: user.external, plan: 'free' });
      const evalToken = await signAccessToken({
        sub: user.external,
        plan: 'free',
        taskOrigin: 'eval',
      });

      const productList = (await (
        await fetch(listUrl, { headers: { authorization: `Bearer ${productToken}` } })
      ).json()) as { result: { data: { tasks: Array<{ taskId: string }> } } };
      expect(productList.result.data.tasks.map((task) => task.taskId)).toContain(productTask);
      expect(productList.result.data.tasks.map((task) => task.taskId)).not.toContain(evalTask);

      const evalList = (await (
        await fetch(listUrl, { headers: { authorization: `Bearer ${evalToken}` } })
      ).json()) as { result: { data: { tasks: Array<{ taskId: string }> } } };
      expect(evalList.result.data.tasks.map((task) => task.taskId)).toContain(evalTask);
      expect(evalList.result.data.tasks.map((task) => task.taskId)).not.toContain(productTask);

      const evalDetail = await fetch(detailUrl(evalTask), {
        headers: { authorization: `Bearer ${evalToken}` },
      });
      const productDetailViaEval = await fetch(detailUrl(productTask), {
        headers: { authorization: `Bearer ${evalToken}` },
      });
      expect(evalDetail.status).toBe(200);
      expect(productDetailViaEval.status).toBe(404);
    } finally {
      await close();
    }
  });

  it('tasks.create persists the server-signed eval origin', async () => {
    const user = await seedUser();
    const { port, signAccessToken, close } = await bootTrpcServer();
    try {
      const evalToken = await signAccessToken({
        sub: user.external,
        plan: 'free',
        taskOrigin: 'eval',
      });
      const response = await fetch(`http://127.0.0.1:${port}/trpc/tasks.create`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${evalToken}`,
        },
        body: JSON.stringify({ intent: '总结一句今天的工作进展' }),
      });
      expect(response.status).toBe(200);
      const body = (await response.json()) as { result: { data: { taskId: string } } };

      const { db } = await import('../../db/client.js');
      const { eq } = await import('drizzle-orm');
      const { tasks } = await import('../../db/schema/tasks.js');
      const [created] = await db
        .select({ origin: tasks.origin })
        .from(tasks)
        .where(eq(tasks.externalId, body.result.data.taskId))
        .limit(1);
      expect(created?.origin).toBe('eval');
    } finally {
      await close();
    }
  });

  it('tasks.create persists browser work as an explicit migration-unavailable terminal', async () => {
    const user = await seedUser();
    const { port, signAccessToken, close } = await bootTrpcServer();
    try {
      const token = await signAccessToken({ sub: user.external, plan: 'free' });
      const response = await fetch(`http://127.0.0.1:${port}/trpc/tasks.create`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ intent: '打开网页并登录' }),
      });
      expect(response.status).toBe(200);
      const body = (await response.json()) as {
        result: { data: { taskId: string; status: string; executionMode: string } };
      };
      expect(body.result.data).toMatchObject({
        status: 'failed',
        executionMode: 'browser',
      });

      const { db } = await import('../../db/client.js');
      const { eq } = await import('drizzle-orm');
      const { tasks } = await import('../../db/schema/tasks.js');
      const [created] = await db
        .select({
          status: tasks.status,
          errorCode: tasks.errorCode,
          errorMessage: tasks.errorMessage,
          result: tasks.result,
        })
        .from(tasks)
        .where(eq(tasks.externalId, body.result.data.taskId))
        .limit(1);
      expect(created).toMatchObject({
        status: 'failed',
        errorCode: 'MODEL_MIGRATION_IN_PROGRESS',
        errorMessage: '这项能力正在迁移到千问，暂时不可用。',
        result: {
          metadata: {
            executionMode: 'browser',
            reasonCode: 'MODEL_MIGRATION_IN_PROGRESS',
          },
        },
      });
    } finally {
      await close();
    }
  });

  it('tasks.list status filter includes partial_success in failure review sets', async () => {
    const user = await seedUser();
    const failed = await seedTask(user.internalId, 'hard fail row', ['goto'], 'failed');
    const partial = await seedTask(
      user.internalId,
      'partial result row',
      ['goto'],
      'partial_success',
    );
    await seedTask(user.internalId, 'clean completed row', ['goto'], 'completed');

    const { port, signAccessToken, close } = await bootTrpcServer();
    try {
      const token = await signAccessToken({ sub: user.external, plan: 'free' });
      const res = await fetch(
        `http://127.0.0.1:${port}/trpc/tasks.list?input=${encodeURIComponent(
          JSON.stringify({ limit: 10, status: ['failed', 'partial_success'] }),
        )}`,
        { headers: { authorization: `Bearer ${token}` } },
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        result: {
          data: { tasks: { taskId: string; status: string }[] };
        };
      };
      expect(body.result.data.tasks.map((t) => t.taskId).sort()).toEqual(
        [failed, partial].sort(),
      );
      expect(new Set(body.result.data.tasks.map((t) => t.status))).toEqual(
        new Set(['failed', 'partial_success']),
      );
    } finally {
      await close();
    }
  });

  it('tasks.list includes awaiting metadata needed to render stable recovery controls', async () => {
    const user = await seedUser();
    const { newExternalId } = await import('@holaday/shared-types');
    const { db } = await import('../../db/client.js');
    const { tasks } = await import('../../db/schema/tasks.js');
    const { eq } = await import('drizzle-orm');
    const taskId = newExternalId('task');
    await db.insert(tasks).values({
      externalId: taskId,
      userId: user.internalId,
      status: 'awaiting_user',
      intent: 'video quote awaiting confirmation',
      awaitingKind: 'video_quote',
      awaitingQuestion: '确认制作这个视频吗？',
      result: { summary: '请确认制作' },
    });

    const { port, signAccessToken, close } = await bootTrpcServer();
    try {
      const token = await signAccessToken({ sub: user.external, plan: 'free' });
      const response = await fetch(
        `http://127.0.0.1:${port}/trpc/tasks.list?input=${encodeURIComponent(
          JSON.stringify({ limit: 10 }),
        )}`,
        { headers: { authorization: `Bearer ${token}` } },
      );
      expect(response.status).toBe(200);
      const body = (await response.json()) as {
        result: {
          data: {
            tasks: Array<{
              taskId: string;
              awaitingKind?: string | null;
              awaitingQuestion?: string | null;
            }>;
          };
        };
      };
      const listed = body.result.data.tasks.find((task) => task.taskId === taskId);
      expect(listed).toMatchObject({
        awaitingKind: 'video_quote',
        awaitingQuestion: '确认制作这个视频吗？',
      });
    } finally {
      await close();
      await db.delete(tasks).where(eq(tasks.externalId, taskId));
    }
  });

  it('tasks.list omits a large terminal screenshot before returning history rows', async () => {
    const user = await seedUser();
    const { newExternalId } = await import('@holaday/shared-types');
    const { db } = await import('../../db/client.js');
    const { tasks } = await import('../../db/schema/tasks.js');
    const { eq } = await import('drizzle-orm');
    const taskId = newExternalId('task');
    await db.insert(tasks).values({
      externalId: taskId,
      userId: user.internalId,
      status: 'completed',
      intent: 'large terminal screenshot',
      result: {
        summary: 'terminal result is ready',
        finalUrl: 'https://example.com/',
        finalScreenshot: 'a'.repeat(400_000),
      },
    });

    const { port, signAccessToken, close } = await bootTrpcServer();
    try {
      const token = await signAccessToken({ sub: user.external, plan: 'free' });
      const response = await fetch(
        `http://127.0.0.1:${port}/trpc/tasks.list?input=${encodeURIComponent(
          JSON.stringify({ limit: 10 }),
        )}`,
        { headers: { authorization: `Bearer ${token}` } },
      );
      expect(response.status).toBe(200);
      const body = (await response.json()) as {
        result: {
          data: {
            tasks: Array<{
              taskId: string;
              result: Record<string, unknown> | null;
            }>;
          };
        };
      };
      const listed = body.result.data.tasks.find((task) => task.taskId === taskId);
      expect(listed?.result).toMatchObject({
        summary: 'terminal result is ready',
        finalUrl: 'https://example.com/',
      });
      expect(listed?.result).not.toHaveProperty('finalScreenshot');
    } finally {
      await close();
      await db.delete(tasks).where(eq(tasks.externalId, taskId));
    }
  });

  it('tasks.detail returns task + steps in seq order with parsed output', async () => {
    const user = await seedUser();
    const taskId = await seedTask(user.internalId, 'with steps', ['goto', 'wait', 'extract']);

    const { port, signAccessToken, close } = await bootTrpcServer();
    try {
      const token = await signAccessToken({ sub: user.external, plan: 'free' });
      const res = await fetch(
        `http://127.0.0.1:${port}/trpc/tasks.detail?input=${encodeURIComponent(
          JSON.stringify({ taskId }),
        )}`,
        { headers: { authorization: `Bearer ${token}` } },
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        result: {
          data: {
            taskId: string;
            intent: string;
            steps: { kind: string; seq: number; output: unknown }[];
          };
        };
      };
      const d = body.result.data;
      expect(d.taskId).toBe(taskId);
      expect(d.intent).toBe('with steps');
      expect(d.steps.map((s) => s.kind)).toEqual(['goto', 'wait', 'extract']);
      expect(d.steps.map((s) => s.seq)).toEqual([0, 1, 2]);
      // Output must be a real object, not a string — normalizeOutput
      // in tasks.ts covers the MariaDB-returns-JSON-as-string case.
      const firstOut = d.steps[0]?.output as { matched?: string; texts?: string[] };
      expect(firstOut?.matched).toBe('step 0');
      expect(firstOut?.texts).toEqual(['text-0-a', 'text-0-b']);
    } finally {
      await close();
    }
  });

  it('returns public stock provenance without exposing the bound snapshot payload', async () => {
    const user = await seedUser();
    const { newExternalId } = await import('@holaday/shared-types');
    const { db } = await import('../../db/client.js');
    const { tasks } = await import('../../db/schema/tasks.js');
    const taskId = newExternalId('task');
    const stockContext = {
      snapshotId: 'stkshot_0123456789abcdef01234567',
      dataAsOf: '2026-08-11',
      trustMode: 'historical',
      evidenceIds: ['quote:603528:2026-08-11'],
      snapshotPayload: {
        watchlistStocks: [{ symbol: '603528', price: '6.38' }],
      },
    };
    await db.insert(tasks).values({
      externalId: taskId,
      userId: user.internalId,
      status: 'completed',
      intent: '解释多伦科技当日变化',
      sourceContext: stockContext,
    });

    const { port, signAccessToken, close } = await bootTrpcServer();
    try {
      const token = await signAccessToken({ sub: user.external, plan: 'free' });
      for (const endpoint of [
        `tasks.list?input=${encodeURIComponent(JSON.stringify({ limit: 10 }))}`,
        `tasks.detail?input=${encodeURIComponent(JSON.stringify({ taskId }))}`,
      ]) {
        const response = await fetch(`http://127.0.0.1:${port}/trpc/${endpoint}`, {
          headers: { authorization: `Bearer ${token}` },
        });
        expect(response.status).toBe(200);
        const body = (await response.json()) as { result: { data: unknown } };
        const data = body.result.data as {
          tasks?: Array<{ taskId: string; stockContext?: Record<string, unknown> }>;
          stockContext?: Record<string, unknown>;
        };
        const exposed = data.tasks
          ? data.tasks.find((task) => task.taskId === taskId)?.stockContext
          : data.stockContext;
        expect(exposed).toEqual({
          snapshotId: stockContext.snapshotId,
          dataAsOf: stockContext.dataAsOf,
          trustMode: stockContext.trustMode,
          evidenceIds: stockContext.evidenceIds,
        });
        expect(exposed).not.toHaveProperty('snapshotPayload');
      }
    } finally {
      await close();
    }
  });

  it("tasks.detail returns NOT_FOUND for another user's task (doesn't leak existence)", async () => {
    const userA = await seedUser();
    const userB = await seedUser();
    const othersTaskId = await seedTask(userB.internalId, "B's task");

    const { port, signAccessToken, close } = await bootTrpcServer();
    try {
      const tokenA = await signAccessToken({ sub: userA.external, plan: 'free' });
      const res = await fetch(
        `http://127.0.0.1:${port}/trpc/tasks.detail?input=${encodeURIComponent(
          JSON.stringify({ taskId: othersTaskId }),
        )}`,
        { headers: { authorization: `Bearer ${tokenA}` } },
      );
      // tRPC maps NOT_FOUND to HTTP 404.
      expect(res.status).toBe(404);
    } finally {
      await close();
    }
  });
});
