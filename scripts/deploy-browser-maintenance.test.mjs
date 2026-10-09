import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'holaday-deploy-entry-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await mkdir(join(dir, 'scripts'));
  await mkdir(join(dir, 'bin'));
  for (const file of [
    'deploy-orchestrator.sh',
    'akshare-production-gate.mjs',
    'auto-smoke-summary.sh',
    'orchestrator-runtime.sh',
    'start-orchestrator-production.sh',
    'start-account-closure-worker-production.sh',
    'team-task-lifecycle-deploy-safety.mjs',
    'qwen-initial-cutover-policy.mjs',
  ])
    await copyFile(new URL(file, import.meta.url), join(dir, 'scripts', file));
  // Probe contents are sent through SSH, not executed locally by this fixture.
  try {
    await copyFile(
      new URL('browser-maintenance-probe.sh', import.meta.url),
      join(dir, 'scripts/browser-maintenance-probe.sh'),
    );
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  await writeFile(join(dir, 'scripts/load-deploy-env.sh'), ':\n');
  await writeFile(
    join(dir, 'scripts/ssh-password-auth.sh'),
    'build_ssh_password_prefix() { SSH_PASSWORD_PREFIX=(env); }\n',
  );
  await writeFile(
    join(dir, 'bin/ssh'),
    `#!${process.execPath}
import { appendFileSync } from 'node:fs';
const args = process.argv.slice(2), text = args.at(-1);
if (!args.includes('StrictHostKeyChecking=yes')) process.exit(91);
const event = text.includes('--verify-akshare') ? 'akshare' : text.includes('browser-maintenance-probe') ? 'probe' : text.includes('browser-maintenance-host.mjs') ? 'release' : 'unexpected';
appendFileSync(process.env.TEST_EVENTS, event+'\\n');
if (event === 'unexpected') process.exit(99);
if (event === 'akshare') {
  if (process.env.TEST_CASE === 'akshare-failed') process.exit(46);
} else if (event === 'probe') {
  if (process.env.TEST_CASE === 'legacy' || process.env.TEST_CASE === 'timeout') process.exit(44);
  if (process.env.TEST_CASE === 'malformed') { console.log('{"protocol":1}'); process.exit(0); }
  console.log(JSON.stringify({ protocol:1, identity:{candidate:'a'.repeat(40),bootId:'b'.repeat(32)},mode:'serving',needsReconciliation:true,idle:false }));
} else {
  if (process.env.TEST_CASE === 'release-failed') process.exit(45);
  if (!text.includes('codex/release') || !text.includes('c'.repeat(40)) || !text.includes('e'.repeat(64)) || !text.includes('f'.repeat(64)) || !text.includes('9'.repeat(64))) process.exit(92);
  console.log(JSON.stringify({ok:true,phase:'opened',identity:{candidate:'c'.repeat(40),bootId:'d'.repeat(32)}}));
}
`,
    { mode: 0o700 },
  );
  await writeFile(join(dir, 'bin/scp'), '#!/bin/sh\necho upload >> "$TEST_EVENTS"\nexit 99\n', {
    mode: 0o700,
  });
  const env = {
    ...process.env,
    PATH: `${join(dir, 'bin')}:${process.env.PATH}`,
    TEST_EVENTS: join(dir, 'events'),
    VULTR_PASSWORD: 'synthetic-credential-never-print',
    HOLADAY_TARGET_CONFIG_SHA256: 'e'.repeat(64),
    HOLADAY_MIGRATION_MANIFEST_SHA256: 'f'.repeat(64),
    HOLADAY_HOST_INVENTORY_SHA256: '9'.repeat(64),
    DEPLOY_REMOTE_RETRIES: '1',
    DEPLOY_REMOTE_RETRY_SLEEP: '0',
    CN_PAYMENT_PREFLIGHT_VERIFIED: '1',
    PAYPAL_PREFLIGHT_VERIFIED: '1',
  };
  const run = (mode, args = ['codex/release', 'c'.repeat(40)], extraEnv = {}) =>
    spawnSync('bash', [join(dir, 'scripts/deploy-orchestrator.sh'), ...args], {
      encoding: 'utf8',
      env: { ...env, TEST_CASE: mode, ...extraEnv },
      timeout: 10000,
    });
  const events = async () => {
    try {
      return (await readFile(env.TEST_EVENTS, 'utf8')).trim().split('\n');
    } catch (e) {
      if (e.code === 'ENOENT') return [];
      throw e;
    }
  };
  return { run, events };
}
for (const mode of ['legacy', 'timeout', 'malformed'])
  test(`${mode} capability refuses before upload/build/migration/stop`, async (t) => {
    const f = await fixture(t);
    const result = f.run(mode);
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /LEGACY_DRAIN_UNSUPPORTED/);
    assert.deepEqual(await f.events(), ['akshare', 'probe']);
    assert.doesNotMatch(result.stdout + result.stderr, /synthetic-credential-never-print/);
  });
test('exact target is required before loading credentials or connecting', async (t) => {
  const f = await fixture(t);
  const result = f.run('success', ['codex/release']);
  assert.equal(result.status, 1);
  assert.deepEqual(await f.events(), []);
});
test('missing inventory binding refuses before any SSH command', async (t) => {
  const f = await fixture(t);
  const result = f.run('success', undefined, { HOLADAY_HOST_INVENTORY_SHA256: '' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /MAINTENANCE_MANIFEST_REQUIRED/);
  assert.deepEqual(await f.events(), []);
});
test('successful capability dispatches exactly one fully bound release', async (t) => {
  const f = await fixture(t);
  const result = f.run('success');
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(await f.events(), ['akshare', 'probe', 'release']);
  assert.match(result.stdout, /MAINTENANCE_RELEASE_OPENED/);
});
test('uncertain release is never retried or replaced by legacy rollback', async (t) => {
  const f = await fixture(t);
  const result = f.run('release-failed');
  assert.equal(result.status, 1);
  assert.deepEqual(await f.events(), ['akshare', 'probe', 'release']);
  assert.match(result.stderr, /MAINTENANCE_RELEASE_INCOMPLETE_INSPECT_PHASE/);
});

test('stock gate failure refuses before capability probe or release',async(t)=>{
 const f=await fixture(t);const result=f.run('akshare-failed');
 assert.equal(result.status,1);assert.match(result.stderr,/AKSHARE_GATE_FAILED/);
 assert.deepEqual(await f.events(),['akshare']);
});
