import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto';
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import mysql from 'mysql2/promise';
import { describe, expect, it } from 'vitest';
import { checkMaintenanceSchema } from './ordinary-maintenance-readiness.js';

const run = promisify(execFile);
const require = createRequire(import.meta.url);
const appRoot = fileURLToPath(new URL('../..', import.meta.url));

// Synthetic data only. This is not a production backup/encryption receipt.
// Catch: complete migration replay mutating historical payment timestamps,
// losing old rows/NULL costs, or losing objects during a real dump/restore.
describe.skipIf(process.env.CORE_MYSQL_INTEGRATION !== '1')(
  'first cutover real MySQL restore',
  () => {
    it.each([
      { label: 'current observed payment shape', missingTime: false },
      { label: 'unsafe completed payment with missing time', missingTime: true },
    ])(
      '$label: restore, then migrate safely or refuse before writing',
      async ({ missingTime }) => {
        const url = new URL(process.env.CORE_MYSQL_TEST_ADMIN_URL ?? 'http://invalid');
        const container = process.env.CORE_MYSQL_TEST_CONTAINER ?? '';
        if (
          url.protocol !== 'mysql:' ||
          url.hostname !== '127.0.0.1' ||
          url.port !== '13316' ||
          url.pathname !== '/' ||
          url.username !== 'root' ||
          url.password ||
          url.search ||
          url.hash ||
          !/^holaday-first-cutover-qa-[a-f0-9]{16}$/.test(container)
        )
          throw new Error('QA_ISOLATED_MYSQL_REQUIRED');
        const inspection = JSON.parse((await run('docker', ['inspect', container])).stdout)[0];
        if (
          inspection.Config.Labels?.['holaday.qa'] !== 'first-cutover-mysql' ||
          inspection.HostConfig.PortBindings?.['3306/tcp']?.length !== 1 ||
          inspection.HostConfig.PortBindings['3306/tcp'][0].HostIp !== '127.0.0.1' ||
          inspection.HostConfig.PortBindings['3306/tcp'][0].HostPort !== '13316' ||
          inspection.Mounts.length !== 1 ||
          inspection.Mounts[0].Destination !== '/var/lib/mysql' ||
          inspection.Mounts[0].Type !== 'volume'
        )
          throw new Error('QA_CONTAINER_SCOPE_UNPROVEN');

        const connection = await mysql.createConnection({ uri: url.toString(), dateStrings: true });
        const suffix = randomBytes(8).toString('hex');
        const source = `holaday_first_cutover_${suffix}_source_integration`;
        const target = `holaday_first_cutover_${suffix}_restore_integration`;
        const created: string[] = [];
        const snapshot = await mkdtemp(join(tmpdir(), 'holaday-cutover-migrations-'));
        const snapshotApp = join(snapshot, 'apps/orchestrator');
        const rows = async (sql: string, values?: unknown[]) => {
          const [result] = await connection.query(sql, values);
          return result as unknown as Record<string, unknown>[];
        };
        const identity = (await rows('SELECT @@server_uuid AS id'))[0]?.id;
        const migrate = async (database: string) => {
          if (!created.includes(database)) throw new Error('QA_DATABASE_NOT_OWNED');
          const destination = new URL(url);
          destination.pathname = `/${database}`;
          // Runner loads dotenv itself: copied source has no .env files at any
          // of its three lookup paths. Do not execute it in the real checkout.
          await run(
            process.execPath,
            [
              '--import',
              require.resolve('tsx/esm'),
              join(snapshotApp, 'scripts/apply-numbered-migrations.ts'),
            ],
            {
              cwd: snapshot,
              env: {
                PATH: dirname(process.execPath),
                DATABASE_URL: destination.toString(),
                TZ: 'UTC',
              },
              timeout: 120_000,
              maxBuffer: 1024 * 1024,
            },
          );
        };
        const use = async (database: string) => {
          if (!created.includes(database)) throw new Error('QA_DATABASE_NOT_OWNED');
          await connection.query(`USE \`${database}\``);
        };
        const inventory = async () => {
          const tables = await rows('SHOW FULL TABLES');
          const objects: Record<string, unknown>[] = [];
          for (const table of tables) {
            const name = String(Object.values(table)[0]);
            if (!/^[a-z0-9_]+$/.test(name)) throw new Error('QA_OBJECT_NAME_INVALID');
            const ddl = await rows(`SHOW CREATE TABLE \`${name}\``);
            objects.push({
              name,
              // MySQL's dump makes an implicit utf8mb4 column charset explicit.
              // Compare real column metadata too; do not mask a charset change.
              ddl: JSON.stringify(ddl)
                .replaceAll(source, 'QA_DB')
                .replaceAll(target, 'QA_DB')
                .replace(/ CHARACTER SET utf8mb4(?= COLLATE utf8mb4_)/g, ''),
              columns: await rows(
                'SELECT COLUMN_NAME,ORDINAL_POSITION,COLUMN_DEFAULT,IS_NULLABLE,COLUMN_TYPE,CHARACTER_SET_NAME,COLLATION_NAME,EXTRA,GENERATION_EXPRESSION FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION',
                [name],
              ),
              data: (await rows(`SELECT * FROM \`${name}\``))
                .map((row) => JSON.stringify(row))
                .sort(),
            });
          }
          for (const [kind, query] of [
            [
              'TRIGGER',
              'SELECT TRIGGER_NAME AS name FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA = DATABASE()',
            ],
            [
              'EVENT',
              'SELECT EVENT_NAME AS name FROM information_schema.EVENTS WHERE EVENT_SCHEMA = DATABASE()',
            ],
            [
              'PROCEDURE',
              "SELECT ROUTINE_NAME AS name FROM information_schema.ROUTINES WHERE ROUTINE_SCHEMA = DATABASE() AND ROUTINE_TYPE = 'PROCEDURE'",
            ],
          ] as const) {
            for (const { name } of await rows(query)) {
              if (typeof name !== 'string' || !/^[a-z0-9_]+$/.test(name))
                throw new Error('QA_OBJECT_NAME_INVALID');
              const ddl = await rows(`SHOW CREATE ${kind} \`${name}\``);
              // Restoration creates a new trigger object; its creation time is
              // not business data. Keep definition, sql_mode and charset checks.
              if (kind === 'TRIGGER') for (const row of ddl) row.Created = undefined;
              objects.push({
                name,
                ddl: JSON.stringify(ddl).replaceAll(source, 'QA_DB').replaceAll(target, 'QA_DB'),
              });
            }
          }
          return objects.sort((a, b) => String(a.name).localeCompare(String(b.name)));
        };
        try {
          for (const database of [source, target]) {
            await connection.query(`CREATE DATABASE \`${database}\``);
            created.push(database);
          }
          await mkdir(join(snapshotApp, 'scripts'), { recursive: true });
          await mkdir(join(snapshotApp, 'drizzle'));
          await copyFile(join(appRoot, 'package.json'), join(snapshotApp, 'package.json'));
          await symlink(join(appRoot, 'node_modules'), join(snapshotApp, 'node_modules'));
          for (const file of ['apply-numbered-migrations.ts', 'release-db-contract.mjs']) {
            await copyFile(join(appRoot, 'scripts', file), join(snapshotApp, 'scripts', file));
          }
          const files = (await readdir(join(appRoot, 'drizzle')))
            .filter((f) => /^\d{4}_.+\.sql$/.test(f))
            .sort();
          expect(files).toHaveLength(61);
          for (const file of files.filter((f) => Number(f.slice(0, 4)) <= 58)) {
            await copyFile(join(appRoot, 'drizzle', file), join(snapshotApp, 'drizzle', file));
          }
          await migrate(source);
          await use(source);
          await connection.query(
            "INSERT INTO users (id,external_id,email,password_hash) VALUES (1,'usr_cutover','cutover@example.invalid','synthetic')",
          );
          for (const status of ['completed', 'failed', 'paused']) {
            await connection.query(
              'INSERT INTO tasks (external_id,user_id,intent,status) VALUES (?,1,?,?)',
              [`tsk_${status}`, '合成迁移验证', status],
            );
          }
          // Simulate an older installation where nullable unknown costs already exist,
          // but the new execution/accounting columns have not been installed.
          await connection.query('ALTER TABLE llm_calls MODIFY cost_usd DECIMAL(12,6) NULL');
          await connection.query(
            "INSERT INTO llm_calls (external_id,user_id,model,purpose,cost_usd) VALUES ('llm_unknown',1,'qa','qa',NULL),('llm_known',1,'qa','qa',1.250000)",
          );
          await connection.query(
            "INSERT INTO payments (external_id,user_external_id,provider,plan,amount_cents,status,updated_at,completed_at) VALUES ('pay_pending','usr_cutover','alipay','pro',4900,'pending','2026-01-02 03:04:05.123',NULL),('pay_completed','usr_cutover','alipay','pro',4900,'completed','2026-01-02 03:04:05.123','2026-01-01 01:02:03.456')",
          );
          if (missingTime)
            await connection.query(
              "INSERT INTO payments (external_id,user_external_id,provider,plan,amount_cents,status,updated_at,completed_at) VALUES ('pay_missing_time','usr_cutover','alipay','pro',9900,'completed','2026-01-02 03:04:05.123',NULL)",
            );
          await connection.query('CREATE TABLE qa_object_probe (id INT PRIMARY KEY)');
          await connection.query(
            'CREATE VIEW qa_payment_view AS SELECT external_id,status FROM payments',
          );
          await connection.query(
            'CREATE TRIGGER qa_probe_trigger BEFORE INSERT ON qa_object_probe FOR EACH ROW SET NEW.id = NEW.id',
          );
          await connection.query(
            'CREATE EVENT qa_disabled_event ON SCHEDULE EVERY 1 DAY DISABLE DO INSERT INTO qa_object_probe VALUES (99)',
          );
          await connection.query('CREATE PROCEDURE qa_probe_procedure() SELECT 1');
          const beforeRestore = await inventory();
          const baselinePayments = await rows(
            'SELECT external_id,amount_cents,status,updated_at,completed_at FROM payments ORDER BY external_id',
          );
          const baselineTasks = await rows(
            'SELECT external_id,status FROM tasks ORDER BY external_id',
          );
          const baselineCosts = await rows(
            'SELECT external_id,cost_usd FROM llm_calls ORDER BY external_id',
          );
          for (const file of files)
            await copyFile(join(appRoot, 'drizzle', file), join(snapshotApp, 'drizzle', file));
          const exportPlain = async () =>
            (
              await run(
                'docker',
                [
                  'exec',
                  container,
                  'mysqldump',
                  '-uroot',
                  '--single-transaction',
                  '--routines',
                  '--events',
                  '--triggers',
                  '--set-gtid-purged=OFF',
                  '--no-tablespaces',
                  source,
                ],
                { maxBuffer: 16 * 1024 * 1024 },
              )
            ).stdout;
          const importPlain = async (plain: string | Buffer) =>
            new Promise<void>((resolve, reject) => {
              const child = execFile(
                'docker',
                ['exec', '-i', container, 'mysql', '-uroot', target],
                { maxBuffer: 1024 * 1024 },
                (error) => (error ? reject(error) : resolve()),
              );
              child.stdin?.on('error', reject);
              child.stdin?.end(plain);
            });
          if (!missingTime) {
            // The REAL coordinator and filesystem journal, using a QA-only
            // encrypted facility and the existing actual MySQL fixture. This
            // does not configure production keys, storage, or host isolation.
            const moduleAt = (file: string) =>
              new URL(`../../../../scripts/${file}`, import.meta.url).href;
            const { backupAndRestoreCheck } = await import(
              moduleAt('browser-first-cutover-backup.mjs')
            );
            const { acquireReleaseJournal } = await import(
              moduleAt('browser-maintenance-journal.mjs')
            );
            const { buildMaintenanceMigrationManifest } = await import(
              moduleAt('browser-maintenance-manifest.mjs')
            );
            const manifest = buildMaintenanceMigrationManifest(join(appRoot, '../..'));
            const binding = {
              attempt: randomUUID(),
              candidate: 'a'.repeat(40),
              configDigest: 'b'.repeat(64),
              migrationDigest: manifest.sha256,
              inventoryDigest: 'd'.repeat(64),
            };
            const journalDirectory = join(await realpath(snapshot), 'journal');
            await mkdir(journalDirectory, { mode: 0o700 });
            const journal = await acquireReleaseJournal(journalDirectory, {
              ...binding,
              kind: 'first-cutover',
              legacyDigest: 'e'.repeat(64),
            });
            try {
              await journal.bindManifest(manifest.manifest);
              for (const phase of [
                'prepared',
                'orders_fenced',
                'legacy_settled',
                'producers_stopped',
                'all_fenced',
                'stopped',
                'backup_verified',
              ])
                await journal.persist(phase, { candidate: binding.candidate });
              await expect(
                journal.persist('migration_started', { candidate: binding.candidate }),
              ).rejects.toThrow('UNPROVEN');
              const hash = (value: unknown) =>
                createHash('sha256').update(JSON.stringify(value)).digest('hex');
              const encryptionProfileDigest = hash('QA-only ephemeral AES-256-GCM facility');
              const key = randomBytes(32);
              const reference = join(snapshot, 'synthetic-backup.enc');
              type Identity = { serverUuid: string; database: string };
              if (typeof identity !== 'string') throw new Error('QA_SERVER_ID_INVALID');
              const sourceIdentity: Identity = { serverUuid: identity, database: source };
              const isolatedTarget: Identity = { serverUuid: identity, database: target };
              const business = async () => ({
                payments: await rows(
                  'SELECT external_id,amount_cents,status,updated_at,completed_at FROM payments ORDER BY external_id',
                ),
                tasks: await rows('SELECT external_id,status FROM tasks ORDER BY external_id'),
                costs: await rows(
                  'SELECT external_id,cost_usd FROM llm_calls ORDER BY external_id',
                ),
              });
              const beforeBusiness = {
                payments: baselinePayments,
                tasks: baselineTasks,
                costs: baselineCosts,
              };
              const receipt = await backupAndRestoreCheck(
                {
                  binding,
                  sourceIdentity,
                  isolatedTarget,
                  maintenanceEndsAtMs: Date.now() + 120_000,
                },
                {
                  now: Date.now,
                  assertOwnership: () => journal.assertOwnership(),
                  assertWritersStopped: async () => {
                    expect(
                      await rows(
                        'SELECT ID FROM information_schema.PROCESSLIST WHERE DB IN (?,?) AND ID <> CONNECTION_ID()',
                        [source, target],
                      ),
                    ).toEqual([]);
                  },
                  readDatabaseIdentity: async (destination: Identity) => {
                    await use(destination.database);
                    const [actual] = await rows(
                      'SELECT @@server_uuid AS serverUuid, DATABASE() AS db',
                    );
                    return { serverUuid: actual?.serverUuid, database: actual?.db };
                  },
                  inspectBackupFacility: async () => ({ encryptionProfileDigest }),
                  exportDatabase: async (destination: Identity) => {
                    expect(destination).toEqual(sourceIdentity);
                    const nonce = randomBytes(12);
                    const cipher = createCipheriv('aes-256-gcm', key, nonce);
                    const encrypted = Buffer.concat([
                      cipher.update(await exportPlain(), 'utf8'),
                      cipher.final(),
                    ]);
                    await writeFile(
                      reference,
                      Buffer.concat([nonce, cipher.getAuthTag(), encrypted]),
                      { mode: 0o600, flag: 'wx' },
                    );
                    return { reference, encryptionProfileDigest };
                  },
                  hashArtifact: async () =>
                    createHash('sha256')
                      .update(await readFile(reference))
                      .digest('hex'),
                  restoreIsolated: async (_artifact: unknown, destination: Identity) => {
                    expect(destination).toEqual(isolatedTarget);
                    const bytes = await readFile(reference);
                    const decipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12));
                    decipher.setAuthTag(bytes.subarray(12, 28));
                    await importPlain(
                      Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]),
                    );
                  },
                  compareInventoryAndData: async () => {
                    await use(source);
                    expect(await inventory()).toEqual(beforeRestore);
                    await use(target);
                    const restored = await inventory();
                    expect(restored).toEqual(beforeRestore);
                    expect(await business()).toEqual(beforeBusiness);
                    return {
                      comparisonDigest: hash({ source: beforeRestore, restored }),
                      sourceDigest: hash(beforeRestore),
                      businessDigest: hash(beforeBusiness),
                    };
                  },
                  runApprovedMigrations: async (destination: Identity, approvedDigest: string) => {
                    expect(destination).toEqual(isolatedTarget);
                    expect(approvedDigest).toBe(manifest.sha256);
                    await migrate(destination.database);
                  },
                  verifySchema: async () => {
                    await use(target);
                    await checkMaintenanceSchema(rows);
                    expect(await business()).toEqual(beforeBusiness);
                    return {
                      schemaDigest: hash(await inventory()),
                      businessDigest: hash(await business()),
                    };
                  },
                  readSourceDigest: async () => {
                    await use(source);
                    return hash(await inventory());
                  },
                  sealReceipt: (value: unknown) => journal.bindBackupReceipt(value),
                },
              );
              const stored = JSON.parse(await readFile(journal.path, 'utf8'));
              expect(stored.backupReceipt).toEqual(receipt);
              await journal.persist('migration_started', { candidate: binding.candidate });
              await use(source);
              expect(await inventory()).toEqual(beforeRestore);
            } finally {
              await journal.close();
            }
            return;
          }
          await importPlain(await exportPlain());
          await use(target);
          expect(await inventory()).toEqual(beforeRestore);
          if (missingTime) {
            // Catch a missing runner precondition, not merely a changed SQL string:
            // unsafe data must fail BEFORE any DDL/DML and remain byte-equivalent.
            await expect(migrate(target)).rejects.toThrow('MIGRATION_PAYMENT_TIME_UNPROVEN');
            expect(await inventory()).toEqual(beforeRestore);

            // An older schema without completed_at must not bypass the guard.
            await connection.query('ALTER TABLE payments DROP INDEX ix_payments_status_completed');
            await connection.query('ALTER TABLE payments DROP COLUMN completed_at');
            const legacyInventory = await inventory();
            await expect(migrate(target)).rejects.toThrow('MIGRATION_PAYMENT_TIME_UNPROVEN');
            expect(await inventory()).toEqual(legacyInventory);

            // Retain direct evidence of WHY the unchanged 0042 is unsafe. Execute
            // it only in this disposable restore DB, outside the guarded runner.
            const file = '0042_payment_completed_at.sql';
            // This fixed file has three simple statements, no quoted semicolons.
            const rawSql = await readFile(join(appRoot, 'drizzle', file), 'utf8');
            for (const statement of rawSql
              .split(';')
              .map((sql) => sql.trim())
              .filter(Boolean))
              await connection.query(statement);
            const [affected] = await rows(
              "SELECT updated_at,completed_at FROM payments WHERE external_id = 'pay_missing_time'",
            );
            expect(affected?.completed_at).toBe('2026-01-02 03:04:05.123');
            expect(affected?.updated_at).not.toBe('2026-01-02 03:04:05.123');
            await use(source);
            expect(await inventory()).toEqual(beforeRestore);
            return;
          }
        } finally {
          try {
            assert.equal(
              (await rows('SELECT @@server_uuid AS id'))[0]?.id,
              identity,
              'QA_SERVER_ID_CHANGED',
            );
            for (const database of [...created].reverse())
              await connection.query(`DROP DATABASE \`${database}\``);
          } finally {
            await connection.end();
            await rm(snapshot, { recursive: true, force: true });
          }
        }
      },
      180_000,
    );
  },
);
