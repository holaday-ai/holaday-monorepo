// Disposable Linux QA only. Real Git/install/build/journal/publication/readiness;
// explicitly synthetic legacy, host, database and merchant observations.
// No transition, stop, migration, backup, candidate start or open is attempted.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import * as fs from 'node:fs/promises';
import { promisify } from 'node:util';
import { createFirstCutoverHostAdapter } from '../browser-first-cutover-host.mjs';
import { candidatePreparationSystem } from '../browser-maintenance-host.mjs';
import { buildMaintenanceMigrationManifest } from '../browser-maintenance-manifest.mjs';

assert.equal(process.platform, 'linux');
assert.equal(process.getuid(), 0);
assert.equal(process.env.CUTOVER_QA_STAGE, '1');
await fs.access('/.dockerenv');
const missingEvidence = process.argv[2] === '--expect-missing-evidence';
assert.ok(process.argv.length === 2 || (process.argv.length === 3 && missingEvidence));
const run = promisify(execFile);
const git = async (...args) => (await run('git', args)).stdout.trim();
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const sourceRoot = '/opt/holaday-monorepo';
assert.equal(await git('-C', sourceRoot, 'remote', 'get-url', 'origin'), '/qa-origin.git');
assert.equal(await git('--git-dir=/qa-origin.git', 'rev-parse', '--is-bare-repository'), 'true');
const candidate = await git('--git-dir=/qa-origin.git', 'rev-parse', 'HEAD');
const sourceCandidate = await git('-C', sourceRoot, 'rev-parse', 'HEAD');
assert.match(candidate, /^[a-f0-9]{40}$/);
assert.notEqual(candidate, sourceCandidate);
const config = Buffer.from(
  [
    'MODEL_RUNTIME_POLICY=qwen_only',
    'QWEN_CORE_ENABLED_LANES=browser',
    'DASHSCOPE_INTL_API_KEY=synthetic-qa-not-a-provider-key',
    'DASHSCOPE_INTL_ANTHROPIC_BASE_URL=http://127.0.0.1:1',
    'DASHSCOPE_INTL_RESPONSES_BASE_URL=http://127.0.0.1:1',
    'QWEN_CORE_ROLLOUT_MODE=off',
    'TEAM_TASK_LIFECYCLE_ENABLED=false',
    'ACCOUNT_CLOSURE_WORKER_ENABLED=false',
    '',
  ].join('\n'),
);
const inventory = { configurationDigests: [sha(config)], merchants: [], targets: [] };
const approval = {
  schemaVersion: 1,
  kind: 'first-cutover',
  attempt: randomUUID(),
  branch: 'codex/browser-release-candidate-20260925',
  candidate,
  configDigest: sha(config),
  migrationDigest: buildMaintenanceMigrationManifest(sourceRoot).sha256,
  inventoryDigest: sha(JSON.stringify(inventory)),
  legacyDigest: sha('synthetic QA legacy scope, not production observation'),
  maintenanceEndsAtMs: Date.now() + 1_800_000,
  reconcileByMs: Date.now() + 1_860_000,
  operatorRef: 'qa-stage-only',
};
const directory = '/var/lib/holaday-deploy/maintenance';
// The older stop-only QA image made this common ancestor root-only. Provision
// traversal for the application group, keeping each private child at 0700.
assert.equal(await fs.realpath('/var/lib/holaday-deploy'), '/var/lib/holaday-deploy');
assert.equal((await fs.lstat('/var/lib/holaday-deploy')).uid, 0);
await fs.chown('/var/lib/holaday-deploy', 0, 998);
await fs.chmod('/var/lib/holaday-deploy', 0o710);
await fs.mkdir(directory, { recursive: true, mode: 0o700 });
await fs.writeFile(`${directory}/first-cutover-approved.json`, JSON.stringify(approval), {
  flag: 'wx',
  mode: 0o600,
});
await fs.writeFile('/var/lib/holaday-deploy/maintenance-target.env', config, {
  flag: 'wx',
  mode: 0o600,
});
for (const [name, mode] of [
  ['evidence-private', 0o700],
  ['evidence', 0o750],
]) {
  const path = `/var/lib/holaday-deploy/${name}`;
  await fs.mkdir(path, { mode });
  if (name === 'evidence') await fs.chown(path, 0, 998);
}
let attached;
let detached = 0;
const forbidden = async () => {
  throw new Error('QA_UNCONFIGURED_EFFECT');
};
const lifecycle = Object.fromEntries(
  [
    'fenceOrders',
    'settleLegacy',
    'stopProducers',
    'fenceAll',
    'stopLegacy',
    'assertStopped',
    'verifyFence',
    'restoreIngress',
    'resumeWorker',
    'reconcile',
    'holdMaintenance',
    'readBackupPlan',
  ].map((name) => [name, forbidden]),
);
lifecycle.attach = async (context) => {
  assert.equal(attached, undefined);
  attached = context;
  assert.equal((await context.journal.assertOwnership()).attempt, approval.attempt);
};
lifecycle.detach = async (context) => {
  assert.equal(context.journal, attached.journal);
  assert.equal(detached++, 0);
};
const backup = Object.fromEntries(
  [
    'readDatabaseIdentity',
    'inspectBackupFacility',
    'exportDatabase',
    'hashArtifact',
    'restoreIsolated',
    'compareInventoryAndData',
    'runApprovedMigrations',
    'verifySchema',
    'readSourceDigest',
    'finishRecovery',
  ].map((name) => [name, forbidden]),
);
const evidence = {
  readHostInventory: async () => {
    if (missingEvidence) throw new Error('QA_READINESS_UNCONFIGURED');
    return {
      inventory,
      observedAtMs: Date.now(),
      unknownWriters: [],
      externalWork: [],
      producersRunning: [],
    };
  },
  readDatabaseScope: async () => ({ observedAtMs: Date.now(), orders: [], unsettled: [] }),
  queryOrders: async () => [],
  readRehearsalArtifacts: async () => ({
    candidate,
    configDigest: approval.configDigest,
    inventoryDigest: approval.inventoryDigest,
    observedAtMs: Date.now(),
    recovery: 'retry-proven',
    recoveryUntilMs: approval.reconcileByMs,
    artifacts: [],
  }),
  readFenceState: async () => ({
    inventoryDigest: approval.inventoryDigest,
    observedAtMs: Date.now(),
    stage: 'observed',
    uncovered: [],
    liveLegacy: [],
    regeneratedLegacy: [],
  }),
};
const commands = [];
let readinessCall;
const system = candidatePreparationSystem();
const adapter = createFirstCutoverHostAdapter(
  { attempt: approval.attempt },
  {
    lifecycle,
    backup,
    evidence,
    inspectLegacySource: async () => ({
      sourceCandidate: await git('-C', sourceRoot, 'rev-parse', 'HEAD'),
      legacyDigest: approval.legacyDigest,
      observedAtMs: Date.now(),
    }),
    exec: async (command, args, options) => {
      commands.push({ command, args: [...args] });
      console.log('QA_COMMAND', command, JSON.stringify(args));
      if (command === 'runuser') readinessCall = { command, args, options };
      return system.exec(command, args, options);
    },
  },
);
try {
  await adapter.preflight(candidate);
  if (missingEvidence) await assert.rejects(adapter.stage(), /QA_READINESS_UNCONFIGURED/);
  else await adapter.stage();
  assert.ok(attached, 'Original host must acquire the journal and finish the real build');
  const record = JSON.parse(await fs.readFile(attached.journal.path, 'utf8'));
  assert.equal(record.candidate, candidate);
  assert.equal(record.attempt, approval.attempt);
  assert.equal(record.phase, 'preflight');
  assert.equal(record.backupReceipt, undefined);
  assert.ok(record.migrationManifest.migrations.length > 0);
  assert.equal(await git('-C', attached.root, 'rev-parse', 'HEAD'), candidate);
  assert.equal(await git('-C', attached.root, 'branch', '--show-current'), '');
  await fs.access(`${attached.root}/apps/orchestrator/dist/index.js`);
  const readers = commands.filter(({ command }) => command === 'runuser');
  assert.equal(readers.length, missingEvidence ? 0 : 1);
  if (!missingEvidence) {
    assert.deepEqual(readers[0].args.slice(0, 6), [
      '-u',
      'holaday',
      '--',
      '/opt/node22/bin/node',
      '--import',
      'tsx',
    ]);
    const report = JSON.parse(
      await fs.readFile(`/var/lib/holaday-deploy/evidence/${approval.attempt}.json`, 'utf8'),
    );
    assert.equal(report.attempt, record.attempt);
    assert.equal(report.stage, 'prepare');
    // Exercise the actual uid998 reader, not root or a mocked validator. A
    // protected summary made unreadable must fail without any release effect.
    const reportPath = `/var/lib/holaday-deploy/evidence/${approval.attempt}.json`;
    const reportBefore = await fs.readFile(reportPath);
    const stat = await fs.stat(reportPath);
    assert.equal(stat.uid, 0);
    assert.equal(stat.gid, 998);
    assert.equal(stat.mode & 0o7777, 0o640);
    await fs.chmod(reportPath, 0o600);
    try {
      await assert.rejects(
        system.exec(readinessCall.command, readinessCall.args, readinessCall.options),
        /MAINTENANCE_PAYMENT_BOUNDARY_UNPROVEN/,
      );
    } finally {
      await fs.chmod(reportPath, 0o640);
    }
    assert.deepEqual(await fs.readFile(reportPath), reportBefore);
    await system.exec(readinessCall.command, readinessCall.args, readinessCall.options);
  }
  assert.ok(
    !commands.some(
      ({ command, args }) => command === 'pm2' || args.some((a) => a.startsWith('db:')),
    ),
  );
  console.log(
    'QA_STAGE_RESULT',
    JSON.stringify({
      candidate,
      attempt: approval.attempt,
      build: true,
      nativeReadinessReader: !missingEvidence,
      missingEvidenceRefused: missingEvidence,
      unreadableEvidenceRefused: !missingEvidence,
      observations: 'synthetic',
      releaseReady: false,
    }),
  );
} finally {
  await adapter.finish({ ok: false });
}
assert.equal(detached, 1);
await fs.access(`${directory}/release.lock`); // Failed/partial attempts never unlock or resume.
