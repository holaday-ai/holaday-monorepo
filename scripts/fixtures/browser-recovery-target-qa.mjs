// Actual recovery-machine Docker/age/import exercise. The caller creates the
// dedicated no-network container/volume; this fixture never stops/removes one.
// Payload and key are synthetic. Optional separate source container exercises
// the original backup coordinator with mysqldump and a durable journal receipt.
// CUTOVER_QA_RETIREMENT binds the real Linux stopping fixture to this session.
// Production coverage, source SSH and the full host/candidate tail are NOT proven.
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmod, mkdir, mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { promisify } from 'node:util';
import {
  encryptAgeBackup,
  inspectFirstCutoverRecoveryTarget,
  pullFirstCutoverAgeBackup,
  restoreFirstCutoverAgeBackup,
} from '../browser-first-cutover-backup.mjs';
import { serveFirstCutoverRecoverySession } from '../browser-first-cutover-recovery-session.mjs';
import { buildMaintenanceMigrationManifest } from '../browser-maintenance-manifest.mjs';

const [containerId, imageId, attempt, runtimeRoot, sourceContainerId, sourceAttempt] =
  process.argv.slice(2);
assert.match(containerId ?? '', /^[a-f0-9]{64}$/);
assert.match(imageId ?? '', /^sha256:[a-f0-9]{64}$/);
assert.match(attempt ?? '', /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/);
const fullSource = Boolean(sourceContainerId);
const retirementLink = process.env.CUTOVER_QA_RETIREMENT === '1';
const recoveryDrift = process.env.CUTOVER_QA_RECOVERY_DRIFT === '1';
assert.ok(!recoveryDrift || retirementLink);
assert.ok(!retirementLink || fullSource || !runtimeRoot);
const stoppedSource = retirementLink && fullSource;
const fullHost = process.env.CUTOVER_QA_HOST === '1';
const hostFault = process.env.CUTOVER_QA_HOST_FAULT ?? 'before-migration';
assert.ok(['before-migration', 'after-start', 'before-open', 'after-open'].includes(hostFault));
const candidateTail = hostFault !== 'before-migration';
const preopenGate = ['before-open', 'after-open'].includes(hostFault);
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
    await run('docker', [
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
    ])
  ).stdout.trim();
const query = (sql) => queryAt(containerId, sql);
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
  const { build } = await import(
    '../../node_modules/.pnpm/esbuild@0.25.12/node_modules/esbuild/lib/main.js'
  );
  await build({
    entryPoints: [resolve('apps/orchestrator/node_modules/mysql2/promise.js')],
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
        'ACCOUNT_CLOSURE_WORKER_ENABLED=false',
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
  maintenanceEndsAtMs: Date.now() + (fullHost ? 600000 : 120000),
  sourceOptions,
  destination,
  identityFile,
  target,
  sourceIdentity,
};
if (runtimeRoot) {
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
        fullHost ? '--memory=3g' : '--memory=512m',
        '--pids-limit=256',
        '--cap-add=SYS_PTRACE',
        '--label',
        `holaday.cutover.attempt=${attempt}`,
        '--mount',
        `type=bind,src=${resolve('scripts')},dst=/source,readonly`,
        '--mount',
        `type=bind,src=${resolve('ops')},dst=/ops,readonly`,
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
        'holaday-first-cutover-age:qa',
        '/opt/node22/bin/node',
        '--input-type=module',
        '-e',
        `${
          fullHost
            ? `
          import assert from 'node:assert/strict';
          import * as fs from 'node:fs/promises';
          import {execFileSync} from 'node:child_process';
          await fs.access('/.dockerenv'); assert.equal(process.getuid(),0);
          const profile=JSON.parse(await fs.readFile('/qa-build/cache.json','utf8'));
          const call=(command,args,options={})=>execFileSync(command,args,{stdio:['ignore',2,2],...options});
          call('cp',['-a','/qa-build/git','/usr/bin/git']);
          call('cp',['-a','/qa-build/git-core','/usr/lib/git-core']);
          call('cp',['-a','/qa-build/pnpm','/opt/node22/lib/node_modules/pnpm']);
          await fs.symlink('/opt/node22/lib/node_modules/pnpm/bin/pnpm.cjs','/opt/node22/bin/pnpm');
          await fs.mkdir('/var/lib/holaday/.local/share/pnpm',{recursive:true});
          call('cp',['-a','/qa-build/store','/var/lib/holaday/.local/share/pnpm/store']);
          call('mv',['/opt/holaday-monorepo','/qa-image-original-source']);
          call('git',['clone','--no-hardlinks','/qa-origin.git','/opt/holaday-monorepo']);
          call('git',['-C','/opt/holaday-monorepo','checkout','--detach',profile.sourceCandidate]);
          call('/opt/node22/bin/pnpm',['install','--frozen-lockfile','--offline'],{
            cwd:'/opt/holaday-monorepo',env:{PATH:'/opt/node22/bin:/usr/bin:/bin',HOME:'/var/lib/holaday'}
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
let diagnostic = '';
child.stderr.on('data', (chunk) => {
  // QA-only child diagnostics; emit codes, never snapshot rows or key material.
  diagnostic += chunk.toString();
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
} finally {
  child.stdin.end();
}
try {
  await exited;
} catch (error) {
  // This fixture contains synthetic QA material only; keep bounded diagnostics
  // in its private directory, never print database rows or key material.
  const diagnosticPath = join(directory, 'coordinator-diagnostic.log');
  await writeFile(diagnosticPath, diagnostic, { mode: 0o600, flag: 'wx' });
  console.error('QA diagnostic path:', diagnosticPath);
  throw error;
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
      scope: stoppedSource ? 'retirement-backup-and-tail-refusal' : 'retirement-and-failure-only',
      knownEffect: false,
      phase: preopenGate
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
      ...(candidateTail
        ? {
            candidateStartedClosed: true,
            failureMode: 'draining',
            closeAcknowledged: false,
            admissionClosed: true,
          }
        : {}),
      ...(preopenGate ? { nativePreopenVerified: true } : {}),
      ...(hostFault === 'after-open'
        ? { candidateOpened: true, needsReconciliation: true, ingressRestored: false }
        : {}),
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
    hostFault === 'after-open'
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
