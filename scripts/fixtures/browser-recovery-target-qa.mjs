import { ingressDiagnosticStage } from '../browser-first-cutover-ingress-diagnostics.mjs';
// Actual recovery-machine Docker/age/import exercise. The caller creates the
// dedicated no-network container/volume; this fixture never stops/removes one.
// Payload and key are synthetic. Optional separate source container exercises
// the original backup coordinator with mysqldump and a durable journal receipt.
// CUTOVER_QA_RETIREMENT binds the real Linux stopping fixture to this session.
// Production coverage, source SSH and the full host/candidate tail are NOT proven.
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { closeSync, fsyncSync, openSync, writeSync } from 'node:fs';
import { chmod, mkdir, mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import {
  encryptAgeBackup,
  inspectFirstCutoverRecoveryTarget,
  pullFirstCutoverAgeBackup,
  restoreFirstCutoverAgeBackup,
} from '../browser-first-cutover-backup.mjs';
import { serveFirstCutoverRecoverySession } from '../browser-first-cutover-recovery-session.mjs';
import { verifyFirstCutoverQaRuntimeMaterials } from './browser-first-cutover-runtime-materials.qa.mjs';
import { buildMaintenanceMigrationManifest } from '../browser-maintenance-manifest.mjs';

const [containerId, imageId, attempt, runtimeRoot, sourceContainerId, sourceAttempt] =
  process.argv.slice(2);
assert.match(containerId ?? '', /^[a-f0-9]{64}$/);
assert.match(imageId ?? '', /^sha256:[a-f0-9]{64}$/);
assert.match(attempt ?? '', /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/);
const fullSource = Boolean(sourceContainerId);
const retirementLink = process.env.CUTOVER_QA_RETIREMENT === '1';
// This branch launches an execution-site role even without a candidate tail.
const physicalIngress = retirementLink;
const recoveryDrift = process.env.CUTOVER_QA_RECOVERY_DRIFT === '1';
assert.ok(!recoveryDrift || retirementLink);
assert.ok(!retirementLink || fullSource || !runtimeRoot);
const stoppedSource = retirementLink && fullSource;
const fullHost = process.env.CUTOVER_QA_HOST === '1';
const compileBudget = process.env.CUTOVER_QA_COMPILE_BUDGET === '1';
assert.ok(
  !compileBudget || (fullHost && /^[a-f0-9]{32}$/.test(process.env.CUTOVER_QA_RUNNER_TOKEN ?? '')),
);
if (process.env.CUTOVER_QA_HOST_IMAGE)
  assert.match(process.env.CUTOVER_QA_HOST_IMAGE, /^sha256:[a-f0-9]{64}$/);
if (process.env.CUTOVER_QA_RUNNER_TOKEN)
  assert.match(process.env.CUTOVER_QA_RUNNER_TOKEN, /^[a-f0-9]{32}$/);
const hostFault = process.env.CUTOVER_QA_HOST_FAULT ?? 'before-migration';
assert.ok(
  [
    'before-migration',
    'after-start',
    'before-open',
    'after-open',
    'after-ingress',
    'after-worker',
    'success',
    'late-known-effect',
  ].includes(hostFault),
);
const candidateTail = hostFault !== 'before-migration';
const successfulCutover = hostFault === 'success';
const lostOpenAck = process.env.CUTOVER_QA_LOST_OPEN_ACK === '1';
assert.ok(!lostOpenAck || (fullHost && successfulCutover));
const enabledWorker = process.env.CUTOVER_QA_ENABLED_WORKER === '1';
assert.ok(
  !enabledWorker ||
    (fullHost && (successfulCutover || hostFault === 'after-worker') && !lostOpenAck),
);
const lateKnownEffect = hostFault === 'late-known-effect';
const nativeIngress = ['after-ingress', 'after-worker', 'success', 'late-known-effect'].includes(
  hostFault,
);
const preopenGate = [
  'before-open',
  'after-open',
  'after-ingress',
  'after-worker',
  'success',
  'late-known-effect',
].includes(hostFault);
assert.ok(hostFault === 'before-migration' || fullHost);
assert.ok(!fullHost || stoppedSource);
const buildCache = fullHost ? await realpath(process.env.CUTOVER_QA_BUILD_CACHE) : undefined;
const buildProfile = fullHost
  ? JSON.parse(await readFile(join(buildCache, 'cache.json'), 'utf8'))
  : undefined;
if (fullHost) {
  assert.equal(buildProfile.schemaVersion, 1);
  assert.equal(buildProfile.observations, 'synthetic-qa-only');
  for (const key of ['candidate', 'sourceCandidate'])
    assert.match(buildProfile[key], /^[a-f0-9]{40}$/);
  assert.equal(await realpath(buildProfile.origin), buildProfile.origin);
}
assert.ok(!stoppedSource || !recoveryDrift);
// QA-only mutation: a lying adapter returns a receipt without persisting it.
// The independent journal assertion below must reject this run.
const omitReceipt = process.env.CUTOVER_QA_OMIT_RECEIPT === '1';
assert.ok(!omitReceipt || fullSource);
if (fullSource) {
  assert.ok(runtimeRoot);
  assert.match(sourceContainerId, /^[a-f0-9]{64}$/);
  assert.match(sourceAttempt ?? '', /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/);
  assert.notEqual(sourceContainerId, containerId);
  assert.notEqual(sourceAttempt, attempt);
}
const run = promisify(execFile);
const hash = (v) => createHash('sha256').update(v).digest('hex');
const queryAt = async (container, sql) =>
  (
    await run(
      'docker',
      [
        'exec',
        container,
        '/usr/bin/mysql',
        '--no-defaults',
        '-uroot',
        '--database=restore_qa',
        '--batch',
        '--raw',
        '--skip-column-names',
        '--execute',
        sql,
      ],
      { timeout: 5000, maxBuffer: 1024 * 1024 },
    )
  ).stdout.trim();
const query = (sql) => queryAt(containerId, sql);
// Readiness is a bounded read-only preflight, before any coordinator effects.
const waitReady = async (id, approvedAttempt) => {
  const resource = JSON.parse(
    (await run('docker', ['inspect', id], { timeout: 5000, maxBuffer: 1024 * 1024 })).stdout,
  )[0];
  assert.equal(resource.Id, id);
  assert.equal(resource.Image, imageId);
  assert.equal(resource.Config.Labels['holaday.cutover.attempt'], approvedAttempt);
  assert.equal(resource.HostConfig.NetworkMode, 'none');
  assert.equal(resource.HostConfig.IpcMode, 'private');
  assert.deepEqual(resource.HostConfig.Binds ?? [], []);
  assert.equal(resource.Mounts.length, 1);
  assert.equal(resource.Mounts[0].Name, `holaday-cutover-restore-${approvedAttempt}`);
  const deadline = performance.now() + 30000;
  let ready = false;
  while (performance.now() < deadline) {
    try {
      ready = (await queryAt(id, 'SELECT 1')) === '1';
    } catch {
      ready = false;
    }
    if (ready) break;
    await delay(500);
  }
  assert.ok(ready && performance.now() < deadline, 'QA_DATABASE_READINESS_UNPROVEN');
  assert.equal(await queryAt(id, 'SELECT @@global.event_scheduler'), 'OFF');
};
await waitReady(containerId, attempt);
if (fullSource) await waitReady(sourceContainerId, sourceAttempt);
const identity = JSON.parse(
  await query("SELECT JSON_OBJECT('serverUuid',@@server_uuid,'database',DATABASE())"),
);
const target = {
  containerId,
  imageId,
  attempt,
  volume: `holaday-cutover-restore-${attempt}`,
  identity,
};
assert.deepEqual(await inspectFirstCutoverRecoveryTarget(target), identity);
const sourceTarget = fullSource
  ? {
      containerId: sourceContainerId,
      imageId,
      attempt: sourceAttempt,
      volume: `holaday-cutover-restore-${sourceAttempt}`,
      identity: JSON.parse(
        await queryAt(
          sourceContainerId,
          "SELECT JSON_OBJECT('serverUuid',@@server_uuid,'database',DATABASE())",
        ),
      ),
    }
  : undefined;
if (sourceTarget) {
  assert.notEqual(sourceTarget.identity.serverUuid, identity.serverUuid);
  await inspectFirstCutoverRecoveryTarget(sourceTarget, { requireEmpty: false });
  if (fullHost) {
    // Fail before compilation/retirement when the explicitly prepared fresh
    // source is missing the original fixture or current application baseline.
    assert.equal(
      await queryAt(
        sourceContainerId,
        'SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE()',
      ),
      candidateTail ? '90' : '2',
    );
    assert.equal(
      await queryAt(
        sourceContainerId,
        'SELECT HEX(text_value), HEX(payload), optional_value IS NULL FROM sample',
      ),
      'E6B5B7E8BEB9\t00FF5C27\t1',
    );
    for (const [catalog, field] of [
      ['TRIGGERS', 'TRIGGER_SCHEMA'],
      ['EVENTS', 'EVENT_SCHEMA'],
    ]) {
      assert.equal(
        await queryAt(
          sourceContainerId,
          `SELECT COUNT(*) FROM information_schema.${catalog} WHERE ${field}=DATABASE()`,
        ),
        '1',
      );
    }
  }
}
const directory = await realpath(await mkdtemp(join(tmpdir(), 'holaday-recovery-target-')));
await chmod(directory, 0o700);
const sourceDirectory = join(directory, 'source');
const recoveryDirectory = join(directory, 'recovery');
await mkdir(sourceDirectory, { mode: 0o700 });
await mkdir(recoveryDirectory, { mode: 0o700 });
const age = await realpath(process.env.CUTOVER_TEST_AGE_EXECUTABLE);
const identityFile = join(recoveryDirectory, 'identity.txt');
await run(join(dirname(age), 'age-keygen'), ['-o', identityFile]);
await chmod(identityFile, 0o600);
const recipient = (await run(join(dirname(age), 'age-keygen'), ['-y', identityFile])).stdout;
const facility = {
  executable: age,
  executableDigest: hash(await readFile(age)),
  recipientDigest: hash(recipient),
};
const optionsFor = async (path) => {
  const recipientFile = join(path, 'recipient.txt');
  await writeFile(recipientFile, recipient, { mode: 0o600, flag: 'wx' });
  return { facility: { ...facility, recipientFile }, directory: path, attempt };
};
let sourceOptions = await optionsFor(sourceDirectory);
const destination = await optionsFor(recoveryDirectory);
let sourceQa;
if (stoppedSource) {
  // Reuse the cached client in the existing stop image; no image build, package
  // installation, Docker socket, recovery private key or production credential.
  const clientDirectory = join(directory, 'client');
  await mkdir(clientDirectory, { mode: 0o700 });
  await run('docker', [
    'cp',
    `${sourceContainerId}:/usr/bin/mysqldump`,
    join(clientDirectory, 'mysqldump'),
  ]);
  // Compiler and dependency overrides belong only to this synthetic QA driver.
  const compiler = process.env.CUTOVER_QA_ESBUILD
    ? pathToFileURL(await realpath(process.env.CUTOVER_QA_ESBUILD)).href
    : '../../node_modules/.pnpm/esbuild@0.25.12/node_modules/esbuild/lib/main.js';
  const moduleRoot = process.env.CUTOVER_QA_MODULE_ROOT
    ? await realpath(process.env.CUTOVER_QA_MODULE_ROOT)
    : process.cwd();
  const { build } = await import(compiler);
  await build({
    entryPoints: [join(moduleRoot, 'apps/orchestrator/node_modules/mysql2/promise.js')],
    outfile: join(clientDirectory, 'mysql2.cjs'),
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    logLevel: 'silent',
  });
  const ageDigest = (
    await run('docker', [
      'run',
      '--rm',
      '--network',
      'none',
      '--cpus=1',
      '--memory=128m',
      '--pids-limit=64',
      '--entrypoint',
      '/usr/bin/sha256sum',
      'holaday-first-cutover-age:qa',
      '/usr/bin/age',
    ])
  ).stdout.split(' ')[0];
  assert.match(ageDigest, /^[a-f0-9]{64}$/);
  sourceOptions = {
    facility: {
      executable: '/usr/bin/age',
      executableDigest: ageDigest,
      recipientFile: '/var/lib/holaday-deploy/source-backup/recipient.txt',
      recipientDigest: hash(recipient),
    },
    directory: '/var/lib/holaday-deploy/source-backup',
    attempt,
  };
  const config = fullHost
    ? [
        'DATABASE_URL=mysql://root@127.0.0.1/restore_qa',
        ...(candidateTail
          ? [
              'REDIS_URL=redis://127.0.0.1:6379',
              'JWT_SECRET=synthetic-qa-only-not-a-production-secret',
              'EXECUTOR_MODE=legacy',
              'HTTP_PORT=4001',
              'WS_PORT=4002',
            ]
          : []),
        'MODEL_RUNTIME_POLICY=qwen_only',
        'QWEN_CORE_ENABLED_LANES=browser',
        'DASHSCOPE_INTL_API_KEY=synthetic-qa-not-a-provider-key',
        // The application validates regional URL syntax even with rollout off.
        // This QA namespace has no external network and only a synthetic key.
        `DASHSCOPE_INTL_ANTHROPIC_BASE_URL=${candidateTail ? 'https://dashscope-intl.aliyuncs.com/apps/anthropic' : 'http://127.0.0.1:1'}`,
        `DASHSCOPE_INTL_RESPONSES_BASE_URL=${candidateTail ? 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1' : 'http://127.0.0.1:1'}`,
        'QWEN_CORE_ROLLOUT_MODE=off',
        'TEAM_TASK_LIFECYCLE_ENABLED=false',
        `ACCOUNT_CLOSURE_WORKER_ENABLED=${enabledWorker ? 'true' : 'false'}`,
        ...(enabledWorker
          ? [
              'ACCOUNT_CLOSURE_HMAC_SECRET=synthetic-qa-worker-only-not-a-production-secret',
              // Fresh synthetic QA contains no retained feedback/analytics.
              // Do not copy these prerequisites into production configuration.
              'ACCOUNT_CLOSURE_LEGACY_FEEDBACK_SANITIZED=true',
              'ACCOUNT_CLOSURE_LEGACY_ANALYTICS_LOGS_SANITIZED=true',
            ]
          : []),
        '',
      ].join('\n')
    : 'DATABASE_URL=mysql://root@127.0.0.1/restore_qa';
  sourceQa = {
    clientDirectory,
    recipient,
    sourceOptions,
    config,
    configDigest: hash(config),
    backupSource: {
      facility: sourceOptions.facility,
      directory: sourceOptions.directory,
      executable: '/usr/local/bin/mysqldump',
      executableDigest: hash(await readFile(join(clientDirectory, 'mysqldump'))),
    },
  };
}
const sql = Buffer.from(
  "SET NAMES utf8mb4; CREATE TABLE sample(id INT PRIMARY KEY, text_value TEXT, payload BLOB, optional_value INT NULL); INSERT INTO sample VALUES(1,'海边',0x00ff5c27,NULL); CREATE TABLE audit(id INT); CREATE TRIGGER qa_trigger AFTER INSERT ON sample FOR EACH ROW INSERT INTO audit VALUES(NEW.id); CREATE EVENT qa_event ON SCHEDULE EVERY 1 DAY DISABLE DO INSERT INTO audit VALUES(99);\n",
);
const artifact =
  fullSource || retirementLink
    ? undefined
    : await encryptAgeBackup(sourceOptions, (sink) => pipeline(Readable.from([sql]), sink));
const bytes = fullSource || retirementLink ? undefined : await readFile(artifact.reference);
const transfer =
  fullSource || retirementLink
    ? undefined
    : {
        source: { options: sourceOptions, artifact },
        destination,
        expectedBackupDigest: hash(bytes),
        expectedBytes: bytes.length,
      };
const io = {
  pull: (input) =>
    pullFirstCutoverAgeBackup(input, {
      spawn: () =>
        stoppedSource
          ? spawn(
              'docker',
              [
                'exec',
                '-i',
                `holaday-retirement-recovery-${attempt}`,
                '/usr/bin/node',
                '--input-type=module',
              ],
              { stdio: ['pipe', 'pipe', 'ignore'] },
            )
          : spawn(process.execPath, ['--input-type=module'], { stdio: ['pipe', 'pipe', 'ignore'] }),
    }),
};
const request = { transfer, identityFile, target };
const migrationManifest = runtimeRoot
  ? buildMaintenanceMigrationManifest(runtimeRoot).manifest
  : [];
const sourceIdentity = sourceTarget?.identity ?? {
  serverUuid: '11111111-1111-4111-8111-111111111111',
  database: 'synthetic_source',
};
const binding = {
  attempt,
  candidate: fullHost ? buildProfile.candidate : (retirementLink ? 'b' : 'a').repeat(40),
  configDigest: sourceQa?.configDigest ?? (retirementLink ? 'c' : 'b').repeat(64),
  migrationDigest: hash(JSON.stringify(migrationManifest)),
  inventoryDigest: retirementLink
    ? hash(
        JSON.stringify({
          configurationDigests: [sourceQa?.configDigest ?? 'c'.repeat(64)],
          merchants: [],
          targets: [],
          backupPlan: { sourceIdentity, isolatedTarget: identity },
          ...(sourceQa ? { backupSource: sourceQa.backupSource } : {}),
        }),
      )
    : 'd'.repeat(64),
};
const scope = {
  schemaVersion: 1,
  binding,
  // New QA approval only: measured real ingress proofs exceeded the old 10m
  // fixture window. Never extend an existing attempt or production approval.
  maintenanceEndsAtMs: Date.now() + (nativeIngress || fullHost ? 900000 : 120000),
  sourceOptions,
  destination,
  identityFile,
  target,
  sourceIdentity,
};
if (runtimeRoot) {
  await verifyFirstCutoverQaRuntimeMaterials({ ...target, root: runtimeRoot });
  if (sourceTarget)
    await verifyFirstCutoverQaRuntimeMaterials({ ...sourceTarget, root: runtimeRoot });
  const bytes = await readFile(join(runtimeRoot, 'runtime.json'));
  const runtime = JSON.parse(bytes);
  assert.equal(runtime.migrationDigest, binding.migrationDigest);
  assert.equal(migrationManifest.migrations.length, 61);
  scope.runtime = {
    manifestDigest: hash(bytes),
    nodeDigest: runtime.files.node,
    toolDigest: runtime.files['recovery-tool.mjs'],
  };
}
const scopeBytes = JSON.stringify(scope);
await writeFile(join(directory, `first-cutover-${attempt}.json`), scopeBytes, {
  mode: 0o600,
  flag: 'wx',
});
const scopeDigest = hash(scopeBytes);
const publicScope = {
  binding,
  maintenanceEndsAtMs: scope.maintenanceEndsAtMs,
  scopeDigest,
  sourceIdentity: scope.sourceIdentity,
  isolatedTarget: identity,
};
const journalDirectory = join(directory, 'journal');
await mkdir(journalDirectory, { mode: 0o700 });
// Child models the coordinator over exactly its stdin/stdout on the caller OS.
// Only public metadata is sent, never the Mac identity file or private key.
const script = `
import assert from 'node:assert/strict';
import { acquireReleaseJournal } from ${JSON.stringify(new URL('../browser-maintenance-journal.mjs', import.meta.url).href)};
import { connectFirstCutoverRecoverySession } from ${JSON.stringify(new URL('../browser-first-cutover-recovery-session.mjs', import.meta.url).href)};
const scope = ${JSON.stringify(publicScope)};
const journal = await acquireReleaseJournal(${JSON.stringify(journalDirectory)}, { ...scope.binding, kind:'first-cutover', legacyDigest:'e'.repeat(64) });
try {
  await journal.bindManifest(${JSON.stringify(migrationManifest)});
  for (const phase of ['prepared','orders_fenced','legacy_settled','producers_stopped','all_fenced','stopped','backup_verified']) await journal.persist(phase, {candidate:scope.binding.candidate});
  const baseline = await journal.readFirstCutoverEffects({forBackupRecovery:true});
  let checks=0;
  const client = await connectFirstCutoverRecoverySession(scope, { input:process.stdin, output:process.stdout, assertScope:async()=>{
    assert.deepEqual(await journal.assertOwnership(),scope.binding);
    assert.deepEqual(await journal.readFirstCutoverEffects({forBackupRecovery:true}),baseline);
    assert.equal(baseline.phase,'backup_verified');
    checks++;
  }});
  ${
    fullSource
      ? `
  const { backupAndRestoreCheck, encryptAgeBackup, inspectAgeBackupFacility, hashAgeBackupArtifact, inspectFirstCutoverRecoveryTarget, executeFirstCutoverRecoveryTargetTool } = await import(${JSON.stringify(new URL('../browser-first-cutover-backup.mjs', import.meta.url).href)});
  const { compareCutoverMysqlSnapshots } = await import(${JSON.stringify(new URL('../browser-first-cutover-mysql.mjs', import.meta.url).href)});
  const { spawn } = await import('node:child_process');
  const { readFile } = await import('node:fs/promises');
  const { pipeline } = await import('node:stream/promises');
  const source = ${JSON.stringify(sourceTarget)};
  const sourceOptions = ${JSON.stringify(sourceOptions)};
  const runtime = ${JSON.stringify(scope.runtime)};
  const assertOwned = async () => {
    assert(Date.now()<scope.maintenanceEndsAtMs);
    assert.deepEqual(await journal.assertOwnership(),scope.binding);
    assert.deepEqual(await journal.readFirstCutoverEffects({forBackupRecovery:true}),baseline);
  };
  const sourceIdentity = async () => {
    await assertOwned();
    return inspectFirstCutoverRecoveryTarget(source,{requireEmpty:false});
  };
  const sourceSnapshot = () => executeFirstCutoverRecoveryTargetTool({target:source,runtime,migrationDigest:scope.binding.migrationDigest,action:'snapshot'},{assertScope:assertOwned});
  const original = await sourceSnapshot();
  const receipt = await backupAndRestoreCheck({binding:scope.binding,sourceIdentity:scope.sourceIdentity,isolatedTarget:scope.isolatedTarget,maintenanceEndsAtMs:scope.maintenanceEndsAtMs},{
    now:Date.now,
    assertOwnership:()=>journal.assertOwnership(),
    // Dedicated no-network QA source has no other sessions or schemas. This
    // does NOT establish physical production writer/process retirement.
    assertWritersStopped:sourceIdentity,
    readDatabaseIdentity: async id => {
      if (JSON.stringify(id)===JSON.stringify(scope.sourceIdentity)) return sourceIdentity();
      assert.deepEqual(id,scope.isolatedTarget);
      return client.inspect();
    },
    inspectBackupFacility:()=>inspectAgeBackupFacility(sourceOptions.facility),
    exportDatabase: async id => {
      assert.deepEqual(id,scope.sourceIdentity);
      return encryptAgeBackup(sourceOptions,async sink=>{
        const dump=spawn('docker',['exec',source.containerId,'/usr/bin/mysqldump','--no-defaults','-uroot','--single-transaction','--routines','--events','--triggers','--set-gtid-purged=OFF','--no-tablespaces',id.database],{stdio:['ignore','pipe','ignore']});
        await Promise.all([pipeline(dump.stdout,sink),new Promise((resolve,reject)=>{
          dump.once('error',reject);dump.once('close',code=>code===0?resolve():reject(Error('QA_DUMP_FAILED')));
        })]);
      });
    },
    hashArtifact:a=>hashAgeBackupArtifact(a,sourceOptions),
    restoreIsolated:async(a,id)=>{
      assert.deepEqual(id,scope.isolatedTarget);
      assert.deepEqual(await client.restore({artifact:a,expectedBackupDigest:await hashAgeBackupArtifact(a,sourceOptions),expectedBytes:(await readFile(a.reference)).length}),id);
    },
    compareInventoryAndData:async()=>{
      const current=await sourceSnapshot();assert.deepEqual(current,original);
      return compareCutoverMysqlSnapshots(current,await client.snapshot());
    },
    runApprovedMigrations:async(id,digest)=>{
      assert.deepEqual(id,scope.isolatedTarget);assert.equal(digest,scope.binding.migrationDigest);
      assert.deepEqual(await client.migrate(),{migrationDigest:digest});
    },
    verifySchema:async id=>{assert.deepEqual(id,scope.isolatedTarget);return client.verify();},
    readSourceDigest:async()=>{const current=await sourceSnapshot();assert.deepEqual(current,original);return current.sourceDigest;},
    sealReceipt:${omitReceipt ? 'r=>r' : 'r=>journal.bindBackupReceipt(r)'},
  });
  assert.equal(receipt.businessDigest,original.businessDigest);
  await journal.assertOwnership();
  assert.deepEqual(JSON.parse(await readFile(journal.path,'utf8')).backupReceipt,receipt);
  await assert.rejects(journal.bindBackupReceipt(receipt));
  `
      : `assert.deepEqual(await client.inspect(),scope.isolatedTarget);
  assert.deepEqual(await client.restore(${JSON.stringify({ artifact, expectedBackupDigest: transfer?.expectedBackupDigest, expectedBytes: transfer?.expectedBytes })}),scope.isolatedTarget);
  assert.deepEqual(await client.inspect(),scope.isolatedTarget);
  ${
    runtimeRoot
      ? `const before = await client.snapshot();
  assert.equal(before.objects.find(v=>v.name==='sample').rowCount,1);
  assert.deepEqual(await client.migrate(),{migrationDigest:scope.binding.migrationDigest});
  const verified = await client.verify();
  assert.equal(verified.businessDigest,before.businessDigest);
  assert.notEqual(verified.schemaDigest,before.schemaDigest);`
      : ''
  }`
  }
  await client.close();
  ${fullSource ? "assert.ok(JSON.parse(await readFile(journal.path,'utf8')).backupReceipt, 'full source recovery must seal the original coordinator receipt');" : ''}
  assert(checks>=8);
} finally { await journal.close(); }
`;
// QA-only fixed metadata, synchronously persisted before container removal.
const safeDiagnosticPath = join(directory, 'safe-stage-diagnostics.log');
const safeDiagnosticFd = openSync(safeDiagnosticPath, 'wx', 0o600);
let safeDiagnosticBytes = 0;
let safeDiagnosticFailed = false;
let safeDiagnosticBuffer = '';
const count = (value) => Number.isSafeInteger(value) && value >= 0;
const safeLine = (line) => {
  if (
    line === 'QA_LATE_KNOWN_OBSERVED' ||
    line === 'QA_LATE_KNOWN_REJECTED CUTOVER_KNOWN_EXTERNAL_WORK_UNPROVEN'
  )
    return true;
  if (
    /^QA_BACKUP_STAGE (?:source-snapshot|recovery-(?:attach|inspect|restore|snapshot|migrate|verify|close)) (?:start|done|failed)(?: (?:UNCLASSIFIED_ERROR|(?:CUTOVER|MAINTENANCE)_[A-Z_]+))?$/.test(
      line,
    )
  )
    return true;
  const match = line.match(
    /^(QA_CGROUP_MEMORY_STATE|QA_FAILURE_JOURNAL_STATE|QA_INGRESS_CHILD_EXIT|QA_INGRESS_REJECTION|QA_RECOVERY_REJECTION)(?: ([a-z-]+))? (\{.*\})$/,
  );
  if (!match) return false;
  try {
    const value = JSON.parse(match[3]);
    const names = Object.keys(value);
    if (match[1] === 'QA_CGROUP_MEMORY_STATE') {
      if (
        !/^(?:observer-failed|(?:source-snapshot|recovery-(?:attach|inspect|restore|snapshot|migrate|verify|close))-(?:start|done|failed))$/.test(
          match[2] ?? '',
        )
      )
        return false;
      return (
        names.every((key) => ['currentBytes', 'peakBytes', 'events'].includes(key)) &&
        names.every((key) =>
          key === 'events'
            ? Object.entries(value.events).every(
                ([name, amount]) =>
                  ['oom', 'oom_kill', 'max', 'high'].includes(name) && count(amount),
              )
            : count(value[key]),
        )
      );
    }
    if (match[2] !== undefined) return false;
    if (match[1] === 'QA_RECOVERY_REJECTION')
      return (
        names.length === 2 &&
        names.every((key) => ['component', 'stage'].includes(key)) &&
        ['client', 'server'].includes(value.component) &&
        typeof value.stage === 'string' &&
        /^(?:RECOVERY_SCOPE_ENTRY|RECOVERY_SCOPE_FOLDER|RECOVERY_SCOPE_FILE|RECOVERY_SCOPE_CONTENT|RECOVERY_SCOPE_SHAPE|RECOVERY_SCOPE_RUNTIME|RECOVERY_SCOPE_TARGET|RECOVERY_SCOPE_PUBLIC|RECOVERY_SCOPE_SOURCE_OPTIONS|RECOVERY_SCOPE_DESTINATION_OPTIONS|RECOVERY_SCOPE_RECIPIENT|RECOVERY_SERVER_ENTRY|RECOVERY_SERVER_SCOPE_READ|RECOVERY_SERVER_PUBLIC|RECOVERY_SERVER_SCOPE_RECHECK|RECOVERY_SERVER_READ|RECOVERY_SERVER_ENVELOPE|RECOVERY_SERVER_ATTACH_VALUE|RECOVERY_SERVER_SCOPE_SEND|RECOVERY_SERVER_SCOPE_READ_ANSWER|RECOVERY_SERVER_SCOPE_ANSWER|RECOVERY_SERVER_RESULT|RECOVERY_SERVER_FINAL_SCOPE|RECOVERY_CLIENT_ENTRY|RECOVERY_CLIENT_SCOPE_INITIAL|RECOVERY_CLIENT_SEND|RECOVERY_CLIENT_READ|RECOVERY_CLIENT_ENVELOPE|RECOVERY_CLIENT_SCOPE_MESSAGE|RECOVERY_CLIENT_SCOPE_CHECK|RECOVERY_CLIENT_SCOPE_SEND|RECOVERY_CLIENT_RESULT|RECOVERY_CLIENT_SCOPE_FINAL|RECOVERY_SITE_CONTEXT|RECOVERY_SITE_CLOCK|RECOVERY_SITE_OWNER|RECOVERY_SITE_SOURCE|RECOVERY_SITE_RECORD|RECOVERY_SITE_PHASE|RECOVERY_SITE_RUN|RECOVERY_SITE_SCOPE|RECOVERY_SITE_RECORD_ANCHOR|RECOVERY_SITE_STOPPED_OBSERVER|RECOVERY_SITE_STOPPED_BOUNDARY|RECOVERY_SITE_STOPPED_SHAPE|RECOVERY_SITE_BOUNDARY_WORK|RECOVERY_SITE_BOUNDARY_FENCE|RECOVERY_SITE_BOUNDARY_PROGRESS|RECOVERY_SITE_BOUNDARY_AFTER_WORK|RECOVERY_SITE_BOUNDARY_VALIDATION|APPROVAL_INPUT|APPROVAL_CLOCK|APPROVAL_DEADLINE|APPROVAL_FOLDER|APPROVAL_FILE|APPROVAL_CONTENT|APPROVAL_CHANGED|APPROVAL_JSON|APPROVAL_BINDING|APPROVAL_RISK|SITE_APPROVAL_BEFORE|SITE_FOLDER|SITE_FILE|SITE_CONTENT|SITE_JSON|SITE_SHAPE|SITE_APPROVAL_AFTER|SITE_CLOCK|SITE_VALIDATE|RECOVERY_SITE_SOURCE_SHAPE|RECOVERY_SITE_SOURCE_DRIFT|PORT_OUTPUT_LIMIT|PORT_TERMINATED|PORT_EXIT|PORT_START|PORT_STDIN|PORT_INPUT|PORT_CLOCK|PORT_DEADLINE|PORT_OWNER|PORT_RECEIPT|PORT_COMMAND|PORT_JSON|PORT_SHAPE|PORT_RULES|PORT_EXISTING|PORT_POLICY|FENCE_CONTEXT|FENCE_RECEIPT|FENCE_PORTS_BEFORE|FENCE_CONFIG|FENCE_PROBE|FENCE_RESULT|FENCE_TARGETS|FENCE_ROUTE|FENCE_STATUS|FENCE_WRITERS|FENCE_PORTS_AFTER|PROBE_ENTRY|PROBE_CLOCK|PROBE_WRITER_READ|PROBE_WRITER_SHAPE|PROBE_TIMEOUT|PROBE_REQUEST|PROBE_RESPONSE|PROBE_BODY|PROBE_UPGRADE|PROBE_SETTLED|PROBE_WRITER_DRIFT|PAIR_ENTRY|PAIR_CLOCK|PAIR_OWNER|PAIR_EFFECTS|PAIR_REVISION|PAIR_PHASE|PAIR_SCOPE|PAIR_LOCAL_RECEIPT|PAIR_REMOTE_RECEIPT|PAIR_RECEIPT_SHAPE|LOCAL_ENTRY|LOCAL_CLOCK|LOCAL_OWNER|LOCAL_EFFECTS|LOCAL_REVISION|LOCAL_PHASE|LOCAL_SCOPE|LOCAL_RECEIPT|STORE_CLOCK|STORE_OWNER|STORE_FOLDER|STORE_ABSENCE|STORE_FILE|STORE_CONTENT|STORE_READ|REMOTE_ENTRY|REMOTE_OWNER|REMOTE_SEND|REMOTE_READ|REMOTE_RESULT|REMOTE_FACT|WIRE_CLOCK|WIRE_READ|WIRE_WRITE|RECEIVER_ENTRY|RECEIVER_SCOPE|RECEIVER_IDENTITY|RECEIVER_FACT|RECEIVER_LOCAL|RECEIVER_RESULT)$/.test(
          value.stage,
        )
      );
    if (match[1] === 'QA_INGRESS_REJECTION')
      return (
        names.length === 2 &&
        names.every((key) => ['component', 'stage'].includes(key)) &&
        ['pair', 'receiver'].includes(value.component) &&
        typeof value.stage === 'string' &&
        /^(?:APPROVAL_INPUT|APPROVAL_CLOCK|APPROVAL_DEADLINE|APPROVAL_FOLDER|APPROVAL_FILE|APPROVAL_CONTENT|APPROVAL_CHANGED|APPROVAL_JSON|APPROVAL_BINDING|APPROVAL_RISK|SITE_APPROVAL_BEFORE|SITE_FOLDER|SITE_FILE|SITE_CONTENT|SITE_JSON|SITE_SHAPE|SITE_APPROVAL_AFTER|SITE_CLOCK|SITE_VALIDATE|RECOVERY_SITE_SOURCE_SHAPE|RECOVERY_SITE_SOURCE_DRIFT|PORT_OUTPUT_LIMIT|PORT_TERMINATED|PORT_EXIT|PORT_START|PORT_STDIN|PORT_INPUT|PORT_CLOCK|PORT_DEADLINE|PORT_OWNER|PORT_RECEIPT|PORT_COMMAND|PORT_JSON|PORT_SHAPE|PORT_RULES|PORT_EXISTING|PORT_POLICY|FENCE_CONTEXT|FENCE_RECEIPT|FENCE_PORTS_BEFORE|FENCE_CONFIG|FENCE_PROBE|FENCE_RESULT|FENCE_TARGETS|FENCE_ROUTE|FENCE_STATUS|FENCE_WRITERS|FENCE_PORTS_AFTER|PROBE_ENTRY|PROBE_CLOCK|PROBE_WRITER_READ|PROBE_WRITER_SHAPE|PROBE_TIMEOUT|PROBE_REQUEST|PROBE_RESPONSE|PROBE_BODY|PROBE_UPGRADE|PROBE_SETTLED|PROBE_WRITER_DRIFT|PAIR_ENTRY|PAIR_CLOCK|PAIR_OWNER|PAIR_EFFECTS|PAIR_REVISION|PAIR_PHASE|PAIR_SCOPE|PAIR_LOCAL_RECEIPT|PAIR_REMOTE_RECEIPT|PAIR_RECEIPT_SHAPE|LOCAL_ENTRY|LOCAL_CLOCK|LOCAL_OWNER|LOCAL_EFFECTS|LOCAL_REVISION|LOCAL_PHASE|LOCAL_SCOPE|LOCAL_RECEIPT|STORE_CLOCK|STORE_OWNER|STORE_FOLDER|STORE_ABSENCE|STORE_FILE|STORE_CONTENT|STORE_READ|REMOTE_ENTRY|REMOTE_OWNER|REMOTE_SEND|REMOTE_READ|REMOTE_RESULT|REMOTE_FACT|WIRE_CLOCK|WIRE_READ|WIRE_WRITE|RECEIVER_ENTRY|RECEIVER_SCOPE|RECEIVER_IDENTITY|RECEIVER_FACT|RECEIVER_LOCAL|RECEIVER_RESULT)$/.test(
          value.stage,
        )
      );
    if (match[1] === 'QA_INGRESS_CHILD_EXIT')
      return (
        names.length === 2 &&
        names.every((key) => ['code', 'signal'].includes(key)) &&
        (value.code === null || (count(value.code) && value.code <= 255)) &&
        [null, 'SIGKILL', 'SIGTERM', 'SIGABRT', 'SIGSEGV', 'SIGINT'].includes(value.signal)
      );
    return (
      names.length === 6 &&
      names.every((key) =>
        [
          'phase',
          'recordDigest',
          'startupCount',
          'registrationCount',
          'unmanagedCount',
          'hasFailureObservation',
        ].includes(key),
      ) &&
      /^(?:preflight|prepared|orders_fenced|legacy_settled|legacy_interruption_accepted|producers_stopped|all_fenced|stopped|backup_verified|migration_started|candidate_started|verified|opened|reconciled)$/.test(
        value.phase,
      ) &&
      /^[a-f0-9]{64}$/.test(value.recordDigest) &&
      ['startupCount', 'registrationCount', 'unmanagedCount'].every(
        (key) => count(value[key]) && value[key] <= 65536,
      ) &&
      typeof value.hasFailureObservation === 'boolean'
    );
  } catch {
    return false;
  }
};
const persistSafeDiagnostics = (chunk) => {
  if (safeDiagnosticFailed) return;
  safeDiagnosticBuffer += chunk.toString();
  const lines = safeDiagnosticBuffer.split('\n');
  safeDiagnosticBuffer = lines.pop();
  if (safeDiagnosticBuffer.length > 8192) safeDiagnosticBuffer = '';
  for (const line of lines) {
    if (line.length > 8192 || !safeLine(line)) continue;
    const bytes = Buffer.from(`${line}\n`);
    if (safeDiagnosticBytes + bytes.length > 65536) {
      safeDiagnosticFailed = true;
      return;
    }
    try {
      let written = 0;
      while (written < bytes.length) {
        const amount = writeSync(safeDiagnosticFd, bytes, written);
        if (!Number.isSafeInteger(amount) || amount <= 0)
          throw new Error('QA_DIAGNOSTIC_WRITE_FAILED');
        written += amount;
      }
      fsyncSync(safeDiagnosticFd);
      safeDiagnosticBytes += bytes.length;
    } catch {
      safeDiagnosticFailed = true;
      return;
    }
  }
};
const child = retirementLink
  ? spawn(
      'docker',
      [
        'run',
        '--rm',
        '-i',
        '--name',
        `holaday-retirement-recovery-${attempt}`,
        '--network',
        stoppedSource ? `container:${sourceContainerId}` : 'none',
        '--cpus=1',
        compileBudget ? '--memory=2g' : '--memory=768m',
        '--pids-limit=256',
        '--cap-add=SYS_PTRACE',
        ...(physicalIngress ? ['--cap-add=NET_ADMIN'] : []),
        '--label',
        `holaday.cutover.attempt=${attempt}`,
        ...(process.env.CUTOVER_QA_RUNNER_TOKEN
          ? ['--label', `holaday.qa.runner=${process.env.CUTOVER_QA_RUNNER_TOKEN}`]
          : []),
        '--mount',
        `type=bind,src=${resolve('scripts')},dst=/source,readonly`,
        '--mount',
        `type=bind,src=${resolve('ops')},dst=/ops,readonly`,
        '--env',
        'NODE_OPTIONS=--max-old-space-size=192 --v8-pool-size=1',
        '--env',
        'UV_THREADPOOL_SIZE=1',
        ...(compileBudget ? ['--env', 'CUTOVER_QA_COMPILE_BUDGET=1'] : []),
        '--env',
        `CUTOVER_QA_RECOVERY_SCOPE=${JSON.stringify(publicScope)}`,
        '--env',
        `CUTOVER_QA_RECOVERY_DRIFT=${recoveryDrift ? '1' : '0'}`,
        ...(fullHost
          ? [
              '--mount',
              `type=bind,src=${buildCache},dst=/qa-build,readonly`,
              '--mount',
              `type=bind,src=${buildProfile.origin},dst=/qa-origin.git,readonly`,
              '--env',
              'CUTOVER_QA_HOST=1',
              '--env',
              `CUTOVER_QA_HOST_FAULT=${hostFault}`,
              '--env',
              `CUTOVER_QA_LOST_OPEN_ACK=${lostOpenAck ? '1' : '0'}`,
              '--env',
              `CUTOVER_QA_ENABLED_WORKER=${enabledWorker ? '1' : '0'}`,
            ]
          : []),
        ...(stoppedSource
          ? [
              '--mount',
              `type=bind,src=${sourceQa.clientDirectory},dst=/qa-source,readonly`,
              '--env',
              `CUTOVER_QA_SOURCE=${JSON.stringify({ ...sourceQa, clientDirectory: undefined, migrationManifest, omitReceipt })}`,
            ]
          : []),
        process.env.CUTOVER_QA_HOST_IMAGE ??
          (physicalIngress ? 'holaday-first-cutover-network:qa' : 'holaday-first-cutover-age:qa'),
        '/opt/node22/bin/node',
        '--input-type=module',
        '-e',
        `${
          fullHost
            ? `
          import assert from 'node:assert/strict';
          import * as fs from 'node:fs/promises';
          import {existsSync} from 'node:fs';
          import {createHash} from 'node:crypto';
          import {execFileSync} from 'node:child_process';
          await fs.access('/.dockerenv'); assert.equal(process.getuid(),0);
          const profile=JSON.parse(await fs.readFile('/qa-build/cache.json','utf8'));
          const call=(command,args,options={})=>execFileSync(command,args,{stdio:['ignore',2,2],...options});
          const file=(name,target)=>{if(existsSync(target)){assert.equal(createHash('sha256').update(requireBytes(target)).digest('hex'),createHash('sha256').update(requireBytes('/qa-build/'+name)).digest('hex'));}else call('cp',['-a','/qa-build/'+name,target]);};
          const {readFileSync:requireBytes}=await import('node:fs');
          file('git','/usr/bin/git');
          ${physicalIngress ? "file('age','/usr/bin/age');" : ''}
          if(!existsSync('/usr/lib/git-core'))call('cp',['-a','/qa-build/git-core','/usr/lib/git-core']);
          if(!existsSync('/opt/node22/lib/node_modules/pnpm'))call('cp',['-a','/qa-build/pnpm','/opt/node22/lib/node_modules/pnpm']);
          assert.equal(JSON.parse(await fs.readFile('/opt/node22/lib/node_modules/pnpm/package.json','utf8')).version,'10.33.0');
          if(!existsSync('/opt/node22/bin/pnpm'))await fs.symlink('/opt/node22/lib/node_modules/pnpm/bin/pnpm.cjs','/opt/node22/bin/pnpm');
          assert.equal(await fs.realpath('/opt/node22/bin/pnpm'),'/opt/node22/lib/node_modules/pnpm/bin/pnpm.cjs');
          await fs.mkdir('/var/lib/holaday/.local/share/pnpm',{recursive:true});
          call('cp',['-a','/qa-build/store','/var/lib/holaday/.local/share/pnpm/store']);
          if (existsSync('/opt/holaday-monorepo')) call('mv',['/opt/holaday-monorepo','/qa-image-original-source']);
          call('git',['clone','--no-hardlinks','/qa-origin.git','/opt/holaday-monorepo']);
          call('git',['-C','/opt/holaday-monorepo','checkout','--detach',profile.sourceCandidate]);
          call('/opt/node22/bin/pnpm',['install','--frozen-lockfile','--offline'],{
            cwd:'/opt/holaday-monorepo',env:{PATH:'/opt/node22/bin:/usr/bin:/bin',HOME:'/var/lib/holaday',NODE_OPTIONS:'--max-old-space-size=192 --v8-pool-size=1',UV_THREADPOOL_SIZE:'1'}
          });
        `
            : ''
        }
        import {spawnSync} from 'node:child_process'; const r=spawnSync(process.execPath,['/source/fixtures/browser-registration-removal-linux.mjs','--execution-site-recovery'],{stdio:'inherit'}); process.exit(r.status ?? 1);`,
      ],
      { stdio: ['pipe', 'pipe', 'pipe'] },
    )
  : spawn(process.execPath, ['--input-type=module', '-e', script], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
child.once('close', () => closeSync(safeDiagnosticFd));
let diagnostic = '';
let budgetReduction;
const reduceCompileBudget = async () => {
  const name = `holaday-retirement-recovery-${attempt}`;
  const rows = JSON.parse((await run('docker', ['inspect', name])).stdout);
  assert.equal(rows.length, 1);
  const before = rows[0];
  assert.match(before.Id, /^[a-f0-9]{64}$/);
  assert.equal(before.Image, process.env.CUTOVER_QA_HOST_IMAGE);
  assert.equal(before.Config.Labels['holaday.qa.runner'], process.env.CUTOVER_QA_RUNNER_TOKEN);
  assert.equal(before.Config.Labels['holaday.cutover.attempt'], attempt);
  assert.equal(before.HostConfig.Memory, 2147483648);
  assert.equal(before.HostConfig.NanoCpus, 1000000000);
  await run('docker', ['update', '--memory', '768m', '--memory-swap', '1g', before.Id]);
  const after = JSON.parse((await run('docker', ['inspect', before.Id])).stdout)[0];
  assert.equal(after.Id, before.Id);
  assert.equal(after.Image, before.Image);
  assert.equal(after.Config.Labels['holaday.qa.runner'], process.env.CUTOVER_QA_RUNNER_TOKEN);
  assert.equal(after.Config.Labels['holaday.cutover.attempt'], attempt);
  assert.equal(after.HostConfig.Memory, 805306368);
  await writeFile(
    join(directory, 'qa-compile-budget-reduction.json'),
    JSON.stringify({
      containerId: before.Id,
      imageId: before.Image,
      attempt,
      beforeMemory: before.HostConfig.Memory,
      afterMemory: after.HostConfig.Memory,
      resourceManagementOnly: true,
    }),
    { mode: 0o600, flag: 'wx' },
  );
};
child.stderr.on('data', (chunk) => {
  persistSafeDiagnostics(chunk);
  // QA-only child diagnostics; emit codes, never snapshot rows or key material.
  diagnostic += chunk.toString();
  if (
    compileBudget &&
    !budgetReduction &&
    diagnostic.includes('QA_COMPILE_COMPLETE_REDUCE_MEMORY\n')
  ) {
    budgetReduction = reduceCompileBudget();
    budgetReduction.catch(() => {});
  }
  if (diagnostic.length > 16384) diagnostic = diagnostic.slice(-16384);
});
const exited = new Promise((resolve, reject) => {
  child.once('error', reject);
  child.once('close', (code) =>
    code === 0
      ? resolve()
      : reject(
          new Error(
            `QA_COORDINATOR_FAILED: ${diagnostic.match(/(?:CUTOVER|MAINTENANCE|QA)_[A-Z_]+|AssertionError/g)?.join(',') ?? 'unclassified'}`,
          ),
        ),
  );
});
// Retain the child outcome even if local serving fails; never restart imports.
exited.catch(() => {});
let servingError;
try {
  await serveFirstCutoverRecoverySession(
    { directory, attempt, scopeDigest },
    {
      input: child.stdout,
      output: child.stdin,
      restore: (input, deps) => restoreFirstCutoverAgeBackup(input, { ...io, ...deps }),
    },
  );
} catch (error) {
  servingError = error;
  const cause = ingressDiagnosticStage(error);
  if (cause) {
    const line =
      'QA_RECOVERY_REJECTION ' + JSON.stringify({ component: 'server', stage: cause }) + '\n';
    persistSafeDiagnostics(Buffer.from(line));
    console.error(line.trimEnd());
  }
} finally {
  child.stdin.end();
}
try {
  await exited;
  if (compileBudget) {
    assert.ok(budgetReduction);
    await budgetReduction;
  }
} catch (error) {
  // This fixture contains synthetic QA material only; keep bounded diagnostics
  // in its private directory, never print database rows or key material.
  const diagnosticPath = join(directory, 'coordinator-diagnostic.log');
  await writeFile(diagnosticPath, diagnostic, { mode: 0o600, flag: 'wx' });
  console.error('QA diagnostic path:', diagnosticPath);
  throw error;
}
if (fullHost) {
  assert.equal(safeDiagnosticFailed, false, 'bounded QA metadata persistence failed');
  assert.ok(safeDiagnosticBytes > 0, 'QA metadata missing');
}
if (servingError && !(retirementLink && recoveryDrift)) throw servingError;
if (retirementLink) {
  if (recoveryDrift) assert.equal(servingError?.message, 'CUTOVER_RECOVERY_SESSION_UNPROVEN');
  const lines = diagnostic.split('\n').filter((line) => line.startsWith('QA_LOST_EFFECT_RESULT '));
  assert.equal(lines.length, 1);
  const proof = JSON.parse(lines[0].slice('QA_LOST_EFFECT_RESULT '.length));
  assert.deepEqual(
    { ...proof, riskDigest: undefined },
    {
      scope: successfulCutover
        ? 'synthetic-complete-cutover'
        : stoppedSource
          ? 'retirement-backup-and-tail-refusal'
          : 'retirement-and-failure-only',
      ...(successfulCutover
        ? { qaFlowPassed: true, reconciliationChecks: 1, lockReleased: true }
        : {}),
      ...(lostOpenAck ? { openAckLost: true, openCommands: 1, statusAfterLostAck: true } : {}),
      ...(lateKnownEffect
        ? { lateKnownEffectBlocked: true, reconciliationChecks: 1, lockRetained: true }
        : {}),
      knownEffect: false,
      phase:
        successfulCutover || lateKnownEffect
          ? 'reconciled'
          : preopenGate
            ? 'verified'
            : candidateTail
              ? 'candidate_started'
              : stoppedSource
                ? 'migration_started'
                : 'backup_verified',
      effectCount: 1,
      releaseReady: false,
      recoveryLinked: !recoveryDrift,
      recoveryRejected: recoveryDrift,
      ...(stoppedSource ? { backupReceipt: true } : {}),
      ...(fullHost ? { originalHost: true, nativeCandidatePreparation: true } : {}),
      ...(candidateTail && !successfulCutover
        ? {
            candidateStartedClosed: true,
            failureMode: 'draining',
            closeAcknowledged: false,
            admissionClosed: true,
          }
        : {}),
      ...(preopenGate ? { nativePreopenVerified: true } : {}),
      ...(['after-open', 'after-ingress', 'after-worker', 'success', 'late-known-effect'].includes(
        hostFault,
      )
        ? {
            candidateOpened: true,
            needsReconciliation: true,
            ingressRestored: nativeIngress,
          }
        : {}),
      ...(hostFault === 'after-worker' || successfulCutover || lateKnownEffect
        ? { nativeStartupPersisted: true, workerEnabled: enabledWorker }
        : {}),
      ...(enabledWorker ? { workerTickObserved: true } : {}),
      riskDigest: undefined,
    },
  );
  assert.match(proof.riskDigest, /^[a-f0-9]{64}$/);
  if (stoppedSource) {
    // Independent semantic assertions, in addition to the production complete
    // snapshot comparator and original migration/schema contract.
    const values = 'SELECT HEX(text_value), HEX(payload), optional_value IS NULL FROM sample';
    assert.equal(await query(values), 'E6B5B7E8BEB9\t00FF5C27\t1');
    assert.equal(await queryAt(sourceContainerId, values), 'E6B5B7E8BEB9\t00FF5C27\t1');
    assert.equal(
      await query(
        'SELECT COUNT(*) FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA=DATABASE()',
      ),
      '1',
    );
    assert.equal(
      await query('SELECT COUNT(*) FROM information_schema.EVENTS WHERE EVENT_SCHEMA=DATABASE()'),
      '1',
    );
    assert.equal(
      await queryAt(
        sourceContainerId,
        'SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE()',
      ),
      candidateTail ? '90' : '2',
    );
    await inspectFirstCutoverRecoveryTarget(sourceTarget, { requireEmpty: false });
  } else
    assert.equal(
      await query('SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE()'),
      '0',
    );
  console.log(
    enabledWorker && hostFault !== 'after-worker'
      ? 'PASS same-attempt full cutover with enabled UID998 worker: real poll, same process through reconciliation, both startup files persisted, one open/no close/no replay and lock released. NOT production release or payment recovery.'
      : lostOpenAck
        ? 'PASS same-attempt actual open effect with lost reply: original transition queries the real candidate and completes recovery/nginx/reconciliation with exactly one open, no close or replay. NOT production readiness or provider recovery.'
        : lateKnownEffect
          ? 'PASS actual same-attempt open/nginx/startup followed by late read-only discovery of a specific unresolved external action: original hold closes same dirty candidate, both HTTPS entrances deny work, lock retained, action count remains one. NOT production reconciliation.'
          : successfulCutover
            ? 'PASS synthetic same-attempt original host/retirement/backup/Mac recovery/migration/newboot/preopen/open/nginx/startup plus actual QA DB and identity reconciliation, lock released, effect retained without replay. NOT production release readiness or external payment recovery.'
            : hostFault === 'after-worker'
              ? `PASS same original host/source/recovery/newboot/preopen/open/native ingress -> ${enabledWorker ? 'native enabled UID998 worker poll' : 'native disabled-worker verification'} and both approved startup files persisted -> explicit post-worker failure; one protective close, dirty state and lock retained, both entrances deny work, no replay. NOT successful cutover or production release.`
              : hostFault === 'after-ingress'
                ? 'PASS same original host/recovery/migration/new boot/preopen/open -> real three-site nginx restoration with bound receipts and HTTPS -> explicit pre-worker failure, one close, dirty retained, both application entrances deny work; NOT full cutover.'
                : hostFault === 'after-open'
                  ? 'PASS same original recovery/migration/start/verify/beforeOpen -> one actual open and native serving identity proof -> explicit ingress failure, one close, dirty retained and HTTP work denied; no reopen/replay. NOT full cutover.'
                  : hostFault === 'before-open'
                    ? 'PASS same original host/retirement/backup/Mac restore/source migration/new closed boot -> native verify and beforeOpen evidence -> fault before open, one close, actual HTTP work denied; no open/replay. NOT full cutover.'
                    : hostFault === 'after-start'
                      ? 'PASS original host/retirement/backup/Mac restore -> actual source migration/seed/new closed candidate -> post-start fault, one close, draining retained and actual HTTP work denied; no open/replay. NOT full cutover.'
                      : stoppedSource
                        ? 'PASS same Linux physical retirement/site/journal -> original source dump/age -> Mac isolated restore/all61 migrations -> original durable receipt; candidate tail explicitly refused, no replay. NOT full cutover.'
                        : recoveryDrift
                          ? 'PASS real Linux site rejected newly identified external work during original Mac recovery attach; target empty, no receipt/candidate/replay. NOT full cutover.'
                          : 'PASS same actual Linux stopped attempt/site/journal -> original Mac recovery pipes -> pinned isolated target identity; source export/restore/candidate tail intentionally NOT configured, no backup receipt or replay. NOT full cutover.',
  );
} else {
  assert.equal(
    await query('SELECT HEX(text_value), HEX(payload), optional_value IS NULL FROM sample'),
    'E6B5B7E8BEB9\t00FF5C27\t1',
  );
  assert.equal(
    await query('SELECT COUNT(*) FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA=DATABASE()'),
    '1',
  );
  assert.equal(
    await query('SELECT COUNT(*) FROM information_schema.EVENTS WHERE EVENT_SCHEMA=DATABASE()'),
    '1',
  );
  if (!fullSource)
    await assert.rejects(
      restoreFirstCutoverAgeBackup(request, { ...io, assertScope: async () => {} }),
      {
        message: 'CUTOVER_RECOVERY_IMPORT_UNPROVEN',
      },
    );
  assert.equal(await query('SELECT COUNT(*) FROM sample'), '1');
  console.log(
    fullSource
      ? 'PASS actual distinct no-network MySQL source -> mysqldump/age -> original recovery session -> full comparison -> all61 migrations -> source unchanged -> original sealed backup receipt. Mac coordinator; production physical stop/SSH and full cutover NOT proven.'
      : runtimeRoot
        ? 'PASS actual same coordinator child pipes/file journal + pinned no-network Docker + age fd import + original full snapshot + all61 original migrations + schema/business check. Physical stopped facts/source SSH synthetic; not production/complete release proof.'
        : 'PASS actual pinned no-network Docker + authenticated age import over real coordinator child pipes and file journal; UTF8/BLOB/NULL/trigger/event and repeat refusal; physical stopped facts/source SSH synthetic, no production or migration proof',
  );
}
