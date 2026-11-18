import { createHash, randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { drizzle } from 'drizzle-orm/mysql2';
import mysql, { type Connection, type RowDataPacket } from 'mysql2/promise';
import type { DB } from '../db/client.js';

const schema = 'holaday_it';
const lockName = 'codex:holaday_it';

/** Opt-in local SQL acceptance only. Never reuse or migrate an existing schema. */
export async function openIsolatedMysqlProbe(
  options: {
    allTableStructures?: boolean;
    includeVaultSchema?: boolean;
    artifactPath?: string;
  } = {},
) {
  if (process.env.HOLADAY_SQL_PERSISTENCE_PROBE !== '1')
    throw new Error('Real SQL probe requires explicit opt-in');
  const value = process.env.HOLADAY_SQL_TEST_URL;
  if (!value) throw new Error('HOLADAY_SQL_TEST_URL is required');
  const url = new URL(value);
  if (!['127.0.0.1', 'localhost'].includes(url.hostname) || url.pathname !== `/${schema}`)
    throw new Error('Probe requires the exact loopback holaday_it schema');
  const owner = randomUUID();
  const evidence: Record<string, unknown> = { schema, modelAPICalls: 0, connectionIds: [] };
  let control: Connection | undefined;
  let connection: Connection | undefined;
  let database: DB | undefined;
  let created = false;
  let tables = ['users', 'tasks', 'task_steps', 'task_events'];
  const connect = async () => {
    const fresh = await mysql.createConnection(value);
    (evidence.connectionIds as number[]).push(fresh.threadId);
    return fresh;
  };
  const close = async () => {
    try {
      const prior = connection;
      connection = undefined;
      await prior?.end();
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
        created = false;
        evidence.cleaned = true;
      }
    } finally {
      try {
        await control?.query('SELECT RELEASE_LOCK(?)', [lockName]);
      } finally {
        await control?.end();
        control = undefined;
        if (options.artifactPath)
          await writeFile(options.artifactPath, JSON.stringify(evidence, null, 2));
      }
    }
  };
  try {
    control = await mysql.createConnection({
      host: url.hostname,
      port: Number(url.port || 3306),
      user: decodeURIComponent(url.username),
      password: decodeURIComponent(url.password),
      connectTimeout: 2000,
    });
    const [lock] = await control.query<RowDataPacket[]>('SELECT GET_LOCK(?, 0) AS acquired', [
      lockName,
    ]);
    if (lock[0]?.acquired !== 1) throw new Error('SQL probe namespace already in use');
    const [existing] = await control.query<RowDataPacket[]>(
      'SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME=?',
      [schema],
    );
    if (existing.length) throw new Error('Reserved schema exists; refusing to migrate or reuse it');
    if (options.allTableStructures) {
      const [source] = await control.query<RowDataPacket[]>(
        "SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA='holaday' AND TABLE_TYPE='BASE TABLE'",
      );
      tables = source.map((row) => String(row.TABLE_NAME));
      if (
        !tables.length ||
        tables.some((table) => !/^\w+$/.test(table) || table === 'codex_probe_owner')
      )
        throw new Error('Unexpected source table inventory');
    }
    const clonedTables = [...tables];
    const missingVault =
      options.includeVaultSchema === true && !tables.includes('browser_session_vaults');
    if (missingVault) tables.push('browser_session_vaults');
    await control.query('CREATE DATABASE `holaday_it` CHARACTER SET utf8mb4');
    created = true;
    await control.query(
      'CREATE TABLE `holaday_it`.`codex_probe_owner` (token VARCHAR(64) PRIMARY KEY)',
    );
    await control.query('INSERT INTO `holaday_it`.`codex_probe_owner` VALUES (?)', [owner]);
    Object.assign(evidence, {
      created: true,
      createdAt: new Date().toISOString(),
      ownershipSHA256: createHash('sha256').update(owner).digest('hex'),
      expectedTables: tables,
    });
    // Persist recovery identity before any long browser operation can block teardown.
    if (options.artifactPath)
      await writeFile(options.artifactPath, JSON.stringify(evidence, null, 2));
    for (const table of clonedTables)
      await control.query(`CREATE TABLE \`holaday_it\`.\`${table}\` LIKE \`holaday\`.\`${table}\``);
    connection = await connect();
    const [version] = await connection.query<RowDataPacket[]>('SELECT VERSION() AS version');
    evidence.server = version[0]?.version;
    const migrations = [
      {
        table: 'tasks',
        column: 'public_cloud_continuation_task_id',
        name: '0070_public_cloud_continuation',
      },
      { table: 'task_files', column: 'browser_source', name: '0071_task_files_browser_source' },
    ];
    const appliedMigrations: string[] = [];
    const baselineSchemaGaps: string[] = [];
    if (missingVault) {
      // The guard owns this exact fresh schema. Never apply a migration to the
      // source business database or silently expand another probe's namespace.
      const name = '0067_browser_session_vault';
      const source = await readFile(new URL(`../../drizzle/${name}.sql`, import.meta.url), 'utf8');
      for (const statement of source.split('--> statement-breakpoint'))
        if (statement.trim()) await connection.query(statement);
      appliedMigrations.push(name);
      baselineSchemaGaps.push('browser_session_vaults');
    }
    for (const migration of migrations) {
      if (!tables.includes(migration.table)) continue;
      const [columns] = await connection.query<RowDataPacket[]>(
        `SHOW COLUMNS FROM \`${migration.table}\` LIKE ?`,
        [migration.column],
      );
      if (columns.length) continue;
      const source = await readFile(
        new URL(`../../drizzle/${migration.name}.sql`, import.meta.url),
        'utf8',
      );
      for (const statement of source.split('--> statement-breakpoint'))
        if (statement.trim()) await connection.query(statement);
      appliedMigrations.push(migration.name);
      baselineSchemaGaps.push(`${migration.table}.${migration.column}`);
    }
    Object.assign(evidence, { appliedMigrations, baselineSchemaGaps });
    database = drizzle(connection) as DB;
    evidence.created = true;
    evidence.clonedTableStructures = clonedTables.length;
    evidence.testSchemaTableCount = tables.length;
  } catch (error) {
    await close();
    throw error;
  }
  return {
    get db() {
      return database!;
    },
    evidence,
    // Parent passes this nonce to its own test child; never include it in evidence logs.
    ownershipToken: owner,
    async reconnect(swap?: (db: DB) => void) {
      const prior = connection;
      connection = await connect();
      database = drizzle(connection) as DB;
      swap?.(database);
      await prior?.end();
    },
    close,
  };
}
export type IsolatedMysqlProbe = Awaited<ReturnType<typeof openIsolatedMysqlProbe>>;
