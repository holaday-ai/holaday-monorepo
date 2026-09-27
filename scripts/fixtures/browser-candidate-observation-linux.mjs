// Bounded disposable Linux QA: real PM2/proc/listeners/runuser/control transport.
// Synthetic candidate protocol only; NOT the maintenance coordinator or full app.
// Catches bypassed identity validation, missed app orphans, and broken fixed argv.
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { once } from 'node:events';
import * as fs from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import { promisify } from 'node:util';
import { readFirstCutoverCandidateRuntime } from '/source/browser-first-cutover-host.mjs';

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
          const serving = reads > 1;
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
    `${root}/start.sh`,
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
    `${root}/start.sh`,
    '--name',
    'holaday-orchestrator',
    '--cwd',
    cwd,
    '--interpreter',
    '/bin/sh',
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
