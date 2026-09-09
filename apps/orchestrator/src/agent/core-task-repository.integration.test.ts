import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { drizzle } from 'drizzle-orm/mysql2';
import mysql, { type Connection, type Pool, type RowDataPacket } from 'mysql2/promise';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { DB } from '../db/client.js';
import { prepareCoreAdmission } from './core-task-admission.js';
import { CoreTaskRepository } from './core-task-repository.js';
import { prepareCoreSettlement } from './core-task-settlement.js';

// Explicit opt-in. No application database, application env loader, migrations,
// users, quotas, or production transports. A fresh throwaway schema is mandatory.
describe.skipIf(process.env.CORE_MYSQL_INTEGRATION !== '1')(
  'core repository real MySQL atomicity',
  () => {
    const database = `holaday_core_${randomBytes(8).toString('hex')}_integration`;
    let admin: Connection | undefined;
    let pool: Pool | undefined;
    let repo: CoreTaskRepository;
    let created = false;
    const scope = { taskId: 'tsk_synthetic_mysql', userId: 7 };
    const before = {
      status: 'awaiting_user',
      executionId: null,
      executionRevision: 0,
      recordVersion: 0,
    };
    const requirements = {
      initialRequest: '仅分析合成资料',
      userTurns: ['保留风险'],
      phase: 'revise' as const,
      workflow: null,
      referencePlan: '合成方案',
      fileIds: [],
    };
    const admission = () => prepareCoreAdmission({ scope, before, requirements });
    function connectionOptions() {
      const url = new URL(
        process.env.CORE_MYSQL_TEST_ADMIN_URL ?? 'mysql://root:holaday-dev-root@127.0.0.1:3306/',
      );
      if (
        url.protocol !== 'mysql:' ||
        !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
        !['', '/'].includes(url.pathname)
      )
        throw new Error('CORE_TEST_REQUIRES_LOOPBACK_ADMIN_WITHOUT_DATABASE');
      return {
        host: url.hostname,
        port: Number(url.port || 3306),
        user: decodeURIComponent(url.username),
        password: decodeURIComponent(url.password),
        connectTimeout: 3000,
      };
    }
    async function sql(statement: string, parameters: unknown[] = []) {
      if (!pool || !created) throw new Error('CORE_TEST_DATABASE_NOT_READY');
      return pool.query(statement, parameters);
    }
    async function snapshot() {
      const [rows] = await sql(
        'SELECT status, execution_id AS executionId, execution_revision AS revision, core_record_version AS version, result FROM tasks',
      );
      const [events] = await sql('SELECT COUNT(*) AS count FROM task_events');
      return { row: (rows as RowDataPacket[])[0], events: (events as RowDataPacket[])[0]?.count };
    }
    const settlement = (op: ReturnType<typeof admission>) =>
      prepareCoreSettlement({
        admission: op,
        status: 'completed',
        result: { summary: '已核验合成结果' },
        generation: { completeness: 'complete', stopReason: 'end_turn' },
        verification: {
          taskId: scope.taskId,
          executionId: op.executionId,
          executionRevision: op.executionRevision,
          passed: true,
          tier: 'llm',
          semanticStatus: 'pass',
          inputCoverage: { complete: true, codes: [] },
          checks: [],
        },
      });
    beforeAll(async () => {
      admin = await mysql.createConnection(connectionOptions());
      // CREATE without IF NOT EXISTS: a collision cannot adopt somebody else's DB.
      await admin.query(`CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4`);
      created = true;
      pool = mysql.createPool({ ...connectionOptions(), database, connectionLimit: 2 });
      repo = new CoreTaskRepository(drizzle(pool) as unknown as DB);
      // Repository contract fixture, not a full application migration gate.
      await sql(`CREATE TABLE tasks (
      id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT, external_id VARCHAR(32) NOT NULL UNIQUE,
      user_id BIGINT UNSIGNED NOT NULL, status VARCHAR(24) NOT NULL,
      result JSON NULL,
      role_id VARCHAR(48) NULL, origin VARCHAR(32) NOT NULL DEFAULT 'user',
      awaiting_question TEXT NULL, awaiting_kind VARCHAR(32) NULL, pause_reason VARCHAR(32) NULL,
      error_code VARCHAR(64) NULL, error_message TEXT NULL, updated_at DATETIME(3) NULL,
      plan_text TEXT NULL, plan_status JSON NULL, verification_json JSON NULL,
      verification_passed BOOLEAN NULL, failure_level VARCHAR(32) NULL, completed_at DATETIME(3) NULL
    ) ENGINE=InnoDB`);
      const migration = await readFile(
        new URL('../../drizzle/0059_core_execution_identity.sql', import.meta.url),
        'utf8',
      );
      for (const statement of migration
        .split('--> statement-breakpoint')
        .map((value) => value.trim())
        .filter(Boolean))
        await sql(statement);
      await sql(`CREATE TABLE task_events (
      id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT, external_id VARCHAR(32) NOT NULL,
      task_id BIGINT UNSIGNED NOT NULL, step_id BIGINT UNSIGNED NULL,
      type VARCHAR(48) NOT NULL, actor VARCHAR(32) NOT NULL,
      payload JSON NULL, created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
    ) ENGINE=InnoDB`);
    });
    beforeEach(async () => {
      await sql('DELETE FROM task_events');
      await sql('DELETE FROM tasks');
      await sql('INSERT INTO tasks (external_id,user_id,status,result) VALUES (?, ?, ?, ?)', [
        scope.taskId,
        scope.userId,
        before.status,
        JSON.stringify({ planText: '旧方案' }),
      ]);
    });
    afterEach(async () => {
      if (created && pool) await sql('DROP TRIGGER IF EXISTS fail_core_event');
    });
    afterAll(async () => {
      await pool?.end();
      if (created) {
        if (!/^holaday_core_[a-f0-9]{16}_integration$/.test(database))
          throw new Error('UNSAFE_TEST_CLEANUP');
        await admin?.query(`DROP DATABASE \`${database}\``);
      }
      await admin?.end();
    });
    it('admits exactly one competing execution with requirements and one atomic event', async () => {
      expect((await snapshot()).row).toMatchObject({ executionId: null, revision: 0, version: 0 });
      const a = admission();
      const b = admission();
      const results = await Promise.all([repo.admit(a), repo.admit(b)]);
      expect(results.filter((r) => r.persisted)).toHaveLength(1);
      const winner = results[0]?.persisted ? a : b;
      const saved = await snapshot();
      expect(saved.row).toMatchObject({
        status: 'executing',
        executionId: winner.executionId,
        revision: 1,
        version: 1,
      });
      expect(saved.row?.result.coreRequirements).toMatchObject(requirements);
      expect(saved.events).toBe(1);
    });
    it('rolls admission back if its event cannot be inserted', async () => {
      const initial = await snapshot();
      await sql(
        "CREATE TRIGGER fail_core_event BEFORE INSERT ON task_events FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='synthetic event refusal'",
      );
      await expect(repo.admit(admission())).rejects.toThrow('CORE_ADMISSION_UNCONFIRMED');
      expect(await snapshot()).toEqual(initial);
    });
    it('rolls settlement back if its event cannot be inserted', async () => {
      const op = admission();
      await repo.admit(op);
      const initial = await snapshot();
      await sql(
        "CREATE TRIGGER fail_core_event BEFORE INSERT ON task_events FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='synthetic event refusal'",
      );
      await expect(repo.settle(settlement(op))).rejects.toThrow('CORE_SETTLEMENT_UNCONFIRMED');
      expect(await snapshot()).toEqual(initial);
    });
    it('settles once, retains accepted requirements, and reads the exact commit receipt', async () => {
      const op = admission();
      await repo.admit(op);
      const end = settlement(op);
      expect(await repo.settle(end)).toEqual({ persisted: true });
      expect(await repo.settle(end)).toEqual({ persisted: false });
      const saved = await snapshot();
      expect(saved.row?.result).toMatchObject({
        summary: '已核验合成结果',
        coreRequirements: requirements,
      });
      expect(saved.events).toBe(2);
      expect(await repo.readSettlement(scope)).toMatchObject({
        status: 'completed',
        executionId: op.executionId,
        executionRevision: 1,
        commitId: end.commitId,
      });
    });
    it('refuses the wrong owner without changing data', async () => {
      const initial = await snapshot();
      expect(
        await repo.admit(
          prepareCoreAdmission({ scope: { ...scope, userId: 8 }, before, requirements }),
        ),
      ).toEqual({ persisted: false });
      expect(await snapshot()).toEqual(initial);
      expect(await repo.readHead({ ...scope, userId: 8 })).toBeNull();
    });
    it('refuses an obsolete legacy JSON snapshot', async () => {
      const initial = await snapshot();
      const op = prepareCoreAdmission({
        scope,
        before,
        requirements,
        legacySnapshot: {
          resultJson: JSON.stringify({ planText: '另一版方案' }),
          roleId: null,
          origin: 'user',
          awaitingQuestion: null,
        },
      });
      expect(await repo.admit(op)).toEqual({ persisted: false });
      expect(await snapshot()).toEqual(initial);
    });
    it.each(['[]', '"synthetic"', 'null'])(
      'refuses non-object result %s without dropping accepted inputs',
      async (value) => {
        await sql('UPDATE tasks SET result = CAST(? AS JSON)', [value]);
        const initial = await snapshot();
        expect(await repo.admit(admission())).toEqual({ persisted: false });
        expect(await snapshot()).toEqual(initial);
      },
    );
  },
);
