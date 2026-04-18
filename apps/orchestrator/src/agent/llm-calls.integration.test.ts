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

describe('llm_calls: DrizzleLlmCallRecorder + tasks.list tRPC query', () => {
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
    const email = `llm+${Date.now()}+${Math.random()}@example.com`;
    const externalId = newExternalId('user');
    await db.insert(users).values({
      externalId,
      email,
      passwordHash: 'placeholder',
    });
    const user = must((await db.select().from(users).where(eq(users.email, email)))[0], 'user');
    return { external: externalId, internalId: user.id };
  }

  it('recorder writes a row with correct user, model, purpose, tokens, and computed cost', async () => {
    const { db } = await import('../db/client.js');
    const { eq } = await import('drizzle-orm');
    const { llmCalls } = await import('../db/schema/llm-calls.js');
    const { DrizzleLlmCallRecorder } = await import('./llm-call-recorder.js');

    const user = await seedUser();
    const recorder = new DrizzleLlmCallRecorder(db);

    await recorder.record({
      userExternalId: user.external,
      provider: 'anthropic',
      model: 'claude-opus-4-7',
      purpose: 'commander.plan',
      inputTokens: 2049,
      outputTokens: 461,
      cacheReadInputTokens: 0,
      cacheCreationInputTokens: 0,
      latencyMs: 15527,
      status: 'ok',
      requestMeta: { planSize: 3 },
    });

    const rows = await db.select().from(llmCalls).where(eq(llmCalls.userId, user.internalId));
    expect(rows).toHaveLength(1);
    const row = must(rows[0], 'row');
    expect(row.model).toBe('claude-opus-4-7');
    expect(row.purpose).toBe('commander.plan');
    expect(row.promptTokens).toBe(2049);
    expect(row.completionTokens).toBe(461);
    // Opus: (2049*5 + 461*25) / 1_000_000 = 0.021770
    expect(Number(row.costUsd)).toBeCloseTo(0.02177, 5);
    expect(row.latencyMs).toBe(15527);
    expect(row.externalId).toMatch(/^llm_/);
  });

  it('recorder silently drops write when user external_id is unknown', async () => {
    const { db } = await import('../db/client.js');
    const { count } = await import('drizzle-orm');
    const { llmCalls } = await import('../db/schema/llm-calls.js');
    const { DrizzleLlmCallRecorder } = await import('./llm-call-recorder.js');

    const errors: unknown[] = [];
    const recorder = new DrizzleLlmCallRecorder(db, {
      onError: (err) => errors.push(err),
    });
    const [before] = await db.select({ n: count(llmCalls.id) }).from(llmCalls);

    await recorder.record({
      userExternalId: 'usr_does_not_exist',
      provider: 'anthropic',
      model: 'claude-opus-4-7',
      purpose: 'commander.plan',
      inputTokens: 100,
      outputTokens: 50,
      latencyMs: 0,
      status: 'ok',
    });

    const [after] = await db.select({ n: count(llmCalls.id) }).from(llmCalls);
    expect(after?.n).toBe(before?.n);
    expect(errors).toHaveLength(1);
  });

  it('tRPC llmCalls.list returns rows + totals filtered by user, with DESC id cursor pagination', async () => {
    const { newExternalId } = await import('@holaday/shared-types');
    const { db } = await import('../db/client.js');
    const { DrizzleLlmCallRecorder } = await import('./llm-call-recorder.js');
    const { signAccessToken } = await import('../auth/jwt.js');
    const { createHttpApp } = await import('../http.js');
    const { StubPlanner } = await import('./planners/stub.js');

    const user = await seedUser();
    const other = await seedUser(); // a second user — list must not leak

    const recorder = new DrizzleLlmCallRecorder(db);

    // 3 calls for `user`, 1 for `other`. Costs should sum accordingly.
    await recorder.record({
      userExternalId: user.external,
      provider: 'anthropic',
      model: 'claude-opus-4-7',
      purpose: 'commander.plan',
      inputTokens: 1000,
      outputTokens: 200,
      latencyMs: 2000,
      status: 'ok',
    });
    await recorder.record({
      userExternalId: user.external,
      provider: 'anthropic',
      model: 'claude-haiku-4-5',
      purpose: 'commander.plan',
      inputTokens: 500,
      outputTokens: 100,
      latencyMs: 1200,
      status: 'ok',
    });
    await recorder.record({
      userExternalId: user.external,
      provider: 'anthropic',
      model: 'claude-sonnet-4-6',
      purpose: 'commander.plan',
      inputTokens: 2000,
      outputTokens: 400,
      latencyMs: 9000,
      status: 'error',
      errorMessage: 'INVALID_PLAN',
    });
    await recorder.record({
      userExternalId: other.external,
      provider: 'anthropic',
      model: 'claude-opus-4-7',
      purpose: 'commander.plan',
      inputTokens: 999,
      outputTokens: 999,
      latencyMs: 5000,
      status: 'ok',
    });

    // Fire up a transient tRPC HTTP server and hit llmCalls.list as `user`.
    const token = await signAccessToken({ sub: user.external, plan: 'free' });
    const app = createHttpApp({ planner: new StubPlanner() });
    const http = await import('node:http');
    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('no address');
    const port = address.port;

    try {
      const res1 = await fetch(
        `http://127.0.0.1:${port}/trpc/llmCalls.list?input=${encodeURIComponent(
          JSON.stringify({ limit: 2 }),
        )}`,
        {
          method: 'GET',
          headers: { authorization: `Bearer ${token}` },
        },
      );
      expect(res1.status).toBe(200);
      const body1 = (await res1.json()) as {
        result: {
          data: {
            rows: { id: number; model: string; status: string }[];
            totals: { totalCalls: number; totalCostUsd: number; totalInputTokens: number };
            nextCursor: number | null;
          };
        };
      };

      // Page 1: 2 rows, desc by id (newest first). All belong to `user`.
      expect(body1.result.data.rows).toHaveLength(2);
      expect(body1.result.data.nextCursor).toBeTypeOf('number');
      expect(body1.result.data.totals.totalCalls).toBe(3); // three rows for `user`; other's row excluded
      // Sum of user's 3 calls:
      //   Opus 4.7: (1000*5 + 200*25) / 1e6 = 0.010000
      //   Haiku 4.5: (500*1 + 100*5) / 1e6 = 0.001000
      //   Sonnet 4.6: (2000*3 + 400*15) / 1e6 = 0.012000
      // Total = 0.023000
      expect(body1.result.data.totals.totalCostUsd).toBeCloseTo(0.023, 5);
      expect(body1.result.data.totals.totalInputTokens).toBe(1000 + 500 + 2000);

      // Page 2 via cursor.
      const cursor = body1.result.data.nextCursor;
      const res2 = await fetch(
        `http://127.0.0.1:${port}/trpc/llmCalls.list?input=${encodeURIComponent(
          JSON.stringify({ limit: 2, cursor }),
        )}`,
        {
          method: 'GET',
          headers: { authorization: `Bearer ${token}` },
        },
      );
      expect(res2.status).toBe(200);
      const body2 = (await res2.json()) as typeof body1;
      expect(body2.result.data.rows).toHaveLength(1);
      // Totals stable across pages.
      expect(body2.result.data.totals.totalCalls).toBe(3);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
