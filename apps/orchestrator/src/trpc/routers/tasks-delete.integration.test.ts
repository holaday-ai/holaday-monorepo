import { afterAll, beforeAll, describe, expect, it } from 'vitest';

beforeAll(() => {
  process.env.DATABASE_URL ??= 'mysql://holaday:holaday-dev@127.0.0.1:3306/holaday';
  process.env.REDIS_URL ??= 'redis://127.0.0.1:6379/0';
  process.env.JWT_SECRET ??= 'integration-test-secret-must-be-32-chars-or-more-please';
});

/**
 * Integration cover for `tasks.delete`:
 *   - deleting own terminal task removes the row (and its steps/events)
 *   - deleting another user's task returns NOT_FOUND (no leak)
 *   - deleting an in-flight task is rejected with PRECONDITION_FAILED
 */

function must<T>(v: T | null | undefined, n: string): T {
  if (v == null) throw new Error(`${n} missing`);
  return v;
}

describe('tRPC tasks.delete', () => {
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
    const email = `tasks-delete+${Date.now()}+${Math.random()}@example.com`;
    const externalId = newExternalId('user');
    await db.insert(users).values({ externalId, email, passwordHash: 'placeholder' });
    const user = must((await db.select().from(users).where(eq(users.email, email)))[0], 'user');
    return { external: externalId, internalId: user.id };
  }

  async function seedTask(userInternalId: number, status: string): Promise<string> {
    const { newExternalId } = await import('@holaday/shared-types');
    const { db } = await import('../../db/client.js');
    const { tasks } = await import('../../db/schema/tasks.js');
    const externalId = newExternalId('task');
    await db.insert(tasks).values({
      externalId,
      userId: userInternalId,
      status,
      intent: `seeded ${status}`,
      plan: null,
    });
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

  async function callDelete(port: number, token: string, taskId: string) {
    return fetch(`http://127.0.0.1:${port}/trpc/tasks.delete`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ taskId }),
    });
  }

  it('deletes the caller\'s own terminal task', async () => {
    const user = await seedUser();
    const taskId = await seedTask(user.internalId, 'completed');
    const { port, signAccessToken, close } = await bootTrpcServer();
    try {
      const token = await signAccessToken({ sub: user.external, plan: 'free' });
      const res = await callDelete(port, token, taskId);
      expect(res.status).toBe(200);

      // Row is gone — tasks.detail should 404.
      const detail = await fetch(
        `http://127.0.0.1:${port}/trpc/tasks.detail?input=${encodeURIComponent(
          JSON.stringify({ taskId }),
        )}`,
        { headers: { authorization: `Bearer ${token}` } },
      );
      expect(detail.status).toBe(404);
    } finally {
      await close();
    }
  });

  it("returns NOT_FOUND when targeting another user's task", async () => {
    const attacker = await seedUser();
    const victim = await seedUser();
    const victimTaskId = await seedTask(victim.internalId, 'completed');
    const { port, signAccessToken, close } = await bootTrpcServer();
    try {
      const token = await signAccessToken({ sub: attacker.external, plan: 'free' });
      const res = await callDelete(port, token, victimTaskId);
      expect(res.status).toBe(404);

      // Victim's row untouched — victim can still read it.
      const victimToken = await signAccessToken({ sub: victim.external, plan: 'free' });
      const detail = await fetch(
        `http://127.0.0.1:${port}/trpc/tasks.detail?input=${encodeURIComponent(
          JSON.stringify({ taskId: victimTaskId }),
        )}`,
        { headers: { authorization: `Bearer ${victimToken}` } },
      );
      expect(detail.status).toBe(200);
    } finally {
      await close();
    }
  });

  it('rejects delete of an in-flight (executing) task', async () => {
    const user = await seedUser();
    const taskId = await seedTask(user.internalId, 'executing');
    const { port, signAccessToken, close } = await bootTrpcServer();
    try {
      const token = await signAccessToken({ sub: user.external, plan: 'free' });
      const res = await callDelete(port, token, taskId);
      // tRPC maps PRECONDITION_FAILED to HTTP 412.
      expect(res.status).toBe(412);
    } finally {
      await close();
    }
  });
});
