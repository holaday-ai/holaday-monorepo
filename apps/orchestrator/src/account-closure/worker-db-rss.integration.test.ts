import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import mysql, { type RowDataPacket } from 'mysql2/promise';
import { describe, expect, it } from 'vitest';

const RSS_RECORD = /ACCOUNT_CLOSURE_RSS=(\{[^\n]+\})/;

describe.sequential('account closure database-backed worker RSS release gate', () => {
  it('runs the real registry against the 205-object synthetic account in a child below 512MB', async () => {
    const results = [await runReleaseGateChild(), await runReleaseGateChild()];
    expect(new Set(results.map((result) => result.databaseName)).size).toBe(2);
    for (const result of results) {
      expect(result.databaseName).not.toBe(result.sourceDatabaseName);
      expect(result.code).toBe(0);
      expect(result.stderr).not.toMatch(/(?:uncaught|unhandled|error:)/i);
      const match = RSS_RECORD.exec(result.stdout);
      expect(match?.[1]).toBeDefined();
      const record = JSON.parse(match?.[1] ?? '{}') as {
        completed: boolean;
        fileCount: number;
        handlerCount: number;
        objectCount: number;
        peakRss: number;
      };
      expect(record).toMatchObject({
        completed: true,
        handlerCount: 13,
        fileCount: 205,
        objectCount: 206,
      });
      expect(record.peakRss).toBeGreaterThan(0);
      expect(record.peakRss).toBeLessThan(512 * 1024 * 1024);
      process.stdout.write(`ACCOUNT_CLOSURE_RSS_VERIFIED=${JSON.stringify(record)}\n`);
    }
  }, 120_000);
});

async function runReleaseGateChild(): Promise<{
  code: number | null;
  databaseName: string;
  sourceDatabaseName: string;
  stdout: string;
  stderr: string;
}> {
  const sourceUrl = dedicatedSourceDatabaseUrl();
  const sourceDatabaseName = decodeURIComponent(sourceUrl.pathname.slice(1));
  const databaseName = `account_closure_task11_rss_${randomBytes(6).toString('hex')}_test`;
  const childUrl = new URL(sourceUrl);
  childUrl.pathname = `/${databaseName}`;
  const adminUrl = new URL(sourceUrl);
  adminUrl.pathname = '/mysql';
  const admin = await mysql.createConnection(adminUrl.toString());
  let childResult: Awaited<ReturnType<typeof spawnReleaseGateChild>> | undefined;
  let operationFailure: unknown;
  try {
    await admin.query(`CREATE DATABASE \`${databaseName}\` CHARACTER SET utf8mb4`);
    childResult = await spawnReleaseGateChild(childUrl.toString());
  } catch (error) {
    operationFailure = error;
  }

  let cleanupFailure: unknown;
  try {
    await admin.query(`DROP DATABASE IF EXISTS \`${databaseName}\``);
    const [rows] = await admin.query<RowDataPacket[]>(
      'SELECT COUNT(*) AS count FROM information_schema.schemata WHERE schema_name = ?',
      [databaseName],
    );
    if (Number(rows[0]?.count ?? -1) !== 0) {
      cleanupFailure = new Error('Task-owned RSS test database cleanup failed');
    }
  } catch (error) {
    cleanupFailure = error;
  }
  try {
    await admin.end();
  } catch (error) {
    cleanupFailure ??= error;
  }
  if (operationFailure) throw operationFailure;
  if (cleanupFailure) throw cleanupFailure;
  if (!childResult) throw new Error('RSS child result missing');
  return { ...childResult, databaseName, sourceDatabaseName };
}

function spawnReleaseGateChild(databaseUrl: string): Promise<{
  code: number | null;
  stdout: string;
  stderr: string;
}> {
  return new Promise((resolve, reject) => {
    const orchestratorRoot = fileURLToPath(new URL('../../', import.meta.url));
    const vitestEntry = fileURLToPath(
      new URL('../../node_modules/vitest/vitest.mjs', import.meta.url),
    );
    const child = spawn(
      process.execPath,
      [
        vitestEntry,
        'run',
        '--config',
        'vitest.integration.config.ts',
        'src/account-closure/release-gates.integration.test.ts',
      ],
      {
        cwd: orchestratorRoot,
        env: {
          ...process.env,
          DATABASE_URL: databaseUrl,
          ALLOW_DESTRUCTIVE_TEST_DB_RESET: '1',
          ACCOUNT_CLOSURE_RSS_CHILD: '1',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.setEncoding('utf8').on('data', (chunk) => {
      stderr += chunk;
    });
    child.once('error', reject);
    child.once('close', (code) => resolve({ code, stdout, stderr }));
  });
}

function dedicatedSourceDatabaseUrl(): URL {
  const raw = process.env.DATABASE_URL;
  if (!raw) throw new Error('DATABASE_URL is required for integration tests');
  const url = new URL(raw);
  const databaseName = decodeURIComponent(url.pathname.slice(1));
  const loopbackHosts = new Set(['127.0.0.1', 'localhost', '[::1]']);
  if (
    !loopbackHosts.has(url.hostname) ||
    !databaseName.endsWith('_test') ||
    databaseName === 'holaday' ||
    /(?:^|_)prod(?:uction)?(?:_|$)/i.test(databaseName)
  ) {
    throw new Error('RSS integration requires a dedicated loopback database ending in _test');
  }
  return url;
}
