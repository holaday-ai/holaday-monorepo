import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const candidate = 'c'.repeat(40);
const attempt = '12345678-1234-4234-8234-123456789abc';
async function fixture(t) {
  const root = await fs.mkdtemp(join(tmpdir(), 'holaday-first-entry-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(join(root, 'scripts'));
  await fs.mkdir(join(root, 'bin'));
  await fs.copyFile(
    new URL('./deploy-browser-first-cutover.sh', import.meta.url),
    join(root, 'scripts/entry.sh'),
  );
  await fs.writeFile(
    join(root, 'scripts/load-deploy-env.sh'),
    'echo credentials >> "$TEST_EVENTS"\n',
  );
  await fs.writeFile(
    join(root, 'scripts/ssh-password-auth.sh'),
    'build_ssh_password_prefix() { SSH_PASSWORD_PREFIX=(env); }\n',
  );
  await fs.writeFile(
    join(root, 'bin/ssh'),
    `#!${process.execPath}
const fs=require('node:fs');
fs.appendFileSync(process.env.TEST_EVENTS,JSON.stringify(process.argv.slice(2))+'\\n');
if(process.env.TEST_CASE==='failed')process.exit(44);
const value={kind:'coordinator-source-inspection',candidate:'c'.repeat(40),toolDigest:'d'.repeat(64),releaseReady:false};
if(process.env.TEST_CASE==='false-ready')value.releaseReady=true;
if(process.env.TEST_CASE==='wrong-candidate')value.candidate='a'.repeat(40);
if(process.env.TEST_CASE==='malformed'){console.log('not-json');process.exit(0);}
console.log(JSON.stringify(value));
`,
    { mode: 0o700 },
  );
  return {
    run: (args = [candidate, attempt], mode = 'success') =>
      spawnSync('bash', [join(root, 'scripts/entry.sh'), ...args], {
        encoding: 'utf8',
        timeout: 10000,
        env: {
          ...process.env,
          PATH: `${join(root, 'bin')}:${process.env.PATH}`,
          TEST_EVENTS: join(root, 'events'),
          TEST_CASE: mode,
          VULTR_PASSWORD: 'synthetic-never-print',
        },
      }),
    events: async () => {
      try {
        return (await fs.readFile(join(root, 'events'), 'utf8')).trim().split('\n');
      } catch (e) {
        if (e.code === 'ENOENT') return [];
        throw e;
      }
    },
  };
}
for (const args of [
  [],
  [candidate],
  [`${candidate};id`, attempt],
  [candidate, 'invalid'],
  [candidate, attempt, '--execute'],
  [candidate, attempt, '--pid', '910'],
]) {
  test(`first entry refuses unsupported target before credentials or SSH: ${args.join(' ')}`, async (t) => {
    const f = await fixture(t);
    const r = f.run(args);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /CUTOVER_COORDINATOR_(USAGE|SITE_UNAVAILABLE)/);
    assert.deepEqual(await f.events(), []);
  });
}
test('first entry defaults to one fixed read-only check and never claims deployment', async (t) => {
  const f = await fixture(t);
  const r = f.run();
  assert.equal(r.status, 0, r.stderr);
  const [credentials, ...events] = await f.events();
  assert.equal(credentials, 'credentials');
  assert.equal(events.length, 1);
  const args = JSON.parse(events[0]);
  assert(args.includes('StrictHostKeyChecking=yes'));
  assert(args.includes('ForwardAgent=no'));
  assert.equal(args.at(-2), 'root@207.148.70.106');
  assert.equal(
    args.at(-1),
    `cd / && env -i PATH=/opt/node22/bin:/usr/bin:/bin /opt/node22/bin/node '/var/lib/holaday-deploy/first-cutover/${candidate}/browser-first-cutover-host.mjs' --check '${attempt}'`,
  );
  assert.equal(JSON.parse(r.stdout).releaseReady, false);
  assert.doesNotMatch(r.stdout + r.stderr, /synthetic-never-print/);
});
for (const mode of ['failed', 'malformed', 'false-ready', 'wrong-candidate']) {
  test(`first entry ${mode} is not retried or called success`, async (t) => {
    const f = await fixture(t);
    const r = f.run(undefined, mode);
    assert.notEqual(r.status, 0);
    assert.equal(r.stdout, '');
    assert.equal((await f.events()).length, 2);
    assert.match(r.stderr, /CUTOVER_COORDINATOR_CHECK_UNPROVEN/);
  });
}
