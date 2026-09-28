import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import * as backup from './browser-first-cutover-backup.mjs';
import { buildMaintenanceMigrationManifest } from './browser-maintenance-manifest.mjs';

const api = await import('./browser-first-cutover-recovery-runtime.mjs').catch(() => ({}));
const hash = (v) => createHash('sha256').update(v).digest('hex');
async function fixture(t) {
  const root = await fs.realpath(await fs.mkdtemp(join(tmpdir(), 'cutover-recovery-runtime-')));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const files = {
    node: 'synthetic runtime',
    'recovery-tool.mjs': 'synthetic compiled reader',
    'apps/orchestrator/scripts/apply-numbered-migrations.mjs': 'synthetic compiled runner',
    'apps/orchestrator/scripts/apply-numbered-migrations.ts': 'original source',
    'apps/orchestrator/scripts/release-db-contract.mjs': 'original contract',
    'apps/orchestrator/drizzle/0000_initial.sql': 'CREATE TABLE sample(id INT);',
  };
  for (const [name, bytes] of Object.entries(files)) {
    await fs.mkdir(dirname(join(root, name)), { recursive: true, mode: 0o700 });
    await fs.writeFile(join(root, name), bytes, { mode: 0o600, flag: 'wx' });
  }
  const migrationDigest = buildMaintenanceMigrationManifest(root).sha256;
  const manifest = {
    schemaVersion: 1,
    migrationDigest,
    files: Object.fromEntries(Object.entries(files).map(([k, v]) => [k, hash(v)])),
  };
  const bytes = JSON.stringify(manifest);
  await fs.writeFile(join(root, 'runtime.json'), bytes, { mode: 0o600, flag: 'wx' });
  return { root, manifest, runtimeDigest: hash(bytes), migrationDigest };
}

test('approved recovery runtime verifies original SQL manifest and all copied bytes', async (t) => {
  assert.equal(typeof api.readFirstCutoverRecoveryRuntime, 'function');
  const f = await fixture(t);
  assert.deepEqual(await api.readFirstCutoverRecoveryRuntime(f), f.manifest);
  await fs.appendFile(
    join(f.root, 'apps/orchestrator/drizzle/0000_initial.sql'),
    'DROP TABLE sample;',
  );
  await assert.rejects(api.readFirstCutoverRecoveryRuntime(f), /CUTOVER_RECOVERY_RUNTIME_UNPROVEN/);
});

for (const fault of [
  'dotenv',
  'nested-dotenv',
  'symlink',
  'unapproved-file',
  'wrong-manifest',
  'wrong-runtime',
  'writable-directory',
]) {
  test(`recovery runtime refuses ${fault} before any runner can load it`, async (t) => {
    assert.equal(typeof api.readFirstCutoverRecoveryRuntime, 'function');
    const f = await fixture(t);
    if (fault === 'dotenv') await fs.writeFile(join(f.root, '.env'), 'DATABASE_URL=private');
    if (fault === 'nested-dotenv')
      await fs.writeFile(join(f.root, 'apps/orchestrator/.env.local'), 'DATABASE_URL=private');
    if (fault === 'unapproved-file') await fs.writeFile(join(f.root, 'extra.mjs'), 'unexpected');
    if (fault === 'symlink') {
      await fs.rename(join(f.root, 'node'), join(f.root, 'saved'));
      await fs.symlink(join(f.root, 'saved'), join(f.root, 'node'));
    }
    if (fault === 'wrong-manifest') f.migrationDigest = '0'.repeat(64);
    if (fault === 'wrong-runtime') f.runtimeDigest = '0'.repeat(64);
    if (fault === 'writable-directory') await fs.chmod(join(f.root, 'apps'), 0o777);
    await assert.rejects(
      api.readFirstCutoverRecoveryRuntime(f),
      /CUTOVER_RECOVERY_RUNTIME_UNPROVEN/,
    );
  });
}

test('runtime cannot bless a different migration source even with matching per-file hashes', async (t) => {
  assert.equal(typeof api.readFirstCutoverRecoveryRuntime, 'function');
  const f = await fixture(t);
  await fs.writeFile(
    join(f.root, 'apps/orchestrator/scripts/apply-numbered-migrations.ts'),
    'replacement',
  );
  f.manifest.files['apps/orchestrator/scripts/apply-numbered-migrations.ts'] = hash('replacement');
  const bytes = JSON.stringify(f.manifest);
  await fs.writeFile(join(f.root, 'runtime.json'), bytes);
  f.runtimeDigest = hash(bytes);
  await assert.rejects(api.readFirstCutoverRecoveryRuntime(f), /CUTOVER_RECOVERY_RUNTIME_UNPROVEN/);
});

for (const fault of ['none', 'runner', 'identity', 'schema']) {
  test(`recovery migration ${fault}: original runner once, exact isolated connection and no replay`, async (t) => {
    assert.equal(typeof api.runFirstCutoverRecoveryTool, 'function');
    const f = await fixture(t);
    const identity = { serverUuid: '11111111-1111-4111-8111-111111111111', database: 'restore_qa' };
    const request = {
      runtimeDigest: f.runtimeDigest,
      migrationDigest: f.migrationDigest,
      identity,
      action: 'migrate',
    };
    let executions = 0;
    let connections = 0;
    let closed = 0;
    const io = {
      root: f.root,
      connect: async (options) => {
        assert.equal(options.socketPath, '/var/run/mysqld/mysqld.sock');
        assert.equal(options.database, 'restore_qa');
        assert.equal(options.multipleStatements, false);
        assert.equal(options.dateStrings, true);
        assert.equal(options.bigNumberStrings, true);
        connections++;
        return {
          query: async (sql) => {
            assert.match(sql, /@@server_uuid/);
            return [[fault === 'identity' ? { ...identity, database: 'other' } : identity]];
          },
          end: async () => {
            closed++;
          },
        };
      },
      execute: async (program, args, options) => {
        executions++;
        assert.equal(program, join(f.root, 'node'));
        assert.deepEqual(args, [
          join(f.root, 'apps/orchestrator/scripts/apply-numbered-migrations.mjs'),
        ]);
        assert.deepEqual(Object.keys(options.env).sort(), ['DATABASE_URL', 'PATH', 'TZ']);
        assert.equal(new URL(options.env.DATABASE_URL).pathname, '/restore_qa');
        assert.equal(
          new URL(options.env.DATABASE_URL).searchParams.get('socketPath'),
          '/var/run/mysqld/mysqld.sock',
        );
        assert.equal(options.cwd, f.root);
        assert.equal(
          await fs.readFile(join(f.root, 'migration-started.json'), 'utf8'),
          JSON.stringify({
            runtimeDigest: f.runtimeDigest,
            migrationDigest: f.migrationDigest,
            identity,
          }),
        );
        if (fault === 'runner') throw new Error('private SQL must not escape');
      },
    };
    if (fault === 'schema') request.identity.database = '../production';
    if (fault === 'none')
      assert.deepEqual(await api.runFirstCutoverRecoveryTool(request, io), {
        migrationDigest: f.migrationDigest,
      });
    else
      await assert.rejects(api.runFirstCutoverRecoveryTool(request, io), {
        message: 'CUTOVER_RECOVERY_TOOL_UNPROVEN',
      });
    const beforeRetry = executions;
    await assert.rejects(
      api.runFirstCutoverRecoveryTool(request, io),
      /CUTOVER_RECOVERY_TOOL_UNPROVEN/,
    );
    assert.equal(executions, beforeRetry);
    assert.equal(executions, fault === 'none' || fault === 'runner' ? 1 : 0);
    assert.equal(connections, closed);
  });
}

for (const action of ['snapshot', 'verify'])
  test(`recovery ${action} uses the original consistent read and closes the dedicated connection`, async (t) => {
    const f = await fixture(t);
    const identity = { serverUuid: '11111111-1111-4111-8111-111111111111', database: 'restore_qa' };
    const queries = [];
    let closed = false;
    let schemaChecked = false;
    const result = await api.runFirstCutoverRecoveryTool(
      {
        runtimeDigest: f.runtimeDigest,
        migrationDigest: f.migrationDigest,
        identity,
        action,
        ...(action === 'verify' ? { projection: [{ table: 'sample', columns: ['id'] }] } : {}),
      },
      {
        root: f.root,
        checkSchema: async (query) => {
          assert.deepEqual(await query('SELECT @@server_uuid'), [identity]);
          schemaChecked = true;
        },
        connect: async () => ({
          query: async (sql) => {
            queries.push(sql);
            if (sql.includes('@@server_uuid')) return [[identity]];
            if (sql.includes('information_schema.SCHEMATA'))
              return [[{ charset: 'utf8mb4', collation: 'utf8mb4_0900_ai_ci' }]];
            if (sql.includes('information_schema.TABLES'))
              return [[{ name: 'sample', kind: 'BASE TABLE', engine: 'InnoDB' }]];
            if (sql.includes('information_schema.COLUMNS'))
              return [[{ COLUMN_NAME: 'id', ORDINAL_POSITION: 1, COLUMN_TYPE: 'int' }]];
            if (sql.startsWith('SHOW CREATE'))
              return [[{ Table: 'sample', 'Create Table': 'CREATE TABLE `sample` (`id` int)' }]];
            if (sql.startsWith('SELECT COUNT')) return [[{ rowCount: 0 }]];
            return [[]];
          },
          end: async () => {
            closed = true;
          },
        }),
      },
    );
    if (action === 'snapshot') {
      assert.deepEqual(result.identity, identity);
      assert.equal(result.objects.length, 1);
      assert.equal(result.objects[0].name, 'sample');
      assert.equal(result.objects[0].rowCount, 0);
      assert.deepEqual(result.projection, [{ table: 'sample', columns: ['id'] }]);
    } else {
      assert.deepEqual(Object.keys(result).sort(), ['businessDigest', 'schemaDigest']);
      assert.equal(schemaChecked, true);
    }
    assert.match(result.businessDigest, /^[a-f0-9]{64}$/);
    assert.ok(queries.includes('START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY'));
    assert.ok(queries.includes('ROLLBACK'));
    assert.equal(closed, true);
    await assert.rejects(fs.stat(join(f.root, 'migration-started.json')), { code: 'ENOENT' });
  });

test('recovery tool entry refuses malformed input without echoing private input or a stack', async () => {
  const child = spawn(process.execPath, [
    new URL('./browser-first-cutover-recovery-tool.mjs', import.meta.url).pathname,
  ]);
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (v) => {
    stdout += v;
  });
  child.stderr.on('data', (v) => {
    stderr += v;
  });
  child.stdin.on('error', () => {});
  const exited = new Promise((resolve) => child.on('close', resolve));
  child.stdin.end('{private invalid input');
  assert.equal(await exited, 1);
  assert.equal(stdout, '');
  assert.equal(stderr, 'CUTOVER_RECOVERY_TOOL_UNPROVEN\n');
});

for (const fault of ['none', 'digest', 'scope', 'late-failure'])
  test(`target runtime invocation ${fault}: pinned executables and current stop scope`, async () => {
    assert.equal(typeof backup.executeFirstCutoverRecoveryTargetTool, 'function');
    const target = {
      containerId: 'a'.repeat(64),
      imageId: `sha256:${'b'.repeat(64)}`,
      attempt: '11111111-1111-4111-8111-111111111111',
      volume: 'holaday-cutover-restore-11111111-1111-4111-8111-111111111111',
      identity: { serverUuid: '22222222-2222-4222-8222-222222222222', database: 'restore' },
    };
    const runtime = {
      manifestDigest: 'c'.repeat(64),
      nodeDigest: 'd'.repeat(64),
      toolDigest: 'e'.repeat(64),
    };
    const migrationDigest = 'f'.repeat(64);
    let spawned = 0;
    let guards = 0;
    const io = {
      inspectTarget: async () => target.identity,
      assertScope: async () => {
        guards++;
        if (fault === 'scope') throw new Error('private scope');
      },
      execFile: async (program, args) => {
        assert.equal(program, 'docker');
        assert.equal(args[3], target.containerId);
        assert.equal(args[4], '/usr/bin/sha256sum');
        return {
          stdout: `${fault === 'digest' ? '0'.repeat(64) : runtime.nodeDigest}  /opt/holaday-recovery/node\n${runtime.toolDigest}  /opt/holaday-recovery/recovery-tool.mjs\n${runtime.manifestDigest}  /opt/holaday-recovery/runtime.json\n`,
        };
      },
      spawn: (program, args, options) => {
        spawned++;
        assert.equal(program, 'docker');
        assert.deepEqual(args, [
          'exec',
          '-i',
          '--user',
          '0',
          target.containerId,
          '/usr/bin/env',
          '-i',
          '/opt/holaday-recovery/node',
          '/opt/holaday-recovery/recovery-tool.mjs',
        ]);
        assert.equal(options.shell, undefined);
        // Real process boundary. SQL/runtime internals are covered by the
        // dedicated MySQL fixture; this child asserts the fixed wire payload.
        return spawn(
          process.execPath,
          [
            '--input-type=module',
            '-e',
            `let s=''; for await(const v of process.stdin)s+=v; const q=JSON.parse(s); if(q.action!=='migrate'||q.identity.database!=='restore'||q.migrationDigest!=='${migrationDigest}'||q.runtimeDigest!=='${runtime.manifestDigest}')process.exit(2); process.stdout.write(JSON.stringify({migrationDigest:q.migrationDigest})); process.exitCode=${fault === 'late-failure' ? 1 : 0};`,
          ],
          { stdio: ['pipe', 'pipe', 'pipe'] },
        );
      },
    };
    const input = { target, runtime, migrationDigest, action: 'migrate' };
    if (fault === 'none')
      assert.deepEqual(await backup.executeFirstCutoverRecoveryTargetTool(input, io), {
        migrationDigest,
      });
    else
      await assert.rejects(backup.executeFirstCutoverRecoveryTargetTool(input, io), {
        message: 'CUTOVER_RECOVERY_TARGET_TOOL_UNPROVEN',
      });
    assert.equal(spawned, fault === 'none' || fault === 'late-failure' ? 1 : 0);
    assert.ok(guards >= 1);
  });
