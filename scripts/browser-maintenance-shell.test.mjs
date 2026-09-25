import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, writeFile, readFile, copyFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const scripts = new URL('./', import.meta.url);
async function harness(t) {
  const directory = await mkdtemp(join(tmpdir(), 'holaday-start-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await mkdir(join(directory, 'scripts'));
  await mkdir(join(directory, 'apps/orchestrator/dist/account-closure'), { recursive: true });
  await mkdir(join(directory, 'apps/orchestrator/src'));
  for (const name of [
    'start-orchestrator-production.sh',
    'start-account-closure-worker-production.sh',
    'orchestrator-runtime.sh',
    'browser-maintenance-start.mjs',
  ])
    await copyFile(new URL(name, scripts), join(directory, 'scripts', name));
  await writeFile(join(directory, 'apps/orchestrator/src/index.ts'), '');
  await writeFile(join(directory, 'apps/orchestrator/dist/account-closure/worker-entry.js'), '');
  const events = join(directory, 'events');
  const node = join(directory, 'fake-node');
  await writeFile(
    node,
    `#!${process.execPath}
import { spawnSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
const args = process.argv.slice(2);
if (args[2]?.endsWith('/browser-maintenance-start.mjs')) {
  const result = spawnSync(process.execPath, args.slice(2), { env: process.env, stdio: 'inherit' });
  process.exit(result.status ?? 99);
}
appendFileSync(process.env.TEST_EVENTS, JSON.stringify({ args, pm2: process.env.PM2_HOME ?? null })+'\\n');
`,
    { mode: 0o700 },
  );
  const env = {
    ...process.env,
    ORCHESTRATOR_REPO_ROOT: directory,
    ORCHESTRATOR_NODE_BIN: node,
    PM2_HOME: '/root/.pm2',
    TEST_EVENTS: events,
  };
  delete env.HOLADAY_ORDINARY_MAINTENANCE;
  delete env.HOLADAY_ORDINARY_CANDIDATE;
  return { directory, events, env };
}

test('both real production start scripts reject wrong ordinary identity before app launch', async (t) => {
  const f = await harness(t);
  for (const file of [
    'start-orchestrator-production.sh',
    'start-account-closure-worker-production.sh',
  ]) {
    const result = spawnSync('bash', [join(f.directory, 'scripts', file)], {
      encoding: 'utf8',
      env: {
        ...f.env,
        HOLADAY_ORDINARY_MAINTENANCE: '1',
        HOLADAY_ORDINARY_CANDIDATE: 'a'.repeat(40),
      },
    });
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /MAINTENANCE_START_IDENTITY/);
  }
  await assert.rejects(readFile(f.events), { code: 'ENOENT' });
});

test('legacy entry still execs one tsx-loaded application with PM2 control env removed', async (t) => {
  const f = await harness(t);
  for (const file of [
    'start-orchestrator-production.sh',
    'start-account-closure-worker-production.sh',
  ]) {
    const result = spawnSync('bash', [join(f.directory, 'scripts', file)], {
      encoding: 'utf8',
      env: f.env,
    });
    assert.equal(result.status, 0, result.stderr);
  }
  const launches = (await readFile(f.events, 'utf8')).trim().split('\n').map(JSON.parse);
  assert.deepEqual(launches, [
    { args: ['--import', 'tsx', `${f.directory}/apps/orchestrator/src/index.ts`], pm2: null },
    {
      args: [
        '--import',
        'tsx',
        `${f.directory}/apps/orchestrator/dist/account-closure/worker-entry.js`,
      ],
      pm2: null,
    },
  ]);
});

test('legacy runtime restart cannot delete or kill an ordinary instance even with flag set to zero', async (t) => {
  const f = await harness(t);
  for (const env of [
    { HOLADAY_ORDINARY_MAINTENANCE: '1' },
    { HOLADAY_ORDINARY_MAINTENANCE: '0' },
    { HOLADAY_ORDINARY_CANDIDATE: 'a'.repeat(40) },
  ]) {
    const result = spawnSync(
      'bash',
      [join(f.directory, 'scripts/orchestrator-runtime.sh'), 'restart', f.directory],
      { encoding: 'utf8', env: { ...f.env, ...env } },
    );
    assert.equal(result.status, 1);
    assert.match(result.stderr, /MAINTENANCE_EXPLICIT_TRANSITION_REQUIRED/);
  }
});
