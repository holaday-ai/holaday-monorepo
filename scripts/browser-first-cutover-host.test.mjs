import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { readFirstCutoverApproval } from './browser-first-cutover-host.mjs';
import * as firstHost from './browser-first-cutover-host.mjs';
import { acquireReleaseJournal } from './browser-maintenance-journal.mjs';

const root = '/var/lib/holaday-deploy/maintenance';
const path = `${root}/first-cutover-approved.json`;
const approved = {
  schemaVersion: 1,
  kind: 'first-cutover',
  attempt: '12345678-1234-4234-8234-123456789abc',
  branch: 'codex/browser-release-candidate-20260925',
  candidate: 'a'.repeat(40),
  configDigest: 'b'.repeat(64),
  migrationDigest: 'c'.repeat(64),
  inventoryDigest: 'd'.repeat(64),
  legacyDigest: 'e'.repeat(64),
  maintenanceEndsAtMs: 2000,
  reconcileByMs: 3000,
  operatorRef: 'qa-operator',
};

async function preparationFixture(t) {
  const config = Buffer.from('SYNTHETIC_ONLY=1\n');
  const migrationManifest = { replaysNumberedSql: true };
  const approval = {
    ...approved,
    configDigest: createHash('sha256').update(config).digest('hex'),
    migrationDigest: createHash('sha256').update(JSON.stringify(migrationManifest)).digest('hex'),
  };
  const f = await fixture(t, approval);
  const events = [];
  const sourceCandidate = 'f'.repeat(40);
  let journal;
  let liveApproval = approval;
  let time = 1000;
  const io = {
    platform: 'linux',
    uid: 0,
    now: () => time,
    readApproval: async (options) => {
      events.push('approval');
      assert.deepEqual(options, { attempt: approved.attempt });
      return {
        ...liveApproval,
        approvalDigest: createHash('sha256').update(JSON.stringify(liveApproval)).digest('hex'),
      };
    },
    inspectLegacySource: async () => ({
      sourceCandidate,
      legacyDigest: approved.legacyDigest,
      observedAtMs: 1000,
    }),
    readConfig: async () => config,
    parseConfig: () => ({
      MODEL_RUNTIME_POLICY: 'qwen_only',
      QWEN_CORE_ROLLOUT_MODE: 'off',
      QWEN_CORE_ENABLED_LANES: 'browser',
      DASHSCOPE_INTL_API_KEY: 'synthetic',
      DASHSCOPE_INTL_ANTHROPIC_BASE_URL: 'https://example.invalid/anthropic',
      DASHSCOPE_INTL_RESPONSES_BASE_URL: 'https://example.invalid/responses',
      TEAM_TASK_LIFECYCLE_ENABLED: 'false',
      ACCOUNT_CLOSURE_WORKER_ENABLED: 'false',
    }),
    targetAbsent: async () => events.push('absent'),
    journal: async (path, metadata) => {
      assert.equal(path, root);
      assert.equal(metadata.kind, 'first-cutover');
      assert.equal(metadata.oldIdentity, undefined);
      events.push('lock');
      journal = await acquireReleaseJournal(f.directory, metadata);
      return journal;
    },
    manifest: () => ({ sha256: approval.migrationDigest, manifest: migrationManifest }),
    stageConfig: async () => events.push('config'),
    exec: async (command, args) => {
      events.push([command, ...args].join(' '));
      if (command === 'id') return '998\n';
      if (command === 'git' && args.includes('get-url'))
        return 'https://example.invalid/repo.git\n';
      if (command === 'git' && args.includes('rev-parse')) return `${approved.candidate}\n`;
      return '';
    },
  };
  t.after(async () => {
    await journal?.close();
  });
  return {
    ...f,
    approvalFileIo: f.io,
    io,
    events,
    approval,
    sourceCandidate,
    setTime: (value) => {
      time = value;
    },
    changeApproval: (change) => {
      liveApproval = { ...liveApproval, ...change };
    },
  };
}

test('first preparation binds a real reserved journal and stages without fabricating an old boot or stopping services', async (t) => {
  assert.equal(typeof firstHost.prepareFirstCutoverCandidate, 'function');
  const f = await preparationFixture(t);
  f.io.readApproval = (options) => readFirstCutoverApproval(options, f.approvalFileIo);
  const prepared = await firstHost.prepareFirstCutoverCandidate(
    { attempt: approved.attempt },
    f.io,
  );
  assert.equal(prepared.root, `/opt/holaday-releases/${approved.candidate}`);
  assert.equal(prepared.sourceCandidate, f.sourceCandidate);
  const held = await prepared.journal.assertOwnership();
  assert.equal(held.attempt, approved.attempt);
  assert.equal(held.oldIdentity, undefined);
  const record = JSON.parse(
    await fs.readFile(join(f.directory, `${approved.attempt}.json`), 'utf8'),
  );
  assert.equal(record.phase, 'preflight');
  assert.equal(record.kind, 'first-cutover');
  assert.ok(record.migrationManifest);
  assert.ok(f.events.indexOf('lock') < f.events.findIndex((e) => e.startsWith('git clone')));
  assert.ok(!f.events.some((e) => /pm2|nginx|db:migrate|control\.mjs/.test(e)));
  await assert.rejects(
    acquireReleaseJournal(f.directory, {
      candidate: approved.candidate,
      configDigest: f.approval.configDigest,
      migrationDigest: approved.migrationDigest,
      oldIdentity: { candidate: f.sourceCandidate, bootId: '1'.repeat(32) },
    }),
    /MAINTENANCE_RELEASE_LOCKED/,
  );
});

for (const fault of [
  'missing-observer',
  'source-drift',
  'source-stale',
  'source-commit',
  'config',
  'policy',
  'existing-target',
]) {
  test(`first preparation rejects ${fault} before acquiring a journal or staging`, async (t) => {
    assert.equal(typeof firstHost.prepareFirstCutoverCandidate, 'function');
    const f = await preparationFixture(t);
    if (fault === 'missing-observer') f.io.inspectLegacySource = undefined;
    if (fault === 'source-drift')
      f.io.inspectLegacySource = async () => ({
        sourceCandidate: f.sourceCandidate,
        legacyDigest: '0'.repeat(64),
        observedAtMs: 1000,
      });
    if (fault === 'source-stale') {
      f.io.now = () => 100000;
      f.changeApproval({ maintenanceEndsAtMs: 200000, reconcileByMs: 300000 });
    }
    if (fault === 'source-commit')
      f.io.inspectLegacySource = async () => ({
        sourceCandidate: 'HEAD',
        legacyDigest: approved.legacyDigest,
        observedAtMs: 1000,
      });
    if (fault === 'config') f.io.readConfig = async () => Buffer.from('WRONG=1');
    if (fault === 'policy') f.io.parseConfig = () => ({ MODEL_RUNTIME_POLICY: 'legacy' });
    if (fault === 'existing-target')
      f.io.targetAbsent = async () => {
        throw new Error('MAINTENANCE_TARGET_EXISTS');
      };
    await assert.rejects(
      firstHost.prepareFirstCutoverCandidate({ attempt: approved.attempt }, f.io),
    );
    assert.ok(!f.events.includes('lock'));
    assert.ok(!f.events.some((e) => e.startsWith('git clone')));
  });
}

for (const fault of ['approval-drift', 'expired-after-build', 'clock-rollback', 'build-failure']) {
  test(`first preparation ${fault} preserves the incomplete lock and never proceeds to services`, async (t) => {
    assert.equal(typeof firstHost.prepareFirstCutoverCandidate, 'function');
    const f = await preparationFixture(t);
    const exec = f.io.exec;
    f.io.exec = async (command, args) => {
      const result = await exec(command, args);
      if (args.includes('build')) {
        if (fault === 'approval-drift') f.changeApproval({ operatorRef: 'changed' });
        if (fault === 'expired-after-build') f.setTime(2000);
        if (fault === 'clock-rollback') f.setTime(999);
        if (fault === 'build-failure') throw new Error('synthetic failure');
      }
      return result;
    };
    await assert.rejects(
      firstHost.prepareFirstCutoverCandidate({ attempt: approved.attempt }, f.io),
    );
    assert.ok(f.events.includes('lock'));
    await fs.stat(join(f.directory, 'release.lock'));
    const record = JSON.parse(
      await fs.readFile(join(f.directory, `${approved.attempt}.json`), 'utf8'),
    );
    assert.equal(record.phase, 'preflight');
    assert.ok(!record.migrationManifest);
    assert.ok(!f.events.some((e) => /pm2|nginx|db:migrate|control\.mjs/.test(e)));
  });
}
async function fixture(t, record = approved) {
  const directory = await fs.realpath(await fs.mkdtemp(join(tmpdir(), 'holaday-approved-input-')));
  await fs.chmod(directory, 0o700);
  const file = join(directory, 'first-cutover-approved.json');
  const bytes = `${JSON.stringify(record)}\n`;
  await fs.writeFile(file, bytes, { mode: 0o600 });
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const map = (p) => {
    assert.ok(p === root || p === path, `unexpected read ${p}`);
    return p === root ? directory : file;
  };
  // Real files exercise inode, mode, hardlink, symlink and read-race behavior.
  // Only the root UID is synthetic on macOS; no production paths are opened.
  const rootStat = (s) => Object.assign(s, { uid: 0 });
  const io = {
    platform: 'linux',
    uid: 0,
    now: () => 1000,
    lstat: async (p) => rootStat(await fs.lstat(map(p))),
    realpath: async (p) => ((await fs.realpath(map(p))) === map(p) ? p : 'not-canonical'),
    open: async (p, flags) => {
      const handle = await fs.open(map(p), flags);
      return {
        stat: async () => rootStat(await handle.stat()),
        readFile: () => handle.readFile(),
        close: () => handle.close(),
      };
    },
  };
  return { io, file, directory, bytes };
}
test('reads only the protected first-cutover manifest and returns its exact content binding', async (t) => {
  const f = await fixture(t);
  const result = await readFirstCutoverApproval({ attempt: approved.attempt }, f.io);
  assert.deepEqual(result, {
    ...approved,
    approvalDigest: createHash('sha256').update(f.bytes).digest('hex'),
  });
});
test('no CLI-selected path, foreign attempt or non-root/non-Linux reader can authorize cutover', async (t) => {
  const f = await fixture(t);
  for (const [options, io] of [
    [{ attempt: approved.attempt, path: '/tmp/approved.json' }, f.io],
    [{ attempt: '22345678-1234-4234-8234-123456789abc' }, f.io],
    [{ attempt: approved.attempt }, { ...f.io, platform: 'darwin' }],
    [{ attempt: approved.attempt }, { ...f.io, uid: 998 }],
  ])
    await assert.rejects(readFirstCutoverApproval(options, io), /CUTOVER_APPROVAL_UNPROVEN/);
});
for (const kind of [
  'symlink',
  'hardlink',
  'writable',
  'public-directory',
  'wrong-owner',
  'replacement',
  'clock-rollback',
  'expired',
  'oversize',
]) {
  test(`approval rejects ${kind} rather than accepting unchecked bytes`, async (t) => {
    const f = await fixture(t);
    if (kind === 'symlink') {
      await fs.rename(f.file, `${f.file}.real`);
      await fs.symlink(`${f.file}.real`, f.file);
    }
    if (kind === 'hardlink') await fs.link(f.file, `${f.file}.link`);
    if (kind === 'writable') await fs.chmod(f.file, 0o660);
    if (kind === 'public-directory') await fs.chmod(f.directory, 0o755);
    if (kind === 'wrong-owner') {
      const stat = f.io.lstat;
      f.io.lstat = async (p) => Object.assign(await stat(p), { uid: 998 });
    }
    if (kind === 'replacement') {
      const open = f.io.open;
      f.io.open = async (...args) => {
        const handle = await open(...args);
        const read = handle.readFile;
        handle.readFile = async () => {
          const bytes = await read();
          await fs.rename(f.file, `${f.file}.old`);
          await fs.writeFile(f.file, bytes, { mode: 0o600 });
          return bytes;
        };
        return handle;
      };
    }
    if (kind === 'clock-rollback') {
      let now = 1000;
      f.io.now = () => --now;
    }
    if (kind === 'expired') f.io.now = () => 2000;
    if (kind === 'oversize') await fs.writeFile(f.file, 'x'.repeat(65537));
    await assert.rejects(
      readFirstCutoverApproval({ attempt: approved.attempt }, f.io),
      /CUTOVER_APPROVAL_UNPROVEN/,
    );
  });
}
test('malformed or extra approval fields cannot silently widen the operation', async (t) => {
  for (const change of [
    { kind: 'normal-release' },
    { candidate: 'HEAD' },
    { branch: '--all' },
    { inventoryDigest: null },
    { legacyDigest: 'unknown' },
    { reconcileByMs: 1999 },
    { operatorRef: '' },
    { skipPayments: true },
  ]) {
    const f = await fixture(t, { ...approved, ...change });
    await assert.rejects(
      readFirstCutoverApproval({ attempt: approved.attempt }, f.io),
      /CUTOVER_APPROVAL_UNPROVEN/,
    );
  }
});
