import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import test from 'node:test';
import * as host from './browser-first-cutover-host.mjs';

test('candidate runtime reader binds two actual control statuses around the existing process observer', async () => {
  assert.equal(typeof host.readFirstCutoverCandidateRuntime, 'function');
  const identity = { candidate: 'a'.repeat(40), bootId: 'b'.repeat(32) };
  const runtime = {
    identity,
    root: `/opt/holaday-releases/${identity.candidate}`,
    main: { pid: 70 },
    worker: null,
  };
  const calls = [];
  let status = { protocol: 1, identity, mode: 'closed', idle: true, needsReconciliation: false };
  const io = {
    platform: 'linux',
    uid: 0,
    exec: async (file, argv, options) => {
      calls.push({ file, argv, options });
      return JSON.stringify(status);
    },
    observe: async (asked) => {
      assert.deepEqual(asked, identity);
      return runtime;
    },
  };
  const value = await host.readFirstCutoverCandidateRuntime(identity, io);
  assert.deepEqual(value, {
    identity,
    mode: 'closed',
    idle: true,
    needsReconciliation: false,
    runtime,
  });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].file, 'runuser');
  assert.deepEqual(calls[0].argv.slice(-3), ['status', identity.candidate, identity.bootId]);
  assert.ok(
    calls[0].argv.includes(
      `/opt/holaday-releases/${identity.candidate}/scripts/browser-maintenance-control.mjs`,
    ),
  );
  await assert.rejects(
    host.readFirstCutoverCandidateRuntime(identity, { ...io, platform: 'darwin' }),
    /UNPROVEN/,
  );
  await assert.rejects(
    host.readFirstCutoverCandidateRuntime(identity, {
      ...io,
      observe: async () => {
        status = { ...status, mode: 'serving', idle: false, needsReconciliation: true };
        return runtime;
      },
    }),
    /UNPROVEN/,
  );
});

const nonce = '12345678-1234-4234-8234-123456789abc';
const source = Buffer.from('export const synthetic = true;');
const sourceDigest = createHash('sha256').update(source).digest('hex');
const boot = '11111111-1111-4111-8111-111111111111';

function fixture(change = () => {}) {
  const calls = [];
  let now = 2000;
  return {
    calls,
    setTime(value) {
      now = value;
    },
    io: {
      now: () => now,
      randomUUID: () => nonce,
      readObserverSource: async () => source,
      exec: async (command, args, options) => {
        const name = args.includes('root@47.99.169.186') ? 'aliyun' : 'vultr';
        calls.push({ command, args, options, name });
        const process = { pid: 91, start: '9000', argvDigest: 'a'.repeat(64) };
        const reply = {
          protocol: 1,
          requestId: nonce,
          host: name,
          sourceDigest,
          sourceCandidate: name === 'vultr' ? 'c'.repeat(40) : null,
          snapshot: { observedAtMs: 1500, bootId: boot, processes: [process], observer: process },
        };
        await change(reply, name);
        return JSON.stringify(reply);
      },
    },
  };
}

test('two-host observation uses fixed strict SSH endpoints and returns actual bound snapshots', async () => {
  assert.equal(typeof host.readFirstCutoverHostPair, 'function');
  const f = fixture();
  const result = await host.readFirstCutoverHostPair(f.io);
  assert.deepEqual(
    result.hosts.map(({ host }) => host),
    ['aliyun', 'vultr'],
  );
  assert.equal(result.observedAtMs, 1500);
  assert.equal(result.sourceDigest, sourceDigest);
  assert.equal(result.sourceCandidate, 'c'.repeat(40));
  assert.equal(f.calls.length, 2);
  for (const call of f.calls) {
    assert.equal(call.command, 'ssh');
    assert.ok(call.args.includes('StrictHostKeyChecking=yes'));
    assert.ok(call.args.includes('ForwardAgent=no'));
    assert.ok(call.args.includes('ClearAllForwardings=yes'));
    assert.equal(call.options.shell, false);
    assert.equal(call.options.timeout, undefined, 'do not timeout/kill the SSH subprocess');
    assert.equal(typeof call.options.input, 'string');
    assert.equal(
      call.args.at(-1),
      call.name === 'aliyun'
        ? '/usr/bin/node --input-type=module'
        : '/opt/node22/bin/node --input-type=module',
    );
  }
  assert.ok(f.calls[1].args.some((arg) => arg.startsWith('ProxyCommand=ssh ')));
  assert.ok(!JSON.stringify(result).includes('ready'), 'an observation is not readiness');
});

for (const [name, change] of [
  [
    'old request',
    (r) => {
      r.requestId = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
    },
  ],
  [
    'wrong host',
    (r) => {
      r.host = r.host === 'aliyun' ? 'vultr' : 'aliyun';
    },
  ],
  [
    'different observer code',
    (r) => {
      r.sourceDigest = 'b'.repeat(64);
    },
  ],
  [
    'old protocol',
    (r) => {
      r.protocol = 0;
    },
  ],
  [
    'missing self identity',
    (r) => {
      r.snapshot.observer = { pid: 92 };
    },
  ],
  [
    'changed self identity',
    (r) => {
      r.snapshot.observer = { ...r.snapshot.observer, start: '9001' };
    },
  ],
  [
    'duplicate self identity',
    (r) => {
      r.snapshot.processes.push({ ...r.snapshot.observer });
    },
  ],
  [
    'stale snapshot',
    (r) => {
      r.snapshot.observedAtMs = -60001;
    },
  ],
  [
    'future snapshot',
    (r) => {
      r.snapshot.observedAtMs = 3000;
    },
  ],
  [
    'malformed boot identity',
    (r) => {
      r.snapshot.bootId = 'unknown';
    },
  ],
  [
    'unbound checkout',
    (r) => {
      r.sourceCandidate = 'unknown';
    },
  ],
]) {
  test(`two-host observation refuses ${name} without retrying`, async () => {
    assert.equal(typeof host.readFirstCutoverHostPair, 'function');
    const f = fixture(change);
    await assert.rejects(host.readFirstCutoverHostPair(f.io), /CUTOVER_HOST_PAIR_UNPROVEN/);
    assert.ok(f.calls.length <= 2);
  });
}

test('one failed host never yields a partial successful pair or leaks remote stderr', async () => {
  assert.equal(typeof host.readFirstCutoverHostPair, 'function');
  let finished = false;
  const f = fixture(async (_, name) => {
    if (name === 'aliyun') throw new Error('password=synthetic-secret');
    await new Promise((resolve) => setTimeout(resolve, 20));
    finished = true;
  });
  await assert.rejects(host.readFirstCutoverHostPair(f.io), {
    message: 'CUTOVER_HOST_PAIR_UNPROVEN',
  });
  assert.equal(finished, true, 'no outstanding remote read after caller receives failure');
  assert.equal(f.calls.length, 2);
});

test('the actual stdin payload invokes the collector and checks the old checkout, without installing files', async () => {
  assert.equal(typeof host.readFirstCutoverHostPair, 'function');
  const payloads = [];
  const code = Buffer.from(`
const hostSystem = {exec: async (command, args) => {
  if (command !== 'git' || args[0] !== '-C' || args[1] !== '/opt/holaday-monorepo') throw Error('bad command');
  if (args.includes('rev-parse')) return '${'c'.repeat(40)}\\n';
  if (args.includes('diff')) return '';
  throw Error('unexpected effect');
}};
async function readCutoverHostSnapshot() {
  return {observedAtMs:Date.now(), bootId:'${boot}', processes:[{pid:process.pid, start:'100', argvDigest:'${'a'.repeat(64)}'}]};
}
`);
  const result = await host.readFirstCutoverHostPair({
    readObserverSource: async () => code,
    exec: async (_command, _args, { input }) => {
      payloads.push(input);
      return new Promise((resolve, reject) => {
        const child = execFile(
          process.execPath,
          ['--input-type=module'],
          { encoding: 'utf8' },
          (error, stdout) => {
            if (error) reject(error);
            else resolve(stdout);
          },
        );
        child.stdin.end(input);
      });
    },
  });
  assert.equal(payloads.length, 2);
  assert.equal(result.sourceCandidate, 'c'.repeat(40));
  assert.ok(result.hosts.every(({ snapshot }) => snapshot.observer.pid !== process.pid));
});

test('pair freshness is checked after the slower host finishes', async () => {
  assert.equal(typeof host.readFirstCutoverHostPair, 'function');
  const f = fixture((_, name) => {
    if (name === 'vultr') f.setTime(62001);
  });
  await assert.rejects(host.readFirstCutoverHostPair(f.io), /CUTOVER_HOST_PAIR_UNPROVEN/);
});

test('local clock reversal refuses the whole pair', async () => {
  assert.equal(typeof host.readFirstCutoverHostPair, 'function');
  const f = fixture(() => f.setTime(1999));
  await assert.rejects(host.readFirstCutoverHostPair(f.io), /CUTOVER_HOST_PAIR_UNPROVEN/);
});

test('malformed or oversized transport output is refused', async () => {
  assert.equal(typeof host.readFirstCutoverHostPair, 'function');
  for (const output of ['not json', ' '.repeat(16 * 1024 * 1024 + 1), '{}\n{}', null]) {
    const f = fixture();
    f.io.exec = async () => output;
    await assert.rejects(host.readFirstCutoverHostPair(f.io), /CUTOVER_HOST_PAIR_UNPROVEN/);
  }
});
