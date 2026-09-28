// Bounded disposable Linux QA: real PM2/proc/listeners/runuser/control transport.
// Synthetic candidate protocol only; NOT the maintenance coordinator or full app.
// Catches bypassed identity validation, missed app orphans, and broken fixed argv.
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import * as fs from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import { promisify } from 'node:util';
import {
  readFirstCutoverCandidateRuntime,
  resumeFirstCutoverCandidateWorker,
} from '/source/browser-first-cutover-host.mjs';
import { acquireReleaseJournal } from '/source/browser-maintenance-journal.mjs';

await fs.access('/.dockerenv');
assert.equal(process.platform, 'linux');
assert.equal(process.getuid(), 0);
process.env.PATH = `/opt/node22/bin:${process.env.PATH}`;
process.env.PM2_HOME = '/root/.pm2';
const exec = async (file, args) =>
  (
    await promisify(execFile)(file, args, {
      encoding: 'utf8',
      timeout: 15000,
      maxBuffer: 8 * 1024 * 1024,
    })
  ).stdout;
const pm2 = (...args) =>
  exec('/opt/node22/bin/node', ['/opt/node22/lib/node_modules/pm2/bin/pm2', ...args]);
const rows = async () => JSON.parse(await pm2('jlist'));
const identity = { candidate: 'd'.repeat(40), bootId: 'e'.repeat(32) };
const root = `/opt/holaday-releases/${identity.candidate}`;
const cwd = `${root}/apps/orchestrator`;
const controlDirectory = '/var/lib/holaday/ordinary-maintenance';
const reject = /^Error: CUTOVER_CANDIDATE_OBSERVATION_UNPROVEN$/;
let orphan;
let unrelatedPid;
let candidateCreated = false;
let unrelatedCreated = false;
const until = async (read) => {
  for (let n = 0; ; n++) {
    try {
      return await read();
    } catch (error) {
      if (n === 60) throw error;
      await sleep(100);
    }
  }
};
try {
  // Exclusive create: never overwrite preexisting candidate/control fixtures.
  await fs.mkdir('/opt/holaday-releases', { recursive: true });
  await fs.mkdir(root);
  await fs.mkdir(cwd, { recursive: true });
  await fs.mkdir(`${root}/scripts`);
  for (const file of ['browser-maintenance-control.mjs', 'browser-maintenance-client.mjs'])
    await fs.copyFile(`/source/${file}`, `${root}/scripts/${file}`);
  await fs.mkdir('/var/lib/holaday', { recursive: true });
  await fs.mkdir(controlDirectory, { mode: 0o700 });
  await fs.chown(controlDirectory, 998, 998);
  await fs.mkdir(`${cwd}/dist`);
  await fs.writeFile(
    `${cwd}/dist/index.js`,
    `
    const http = require('node:http');
    const fs = require('node:fs');
    const net = require('node:net');
    const identity = ${JSON.stringify(identity)};
    const directory = ${JSON.stringify(controlDirectory)};
    let reads = 0;
    // SYNTHETIC protocol model: no real coordinator, DB, work counters or app.
    if (!process.argv.includes('--qa-orphan') && !process.argv.includes('--without-control')) {
      const server = net.createServer(socket => {
        socket.on('error', ()=>{});
        let input = '';
        socket.on('data', bytes => {
          input += bytes;
          if (!input.endsWith('\\n')) return;
          let q;
          try { q = JSON.parse(input); } catch { socket.end(JSON.stringify({ok:false,code:'INVALID_COMMAND'})+'\\n'); return; }
          fs.appendFileSync(directory+'/requests.ndjson', JSON.stringify(q)+'\\n');
          if (q.protocol !== 1 || q.op !== 'status') {
            socket.end(JSON.stringify({ok:false,code:'INVALID_COMMAND'})+'\\n'); return;
          }
          if (q.candidate !== identity.candidate || q.bootId !== identity.bootId) {
            socket.end(JSON.stringify({ok:false,code:'IDENTITY_MISMATCH'})+'\\n'); return;
          }
          if (fs.existsSync(directory+'/flip')) reads++; else reads = 0;
          const serving = reads > 1 || fs.existsSync(directory+'/serving');
          const counts = {mode: serving?'open':'closed',idle:!serving,active:0,roots:0,children:0,unknown:0,
            byKind:{request:0,execution:0,suggestions:0,database:0,model:0,scheduler:0}};
          socket.end(JSON.stringify({ok:true,snapshot:{identity,mode:serving?'serving':'closed',needsReconciliation:serving,counts}})+'\\n');
        });
      });
      server.listen(directory+'/control.sock', ()=>fs.chmodSync(directory+'/control.sock',0o600));
    }
    if (!process.argv.includes('--qa-orphan')) for (const port of [4001, 4002]) http.createServer((q,r)=>r.end('synthetic QA')).listen(port, '127.0.0.1');
    setInterval(()=>{},1000);
  `,
    { flag: 'wx' },
  );
  await fs.writeFile(
    `${root}/scripts/start-orchestrator-production.sh`,
    `#!/bin/sh\nexec /opt/node22/bin/node ${cwd}/dist/index.js ${process.argv.includes('--without-control') ? '--without-control' : ''}\n`,
    { flag: 'wx', mode: 0o755 },
  );
  await pm2('ping'); // Consume first-use banner before JSON observations.
  assert.equal((await pm2('--version')).trim(), '6.0.14');
  assert.equal(
    (await rows()).some((r) => r.name === 'holaday-orchestrator'),
    false,
  );
  assert.equal(
    (await rows()).some((r) => r.name === 'qa-candidate-observation-unrelated'),
    false,
  );
  await fs.writeFile(`${root}/unrelated.cjs`, 'setInterval(()=>{},1000);\n', { flag: 'wx' });
  await pm2('start', `${root}/unrelated.cjs`, '--name', 'qa-candidate-observation-unrelated');
  unrelatedCreated = true;
  unrelatedPid = (await rows()).find((r) => r.name === 'qa-candidate-observation-unrelated').pid;
  process.env.HOLADAY_ORDINARY_MAINTENANCE = '1';
  process.env.HOLADAY_ORDINARY_CANDIDATE = identity.candidate;
  await pm2(
    'start',
    `${root}/scripts/start-orchestrator-production.sh`,
    '--name',
    'holaday-orchestrator',
    '--cwd',
    cwd,
    '--interpreter',
    '/usr/bin/bash',
    '--uid',
    '998',
    '--gid',
    '998',
    '--no-autorestart',
  );
  candidateCreated = true;
  await until(async () => {
    for (const port of [4001, 4002])
      assert.equal((await fetch(`http://127.0.0.1:${port}`)).status, 200);
  });
  // TDD red: --without-control rejects before any synthetic server was added.
  const observed = await readFirstCutoverCandidateRuntime(identity);
  assert.deepEqual(observed.identity, identity);
  assert.equal(observed.mode, 'closed');
  assert.equal(observed.idle, true);
  assert.equal(observed.needsReconciliation, false);
  assert.equal(observed.runtime.main.uid, 998);
  assert.equal(observed.runtime.main.cwd, cwd);
  assert.equal(observed.runtime.main.command, 'main');
  assert.equal(await fs.readlink(`/proc/${observed.runtime.main.pid}/exe`), '/opt/node22/bin/node');
  assert.equal(
    observed.runtime.main.pid,
    (await rows()).find((r) => r.name === 'holaday-orchestrator').pid,
  );
  assert.equal(observed.runtime.worker, null);
  const socketStat = await fs.stat(`${controlDirectory}/control.sock`);
  assert.equal(socketStat.isSocket(), true);
  assert.equal(socketStat.uid, 998);
  assert.equal(socketStat.mode & 0o777, 0o600);
  const requests = async () =>
    (await fs.readFile(`${controlDirectory}/requests.ndjson`, 'utf8'))
      .trim()
      .split('\n')
      .map(JSON.parse);
  assert.deepEqual(await requests(), [
    { protocol: 1, ...identity, op: 'status' },
    { protocol: 1, ...identity, op: 'status' },
  ]);
  console.log(
    'PASS default reader: real fixed runuser argv, UID998 PM2 Node, proc, ports 4001/4002 and socket transport; synthetic candidate protocol',
  );
  await assert.rejects(
    readFirstCutoverCandidateRuntime({ ...identity, bootId: 'f'.repeat(32) }),
    reject,
  );
  await assert.rejects(
    readFirstCutoverCandidateRuntime({ ...identity, candidate: 'f'.repeat(40) }),
    reject,
  );
  await assert.rejects(readFirstCutoverCandidateRuntime({ ...identity, extra: true }), reject);
  await fs.writeFile(`${controlDirectory}/flip`, '', { flag: 'wx' });
  await assert.rejects(readFirstCutoverCandidateRuntime(identity), reject);
  await fs.unlink(`${controlDirectory}/flip`);
  await readFirstCutoverCandidateRuntime(identity);
  console.log(
    'PASS control-state change between real bracketing socket reads rejected (synthetic state transition)',
  );
  orphan = spawn('/opt/node22/bin/node', [`${cwd}/dist/index.js`, '--qa-orphan'], {
    cwd,
    uid: 998,
    gid: 998,
    stdio: 'ignore',
  });
  orphan.exited = once(orphan, 'exit');
  await until(async () =>
    assert.match(await fs.readFile(`/proc/${orphan.pid}/cmdline`, 'utf8'), /dist\/index.js/),
  );
  await assert.rejects(readFirstCutoverCandidateRuntime(identity), reject);
  orphan.kill('SIGTERM');
  await orphan.exited;
  orphan = undefined;
  await readFirstCutoverCandidateRuntime(identity);
  assert.equal(
    (await rows()).find((r) => r.name === 'qa-candidate-observation-unrelated').pid,
    unrelatedPid,
  );
  console.log(
    'PASS wrong candidate/boot/extra identity rejected; real UID998 orphan rejected; recovery and unrelated PID preserved',
  );
  if (process.argv.includes('--resume-worker')) {
    // Real worker/proc/PM2/save/journal I/O; only candidate workload/control and
    // legacy two-host scope are synthetic. No source database or live service.
    const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
    await fs.copyFile('/source/secure-pm2-logs.mjs', `${root}/scripts/secure-pm2-logs.mjs`);
    await fs.mkdir(`${cwd}/dist/account-closure`);
    await fs.writeFile(
      `${cwd}/dist/account-closure/worker-entry.js`,
      'setInterval(()=>{},1000);\n',
      { flag: 'wx' },
    );
    await fs.writeFile(
      `${root}/scripts/start-account-closure-worker-production.sh`,
      `#!/bin/sh\nexec /opt/node22/bin/node ${cwd}/dist/account-closure/worker-entry.js\n`,
      { flag: 'wx', mode: 0o755 },
    );
    await fs.mkdir('/var/lib/holaday-deploy', { recursive: true });
    const storage = '/var/lib/holaday-deploy/maintenance';
    await fs.mkdir(storage, { mode: 0o700 });
    const enabled = !process.argv.includes('--worker-disabled');
    const missingBackup = process.argv.includes('--missing-backup');
    const config = Buffer.from(`ACCOUNT_CLOSURE_WORKER_ENABLED=${enabled}\n`);
    await fs.writeFile('/var/lib/holaday-deploy/maintenance-target.env', config, {
      flag: 'wx',
      mode: 0o600,
    });
    const binding = {
      attempt: '11111111-1111-4111-8111-111111111111',
      candidate: identity.candidate,
      configDigest: sha(config),
      migrationDigest: sha('[]'),
      inventoryDigest: '1'.repeat(64),
    };
    const journal = await acquireReleaseJournal(storage, {
      ...binding,
      legacyDigest: '2'.repeat(64),
      kind: 'first-cutover',
    });
    try {
      await journal.bindManifest([]);
      for (const phase of [
        'prepared',
        'orders_fenced',
        'legacy_settled',
        'producers_stopped',
        'all_fenced',
        'stopped',
        'backup_verified',
      ])
        await journal.persist(phase, { candidate: identity.candidate });
      await journal.bindBackupReceipt({
        ...binding,
        backupDigest: '1'.repeat(64),
        databaseIdentityDigest: '2'.repeat(64),
        isolatedTargetDigest: '3'.repeat(64),
        encryptionProfileDigest: '4'.repeat(64),
        comparisonDigest: '5'.repeat(64),
        schemaDigest: '6'.repeat(64),
        businessDigest: '7'.repeat(64),
        restoredAtMs: Date.now(),
      });
      await journal.persist('migration_started', { candidate: identity.candidate });
      await journal.bindBootstrapSeed('8'.repeat(32));
      await journal.persist('candidate_started', { candidate: identity.candidate });
      await journal.persist('verified', { candidate: identity.candidate, identity });
      await fs.writeFile(`${controlDirectory}/serving`, '', { flag: 'wx' });
      const primary = '[{ "name": "unrelated-primary", "counter": 9007199254740993 }]\n';
      const fallback = '[{ "name": "unrelated-backup", "counter": 9007199254740995 }]\n';
      await fs.writeFile('/root/.pm2/dump.pm2', primary, { flag: 'wx', mode: 0o600 });
      if (!missingBackup)
        await fs.writeFile('/root/.pm2/dump.pm2.bak', fallback, { flag: 'wx', mode: 0o600 });
      const files = [primary, fallback].map((bytes, i) => ({
        path: `/root/.pm2/${i ? 'dump.pm2.bak' : 'dump.pm2'}`,
        digest: i === 1 && missingBackup ? null : sha(bytes),
        remove: [],
      }));
      const context = {
        binding,
        approval: { ...binding, maintenanceEndsAtMs: Date.now() + 120000 },
        journal,
        root,
        applicationGid: 998,
      };
      const unrelatedBefore = (await rows()).find((r) => r.pid === unrelatedPid);
      const overrides = {
        parseConfig: () => ({ ACCOUNT_CLOSURE_WORKER_ENABLED: String(enabled) }),
        assertNoLegacy: async (id) => {
          assert.deepEqual(id, identity);
          assert.equal(
            (await rows()).find((r) => r.name === 'qa-candidate-observation-unrelated').pid,
            unrelatedPid,
          );
        },
      };
      await resumeFirstCutoverCandidateWorker(context, identity, files, overrides);
      const actual = await readFirstCutoverCandidateRuntime(identity);
      assert.equal(actual.runtime.main.pid, observed.runtime.main.pid);
      if (enabled) {
        assert.equal(actual.runtime.worker.uid, 998);
        assert.equal(actual.runtime.worker.command, 'worker');
      } else assert.equal(actual.runtime.worker, null);
      assert.equal(actual.mode, 'serving');
      for (const [i, original] of [primary, fallback].entries()) {
        const bytes = await fs.readFile(files[i].path, 'utf8');
        if (!(i === 1 && missingBackup)) assert(bytes.includes(original.slice(1, -2)));
        assert.deepEqual(
          JSON.parse(bytes).map((r) => r.name),
          [
            ...(i === 1 && missingBackup ? [] : [i ? 'unrelated-backup' : 'unrelated-primary']),
            'holaday-orchestrator',
            ...(enabled ? ['holaday-account-closure-worker'] : []),
          ],
        );
        assert.equal((await fs.stat(files[i].path)).mode & 0o777, 0o600);
      }
      assert.equal((await journal.readFirstCutoverEffects()).candidateStartupEvents.length, 6);
      await assert.rejects(
        resumeFirstCutoverCandidateWorker(context, identity, files, overrides),
        /UNPROVEN/,
      );
      assert.equal(
        (await rows()).find((r) => r.name === 'holaday-account-closure-worker')?.pid ?? null,
        actual.runtime.worker?.pid ?? null,
      );
      const unrelatedAfter = (await rows()).find((r) => r.pid === unrelatedPid);
      assert.equal(unrelatedAfter.pm2_env.restart_time, unrelatedBefore.pm2_env.restart_time);
      console.log(
        `PASS real worker enabled=${enabled} missingBackup=${missingBackup}: same main + original journal/atomic persistence; unrelated PID/restarts/raw integers preserved; replay refused (synthetic workload/legacy scope)`,
      );
    } finally {
      await journal.close();
    }
  }
} finally {
  if (orphan) {
    orphan.kill('SIGTERM');
    await orphan.exited;
  }
  if (candidateCreated) await pm2('delete', 'holaday-orchestrator');
  if (unrelatedCreated) {
    assert.equal(
      (await rows()).find((r) => r.name === 'qa-candidate-observation-unrelated').pid,
      unrelatedPid,
    );
    await pm2('delete', 'qa-candidate-observation-unrelated');
  }
  // No pm2 kill/delete-all; remaining preexisting resources belong to others.
}
