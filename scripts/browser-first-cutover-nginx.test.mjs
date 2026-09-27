import assert from 'node:assert/strict';
import test from 'node:test';
import * as nginx from './browser-first-cutover-nginx.mjs';

const binding = {
  attempt: '11111111-1111-4111-8111-111111111111',
  candidate: 'a'.repeat(40),
  configDigest: 'b'.repeat(64),
  migrationDigest: 'c'.repeat(64),
  inventoryDigest: 'd'.repeat(64),
};
const master = {
  pid: 100,
  start: '123',
  uid: 0,
  exe: '/usr/sbin/nginx',
  command: 'nginx: master process /usr/sbin/nginx',
};
const worker = (pid, start = '234') => ({
  pid,
  start,
  uid: 33,
  exe: '/usr/sbin/nginx',
  shuttingDown: false,
});
function fixture() {
  let now = 1000;
  const state = {
    receipt: {
      ...binding,
      stage: 'orders',
      phase: 'installing',
      files: [{ path: '/etc/nginx/sites-available/holaday', generatedDigest: 'e'.repeat(64) }],
    },
    dump: 'tested complete nginx configuration',
    runtime: { master, workers: [worker(101)] },
    calls: [],
    reads: 0,
    afterReload: () => {
      state.runtime = { master, workers: [worker(102)] };
    },
  };
  const io = {
    platform: 'linux',
    uid: 0,
    now: () => now,
    assertJournalOwnership: async () => binding,
    readFenceReceipt: async () => structuredClone(state.receipt),
    readRuntime: async () => {
      state.reads++;
      return structuredClone(state.runtime);
    },
    exec: async (file, args, options) => {
      assert.equal(file, '/usr/sbin/nginx');
      assert.deepEqual(options.env, { PATH: '/usr/sbin:/usr/bin:/sbin:/bin', LC_ALL: 'C' });
      state.calls.push(args.join(' '));
      if (args.join(' ') === '-s reload') state.afterReload();
      return args[0] === '-T' ? state.dump : '';
    },
    sleep: async (ms) => {
      now += ms;
    },
  };
  return {
    state,
    io,
    input: { binding, maintenanceEndsAtMs: 60000 },
    setTime: (t) => {
      now = t;
    },
  };
}

test('reload waits for a new serving generation and old acceptance to stop, not command ACK', async () => {
  const f = fixture();
  assert.equal(typeof nginx.createCutoverNginxIO, 'function');
  let slept = 0;
  // Reader changes only after multiple observed generations; ACK alone cannot pass.
  f.io.sleep = async () => {
    slept++;
    if (slept === 2) f.state.runtime.workers = [worker(102)];
  };
  f.state.afterReload = () => {
    f.state.runtime.workers.push(worker(102));
  };
  const actual = nginx.createCutoverNginxIO(f.input, f.io);
  await actual.testNginx();
  await actual.reloadNginx();
  assert.ok(slept >= 3);
  assert.equal(f.state.calls.filter((c) => c === '-s reload').length, 1);
  await assert.rejects(actual.reloadNginx(), /CUTOVER_NGINX_UNPROVEN/);
  assert.equal(f.state.calls.filter((c) => c === '-s reload').length, 1);
});

test('reload refuses missing test, config drift or changed maintenance receipt before signal', async () => {
  for (const kind of ['no-test', 'config', 'receipt', 'deadline']) {
    const f = fixture();
    const io = nginx.createCutoverNginxIO(f.input, f.io);
    if (kind !== 'no-test') await io.testNginx();
    if (kind === 'config') f.state.dump += '\nchanged';
    if (kind === 'receipt') f.state.receipt.phase = 'active';
    if (kind === 'deadline') f.setTime(60000);
    await assert.rejects(io.reloadNginx(), /CUTOVER_NGINX_UNPROVEN/);
    assert.ok(!f.state.calls.includes('-s reload'));
  }
});

test('failed or uncertain reload is never retried or followed by a successful re-test', async () => {
  const f = fixture();
  f.state.afterReload = () => {
    throw new Error('lost reload acknowledgment');
  };
  const io = nginx.createCutoverNginxIO(f.input, f.io);
  await io.testNginx();
  await assert.rejects(io.reloadNginx(), /CUTOVER_NGINX_UNPROVEN/);
  await assert.rejects(io.testNginx(), /CUTOVER_NGINX_UNPROVEN/);
  await assert.rejects(io.reloadNginx(), /CUTOVER_NGINX_UNPROVEN/);
  assert.equal(f.state.calls.filter((c) => c === '-s reload').length, 1);
});

test('master replacement, surviving old worker, missing workers and post-reload config drift refuse', async () => {
  for (const kind of ['master', 'survivor', 'empty', 'drift']) {
    const f = fixture();
    f.state.afterReload = () => {
      if (kind === 'master')
        f.state.runtime = { master: { ...master, start: '999' }, workers: [worker(102)] };
      if (kind === 'empty') f.state.runtime.workers = [];
      if (kind === 'drift') {
        f.state.runtime.workers = [worker(102)];
        f.state.dump += 'changed';
      }
    };
    const io = nginx.createCutoverNginxIO(f.input, f.io);
    await io.testNginx();
    await assert.rejects(io.reloadNginx(), /CUTOVER_NGINX_UNPROVEN/);
    assert.equal(f.state.calls.filter((c) => c === '-s reload').length, 1);
    assert.ok(!f.state.calls.some((c) => /stop|quit/.test(c)));
  }
});

test('restoring the same operation is supported, but active or foreign receipt cannot authorize reload', async () => {
  for (const phase of ['restoring', 'active', 'foreign']) {
    const f = fixture();
    f.state.receipt.phase = phase === 'foreign' ? 'installing' : phase;
    if (phase === 'restoring') f.state.receipt.stage = 'all-writers';
    if (phase === 'foreign') f.state.receipt.attempt = '22222222-2222-4222-8222-222222222222';
    const io = nginx.createCutoverNginxIO(f.input, f.io);
    if (phase === 'restoring') {
      await io.testNginx();
      await io.reloadNginx();
    } else {
      await assert.rejects(io.testNginx(), /CUTOVER_NGINX_UNPROVEN/);
      assert.equal(f.state.calls.length, 0);
    }
  }
});

test('expired or malformed setup is rejected at construction before any fence file could change', () => {
  for (const deadline of [1000, -1, Number.NaN]) {
    const f = fixture();
    f.input.maintenanceEndsAtMs = deadline;
    assert.throws(() => nginx.createCutoverNginxIO(f.input, f.io), /CUTOVER_NGINX_UNPROVEN/);
    assert.equal(f.state.calls.length, 0);
  }
});

test('Linux reader identifies actual proc fields and refuses foreign exe, child, PID reuse and permission gaps', async () => {
  // Linux stat field22 is starttime; the parser must not confuse ppid or utime.
  const stat = (pid, ppid, start) =>
    `${pid} (nginx) S ${ppid} ${Array(17).fill('0').join(' ')} ${start} 0 0\n`;
  for (const kind of ['valid', 'exe', 'child', 'reuse', 'permission', 'pid-file']) {
    const reads = new Map();
    const io = {
      platform: 'linux',
      readPidFile: async () => (kind === 'pid-file' ? 'not-a-pid' : '100\n'),
      readlink: async (path) => {
        if (kind === 'permission') throw Object.assign(new Error('denied'), { code: 'EACCES' });
        return kind === 'exe' && path.includes('/101/') ? '/usr/bin/node' : '/usr/sbin/nginx';
      },
      readFile: async (path) => {
        const pid = Number(path.split('/')[2]);
        const count = (reads.get(path) ?? 0) + 1;
        reads.set(path, count);
        if (path.endsWith('/children')) return '101 ';
        if (path.endsWith('/stat'))
          return stat(
            pid,
            pid === 100 ? 1 : 100,
            pid === 100 ? '123' : kind === 'reuse' && count === 2 ? '999' : '234',
          );
        if (path.endsWith('/status'))
          return `Uid:\t${pid === 100 ? '0\t0\t0\t0' : '33\t33\t33\t33'}\n`;
        if (path.endsWith('/cmdline'))
          return pid === 100
            ? 'nginx: master process /usr/sbin/nginx\0'
            : kind === 'child'
              ? 'unknown worker\0'
              : 'nginx: worker process\0';
        throw new Error(`unexpected proc read ${path}`);
      },
    };
    if (kind === 'valid')
      assert.deepEqual(await nginx.readCutoverNginxRuntime(io), { master, workers: [worker(101)] });
    else await assert.rejects(nginx.readCutoverNginxRuntime(io), /CUTOVER_NGINX_UNPROVEN/);
  }
});

test('nginx validation errors and clock reversal do not cause a reload', async () => {
  for (const kind of ['validation', 'clock']) {
    const f = fixture();
    const exec = f.io.exec;
    f.io.exec = async (...args) => {
      if (kind === 'validation' && args[1][0] === '-t') throw new Error('configuration rejected');
      return exec(...args);
    };
    const io = nginx.createCutoverNginxIO(f.input, f.io);
    if (kind === 'validation') await assert.rejects(io.testNginx(), /CUTOVER_NGINX_UNPROVEN/);
    else {
      await io.testNginx();
      f.setTime(999);
      await assert.rejects(io.reloadNginx(), /CUTOVER_NGINX_UNPROVEN/);
    }
    assert.ok(!f.state.calls.includes('-s reload'));
  }
});

test('old draining workers may retain unrelated connections while new generation serves', async () => {
  const f = fixture();
  f.state.afterReload = () => {
    f.state.runtime.workers = [{ ...worker(101), shuttingDown: true }, worker(102)];
  };
  const io = nginx.createCutoverNginxIO(f.input, f.io);
  await io.testNginx();
  await io.reloadNginx();
  assert.equal(f.state.calls.filter((c) => c === '-s reload').length, 1);
});

test('a subsequent stage does not require unrelated draining workers to disappear', async () => {
  const f = fixture();
  f.state.runtime.workers.unshift({ ...worker(98), shuttingDown: true });
  const io = nginx.createCutoverNginxIO(f.input, f.io);
  await io.testNginx();
  // Retirement of an already draining generation is not an active-generation change.
  f.state.runtime.workers = [worker(101)];
  f.state.afterReload = () => {
    f.state.runtime.workers = [{ ...worker(101), shuttingDown: true }, worker(102)];
  };
  await io.reloadNginx();
  assert.equal(f.state.calls.filter((c) => c === '-s reload').length, 1);
});
