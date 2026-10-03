import { createHash } from 'node:crypto';
const requireHash = (bytes) => createHash('sha256').update(bytes).digest('hex');
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { tmpdir } from 'node:os';
test('QA diagnostics persist only bounded private whitelisted metadata across chunks', () => {
  const source = fs.readFileSync(
    new URL('./fixtures/browser-recovery-target-qa.mjs', import.meta.url),
    'utf8',
  );
  const start = source.indexOf('const safeDiagnosticPath =');
  const end = source.indexOf('const child =', start);
  assert.ok(start > 0 && end > start);
  const directory = fs.mkdtempSync(join(tmpdir(), 'holaday-safe-diagnostic-contract-'));
  const api = new Function(
    'directory',
    'join',
    'openSync',
    'writeSync',
    'fsyncSync',
    source.slice(start, end) +
      '\nreturn {safeLine,persistSafeDiagnostics,fd:safeDiagnosticFd,path:safeDiagnosticPath,state:()=>({bytes:safeDiagnosticBytes,failed:safeDiagnosticFailed})};',
  )(directory, join, fs.openSync, fs.writeSync, fs.fsyncSync);
  assert.equal(fs.statSync(api.path).mode & 0o777, 0o600);
  const good = 'QA_BACKUP_STAGE source-snapshot start';
  assert.ok(api.safeLine(good));
  assert.ok(api.safeLine('QA_INGRESS_REJECTION {"component":"pair","stage":"PAIR_REVISION"}'));
  assert.equal(api.safeLine('QA_INGRESS_REJECTION {"component":"pair","stage":"/SECRET"}'), false);
  assert.equal(
    api.safeLine(
      'QA_INGRESS_REJECTION {"component":"pair","stage":"PAIR_ENTRY","message":"SECRET"}',
    ),
    false,
  );
  assert.ok(
    api.safeLine(
      'QA_RECOVERY_REJECTION {"component":"server","stage":"RECOVERY_SERVER_SCOPE_READ"}',
    ),
  );
  assert.ok(api.safeLine('QA_RECOVERY_REJECTION {"component":"client","stage":"PAIR_REVISION"}'));
  assert.equal(
    api.safeLine('QA_RECOVERY_REJECTION {"component":"server","stage":"SECRET"}'),
    false,
  );
  assert.equal(
    api.safeLine(
      'QA_RECOVERY_REJECTION {"component":"server","stage":"RECOVERY_SERVER_SCOPE_READ","message":"SECRET"}',
    ),
    false,
  );
  assert.equal(
    api.safeLine(
      'QA_RECOVERY_REJECTION {"component":"server","stage":["RECOVERY_SERVER_SCOPE_READ"]}',
    ),
    false,
  );
  const newStages = [
    'PORT_OUTPUT_LIMIT',
    'PORT_TERMINATED',
    'PORT_EXIT',
    'PORT_START',
    'PORT_STDIN',

    'PORT_INPUT',
    'PORT_CLOCK',
    'PORT_DEADLINE',
    'PORT_OWNER',
    'PORT_RECEIPT',
    'PORT_COMMAND',
    'PORT_JSON',
    'PORT_SHAPE',
    'PORT_RULES',
    'PORT_EXISTING',
    'PORT_POLICY',

    'FENCE_CONTEXT',
    'FENCE_RECEIPT',
    'FENCE_PORTS_BEFORE',
    'FENCE_CONFIG',
    'FENCE_PROBE',
    'FENCE_RESULT',
    'FENCE_TARGETS',
    'FENCE_ROUTE',
    'FENCE_STATUS',
    'FENCE_WRITERS',
    'FENCE_PORTS_AFTER',
    'PROBE_ENTRY',
    'PROBE_CLOCK',
    'PROBE_WRITER_READ',
    'PROBE_WRITER_SHAPE',
    'PROBE_TIMEOUT',
    'PROBE_REQUEST',
    'PROBE_RESPONSE',
    'PROBE_BODY',
    'PROBE_UPGRADE',
    'PROBE_SETTLED',
    'PROBE_WRITER_DRIFT',
  ];
  newStages.push(
    'APPROVAL_INPUT',
    'APPROVAL_CLOCK',
    'APPROVAL_DEADLINE',
    'APPROVAL_FOLDER',
    'APPROVAL_FILE',
    'APPROVAL_CONTENT',
    'APPROVAL_CHANGED',
    'APPROVAL_JSON',
    'APPROVAL_BINDING',
    'APPROVAL_RISK',
    'SITE_APPROVAL_BEFORE',
    'SITE_FOLDER',
    'SITE_FILE',
    'SITE_CONTENT',
    'SITE_JSON',
    'SITE_SHAPE',
    'SITE_APPROVAL_AFTER',
    'SITE_CLOCK',
    'SITE_VALIDATE',
    'RECOVERY_SITE_SOURCE_SHAPE',
    'RECOVERY_SITE_SOURCE_DRIFT',
  );
  for (const stage of newStages) {
    for (const component of ['client', 'server']) {
      assert.ok(api.safeLine('QA_RECOVERY_REJECTION ' + JSON.stringify({ component, stage })));
      assert.equal(
        api.safeLine('QA_RECOVERY_REJECTION ' + JSON.stringify({ component, stage: [stage] })),
        false,
      );
      assert.equal(
        api.safeLine(
          'QA_RECOVERY_REJECTION ' + JSON.stringify({ component, stage, raw: 'PRIVATE' }),
        ),
        false,
      );
    }
    for (const component of ['pair', 'receiver']) {
      const line = 'QA_INGRESS_REJECTION ' + JSON.stringify({ component, stage });
      assert.ok(api.safeLine(line));
      assert.equal(
        api.safeLine('QA_INGRESS_REJECTION ' + JSON.stringify({ component, stage: [stage] })),
        false,
      );
      assert.equal(
        api.safeLine('QA_INGRESS_REJECTION ' + JSON.stringify({ component, stage, raw: 'SECRET' })),
        false,
      );
    }
  }
  assert.equal(
    api.safeLine('QA_INGRESS_REJECTION {"component":"receiver","stage":"PROBE_UNKNOWN"}'),
    false,
  );
  for (const bad of [
    'raw SECRET business-row',
    'QA_BACKUP_STAGE source-snapshot start SECRET',
    'QA_CGROUP_MEMORY_STATE source-snapshot-start {"env":"SECRET"}',
    'QA_CGROUP_MEMORY_STATE source-snapshot-start {"events":{"SECRET":1}}',
    'QA_INGRESS_CHILD_EXIT {"code":0,"signal":null,"env":"SECRET"}',
    'QA_INGRESS_CHILD_EXIT {"code":256,"signal":null}',
  ])
    assert.equal(api.safeLine(bad), false);
  api.persistSafeDiagnostics(Buffer.from('raw SECRET\n' + good.slice(0, 10)));
  api.persistSafeDiagnostics(Buffer.from(good.slice(10) + '\n'));
  assert.equal(fs.readFileSync(api.path, 'utf8'), good + '\n');
  api.persistSafeDiagnostics(Buffer.from((good + '\n').repeat(3000)));
  assert.equal(api.state().failed, true);
  assert.ok(api.state().bytes <= 65536);
  const saved = fs.readFileSync(api.path, 'utf8');
  assert.ok(!saved.includes('SECRET'));
  assert.ok(
    saved
      .split('\n')
      .filter(Boolean)
      .every((v) => v === good),
  );
  fs.closeSync(api.fd);
  fs.rmSync(directory, { recursive: true, force: true });
});

test('late failure QA checks both mapped approved startup files and isolates Aliyun dump', async (t) => {
  const source = fs.readFileSync(
    new URL('./fixtures/browser-registration-removal-linux.mjs', import.meta.url),
    'utf8',
  );
  const start = source.indexOf(
    '          const durable = effects;',
    source.indexOf('effects.candidateStartupEvents !== undefined'),
  );
  const end = source.indexOf('          // Do not resurrect', start);
  assert.ok(start > 0 && end > start);
  const directory = fs.mkdtempSync(join(tmpdir(), 'holaday-mapped-startup-contract-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const vultrStartupRoot = join(directory, 'vultr'),
    vultrArchive = join(directory, 'archive');
  fs.mkdirSync(vultrStartupRoot);
  const mapping = source.slice(
    source.indexOf('  const startupMappings ='),
    source.indexOf('  const startupFs ='),
  );
  const mapStartup = new Function(
    'vultrStartupRoot',
    'vultrArchive',
    mapping + ';return mapStartup;',
  )(vultrStartupRoot, vultrArchive);
  const root = '/opt/holaday-releases/' + 'a'.repeat(40);
  const entries = [
    { name: 'qa-unrelated' },
    {
      name: 'holaday-orchestrator',
      pm_cwd: root + '/apps/orchestrator',
      autorestart: false,
      uid: 998,
    },
    {
      name: 'holaday-account-closure-worker',
      pm_cwd: root + '/apps/orchestrator',
      autorestart: false,
      uid: 998,
    },
  ];
  const sha = (bytes) => requireHash(bytes);
  const files = ['dump.pm2', 'dump.pm2.bak'].map((name) => ({ path: '/root/.pm2/' + name }));
  const effects = {
    candidateStartupEvents: [
      {},
      { files: files.map((f) => ({ path: f.path, afterDigest: sha(JSON.stringify(entries)) })) },
    ],
  };
  for (const f of files) fs.writeFileSync(mapStartup(f.path), JSON.stringify(entries));
  const aliyun = join(directory, 'aliyun.json');
  fs.writeFileSync(aliyun, JSON.stringify([{ name: 'qa-unrelated' }]));
  const io = {
    readFile: (p, ...args) =>
      fs.promises.readFile(p === '/root/.pm2/dump.pm2' ? aliyun : p, ...args),
  };
  const run = new Function(
    'vultrStartupFiles',
    'effects',
    'fs',
    'mapStartup',
    'sha',
    'siteContext',
    'enabledWorker',
    'assert',
    'return (async()=>{' + source.slice(start, end) + '})();',
  );
  await run(files, effects, io, mapStartup, sha, { root }, true, assert);
  for (const f of files) {
    const original = fs.readFileSync(mapStartup(f.path));
    fs.writeFileSync(mapStartup(f.path), '[]');
    await assert.rejects(run(files, effects, io, mapStartup, sha, { root }, true, assert));
    fs.writeFileSync(mapStartup(f.path), original);
  }
  fs.writeFileSync(aliyun, JSON.stringify(entries));
  await assert.rejects(run(files, effects, io, mapStartup, sha, { root }, true, assert));
});
test('after-worker QA summary chooses failure semantics ahead of enabled-worker success', () => {
  const source = fs.readFileSync(
    new URL('./fixtures/browser-recovery-target-qa.mjs', import.meta.url),
    'utf8',
  );
  const start = source.indexOf('  console.log(\n    enabledWorker');
  const end = source.indexOf('\n  );', start);
  assert.ok(start > 0 && end > start);
  const summary = new Function(
    'enabledWorker',
    'hostFault',
    'lostOpenAck',
    'lateKnownEffect',
    'successfulCutover',
    'stoppedSource',
    'recoveryDrift',
    'console',
    source.slice(start, end + 6),
  );
  let actual;
  const console = { log: (value) => (actual = value) };
  summary(true, 'after-worker', false, false, false, false, false, console);
  assert.match(actual, /enabled UID998 worker poll/);
  assert.match(actual, /lock retained/);
  assert.doesNotMatch(actual, /lock released|no close|disabled-worker/);
  summary(false, 'after-worker', false, false, false, false, false, console);
  assert.match(actual, /disabled-worker verification/);
  assert.match(actual, /lock retained/);
  assert.doesNotMatch(actual, /enabled UID998|lock released/);
  summary(true, '', false, false, true, false, false, console);
  assert.match(actual, /lock released/);
});

test('late known QA persists only fixed discovery and inner refusal markers', (t) => {
  const source = fs.readFileSync(
    new URL('./fixtures/browser-recovery-target-qa.mjs', import.meta.url),
    'utf8',
  );
  const start = source.indexOf('const safeDiagnosticPath ='),
    end = source.indexOf('const child =', start);
  const directory = fs.mkdtempSync(join(tmpdir(), 'holaday-late-known-filter-'));
  const api = new Function(
    'directory',
    'join',
    'openSync',
    'writeSync',
    'fsyncSync',
    source.slice(start, end) + ';return {safeLine,fd:safeDiagnosticFd};',
  )(directory, join, fs.openSync, fs.writeSync, fs.fsyncSync);
  t.after(() => {
    fs.closeSync(api.fd);
    fs.rmSync(directory, { recursive: true, force: true });
  });
  for (const marker of [
    'QA_LATE_KNOWN_OBSERVED',
    'QA_LATE_KNOWN_REJECTED CUTOVER_KNOWN_EXTERNAL_WORK_UNPROVEN',
  ]) {
    assert.ok(api.safeLine(marker));
    assert.equal(api.safeLine(marker + ' SECRET'), false);
  }
  assert.equal(api.safeLine('QA_LATE_KNOWN_REJECTED CUTOVER_SITE_UNPROVEN'), false);
});

test('actual late-known QA checkOwned emits refusal only after original bound serving checks', async (t) => {
  const source = fs.readFileSync(
    new URL('./fixtures/browser-registration-removal-linux.mjs', import.meta.url),
    'utf8',
  );
  const start = source.indexOf('                  const checkOwned = async () => {'),
    end = source.indexOf('                  const before = await checkOwned();', start);
  assert.ok(start > 0 && end > start);
  const directory = fs.mkdtempSync(join(tmpdir(), 'holaday-late-known-refusal-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const path = join(directory, 'journal.json');
  const identity = { candidate: 'a'.repeat(40), bootId: 'b'.repeat(32) },
    binding = { attempt: 'c'.repeat(32) };
  fs.writeFileSync(path, JSON.stringify({ phase: 'reconciled', identity }));
  const journal = { path, assertOwnership: async () => binding };
  const ctx = { journal, binding, approval: { reconcileByMs: Date.now() + 60000 } };
  let checks = 0;
  const hostAdapter = {
    status: async () => {
      checks++;
      return { identity, mode: 'serving', needsReconciliation: true, idle: false };
    },
  };
  const events = [];
  const make = new Function(
    'ctx',
    'journal',
    'identity',
    'fs',
    'hostAdapter',
    'knownEffectVisible',
    'lateKnownEffect',
    'effectCount',
    'assert',
    'console',
    'let lateKnownRejections=0;' +
      source.slice(start, end) +
      ';return {checkOwned,count:()=>lateKnownRejections};',
  );
  const good = make(ctx, journal, identity, fs.promises, hostAdapter, false, true, 1, assert, {
    error: (x) => events.push(x),
  });
  await good.checkOwned();
  assert.equal(good.count(), 0);
  assert.equal(events.length, 0);
  const refusal = make(ctx, journal, identity, fs.promises, hostAdapter, true, true, 1, assert, {
    error: (x) => events.push(x),
  });
  await assert.rejects(refusal.checkOwned(), { message: 'CUTOVER_KNOWN_EXTERNAL_WORK_UNPROVEN' });
  assert.equal(refusal.count(), 1);
  assert.deepEqual(events, ['QA_LATE_KNOWN_REJECTED CUTOVER_KNOWN_EXTERNAL_WORK_UNPROVEN']);
  assert.equal(checks, 2);
  fs.writeFileSync(path, JSON.stringify({ phase: 'verified', identity }));
  const invalid = make(ctx, journal, identity, fs.promises, hostAdapter, true, true, 1, assert, {
    error: (x) => events.push(x),
  });
  await assert.rejects(invalid.checkOwned());
  assert.equal(invalid.count(), 0);
  assert.equal(events.length, 1, 'prior binding/phase refusal cannot claim known work reached');
});
