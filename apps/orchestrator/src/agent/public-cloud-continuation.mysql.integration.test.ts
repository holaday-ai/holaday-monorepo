import { randomBytes, randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { drizzle } from 'drizzle-orm/mysql2';
import mysql, { type Connection, type Pool, type RowDataPacket } from 'mysql2/promise';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { DB } from '../db/client.js';
import * as schema from '../db/schema/index.js';
import {
  type ContinuationOriginal,
  insertWithContinuationLink,
  runPublicCloudContinuation,
} from '../trpc/routers/public-cloud-continuation.js';
import { PublicCloudContinuationLinkError, TaskRepository } from './task-repository.js';

// The release runner's own splitter / replay rules (plain .mjs, untyped).
type ReleaseDbContract = {
  isSkippableAlreadyAppliedError: (
    error: unknown,
    context?: { file?: string; statement?: string },
  ) => boolean;
  splitMigrationStatements: (sql: string) => string[];
};
const releaseDbContract = new URL('../../scripts/release-db-contract.mjs', import.meta.url).href;
const { isSkippableAlreadyAppliedError, splitMigrationStatements } = (await import(
  releaseDbContract
)) as ReleaseDbContract;

// Explicit opt-in. Loopback admin only, a fresh throwaway schema per run, the
// real numbered migration chain, no application env, users or transports.
describe.skipIf(process.env.CONTINUATION_MYSQL_INTEGRATION !== '1')(
  'public-cloud continuation uniqueness on real MySQL',
  () => {
    const database = `holaday_continuation_${randomBytes(6).toString('hex')}_integration`;
    const INTENT = '在京东查一下 iPhone 价格';
    let admin: Connection | undefined;
    let pool: Pool | undefined;
    let repo: TaskRepository;
    let created = false;
    let userId = 0;

    function connectionOptions() {
      const url = new URL(
        process.env.CONTINUATION_MYSQL_TEST_ADMIN_URL ??
          'mysql://root:holaday-dev-root@127.0.0.1:3306/',
      );
      if (
        url.protocol !== 'mysql:' ||
        !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
        !['', '/'].includes(url.pathname)
      )
        throw new Error('CONTINUATION_TEST_REQUIRES_LOOPBACK_ADMIN_WITHOUT_DATABASE');
      return {
        host: url.hostname,
        port: Number(url.port || 3306),
        user: decodeURIComponent(url.username),
        password: decodeURIComponent(url.password),
        connectTimeout: 3000,
      };
    }
    async function sql(statement: string, parameters: unknown[] = []) {
      if (!pool || !created) throw new Error('CONTINUATION_TEST_DATABASE_NOT_READY');
      return pool.query(statement, parameters);
    }
    async function migrationStatements(file: string): Promise<string[]> {
      // Same splitter as the release runner (scripts/apply-numbered-migrations.ts).
      const raw = await readFile(new URL(`../../drizzle/${file}`, import.meta.url), 'utf8');
      return splitMigrationStatements(raw);
    }
    async function column(taskId: string): Promise<string | null> {
      const [rows] = await sql(
        'SELECT public_cloud_continuation_task_id AS link FROM tasks WHERE external_id = ?',
        [taskId],
      );
      return ((rows as RowDataPacket[])[0]?.link as string | null) ?? null;
    }
    async function taskCount(): Promise<number> {
      const [rows] = await sql('SELECT COUNT(*) AS n FROM tasks WHERE user_id = ?', [userId]);
      return Number((rows as RowDataPacket[])[0]?.n);
    }
    async function loadOriginal(taskId: string): Promise<ContinuationOriginal | undefined> {
      const [rows] = await sql(
        'SELECT status, intent, result, public_cloud_continuation_task_id AS publicCloudContinuationTaskId FROM tasks WHERE external_id = ?',
        [taskId],
      );
      return (rows as RowDataPacket[])[0] as ContinuationOriginal | undefined;
    }
    /** The production composition: DB claim, then link inside the replacement insert. */
    function continueOnce(originalTaskId: string, charges: { n: number }) {
      return runPublicCloudContinuation({
        originalTaskId,
        intent: INTENT,
        loadOriginal: () => loadOriginal(originalTaskId),
        claim: (claimToken) =>
          repo.claimPublicCloudContinuation({ originalTaskId, userId, claimToken }),
        release: (claimToken) =>
          repo.releasePublicCloudContinuationClaim({ originalTaskId, userId, claimToken }),
        newClaimToken: () => randomUUID(),
        create: async (link) => {
          charges.n += 1;
          const replacementTaskId = `task_r${randomBytes(6).toString('hex')}`;
          await insertWithContinuationLink({
            link,
            replacementTaskId,
            insert: (publicCloudContinuation) =>
              repo.insertTask(
                {
                  taskId: replacementTaskId,
                  status: 'executing',
                  plan: [],
                  cursor: 0,
                  pendingConfirm: null,
                },
                { userId, intent: INTENT, publicCloudContinuation },
              ),
            refundPendingCharge: async () => {
              charges.n -= 1;
            },
          });
          return { taskId: replacementTaskId };
        },
      });
    }

    beforeAll(async () => {
      admin = await mysql.createConnection(connectionOptions());
      // CREATE without IF NOT EXISTS: a collision cannot adopt somebody else's DB.
      await admin.query(`CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4`);
      created = true;
      pool = mysql.createPool({ ...connectionOptions(), database, connectionLimit: 8 });
      const files = (await readdir(new URL('../../drizzle/', import.meta.url)))
        .filter((file) => /^\d{4}_.+\.sql$/.test(file))
        .sort();
      // Mirror the release runner: statements already applied by an earlier file skip.
      for (const file of files)
        for (const statement of await migrationStatements(file))
          await sql(statement).catch((err: unknown) => {
            if (!isSkippableAlreadyAppliedError(err, { file, statement })) throw err;
          });
      // The release runner replays every file: 0070 must skip as already applied.
      for (const statement of await migrationStatements('0070_public_cloud_continuation.sql')) {
        const replay = await sql(statement).then(
          () => null,
          (err: unknown) => err,
        );
        expect(isSkippableAlreadyAppliedError(replay, { file: '0070', statement })).toBe(true);
      }
      const [inserted] = await sql(
        'INSERT INTO users (external_id, email, password_hash) VALUES (?, ?, ?)',
        ['usr_continuation_it', 'continuation-it@example.invalid', 'not-a-real-hash'],
      );
      userId = (inserted as { insertId: number }).insertId;
      repo = new TaskRepository(
        drizzle(pool, { schema, mode: 'default', casing: 'snake_case' }) as unknown as DB,
      );
    }, 120_000);

    afterAll(async () => {
      await pool?.end();
      if (created) await admin?.query(`DROP DATABASE \`${database}\``);
      await admin?.end();
    });

    let original = '';
    let baseline = 0;
    beforeEach(async () => {
      original = `task_o${randomBytes(6).toString('hex')}`;
      await repo.insertTask(
        { taskId: original, status: 'awaiting_user', plan: [], cursor: 0, pendingConfirm: null },
        { userId, intent: INTENT },
      );
      await sql(
        `UPDATE tasks SET status = 'cancelled', result = JSON_OBJECT('metadata', JSON_OBJECT('browserConnection', JSON_OBJECT('reason', 'extension_offline', 'publicCloudAllowed', true))) WHERE external_id = ?`,
        [original],
      );
      baseline = await taskCount();
    });

    it('of many concurrent claims exactly one wins', async () => {
      const tokens = Array.from({ length: 8 }, () => `claim:${randomUUID()}`);
      const results = await Promise.all(
        tokens.map((claimToken) =>
          repo.claimPublicCloudContinuation({ originalTaskId: original, userId, claimToken }),
        ),
      );
      expect(results.filter(Boolean)).toHaveLength(1);
      expect(await column(original)).toBe(tokens[results.indexOf(true)]);
    });

    it('links the replacement in its insert transaction and refuses any later continuation', async () => {
      const charges = { n: 0 };
      const { taskId } = await continueOnce(original, charges);
      expect(await column(original)).toBe(taskId);
      // Idempotency TTL long gone: a fresh request is refused by the column.
      await expect(continueOnce(original, charges)).rejects.toMatchObject({ code: 'CONFLICT' });
      expect(await taskCount()).toBe(baseline + 1);
      expect(charges.n).toBe(1);
    });

    it('two concurrent continuations create exactly one replacement', async () => {
      const charges = { n: 0 };
      const results = await Promise.allSettled([
        continueOnce(original, charges),
        continueOnce(original, charges),
      ]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(results.find((r) => r.status === 'rejected')).toMatchObject({
        reason: { code: 'CONFLICT' },
      });
      expect(await taskCount()).toBe(baseline + 1);
      expect(charges.n).toBe(1);
    });

    it('a lost claim rolls the replacement insert back (no row, no event, no charge)', async () => {
      const claimToken = `claim:${randomUUID()}`;
      expect(
        await repo.claimPublicCloudContinuation({ originalTaskId: original, userId, claimToken }),
      ).toBe(true);
      // Somebody else's claim replaces ours before our insert commits.
      await sql('UPDATE tasks SET public_cloud_continuation_task_id = ? WHERE external_id = ?', [
        'claim:other',
        original,
      ]);
      const charges = { n: 1 };
      const replacement = `task_r${randomBytes(6).toString('hex')}`;
      await expect(
        insertWithContinuationLink({
          link: { originalTaskId: original, claimToken, onLinked: () => {} },
          replacementTaskId: replacement,
          insert: (publicCloudContinuation) =>
            repo.insertTask(
              {
                taskId: replacement,
                status: 'executing',
                plan: [],
                cursor: 0,
                pendingConfirm: null,
              },
              { userId, intent: INTENT, publicCloudContinuation },
            ),
          refundPendingCharge: async () => {
            charges.n -= 1;
          },
        }),
      ).rejects.toBeInstanceOf(PublicCloudContinuationLinkError);
      const [rows] = await sql(
        'SELECT (SELECT COUNT(*) FROM tasks WHERE external_id = ?) AS tasks, (SELECT COUNT(*) FROM task_events e JOIN tasks t ON t.id = e.task_id WHERE t.external_id = ?) AS events',
        [replacement, replacement],
      );
      expect((rows as RowDataPacket[])[0]).toMatchObject({ tasks: 0, events: 0 });
      expect(charges.n).toBe(0);
      expect(await column(original)).toBe('claim:other');
    });

    it('release clears only its own claim, never a link, and the unique key blocks a shared replacement', async () => {
      const charges = { n: 0 };
      const { taskId } = await continueOnce(original, charges);
      await repo.releasePublicCloudContinuationClaim({
        originalTaskId: original,
        userId,
        claimToken: taskId,
      });
      await repo.releasePublicCloudContinuationClaim({
        originalTaskId: original,
        userId,
        claimToken: 'claim:not-mine',
      });
      expect(await column(original)).toBe(taskId);
      await expect(
        sql(
          'UPDATE tasks SET public_cloud_continuation_task_id = ? WHERE user_id = ? AND external_id <> ? LIMIT 1',
          [taskId, userId, original],
        ),
      ).rejects.toMatchObject({ code: 'ER_DUP_ENTRY' });
    });
  },
);
