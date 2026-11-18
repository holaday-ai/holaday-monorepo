import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  type IsolatedMysqlProbe,
  openIsolatedMysqlProbe,
} from '../testing/isolated-mysql-probe.js';

const enabled = process.env.HOLADAY_SQL_PERSISTENCE_PROBE === '1';
let probe: IsolatedMysqlProbe;
describe.runIf(enabled)('isolated real MySQL TaskRepository persistence', () => {
  beforeAll(async () => {
    if (process.env.HOLADAY_SQL_TEST_URL)
      vi.stubEnv('DATABASE_URL', process.env.HOLADAY_SQL_TEST_URL);
    vi.stubEnv('REDIS_URL', process.env.REDIS_URL ?? 'redis://127.0.0.1:6379/0');
    vi.stubEnv(
      'JWT_SECRET',
      process.env.JWT_SECRET ?? 'isolated-persistence-test-secret-at-least-32-characters',
    );
    probe = await openIsolatedMysqlProbe({ artifactPath: process.env.HOLADAY_SQL_PROBE_ARTIFACT });
  });
  afterAll(async () => {
    try {
      await probe?.close();
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('commits a browser task and outcome, reloads through a new connection, and refuses a late overwrite', async () => {
    const { TaskRepository } = await import('./task-repository.js');
    const { users } = await import('../db/schema/users.js');
    const { tasks } = await import('../db/schema/tasks.js');
    const { taskEvents } = await import('../db/schema/task-events.js');
    const id = `sql-${randomUUID()}`;
    const taskId = `tsk_${randomUUID().replaceAll('-', '').slice(0, 20)}`;
    let db = probe.db;
    await db.insert(users).values({
      externalId: `usr_${randomUUID().replaceAll('-', '').slice(0, 20)}`,
      email: `${id}@example.test`,
      passwordHash: 'synthetic-only',
    });
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.email, `${id}@example.test`));
    expect(user).toBeDefined();
    let repository = new TaskRepository(db as never);
    const state: Parameters<typeof repository.insertTask>[0] = {
      taskId,
      status: 'executing',
      plan: [],
      cursor: 0,
      pendingConfirm: null,
    };
    await repository.insertTask(state, {
      userId: user!.id,
      intent: 'Persist a browser report result',
      sourceContext: { browserSource: 'local-chrome' },
    });
    expect(await repository.isTaskExecuting(taskId)).toBe(true);
    const summary = 'The report was analyzed and the verified result is saved.';
    expect(
      await repository.persistVisionOutcome(taskId, {
        status: 'completed',
        summary,
        tickCount: 1,
        metadata: { browserSource: 'local-chrome' },
      }),
    ).toEqual({ persisted: true });
    await probe.reconnect();
    db = probe.db;
    repository = new TaskRepository(db as never);
    expect(await repository.isCurrentCompletedOutcome(taskId, summary)).toBe(true);
    expect(await repository.isTaskExecuting(taskId)).toBe(false);
    const [saved] = await db.select().from(tasks).where(eq(tasks.externalId, taskId));
    expect(saved?.status).toBe('completed');
    expect(saved?.result).toMatchObject({ summary, metadata: { browserSource: 'local-chrome' } });
    expect(
      await repository.persistVisionOutcome(taskId, {
        status: 'failed',
        reason: 'late result',
        tickCount: 2,
      }),
    ).toEqual({ persisted: false });
    expect(await repository.isCurrentCompletedOutcome(taskId, summary)).toBe(true);
    const events = await db.select().from(taskEvents).where(eq(taskEvents.taskId, saved!.id));
    expect(events.map((event) => event.type).sort()).toEqual(['task.created', 'vision.completed']);
    Object.assign(probe.evidence, {
      persistedAcrossConnection: true,
      lateOverwriteRefused: true,
      taskEvents: events.length,
      status: saved!.status,
    });
  });
});
