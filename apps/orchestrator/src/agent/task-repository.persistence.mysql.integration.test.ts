import { randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/mysql2';
import mysql, { type Connection, type RowDataPacket } from 'mysql2/promise';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const enabled = process.env.HOLADAY_SQL_PERSISTENCE_PROBE === '1';
const schema = 'holaday_it';
const tables = ['users', 'tasks', 'task_steps', 'task_events'];
const owner = randomUUID();
let control: Connection | undefined;
let connection: Connection | undefined;
let created = false;
const evidence: Record<string, unknown> = { schema, modelAPICalls: 0 };

describe.runIf(enabled)('isolated real MySQL TaskRepository persistence', () => {
  beforeAll(async () => {
    const value = process.env.HOLADAY_SQL_TEST_URL;
    if (!value) throw new Error('HOLADAY_SQL_TEST_URL is required');
    const url = new URL(value);
    if (!['127.0.0.1', 'localhost'].includes(url.hostname) || url.pathname !== `/${schema}`)
      throw new Error('Probe requires the exact loopback holaday_it schema');
    process.env.DATABASE_URL = value;
    process.env.REDIS_URL ??= 'redis://127.0.0.1:6379/0';
    process.env.JWT_SECRET ??= 'isolated-persistence-test-secret-at-least-32-characters';
    control = await mysql.createConnection({
      host: url.hostname,
      port: Number(url.port || 3306),
      user: decodeURIComponent(url.username),
      password: decodeURIComponent(url.password),
      connectTimeout: 2000,
    });
    const [lock] = await control.query<RowDataPacket[]>(
      "SELECT GET_LOCK('codex:holaday_it', 0) AS acquired",
    );
    if (lock[0]?.acquired !== 1) throw new Error('SQL probe namespace already in use');
    const [existing] = await control.query<RowDataPacket[]>(
      'SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME=?',
      [schema],
    );
    if (existing.length) throw new Error('Reserved schema exists; refusing to migrate or reuse it');
    await control.query('CREATE DATABASE `holaday_it` CHARACTER SET utf8mb4');
    created = true;
    await control.query(
      'CREATE TABLE `holaday_it`.`codex_probe_owner` (token VARCHAR(64) PRIMARY KEY)',
    );
    await control.query('INSERT INTO `holaday_it`.`codex_probe_owner` VALUES (?)', [owner]);
    for (const table of tables)
      await control.query(`CREATE TABLE \`holaday_it\`.\`${table}\` LIKE \`holaday\`.\`${table}\``);
    connection = await mysql.createConnection(value);
    const [columns] = await connection.query<RowDataPacket[]>('SHOW COLUMNS FROM `tasks` LIKE ?', [
      'public_cloud_continuation_task_id',
    ]);
    if (!columns.length) {
      // Clone structure only; bring this owned schema up to the current repository contract.
      const migration = await readFile(
        new URL('../../drizzle/0070_public_cloud_continuation.sql', import.meta.url),
        'utf8',
      );
      for (const statement of migration.split('--> statement-breakpoint'))
        if (statement.trim()) await connection.query(statement);
      evidence.appliedMigrations = ['0070_public_cloud_continuation'];
      evidence.baselineSchemaGaps = ['tasks.public_cloud_continuation_task_id'];
    }
    evidence.created = true;
  });

  afterAll(async () => {
    try {
      await connection?.end();
      if (created && control) {
        const [marker] = await control.query<RowDataPacket[]>(
          'SELECT token FROM `holaday_it`.`codex_probe_owner`',
        );
        const [ownedTables] = await control.query<RowDataPacket[]>(
          'SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=?',
          [schema],
        );
        if (
          marker.length !== 1 ||
          marker[0]?.token !== owner ||
          ownedTables.some((row) => ![...tables, 'codex_probe_owner'].includes(row.TABLE_NAME))
        )
          throw new Error('Probe ownership changed; refusing cleanup');
        await control.query('DROP DATABASE `holaday_it`');
        evidence.cleaned = true;
      }
    } finally {
      try {
        await control?.query("SELECT RELEASE_LOCK('codex:holaday_it')");
      } finally {
        await control?.end();
        if (process.env.HOLADAY_SQL_PROBE_ARTIFACT)
          await writeFile(
            process.env.HOLADAY_SQL_PROBE_ARTIFACT,
            JSON.stringify(evidence, null, 2),
          );
      }
    }
  });

  it('commits a browser task and outcome, reloads through a new connection, and refuses a late overwrite', async () => {
    const { TaskRepository } = await import('./task-repository.js');
    const { users } = await import('../db/schema/users.js');
    const { tasks } = await import('../db/schema/tasks.js');
    const { taskEvents } = await import('../db/schema/task-events.js');
    const id = `sql-${randomUUID()}`;
    const taskId = `tsk_${randomUUID().replaceAll('-', '').slice(0, 20)}`;
    let db = drizzle(connection!);
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
    await connection!.end();
    connection = await mysql.createConnection(process.env.HOLADAY_SQL_TEST_URL!);
    db = drizzle(connection);
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
    Object.assign(evidence, {
      persistedAcrossConnection: true,
      lateOverwriteRefused: true,
      taskEvents: events.length,
      status: saved!.status,
    });
  });
});
