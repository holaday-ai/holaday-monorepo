import { afterAll, beforeAll, describe, expect, it } from 'vitest';

beforeAll(() => {
  process.env.DATABASE_URL ??= 'mysql://holaday:holaday-dev@127.0.0.1:3306/holaday';
  process.env.REDIS_URL ??= 'redis://127.0.0.1:6379/0';
  process.env.JWT_SECRET ??= 'integration-test-secret-must-be-32-chars-or-more-please';
});

/**
 * P1.1 self-heal metrics — end-to-end against real MariaDB.
 *
 * Covers:
 *   - TaskRepository.recordHealAttempt increments heal_attempts AND
 *     writes elapsed + token counters onto the step row
 *   - TaskRepository.markHealSucceeded flips heal_succeeded to 1 on
 *     the right step
 *   - tRPC tasks.healStats aggregates correctly across several steps
 *     (scoped to the caller; doesn't count other users' heals)
 */

function must<T>(v: T | null | undefined, n: string): T {
  if (v == null) throw new Error(`${n} missing`);
  return v;
}

describe('self-heal metrics (P1.1)', () => {
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

  async function seedUser() {
    const { newExternalId } = await import('@holaday/shared-types');
    const { db } = await import('../db/client.js');
    const { eq } = await import('drizzle-orm');
    const { users } = await import('../db/schema/users.js');
    const email = `heal+${Date.now()}+${Math.random()}@example.com`;
    const externalId = newExternalId('user');
    await db.insert(users).values({ externalId, email, passwordHash: 'placeholder' });
    const row = must((await db.select().from(users).where(eq(users.email, email)))[0], 'user');
    return { external: externalId, internalId: row.id };
  }

  async function seedTaskWithStep(userInternalId: number) {
    const { newExternalId } = await import('@holaday/shared-types');
    const { db } = await import('../db/client.js');
    const { eq } = await import('drizzle-orm');
    const { tasks } = await import('../db/schema/tasks.js');
    const { taskSteps } = await import('../db/schema/task-steps.js');
    const taskExternalId = newExternalId('task');
    await db.insert(tasks).values({
      externalId: taskExternalId,
      userId: userInternalId,
      status: 'executing',
      intent: 'heal-metrics fixture',
      plan: null,
    });
    const task = must(
      (await db.select().from(tasks).where(eq(tasks.externalId, taskExternalId)))[0],
      'task',
    );
    const stepExternalId = newExternalId('taskStep');
    await db.insert(taskSteps).values({
      externalId: stepExternalId,
      taskId: task.id,
      seq: 0,
      kind: 'extract',
      status: 'executing',
      riskLevel: 'low',
    });
    return { taskExternalId, stepExternalId };
  }

  it('recordHealAttempt increments heal_attempts + writes elapsed/tokens', async () => {
    const { db } = await import('../db/client.js');
    const { TaskRepository } = await import('./task-repository.js');
    const { taskSteps } = await import('../db/schema/task-steps.js');
    const { eq } = await import('drizzle-orm');
    const user = await seedUser();
    const { taskExternalId, stepExternalId } = await seedTaskWithStep(user.internalId);
    const repo = new TaskRepository(db);

    await repo.recordHealAttempt({
      taskExternalId,
      stepExternalId,
      elapsedMs: 1234,
      inputTokens: 500,
      outputTokens: 120,
    });

    const row = must(
      (await db.select().from(taskSteps).where(eq(taskSteps.externalId, stepExternalId)))[0],
      'step row',
    );
    expect(row.healAttempts).toBe(1);
    expect(row.healSucceeded).toBe(0);
    expect(row.healElapsedMs).toBe(1234);
    expect(row.healInputTokens).toBe(500);
    expect(row.healOutputTokens).toBe(120);
  });

  it('markHealSucceeded flips only the matching step', async () => {
    const { db } = await import('../db/client.js');
    const { TaskRepository } = await import('./task-repository.js');
    const { taskSteps } = await import('../db/schema/task-steps.js');
    const { eq } = await import('drizzle-orm');
    const user = await seedUser();
    const a = await seedTaskWithStep(user.internalId);
    const b = await seedTaskWithStep(user.internalId);
    const repo = new TaskRepository(db);
    await repo.recordHealAttempt({
      taskExternalId: a.taskExternalId,
      stepExternalId: a.stepExternalId,
      elapsedMs: 1,
      inputTokens: 1,
      outputTokens: 1,
    });
    await repo.recordHealAttempt({
      taskExternalId: b.taskExternalId,
      stepExternalId: b.stepExternalId,
      elapsedMs: 1,
      inputTokens: 1,
      outputTokens: 1,
    });
    await repo.markHealSucceeded({
      taskExternalId: a.taskExternalId,
      stepExternalId: a.stepExternalId,
    });

    const rowA = must(
      (await db.select().from(taskSteps).where(eq(taskSteps.externalId, a.stepExternalId)))[0],
      'a',
    );
    const rowB = must(
      (await db.select().from(taskSteps).where(eq(taskSteps.externalId, b.stepExternalId)))[0],
      'b',
    );
    expect(rowA.healSucceeded).toBe(1);
    expect(rowB.healSucceeded).toBe(0);
  });

  it('tasks.healStats aggregates per-caller, computes successRate + token totals', async () => {
    const { db } = await import('../db/client.js');
    const { TaskRepository } = await import('./task-repository.js');
    const { signAccessToken } = await import('../auth/jwt.js');
    const { createHttpApp } = await import('../http.js');
    const { StubPlanner } = await import('./planners/stub.js');
    const http = await import('node:http');

    const caller = await seedUser();
    const other = await seedUser();
    const repo = new TaskRepository(db);

    // Caller: 3 heal attempts, 2 succeeded — 66.7% success rate.
    for (let i = 0; i < 3; i++) {
      const { taskExternalId, stepExternalId } = await seedTaskWithStep(caller.internalId);
      await repo.recordHealAttempt({
        taskExternalId,
        stepExternalId,
        elapsedMs: 1000 + i * 100, // 1000, 1100, 1200 → avg 1100
        inputTokens: 200,
        outputTokens: 50,
      });
      if (i < 2) {
        await repo.markHealSucceeded({ taskExternalId, stepExternalId });
      }
    }
    // Other user: 5 attempts all succeeded — must NOT show up in caller's stats.
    for (let i = 0; i < 5; i++) {
      const { taskExternalId, stepExternalId } = await seedTaskWithStep(other.internalId);
      await repo.recordHealAttempt({
        taskExternalId,
        stepExternalId,
        elapsedMs: 9999,
        inputTokens: 9999,
        outputTokens: 9999,
      });
      await repo.markHealSucceeded({ taskExternalId, stepExternalId });
    }

    const app = createHttpApp({ planner: new StubPlanner() });
    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('no address');
    try {
      const token = await signAccessToken({ sub: caller.external, plan: 'free' });
      const res = await fetch(
        `http://127.0.0.1:${address.port}/trpc/tasks.healStats?input=${encodeURIComponent(
          JSON.stringify({}),
        )}`,
        { headers: { authorization: `Bearer ${token}` } },
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        result: {
          data: {
            attempts: number;
            successes: number;
            successRate: number;
            avgElapsedMs: number;
            totalInputTokens: number;
            totalOutputTokens: number;
          };
        };
      };
      const d = body.result.data;
      expect(d.attempts).toBe(3);
      expect(d.successes).toBe(2);
      expect(d.successRate).toBeCloseTo(2 / 3, 4);
      expect(d.avgElapsedMs).toBeCloseTo(1100, 0);
      expect(d.totalInputTokens).toBe(600); // 200 × 3
      expect(d.totalOutputTokens).toBe(150); // 50 × 3
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
