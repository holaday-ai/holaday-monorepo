// Actual fixed entry, protected files, Git objects and /proc in disposable QA.
// No production credentials, host PID namespace, external network or services.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';

await fs.access('/.dockerenv');
assert.equal(process.getuid(), 0);
const modules = [
  'browser-backup-age.mjs',
  'browser-cutover-evidence.mjs',
  'browser-first-cutover-backup.mjs',
  'browser-first-cutover-fence.mjs',
  'browser-first-cutover-host.mjs',
  'browser-first-cutover-ingress-files.mjs',
  'browser-first-cutover-ingress-session.mjs',
  'browser-first-cutover-inventory.mjs',
  'browser-first-cutover-nginx.mjs',
  'browser-first-cutover-runtime.mjs',
  'browser-maintenance-host.mjs',
  'browser-maintenance-journal.mjs',
  'browser-maintenance-linux.mjs',
  'browser-maintenance-manifest.mjs',
  'browser-maintenance-policy.mjs',
  'browser-maintenance-release-tail.mjs',
  'browser-maintenance-runtime-system.mjs',
  'browser-maintenance-runtime.mjs',
  'browser-maintenance-transition.mjs',
  'browser-payment-port-fence.mjs',
];
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const repo = '/opt/holaday-monorepo';
const run = (file, args, options = {}) => {
  const result = spawnSync(file, args, { encoding: 'utf8', cwd: '/', timeout: 30000, ...options });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
};
await fs.mkdir(`${repo}/scripts`, { recursive: true });
await fs.mkdir(`${repo}/ops/aliyun-edge`, { recursive: true });
const files = {};
for (const name of modules) {
  const bytes = await fs.readFile(`/source/${name}`);
  await fs.writeFile(`${repo}/scripts/${name}`, bytes);
  files[name] = hash(bytes);
}
const policy = await fs.readFile('/ops/aliyun-edge/holaday-payment-ingress.nft');
await fs.writeFile(`${repo}/ops/aliyun-edge/holaday-payment-ingress.nft`, policy);
const git = (...args) => run('git', ['-C', repo, ...args]);
git('init', '--quiet');
git('add', 'scripts', 'ops');
git(
  '-c',
  'user.name=Cutover QA',
  '-c',
  'user.email=qa@invalid',
  'commit',
  '--quiet',
  '-m',
  'synthetic candidate',
);
const candidate = git('rev-parse', 'HEAD').trim();
git('update-ref', 'refs/remotes/origin/codex/qa', candidate);
const base = '/var/lib/holaday-deploy/first-cutover';
await fs.mkdir(base, { recursive: true, mode: 0o700 });
const folder = `${base}/${candidate}`;
await fs.mkdir(folder, { mode: 0o700 });
for (const name of modules)
  await fs.writeFile(`${folder}/${name}`, await fs.readFile(`/source/${name}`), { mode: 0o600 });
await fs.writeFile(
  `${folder}/bundle.json`,
  JSON.stringify({ schemaVersion: 1, candidate, files }),
  { mode: 0o600 },
);
await fs.mkdir(`${base}/ops`, { mode: 0o700 });
await fs.mkdir(`${base}/ops/aliyun-edge`, { mode: 0o700 });
const policyPath = `${base}/ops/aliyun-edge/holaday-payment-ingress.nft`;
await fs.writeFile(policyPath, policy, { mode: 0o600 });
const directory = '/var/lib/holaday-deploy/maintenance';
await fs.mkdir(directory, { mode: 0o700 });
const attempt = '12345678-1234-4234-8234-123456789abc';
const approval = {
  schemaVersion: 1,
  kind: 'first-cutover',
  attempt,
  candidate,
  branch: 'codex/qa',
  configDigest: 'b'.repeat(64),
  migrationDigest: 'c'.repeat(64),
  inventoryDigest: 'd'.repeat(64),
  legacyDigest: 'e'.repeat(64),
  maintenanceEndsAtMs: Date.now() + 60000,
  reconcileByMs: Date.now() + 120000,
  operatorRef: 'qa-fixture',
};
const approvalPath = `${directory}/first-cutover-approved.json`;
await fs.writeFile(approvalPath, JSON.stringify(approval), { mode: 0o600 });
const entry = `${folder}/browser-first-cutover-host.mjs`;
const inspect = () => run('/opt/node22/bin/node', [entry, '--check', attempt]);
const checked = JSON.parse(inspect());
assert.equal(checked.kind, 'coordinator-source-inspection');
assert.equal(checked.candidate, candidate);
assert.equal(checked.releaseReady, false);
assert.match(checked.toolDigest, /^[a-f0-9]{64}$/);
const denied = (args = [entry, '--check', attempt], options = {}) => {
  const result = spawnSync('/opt/node22/bin/node', args, {
    encoding: 'utf8',
    cwd: '/',
    timeout: 30000,
    ...options,
  });
  assert.equal(result.error, undefined);
  assert.notEqual(result.status, 0);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /CUTOVER_COORDINATOR_/);
};
denied([entry, '--execute', attempt]);
denied([entry]);
denied(undefined, { cwd: '/tmp' });
await fs.chmod(approvalPath, 0o644);
denied();
await fs.chmod(approvalPath, 0o600);
await fs.writeFile(policyPath, 'changed policy');
denied();
await fs.writeFile(policyPath, policy);
// Valid JS and matching bundle hash still cannot impersonate candidate Git bytes.
const altered = `${folder}/browser-maintenance-policy.mjs`;
const original = await fs.readFile(altered);
const changed = Buffer.concat([original, Buffer.from('\n// unexpected tool change\n')]);
await fs.writeFile(altered, changed);
files['browser-maintenance-policy.mjs'] = hash(changed);
await fs.writeFile(`${folder}/bundle.json`, JSON.stringify({ schemaVersion: 1, candidate, files }));
denied();
assert.deepEqual((await fs.readdir(directory)).sort(), ['first-cutover-approved.json']);
console.log(
  JSON.stringify({
    fixedEntry: 'passed',
    actualProc: 'passed',
    candidateGitBytes: 'passed',
    changedToolAndManifest: 'denied',
    policyDrift: 'denied',
    execute: 'unavailable',
    journalOrServiceWrites: false,
    releaseReady: false,
  }),
);
