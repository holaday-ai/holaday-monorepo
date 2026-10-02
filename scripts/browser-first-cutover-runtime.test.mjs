import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  cutoverRegistrationConfigDigest,
  validateFirstCutoverCloudSources,
} from './browser-cutover-evidence.mjs';
import {
  captureLegacyRuntime,
  createLegacyProducerEffects,
  createLegacyRuntimeEffects,
  initializeFirstMaintenanceState,
  retireLegacyProducers,
  retireLegacyRuntime,
} from './browser-first-cutover-runtime.mjs';
import * as firstRuntime from './browser-first-cutover-runtime.mjs';
import { acquireReleaseJournal } from './browser-maintenance-journal.mjs';
import { retireMaintenanceRuntime } from './browser-maintenance-runtime.mjs';

test('cloud sources native leaf exists and refuses unsupported input without effects', async () => {
  assert.equal(typeof firstRuntime.readFirstCutoverCloudRecoverySources, 'function');
  await assert.rejects(
    firstRuntime.readFirstCutoverCloudRecoverySources({}, { platform: 'darwin', uid: 0 }),
    /CUTOVER_CLOUD_SOURCES_UNPROVEN/,
  );
});

async function sourceNativeFixture() {
  // Synthetic physical IO. Public PM2/entry bytes only, no production env.
  const { inflateSync } = await import('node:zlib');
  // Frozen public PM2 6.0.14 source + reviewed entry, compressed only for test size.
  const { pm2: publicSources, entry } = JSON.parse(
    inflateSync(
      Buffer.from(
        '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',
        'base64',
      ),
    ).toString(),
  );
  const data = new Map();
  const dirs = new Set(['/']);
  const links = new Map([
    ['/bin', '/usr/bin'],
    ['/bin/sh', '/usr/bin/dash'],
    ['/usr/bin/python3', '/usr/bin/python3.10'],
  ]);
  const parent = (p) => p.slice(0, p.lastIndexOf('/')) || '/';
  const add = (p, v = 'binary') => {
    data.set(p, Buffer.from(v));
    let d = parent(p);
    for (;;) {
      dirs.add(d);
      if (d === '/') break;
      d = parent(d);
    }
  };
  for (const p of [
    '/usr/bin/unshare',
    '/usr/bin/dash',
    '/usr/bin/mount',
    '/usr/bin/setpriv',
    '/usr/bin/python3.10',
    '/usr/bin/Xvfb',
    '/usr/bin/bash',
    '/usr/bin/x11vnc',
    '/usr/bin/pkill',
    '/usr/bin/sleep',
    '/usr/bin/date',
    '/opt/brave.com/brave/brave',
    '/opt/brave.com/brave/chrome_crashpad_handler',
    '/opt/holaday-vnc/start.sh',
    '/usr/lib/python3.10/site.py',
    '/usr/lib/python3.10/importlib/metadata/__init__.py',
  ])
    add(p);
  add('/usr/bin/websockify', entry);
  add('/usr/lib/node_modules/pm2/package.json', '{"version":"6.0.14"}');
  for (const f of publicSources.files) add(`/usr/lib/node_modules/pm2/${f.path}`, f.source);
  for (const n of [
    '__init__',
    'websocket',
    'websocketserver',
    'websocketproxy',
    'websockifyserver',
  ])
    add(`/usr/lib/python3/dist-packages/websockify/${n}.py`, '# synthetic module\n');
  add(
    '/usr/lib/python3/dist-packages/websockify-0.10.0.egg-info/PKG-INFO',
    'Name: websockify\nVersion: 0.10.0\n',
  );
  add(
    '/usr/lib/python3/dist-packages/websockify-0.10.0.egg-info/entry_points.txt',
    '[console_scripts]\nwebsockify = websockify.websocketproxy:websockify_init\n',
  );
  add('/root/.pm2/pm2.pid', '40\n');
  add('/proc/sys/kernel/random/boot_id', '11111111-1111-4111-8111-111111111111\n');
  add('/proc/40/stat', `40 (PM2 daemon) S 1 ${Array(17).fill('0').join(' ')} 1234\n`);
  add('/proc/40/cmdline', 'PM2 v6.0.14: God Daemon (/root/.pm2)\0');
  add('/proc/40/status', 'Uid:\t0\t0\t0\t0\nGid:\t0\t0\t0\t0\n');
  add('/proc/40/environ', 'PRIVATE_DAEMON=never-export-this\0');
  const missing = () => Object.assign(new Error('synthetic missing'), { code: 'ENOENT' });
  const resolve = (p) =>
    links.get(p) ?? (p.startsWith('/bin/') ? p.replace('/bin/', '/usr/bin/') : p);
  const modes = new Map();
  const getStat = (p) => {
    const type = links.has(p) ? 'link' : dirs.has(p) ? 'dir' : data.has(p) ? 'file' : null;
    if (!type) throw missing();
    return {
      dev: 1,
      ino: p,
      mode: modes.get(p) ?? (type === 'link' ? 0o120777 : type === 'dir' ? 0o40755 : 0o100755),
      uid: 0,
      gid: 0,
      size: data.get(p)?.length ?? 0,
      mtimeMs: 1,
      ctimeMs: 1,
      isFile: () => type === 'file',
      isDirectory: () => type === 'dir',
      isSymbolicLink: () => type === 'link',
    };
  };
  const io = {
    platform: 'linux',
    uid: 0,
    now: () => 1000,
    monotonic: () => 1,
    hostname: () => 'qa-vultr',
    lstat: async (p) => getStat(p),
    realpath: async (p) => {
      const r = resolve(p);
      getStat(r);
      return r;
    },
    readdir: async (p) => {
      getStat(p);
      return [
        ...new Set(
          [...data.keys(), ...dirs, ...links.keys()]
            .filter((q) => q !== p && parent(q) === p)
            .map((q) => q.slice(p.length + (p === '/' ? 0 : 1))),
        ),
      ];
    },
    opendir: async function (p) {
      const names = await this.readdir(p);
      let index = 0;
      return {
        read: async () => (index < names.length ? { name: names[index++] } : null),
        close: async () => {},
      };
    },
    open: async (p) => {
      getStat(p);
      let offset = 0;
      return {
        stat: async () => getStat(p),
        read: async (buf, start, length) => {
          const bytes = data.get(p);
          const n = Math.min(length, bytes.length - offset);
          bytes.copy(buf, start, offset, offset + n);
          offset += n;
          return { bytesRead: n };
        },
        close: async () => {},
      };
    },
  };
  const configs = ['holaday-vnc', 'holaday-chromium-headed'].map((name, i) => ({
    name,
    pmId: 6 + i,
    config: {
      name,
      pm_id: 6 + i,
      status: 'online',
      restart_time: 3,
      exec_mode: 'fork_mode',
      autostart: true,
      pm_exec_path: i ? '/opt/holaday-headed/start.sh' : '/opt/holaday-vnc/start.sh',
      exec_interpreter: 'bash',
      args: [],
      pm_cwd: '/root',
      env: { PATH: '/usr/bin', HOME: '/root', DISPLAY: ':98', PRIVATE_VALUE: 'never-export-this' },
    },
  }));
  return {
    input: { attempt: '22222222-2222-4222-8222-222222222222', configs },
    io,
    data,
    dirs,
    links,
    modes,
    add,
  };
}
for (const mode of ['missing', 'top-level', 'nested-overrides']) {
  test(`cloud sources VNC display accepts ${mode} without changing retained config`, async () => {
    const f = await sourceNativeFixture();
    const baseline = await firstRuntime.readFirstCutoverCloudRecoverySources(f.input, f.io);
    const config = f.input.configs[0].config;
    if (mode === 'missing' || mode === 'top-level') Reflect.deleteProperty(config.env, 'DISPLAY');
    if (mode === 'top-level') config.DISPLAY = ':98';
    if (mode === 'nested-overrides') config.DISPLAY = ':0';
    const retained = structuredClone(f.input);
    const observed = await firstRuntime.readFirstCutoverCloudRecoverySources(f.input, f.io);
    assert.deepEqual(f.input, retained);
    assert.equal(observed.roles[0].configDigest, cutoverRegistrationConfigDigest(config));
    assert.equal(observed.roles[1].selectionDigest, baseline.roles[1].selectionDigest);
    if (mode === 'missing') {
      assert.notEqual(observed.roles[0].selectionDigest, baseline.roles[0].selectionDigest);
      assert.equal(Object.hasOwn(config, 'DISPLAY'), false);
      assert.equal(Object.hasOwn(config.env, 'DISPLAY'), false);
    } else {
      assert.equal(observed.roles[0].selectionDigest, baseline.roles[0].selectionDigest);
    }
  });
}
for (const location of ['top-level', 'nested']) {
  for (const value of [':0', '', null, 98, ':98\0']) {
    test(`cloud sources VNC display refuses ${location} ${JSON.stringify(value)}`, async () => {
      const f = await sourceNativeFixture();
      const config = f.input.configs[0].config;
      if (location === 'top-level') {
        Reflect.deleteProperty(config.env, 'DISPLAY');
        config.DISPLAY = value;
      } else {
        config.DISPLAY = ':98';
        config.env.DISPLAY = value;
      }
      await assert.rejects(
        firstRuntime.readFirstCutoverCloudRecoverySources(f.input, f.io),
        /CUTOVER_CLOUD_SOURCES_UNPROVEN/,
      );
    });
  }
}
async function recoveryContextFixture() {
  const f = await sourceNativeFixture();
  f.add('/proc/40/stat', `40 (PM2 daemon) S 1 ${Array(17).fill('0').join(' ')} 50\n`);
  f.add(
    '/proc/40/status',
    'Uid:\t0\t0\t0\t0\nGid:\t0\t0\t0\t0\nCapEff:\t0000000000200100\nCapPrm:\t0000000000200100\nCapBnd:\t0000000000200100\nCapInh:\t0000000000000000\nCapAmb:\t0000000000000000\nNoNewPrivs:\t0\nSeccomp:\t0\n',
  );
  f.add('/proc/40/attr/current', 'unconfined\n');
  f.add('/proc/stat', 'btime 0\n');
  const auxv = Buffer.alloc(32);
  auxv.writeBigUInt64LE(17n, 0);
  auxv.writeBigUInt64LE(100n, 8);
  f.add('/proc/self/auxv', auxv);
  f.add('/opt/node22/bin/node', 'synthetic node');
  const namespaces = new Map();
  for (const pid of [1, 40])
    for (const ns of ['mnt', 'user', 'net']) namespaces.set(`/proc/${pid}/ns/${ns}`, `${ns}:[10]`);
  namespaces.set('/proc/40/exe', '/opt/node22/bin/node');
  f.io.readlink = async (p) => {
    assert.ok(namespaces.has(p), p);
    return namespaces.get(p);
  };
  f.io.stat = (p) => f.io.lstat(p === '/proc/40/exe' ? '/opt/node22/bin/node' : p);
  f.io.arch = 'arm64';
  const sources = await firstRuntime.readFirstCutoverCloudRecoverySources(f.input, f.io);
  return { ...f, sources, namespaces };
}
test('cloud recovery context binds native daemon and source chronology without exposing environment', async () => {
  const f = await recoveryContextFixture();
  const original = structuredClone(f.sources);
  const proof = await firstRuntime.readFirstCutoverCloudRecoveryContext(
    { sources: f.sources },
    f.io,
  );
  assert.equal(proof.daemon.pid, 40);
  assert.equal(proof.daemon.start, '50');
  assert.deepEqual(proof.daemon.securityLabel, { kind: 'observed', value: 'unconfined' });
  assert.equal(proof.hostname, f.sources.hostname);
  assert.equal(proof.bootId, f.sources.bootId);
  assert.match(proof.sourcesDigest, /^[a-f0-9]{64}$/);
  assert.match(proof.daemon.contextDigest, /^[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(proof).includes('never-export-this'), false);
  assert.equal(Object.hasOwn(proof, 'recoveryReady'), false);
  assert.deepEqual(f.sources, original);
});
for (const fault of [
  'platform',
  'arch',
  'uid',
  'stale',
  'future',
  'hostname',
  'boot',
  'extra',
  'cap-effective',
  'cap-permitted',
  'cap-bounding',
  'setpcap',
  'uid-row',
  'seccomp',
  'nnp',
  'apparmor',
  'selinux',
  'namespace',
  'deleted-node',
  'node-inode',
  'node-writable',
  'loader-env',
  'node-path',
  'duplicate-env',
  'source-ctime',
  'source-bytes',
  'clock-ticks',
  'daemon-drift',
  'source-drift',
  'clock-backward',
]) {
  test(`cloud recovery context refuses ${fault}`, async () => {
    const f = await recoveryContextFixture();
    const input = { sources: f.sources };
    const replace = (p, a, b) => f.data.set(p, Buffer.from(f.data.get(p).toString().replace(a, b)));
    if (fault === 'platform') f.io.platform = 'darwin';
    if (fault === 'arch') f.io.arch = 'unknown';
    if (fault === 'uid') f.io.uid = 1;
    if (fault === 'stale') f.io.now = () => 62000;
    if (fault === 'future') f.sources.observedAtMs = 1001;
    if (fault === 'hostname') f.io.hostname = () => 'other';
    if (fault === 'boot')
      f.data.set(
        '/proc/sys/kernel/random/boot_id',
        Buffer.from('22222222-2222-4222-8222-222222222222\n'),
      );
    if (fault === 'extra') input.trusted = true;
    for (const [label, key] of [
      ['cap-effective', 'CapEff'],
      ['cap-permitted', 'CapPrm'],
      ['cap-bounding', 'CapBnd'],
    ])
      if (fault === label)
        replace('/proc/40/status', `${key}:\t0000000000200100`, `${key}:\t0000000000000100`);
    if (fault === 'setpcap')
      replace('/proc/40/status', 'CapEff:\t0000000000200100', 'CapEff:\t0000000000200000');
    if (fault === 'uid-row') replace('/proc/40/status', 'Uid:\t0\t0\t0\t0', 'Uid:\t0\t1\t0\t0');
    if (fault === 'seccomp') replace('/proc/40/status', 'Seccomp:\t0', 'Seccomp:\t2');
    if (fault === 'nnp') replace('/proc/40/status', 'NoNewPrivs:\t0', 'NoNewPrivs:\t1');
    if (fault === 'apparmor') f.add('/proc/40/attr/current', 'unreviewed-profile\n');
    if (fault === 'selinux') f.add('/sys/fs/selinux/enforce', '1\n');
    if (fault === 'namespace') f.namespaces.set('/proc/40/ns/mnt', 'mnt:[11]');
    if (fault === 'deleted-node')
      f.namespaces.set('/proc/40/exe', '/opt/node22/bin/node (deleted)');
    if (fault === 'node-inode') {
      const stat = f.io.stat;
      f.io.stat = async (p) => ({ ...(await stat(p)), ino: p });
    }
    if (fault === 'node-writable') f.modes.set('/opt/node22/bin/node', 0o100777);
    if (fault === 'loader-env') f.add('/proc/40/environ', 'NODE_OPTIONS=--require=/private.js\0');
    if (fault === 'node-path') f.add('/proc/40/environ', 'NODE_PATH=/private\0');
    if (fault === 'duplicate-env') f.add('/proc/40/environ', 'NODE_OPTIONS=\0NODE_OPTIONS=\0');
    const source = '/usr/lib/node_modules/pm2/lib/God.js';
    if (fault === 'source-ctime') {
      const stat = f.io.lstat;
      f.io.lstat = async (p) => ({ ...(await stat(p)), ...(p === source ? { ctimeMs: 900 } : {}) });
    }
    if (fault === 'source-bytes') f.add(source, 'changed');
    if (fault === 'clock-ticks') f.data.get('/proc/self/auxv').writeBigUInt64LE(0n, 8);
    if (fault === 'daemon-drift') {
      const readlink = f.io.readlink;
      let n = 0;
      f.io.readlink = async (p) =>
        p === '/proc/40/exe' && ++n > 1 ? '/usr/bin/node' : readlink(p);
    }
    if (fault === 'source-drift') {
      const stat = f.io.lstat;
      let n = 0;
      f.io.lstat = async (p) => ({
        ...(await stat(p)),
        ...(p === source && ++n > 1 ? { mtimeMs: 2 } : {}),
      });
    }
    if (fault === 'clock-backward') {
      let n = 0;
      f.io.now = () => (++n < 3 ? 1000 : 999);
    }
    await assert.rejects(
      firstRuntime.readFirstCutoverCloudRecoveryContext(input, f.io),
      /CUTOVER_CLOUD_CONTEXT_UNPROVEN/,
    );
  });
}
for (const code of ['EINVAL', 'ENOENT']) {
  test(`cloud recovery context preserves unavailable label ${code} as unknown`, async () => {
    const f = await recoveryContextFixture();
    const open = f.io.open;
    f.io.open = async (p, ...args) => {
      if (p === '/proc/40/attr/current') throw Object.assign(new Error('unavailable'), { code });
      return open(p, ...args);
    };
    const result = await firstRuntime.readFirstCutoverCloudRecoveryContext(
      { sources: f.sources },
      f.io,
    );
    assert.deepEqual(result.daemon.securityLabel, { kind: 'unavailable', reason: code });
    assert.equal(Object.hasOwn(result, 'recoveryReady'), false);
  });
}
for (const [path, code] of [
  ['/proc/40/attr/current', 'EACCES'],
  ['/proc/40/environ', 'EINVAL'],
  ['/usr/lib/node_modules/pm2/lib/God.js', 'EINVAL'],
]) {
  test(`cloud recovery context refuses ${code} outside missing-label observation ${path}`, async () => {
    const f = await recoveryContextFixture();
    const open = f.io.open;
    f.io.open = async (p, ...args) => {
      if (p === path) throw Object.assign(new Error('unreadable'), { code });
      return open(p, ...args);
    };
    await assert.rejects(
      firstRuntime.readFirstCutoverCloudRecoveryContext({ sources: f.sources }, f.io),
      /CUTOVER_CLOUD_CONTEXT_UNPROVEN/,
    );
  });
}
test('cloud recovery context refuses a changing security-label availability', async () => {
  const f = await recoveryContextFixture();
  const open = f.io.open;
  let labels = 0;
  f.io.open = async (p, ...args) => {
    if (p === '/proc/40/attr/current' && ++labels > 1)
      throw Object.assign(new Error('unavailable'), { code: 'EINVAL' });
    return open(p, ...args);
  };
  await assert.rejects(
    firstRuntime.readFirstCutoverCloudRecoveryContext({ sources: f.sources }, f.io),
    /CUTOVER_CLOUD_CONTEXT_UNPROVEN/,
  );
});
for (const path of ['/opt/node22/bin', '/opt/node22/bin/node']) {
  for (const owner of ['uid', 'gid']) {
    test(`cloud recovery context refuses unprotected Node ${owner} at ${path}`, async () => {
      const f = await recoveryContextFixture();
      const lstat = f.io.lstat;
      f.io.lstat = async (p) => ({ ...(await lstat(p)), ...(p === path ? { [owner]: 1000 } : {}) });
      await assert.rejects(
        firstRuntime.readFirstCutoverCloudRecoveryContext({ sources: f.sources }, f.io),
        /CUTOVER_CLOUD_CONTEXT_UNPROVEN/,
      );
    });
  }
}
for (const [name, environment, allowed] of [
  ['native-pair', 'NODE_CHANNEL_FD=3\0NODE_CHANNEL_SERIALIZATION_MODE=json\0', true],
  ['missing-mode', 'NODE_CHANNEL_FD=3\0', false],
  ['missing-fd', 'NODE_CHANNEL_SERIALIZATION_MODE=json\0', false],
  ['wrong-fd', 'NODE_CHANNEL_FD=4\0NODE_CHANNEL_SERIALIZATION_MODE=json\0', false],
  ['invalid-fd', 'NODE_CHANNEL_FD=3x\0NODE_CHANNEL_SERIALIZATION_MODE=json\0', false],
  ['empty-fd', 'NODE_CHANNEL_FD=\0NODE_CHANNEL_SERIALIZATION_MODE=json\0', false],
  ['other-mode', 'NODE_CHANNEL_FD=3\0NODE_CHANNEL_SERIALIZATION_MODE=advanced\0', false],
  ['empty-mode', 'NODE_CHANNEL_FD=3\0NODE_CHANNEL_SERIALIZATION_MODE=\0', false],
  [
    'duplicate-fd',
    'NODE_CHANNEL_FD=3\0NODE_CHANNEL_FD=3\0NODE_CHANNEL_SERIALIZATION_MODE=json\0',
    false,
  ],
  [
    'loader-alongside-ipc',
    'NODE_CHANNEL_FD=3\0NODE_CHANNEL_SERIALIZATION_MODE=json\0NODE_OPTIONS=--require=/private.js\0',
    false,
  ],
]) {
  test(`cloud recovery context PM2 bootstrap IPC ${name}`, async () => {
    const f = await recoveryContextFixture();
    f.add('/proc/40/environ', environment);
    if (allowed) {
      const result = await firstRuntime.readFirstCutoverCloudRecoveryContext(
        { sources: f.sources },
        f.io,
      );
      assert.equal(result.daemon.pid, 40);
      assert.equal(JSON.stringify(result).includes('NODE_CHANNEL'), false);
    } else {
      await assert.rejects(
        firstRuntime.readFirstCutoverCloudRecoveryContext({ sources: f.sources }, f.io),
        /CUTOVER_CLOUD_CONTEXT_UNPROVEN/,
      );
    }
  });
}
async function ownedDisplayFixture() {
  const f = await recoveryContextFixture();
  const sha = (v) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
  const exe = new Map([
    [40, '/opt/node22/bin/node'],
    [41, '/usr/bin/bash'],
    [42, '/usr/bin/bash'],
    [43, '/usr/bin/Xvfb'],
    [44, '/usr/bin/openbox'],
    [45, '/usr/bin/x11vnc'],
    [46, '/opt/brave.com/brave/brave'],
    [99, '/usr/bin/other'],
  ]);
  f.add('/usr/bin/openbox', 'window manager');
  const displayCmd = `${['Xvfb', ':98', '-screen', '0', '1280x800x24', '-nolisten', 'tcp'].join('\0')}\0`;
  const census = {
    hostname: f.sources.hostname,
    bootId: f.sources.bootId,
    observedAtMs: 1000,
    processes: [...exe].map(([pid, path]) => ({
      pid,
      ppid: pid === 40 || pid === 99 ? 1 : pid === 41 || pid === 42 ? 40 : pid === 45 ? 41 : 42,
      start: pid === 40 ? '50' : String(pid * 10),
      uids: [0, 0, 0, 0],
      exe: path,
      cwd: '/root',
      argvDigest: sha(pid === 43 ? displayCmd : `synthetic-${pid}`),
      cgroup: '0::/qa',
      mountNamespace: 'mnt:[10]',
      state: 'live',
      noNewPrivs: 0,
      capabilities: Object.fromEntries(
        ['CapEff', 'CapPrm', 'CapBnd', 'CapInh', 'CapAmb'].map((k) => [k, '0000000000000000']),
      ),
    })),
  };
  const rows = f.input.configs.map((c, i) => ({
    name: c.name,
    pm_id: c.pmId,
    pid: 41 + i,
    pm2_env: structuredClone(c.config),
  }));
  f.io.rpc = async (method) => {
    assert.equal(method, 'getMonitorData');
    return structuredClone(rows);
  };
  f.io.readCensus = async () => structuredClone(census);
  for (const p of census.processes) {
    f.namespaces.set(`/proc/${p.pid}/exe`, p.exe);
    for (const ns of ['mnt', 'net', 'user'])
      f.namespaces.set(`/proc/${p.pid}/ns/${ns}`, `${ns}:[10]`);
    if (p.pid !== 40)
      f.add(
        `/proc/${p.pid}/stat`,
        `${p.pid} (qa) S ${p.ppid} ${Array(17).fill('0').join(' ')} ${p.start}\n`,
      );
  }
  f.add('/proc/43/cmdline', displayCmd);
  f.io.stat = (p) => f.io.lstat(f.namespaces.get(p) ?? p);
  const connections = [
    { pid: 45, fd: 8, inode: '202', server: '102', serverFd: 7 },
    { pid: 46, fd: 8, inode: '203', server: '103', serverFd: 8 },
    { pid: 44, fd: 8, inode: '204', server: '104', serverFd: 9 },
  ];
  const sockets = () => {
    f.namespaces.set('/proc/43/fd/5', 'socket:[100]');
    f.namespaces.set('/proc/43/fd/6', 'socket:[101]');
    const lines = [
      'u_str LISTEN 0 128 /tmp/.X11-unix/X98 100 * 0 users:(("Xvfb",pid=43,fd=5))',
      'u_str LISTEN 0 128 @/tmp/.X11-unix/X98 101 * 0 users:(("Xvfb",pid=43,fd=6))',
    ];
    for (const c of connections) {
      f.namespaces.set(`/proc/43/fd/${c.serverFd}`, `socket:[${c.server}]`);
      f.namespaces.set(`/proc/${c.pid}/fd/${c.fd}`, `socket:[${c.inode}]`);
      lines.push(
        `u_str ESTAB 0 0 /tmp/.X11-unix/X98 ${c.server} * ${c.inode} users:(("Xvfb",pid=43,fd=${c.serverFd}))`,
        `u_str ESTAB 0 0 * ${c.inode} * ${c.server} users:(("client",pid=${c.pid},fd=${c.fd}))`,
      );
    }
    return `${lines.join('\n')}\n`;
  };
  let unix = sockets;
  let tcp = '';
  f.io.exec = async (command, args) => {
    assert.equal(command, '/usr/bin/ss');
    if (args.join(' ') === '-H -xapn') return unix();
    assert.equal(args.join(' '), '-H -tanp');
    return tcp;
  };
  return {
    ...f,
    census,
    rows,
    connections,
    sha,
    sockets,
    setUnix: (v) => {
      unix = v;
    },
    setTcp: (v) => {
      tcp = v;
    },
    request: { sources: f.sources, maintenanceEndsAtMs: 15000 },
  };
}
test('owned cloud display measures scoped Xvfb, window manager and both roles actual peer ownership', async () => {
  const f = await ownedDisplayFixture();
  const result = await firstRuntime.readFirstCutoverCloudOwnedDisplay(f.request, f.io);
  assert.equal(result.purpose, 'cloud-owned-display-observation');
  assert.deepEqual(
    result.members.map((p) => p.pid),
    [43, 44],
  );
  assert.deepEqual(
    result.treeDigests,
    [
      [41, 45],
      [42, 43, 44, 46],
    ].map((ids) =>
      f.sha(
        f.census.processes
          .filter((p) => ids.includes(p.pid))
          .map((p) =>
            Object.fromEntries(
              ['pid', 'ppid', 'start', 'uids', 'exe', 'cwd', 'argvDigest', 'cgroup'].map((k) => [
                k,
                p[k],
              ]),
            ),
          ),
      ),
    ),
  );
  assert.equal(result.display.pid, 43);
  assert.equal(result.display.ppid, 42);
  assert.equal(result.clients.length, 3);
  assert.match(result.censusDigest, /^[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(result).includes('never-export-this'), false);
  assert.equal(Object.hasOwn(result, 'stopAuthorized'), false);
});
for (const state of ['no-window-manager', 'vnc-stopped']) {
  test(`owned cloud display accepts bounded original state ${state}`, async () => {
    const f = await ownedDisplayFixture();
    if (state === 'no-window-manager') {
      f.census.processes = f.census.processes.filter((p) => p.pid !== 44);
      f.connections.splice(2, 1);
    } else {
      f.rows[0].pid = 0;
      f.rows[0].pm2_env.status = 'stopped';
      f.input.configs[0].config = structuredClone(f.rows[0].pm2_env);
      f.sources = await firstRuntime.readFirstCutoverCloudRecoverySources(f.input, f.io);
      f.request.sources = f.sources;
      f.census.processes = f.census.processes.filter((p) => ![41, 45].includes(p.pid));
      f.connections.splice(0, 1);
    }
    const result = await firstRuntime.readFirstCutoverCloudOwnedDisplay(f.request, f.io);
    assert.equal(result.roots[1].pid, 42);
    assert.equal(result.members.length, state === 'no-window-manager' ? 1 : 2);
    if (state === 'vnc-stopped') {
      assert.equal(result.roots[0].pid, 0);
      assert.equal(result.roots[0].start, null);
      assert(result.clients.every((p) => p.role === 'holaday-chromium-headed'));
    }
  });
}
for (const fault of [
  'extra',
  'expired',
  'manager-pid',
  'manager-config',
  'headed-stopped',
  'display-outside',
  'display-wrong-parent',
  'second-display',
  'xorg',
  'window-manager-outside',
  'unconnected-window-manager',
  'outside-client',
  'unknown-client',
  'no-listeners',
  'server-owner',
  'peer-missing',
  'fd-mismatch',
  'display-tcp',
  'loaded-inode',
  'source-bytes',
  'display-command',
  'census-drift',
  'manager-drift',
  'socket-drift',
]) {
  test(`owned cloud display refuses ${fault}`, async () => {
    const f = await ownedDisplayFixture();
    const p = (id) => f.census.processes.find((p) => p.pid === id);
    if (fault === 'extra') f.request.trusted = true;
    if (fault === 'expired') f.request.maintenanceEndsAtMs = 1000;
    if (fault === 'manager-pid') f.rows[1].pid = 99;
    if (fault === 'manager-config') f.rows[1].pm2_env.env.PRIVATE_VALUE = 'changed';
    if (fault === 'headed-stopped') {
      f.rows[1].pid = 0;
      f.rows[1].pm2_env.status = 'stopped';
    }
    if (fault === 'display-outside') p(43).ppid = 1;
    if (fault === 'display-wrong-parent') p(43).ppid = 46;
    if (fault === 'second-display') p(46).exe = '/usr/bin/Xvfb';
    if (fault === 'xorg') p(46).exe = '/usr/bin/Xorg';
    if (fault === 'window-manager-outside') p(44).ppid = 1;
    if (fault === 'unconnected-window-manager') f.connections.splice(2, 1);
    if (fault === 'outside-client') f.connections[0].pid = 99;
    if (fault === 'unknown-client') f.connections[0].pid = 999;
    if (fault === 'no-listeners')
      f.setUnix(() =>
        f
          .sockets()
          .split('\n')
          .filter((l) => !l.includes('LISTEN'))
          .join('\n'),
      );
    if (fault === 'server-owner')
      f.setUnix(() => f.sockets().replace('pid=43,fd=5', 'pid=99,fd=5'));
    if (fault === 'peer-missing')
      f.setUnix(() =>
        f
          .sockets()
          .split('\n')
          .filter((l) => !l.includes('* 202 * 102'))
          .join('\n'),
      );
    if (fault === 'fd-mismatch') {
      const readlink = f.io.readlink;
      f.io.readlink = (p) =>
        p === '/proc/45/fd/8' ? Promise.resolve('socket:[999]') : readlink(p);
    }
    if (fault === 'display-tcp')
      f.setTcp('LISTEN 0 128 0.0.0.0:6098 0.0.0.0:* users:(("Xvfb",pid=43,fd=20))\n');
    if (fault === 'loaded-inode') {
      const stat = f.io.stat;
      f.io.stat = async (path) =>
        Object.assign(await stat(path), path === '/proc/43/exe' ? { ino: 'changed' } : {});
    }
    if (fault === 'source-bytes') f.data.set('/usr/bin/Xvfb', Buffer.from('changed'));
    if (fault === 'display-command') f.data.set('/proc/43/cmdline', Buffer.from('Xvfb\0:99\0'));
    let censusReads = 0;
    const census = f.io.readCensus;
    f.io.readCensus = async () => {
      if (++censusReads === 2 && fault === 'census-drift') p(46).start = '999';
      return census();
    };
    let managerReads = 0;
    const rpc = f.io.rpc;
    f.io.rpc = async (...a) => {
      if (++managerReads === 2 && fault === 'manager-drift') f.rows[0].pm2_env.restart_time++;
      return rpc(...a);
    };
    if (fault === 'socket-drift') {
      let reads = 0;
      f.setUnix(() => {
        if (++reads === 2) f.connections.pop();
        return f.sockets();
      });
    }
    await assert.rejects(
      firstRuntime.readFirstCutoverCloudOwnedDisplay(f.request, f.io),
      /CUTOVER_CLOUD_DISPLAY_SCOPE_UNPROVEN/,
    );
  });
}

async function recoveryVacancyFixture() {
  const f = await recoveryContextFixture();
  for (const c of f.input.configs) c.config.status = 'stopped';
  f.sources = await firstRuntime.readFirstCutoverCloudRecoverySources(f.input, f.io);
  const rows = f.input.configs.map((c) => ({
    name: c.name,
    pm_id: c.pmId,
    pid: 0,
    pm2_env: structuredClone(c.config),
  }));
  f.io.rpc = async (method) => {
    assert.equal(method, 'getMonitorData');
    return structuredClone(rows);
  };
  for (const ns of ['mnt', 'net', 'user']) f.namespaces.set(`/proc/self/ns/${ns}`, `${ns}:[10]`);
  f.dirs.add('/tmp');
  f.dirs.add('/tmp/.X11-unix');
  f.modes.set('/tmp', 0o41777);
  f.modes.set('/tmp/.X11-unix', 0o41777);
  f.add(
    '/proc/self/net/unix',
    'Num RefCount Protocol Flags Type St Inode Path\n00000000: 00000002 00000000 00010000 0001 01 123 @unrelated-private-name\n',
  );
  const header =
    '  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt uid timeout inode\n';
  f.add('/proc/self/net/tcp', header);
  f.add('/proc/self/net/tcp6', header);
  const tcp = (port, ipv6 = false, state = '0A') =>
    `0: ${'0'.repeat(ipv6 ? 32 : 8)}:${port.toString(16).toUpperCase().padStart(4, '0')} ${'0'.repeat(ipv6 ? 32 : 8)}:0000 ${state} 00000000:00000000 00:00000000 00000000 0 0 123 1\n`;
  return { ...f, rows, header, tcp, request: { sources: f.sources, maintenanceEndsAtMs: 15000 } };
}
test('cloud recovery vacancy observes both stopped roles and fixed native endpoints without effects', async () => {
  const f = await recoveryVacancyFixture();
  f.data.set('/proc/self/net/tcp', Buffer.from(f.header + f.tcp(8080)));
  const result = await firstRuntime.readFirstCutoverCloudRecoveryVacancy(f.request, f.io);
  assert.equal(result.purpose, 'cloud-recovery-vacancy-observation');
  assert.equal(result.hostname, f.sources.hostname);
  assert.equal(result.bootId, f.sources.bootId);
  assert.match(result.observationDigest, /^[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(result).includes('private-name'), false);
  assert.equal(Object.hasOwn(result, 'recoveryReady'), false);
});
for (const fault of [
  'platform',
  'extra',
  'missing-deadline',
  'expired',
  'manager-live',
  'manager-status',
  'manager-id',
  'manager-config',
  'manager-drift',
  'self-net',
  'self-mount',
  'daemon-drift',
  'lock',
  'lock-symlink',
  'socket',
  'tmp-symlink',
  'tmp-writable',
  'abstract',
  'filesystem-unix',
  'tcp-5901',
  'tcp-6080',
  'tcp-9223',
  'tcp6',
  'tcp-timewait',
  'tcp-malformed',
  'unix-malformed',
  'missing-net-table',
  'net-oversized',
  'endpoint-drift',
  'clock-backward',
]) {
  test(`cloud recovery vacancy refuses ${fault} without dispatch`, async () => {
    const f = await recoveryVacancyFixture();
    if (fault === 'platform') f.io.platform = 'darwin';
    if (fault === 'extra') f.request.approved = true;
    if (fault === 'missing-deadline') Reflect.deleteProperty(f.request, 'maintenanceEndsAtMs');
    if (fault === 'expired') f.request.maintenanceEndsAtMs = 1000;
    if (fault === 'manager-live') f.rows[0].pid = 41;
    if (fault === 'manager-status') f.rows[0].pm2_env.status = 'online';
    if (fault === 'manager-id') f.rows[0].pm_id = f.rows[0].pm2_env.pm_id = 9;
    if (fault === 'manager-config') f.rows[0].pm2_env.env.PRIVATE_VALUE = 'drift';
    if (fault === 'self-net') f.namespaces.set('/proc/self/ns/net', 'net:[11]');
    if (fault === 'self-mount') f.namespaces.set('/proc/self/ns/mnt', 'mnt:[11]');
    if (fault === 'daemon-drift') f.data.set('/proc/40/attr/current', Buffer.from('restricted'));
    if (fault === 'lock') f.add('/tmp/.X98-lock', '42\n');
    if (fault === 'lock-symlink') f.links.set('/tmp/.X98-lock', '/nonexistent');
    if (fault === 'socket') f.add('/tmp/.X11-unix/X98', 'occupied');
    if (fault === 'tmp-symlink') f.links.set('/tmp/.X11-unix', '/other');
    if (fault === 'tmp-writable') f.modes.set('/tmp', 0o40777);
    if (['abstract', 'filesystem-unix'].includes(fault))
      f.add(
        '/proc/self/net/unix',
        `Num RefCount Protocol Flags Type St Inode Path\n00000000: 00000002 00000000 00010000 0001 01 123 ${fault === 'abstract' ? '@' : ''}/tmp/.X11-unix/X98\n`,
      );
    if (/^tcp-\d+$/.test(fault))
      f.add('/proc/self/net/tcp', f.header + f.tcp(Number(fault.slice(4))));
    if (fault === 'tcp6') f.add('/proc/self/net/tcp6', f.header + f.tcp(6080, true));
    if (fault === 'tcp-timewait') f.add('/proc/self/net/tcp', f.header + f.tcp(9223, false, '06'));
    if (fault === 'tcp-malformed') f.add('/proc/self/net/tcp', `${f.header}0: truncated\n`);
    if (fault === 'unix-malformed') f.add('/proc/self/net/unix', 'invalid table\n');
    if (fault === 'missing-net-table') f.data.delete('/proc/self/net/tcp6');
    if (fault === 'net-oversized') f.add('/proc/self/net/unix', 'x'.repeat(1048577));
    let calls = 0;
    const rpc = f.io.rpc;
    f.io.rpc = async (...a) => {
      calls++;
      if (calls === 2 && fault === 'manager-drift') f.rows[1].pm2_env.restart_time++;
      if (calls === 2 && fault === 'endpoint-drift') f.add('/tmp/.X98-lock', '43\n');
      return rpc(...a);
    };
    if (fault === 'clock-backward') {
      let now = 1000;
      f.io.now = () => now--;
    }
    await assert.rejects(
      firstRuntime.readFirstCutoverCloudRecoveryVacancy(f.request, f.io),
      /CUTOVER_CLOUD_VACANCY_UNPROVEN/,
    );
  });
}

async function privatePolicyFixture() {
  const root = await fs.realpath(await fs.mkdtemp(join(tmpdir(), 'cloud-policy-')));
  const physical = (p) => join(root, p);
  const logical = (p) => (p === root ? '/' : p.startsWith(`${root}/`) ? p.slice(root.length) : p);
  const source = '/etc/brave/policies/managed';
  const parent = '/var/lib/holaday-deploy/maintenance';
  const attempt = '22222222-2222-4222-8222-222222222222';
  const target = `${parent}/${attempt}/cloud-browser-policy`;
  await fs.mkdir(physical(source), { recursive: true, mode: 0o755 });
  await fs.mkdir(physical(parent), { recursive: true, mode: 0o700 });
  const original = '{"HomepageLocation":"about:blank","PrivateQA":"not-returned"}\n';
  await fs.writeFile(physical(`${source}/existing.json`), original, { mode: 0o600 });
  const binding = {
    attempt,
    candidate: 'a'.repeat(40),
    configDigest: 'b'.repeat(64),
    migrationDigest: 'c'.repeat(64),
    inventoryDigest: 'd'.repeat(64),
  };
  const hash = (v) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
  const record = {
    ...binding,
    kind: 'first-cutover',
    phase: 'preflight',
    startupEvents: [],
    registrationEvents: [],
    unmanagedEvents: [],
    cloudMaintenanceEvents: [],
    executionSiteDigest: 'e'.repeat(64),
    cloudMaintenanceScope: [
      {
        name: 'holaday-vnc',
        pmId: 6,
        scopeDigest: 'f'.repeat(64),
        recoveryDigest: hash(firstRuntime.firstCutoverCloudVncRecoveryMaterial({ attempt })),
      },
      {
        name: 'holaday-chromium-headed',
        pmId: 7,
        scopeDigest: 'f'.repeat(64),
        recoveryDigest: hash(firstRuntime.firstCutoverCloudBrowserRecoveryLaunch({ attempt })),
      },
    ],
  };
  // Logical fixed paths mapped to real isolated files. Root identity is synthetic
  // only on non-root developer machines; the Linux suite uses actual root IO.
  const metadata = (st) => (process.getuid?.() === 0 ? st : Object.assign(st, { uid: 0 }));
  const io = {
    platform: 'linux',
    uid: 0,
    now: () => 1000,
    journal: {
      assertOwnership: async () => structuredClone(binding),
      readFirstCutoverEffects: async () => structuredClone(record),
    },
    lstat: async (p) => metadata(await fs.lstat(physical(p))),
    realpath: async (p) => logical(await fs.realpath(physical(p))),
    readdir: (p) => fs.readdir(physical(p)),
    mkdir: (p, o) => fs.mkdir(physical(p), o),
    open: async (p, ...args) => {
      const h = await fs.open(physical(p), ...args);
      return {
        stat: async () => metadata(await h.stat()),
        read: (...a) => h.read(...a),
        writeFile: (...a) => h.writeFile(...a),
        sync: () => h.sync(),
        close: () => h.close(),
      };
    },
  };
  return {
    root,
    physical,
    source,
    parent,
    target,
    attempt,
    original,
    binding,
    record,
    io,
    cleanup: () => fs.rm(root, { recursive: true, force: true }),
  };
}
test('private cloud policy preparation copies protected bytes under owned attempt and refuses reuse', async () => {
  const f = await privatePolicyFixture();
  try {
    const result = await firstRuntime.prepareFirstCutoverCloudBrowserPolicy(
      { attempt: f.attempt, maintenanceEndsAtMs: 15000 },
      f.io,
    );
    assert.equal(result.attempt, f.attempt);
    assert.match(result.originalDigest, /^[a-f0-9]{64}$/);
    assert.match(result.privateDigest, /^[a-f0-9]{64}$/);
    assert.equal(JSON.stringify(result).includes('not-returned'), false);
    assert.equal(await fs.readFile(f.physical(`${f.source}/existing.json`), 'utf8'), f.original);
    assert.equal(await fs.readFile(f.physical(`${f.target}/existing.json`), 'utf8'), f.original);
    assert.deepEqual(
      JSON.parse(await fs.readFile(f.physical(`${f.target}/recovery.json`), 'utf8')),
      { RestoreOnStartup: 5 },
    );
    assert.equal((await fs.stat(f.physical(f.target))).mode & 0o7777, 0o700);
    for (const name of ['existing.json', 'recovery.json'])
      assert.equal((await fs.stat(f.physical(`${f.target}/${name}`))).mode & 0o7777, 0o600);
    await assert.rejects(
      firstRuntime.prepareFirstCutoverCloudBrowserPolicy(
        { attempt: f.attempt, maintenanceEndsAtMs: 15000 },
        f.io,
      ),
      /CUTOVER_CLOUD_POLICY_UNPROVEN/,
    );
    assert.equal(await fs.readFile(f.physical(`${f.target}/existing.json`), 'utf8'), f.original);
  } finally {
    await f.cleanup();
  }
});
test('private cloud policy preparation consumes the actual v1 first-cutover journal projection', async () => {
  const f = await privatePolicyFixture();
  let journal;
  try {
    const manifest = {
      replaysNumberedSql: true,
      runnerSha256: 'a'.repeat(64),
      migrations: [{ name: '0042_qa.sql', sha256: 'b'.repeat(64) }],
    };
    journal = await acquireReleaseJournal(f.physical(f.parent), {
      ...f.binding,
      kind: 'first-cutover',
      legacyDigest: 'c'.repeat(64),
      migrationDigest: createHash('sha256').update(JSON.stringify(manifest)).digest('hex'),
    });
    await journal.bindManifest(manifest);
    await journal.bindExecutionSite(f.record.executionSiteDigest, f.record.cloudMaintenanceScope);
    const before = await journal.readFirstCutoverEffects();
    assert.equal(before.kind, undefined);
    assert.equal(before.cloudMaintenanceEvents, undefined);
    const result = await firstRuntime.prepareFirstCutoverCloudBrowserPolicy(
      { attempt: f.attempt, maintenanceEndsAtMs: 15000 },
      { ...f.io, journal },
    );
    assert.match(result.privateDigest, /^[a-f0-9]{64}$/);
    assert.deepEqual(await journal.readFirstCutoverEffects(), before);
  } finally {
    await journal?.close();
    await f.cleanup();
  }
});
for (const fault of [
  'platform',
  'uid',
  'extra',
  'wrong-attempt',
  'phase',
  'wrong-kind',
  'null-cloud-events',
  'missing-deadline',
  'expired-deadline',
  'deadline-drift',
  'journal-deadline',
  'scope-launch',
  'scope-role',
  'scope-id',
  'failure',
  'prior-cloud-event',
  'no-journal',
  'unowned',
  'unsafe-parent',
  'source-writable',
  'source-symlink',
  'file-symlink',
  'file-hardlink',
  'reserved-name',
  'startup-key',
  'invalid-json',
  'invalid-name',
  'existing-attempt',
  'source-drift',
  'lost-lock',
  'write-failure',
]) {
  test(`private cloud policy preparation refuses ${fault} and preserves originals`, async () => {
    const f = await privatePolicyFixture();
    const input = {
      attempt: f.attempt,
      ...(fault === 'missing-deadline' ? {} : { maintenanceEndsAtMs: 15000 }),
    };
    try {
      if (fault === 'platform') f.io.platform = 'darwin';
      if (fault === 'uid') f.io.uid = 1;
      if (fault === 'extra') input.overwrite = true;
      if (fault === 'wrong-attempt') input.attempt = '33333333-3333-4333-8333-333333333333';
      if (fault === 'wrong-kind') f.record.kind = 'ordinary';
      if (fault === 'null-cloud-events') f.record.cloudMaintenanceEvents = null;
      if (fault === 'expired-deadline') input.maintenanceEndsAtMs = 1000;
      if (fault === 'journal-deadline') f.record.maintenanceEndsAtMs = 16000;
      if (fault === 'phase') f.record.phase = 'verified';
      if (fault === 'scope-launch')
        f.record.cloudMaintenanceScope[1].recoveryDigest = '0'.repeat(64);
      if (fault === 'scope-role') f.record.cloudMaintenanceScope[1].name = 'other';
      if (fault === 'scope-id')
        f.record.cloudMaintenanceScope[1].pmId = f.record.cloudMaintenanceScope[0].pmId;
      if (fault === 'failure') f.record.failureObservation = { code: 'prior' };
      if (fault === 'prior-cloud-event')
        f.record.cloudMaintenanceEvents.push({ phase: 'cloud-stop-intent' });
      if (fault === 'no-journal') f.io.journal = undefined;
      if (fault === 'unowned')
        f.io.journal.assertOwnership = async () => {
          throw Error('not owned');
        };
      if (fault === 'unsafe-parent') await fs.chmod(f.physical(f.parent), 0o777);
      if (fault === 'source-writable')
        await fs.chmod(f.physical(`${f.source}/existing.json`), 0o666);
      if (fault === 'source-symlink') {
        await fs.rename(f.physical(f.source), f.physical(`${f.source}-moved`));
        await fs.symlink(f.physical(`${f.source}-moved`), f.physical(f.source));
      }
      if (fault === 'file-symlink') {
        await fs.rename(f.physical(`${f.source}/existing.json`), f.physical('/original.json'));
        await fs.symlink(f.physical('/original.json'), f.physical(`${f.source}/existing.json`));
      }
      if (fault === 'file-hardlink')
        await fs.link(f.physical(`${f.source}/existing.json`), f.physical('/linked.json'));
      if (fault === 'reserved-name')
        await fs.writeFile(f.physical(`${f.source}/recovery.json`), '{}');
      if (fault === 'startup-key')
        await fs.writeFile(f.physical(`${f.source}/existing.json`), '{"RestoreOnStartup":1}');
      if (fault === 'invalid-json')
        await fs.writeFile(f.physical(`${f.source}/existing.json`), 'invalid');
      if (fault === 'invalid-name') await fs.writeFile(f.physical(`${f.source}/unrecognized`), 'x');
      if (fault === 'existing-attempt') {
        await fs.mkdir(f.physical(`${f.parent}/${f.attempt}`), { mode: 0o700 });
        await fs.writeFile(f.physical(`${f.parent}/${f.attempt}/sentinel`), 'preserve');
      }
      let created = false;
      let clock = 1000;
      if (fault === 'deadline-drift') f.io.now = () => clock;
      const mkdir = f.io.mkdir;
      f.io.mkdir = async (...args) => {
        const v = await mkdir(...args);
        created = true;
        if (fault === 'deadline-drift') clock = 15000;
        if (fault === 'source-drift')
          await fs.writeFile(f.physical(`${f.source}/existing.json`), '{"changed":true}');
        return v;
      };
      if (fault === 'lost-lock') {
        const ownership = f.io.journal.assertOwnership;
        f.io.journal.assertOwnership = async () => {
          if (created) throw Error('lost');
          return ownership();
        };
      }
      if (fault === 'write-failure') {
        const open = f.io.open;
        f.io.open = async (p, ...args) => {
          if (p.startsWith(f.target)) throw Error('write failed');
          return open(p, ...args);
        };
      }
      const baseline = await fs.readFile(f.physical(`${f.source}/existing.json`), 'utf8');
      await assert.rejects(
        firstRuntime.prepareFirstCutoverCloudBrowserPolicy(input, f.io),
        /CUTOVER_CLOUD_POLICY_UNPROVEN/,
      );
      assert.equal(
        await fs.readFile(f.physical(`${f.source}/existing.json`), 'utf8'),
        fault === 'source-drift' && created ? '{"changed":true}' : baseline,
      );
      if (fault === 'existing-attempt')
        assert.equal(
          await fs.readFile(f.physical(`${f.parent}/${f.attempt}/sentinel`), 'utf8'),
          'preserve',
        );
      if (['source-drift', 'lost-lock', 'write-failure'].includes(fault)) {
        assert.equal(created, true);
        await assert.rejects(
          firstRuntime.prepareFirstCutoverCloudBrowserPolicy(input, f.io),
          /CUTOVER_CLOUD_POLICY_UNPROVEN/,
        );
      }
    } finally {
      await f.cleanup();
    }
  });
}
const pythonUserSitePaths = [
  '/root/.local',
  '/root/.local/lib',
  '/root/.local/lib/python3.10',
  '/root/.local/lib/python3.10/site-packages',
];
for (const depth of [1, 2, 3]) {
  test(`cloud sources accepts ${depth} protected user-base ancestors with no Python user site`, async () => {
    const f = await sourceNativeFixture();
    for (const path of pythonUserSitePaths.slice(0, depth)) f.dirs.add(path);
    f.add('/root/.local/share/qa-note', 'unrelated application data');
    const open = f.io.open;
    f.io.open = async (path) => {
      assert.ok(!path.startsWith('/root/.local/'), 'do not read unrelated user-base data');
      return open(path);
    };
    const result = await firstRuntime.readFirstCutoverCloudRecoverySources(f.input, f.io);
    assert.equal(result.pythonEntry.name, 'websockify');
    assert.ok(result.files.every((row) => !row.path.startsWith('/root/.local/')));
  });
}
for (const fault of [
  'present-site',
  'symlink-local',
  'symlink-lib',
  'symlink-python',
  'writable-local',
  'writable-lib',
  'writable-python',
  'unowned-local',
  'non-directory-lib',
  'creation-drift',
]) {
  test(`cloud sources refuses unsafe user-base ${fault}`, async () => {
    const f = await sourceNativeFixture();
    for (const path of pythonUserSitePaths.slice(0, 3)) f.dirs.add(path);
    if (fault === 'present-site') f.dirs.add(pythonUserSitePaths[3]);
    for (const [part, index] of [
      ['local', 0],
      ['lib', 1],
      ['python', 2],
    ]) {
      if (fault === `symlink-${part}`) {
        f.links.set(pythonUserSitePaths[index], '/tmp/foreign-user-base');
        f.dirs.add('/tmp/foreign-user-base');
      }
      if (fault === `writable-${part}`) f.modes.set(pythonUserSitePaths[index], 0o40777);
    }
    if (fault === 'unowned-local') {
      const read = f.io.lstat;
      f.io.lstat = async (path) => {
        const stat = await read(path);
        return path === pythonUserSitePaths[0] ? { ...stat, uid: 1000 } : stat;
      };
    }
    if (fault === 'non-directory-lib') {
      f.dirs.delete(pythonUserSitePaths[1]);
      f.add(pythonUserSitePaths[1], 'not a directory');
    }
    if (fault === 'creation-drift') {
      const read = f.io.lstat;
      let absentReads = 0;
      f.io.lstat = async (path) => {
        if (path === pythonUserSitePaths[3] && ++absentReads === 3) f.dirs.add(path);
        return read(path);
      };
    }
    await assert.rejects(
      firstRuntime.readFirstCutoverCloudRecoverySources(f.input, f.io),
      /SOURCES_UNPROVEN/,
    );
  });
}

test('cloud source schema preserves exact compatibility facts and refuses forged special targets', async () => {
  const f = await sourceNativeFixture();
  f.modes.set('/usr/bin/mount', 0o104755);
  f.add('/usr/bin/pgrep', 'reviewed procps executable');
  f.links.set('/usr/bin/pkill', '/usr/bin/pgrep');
  const result = await firstRuntime.readFirstCutoverCloudRecoverySources(f.input, f.io);
  const options = {
    scope: f.input.configs.map(({ name, pmId }) => ({ name, pmId })),
    observed: true,
  };
  assert.doesNotThrow(() => validateFirstCutoverCloudSources(result, options));
  for (const [path, changes] of [
    ['/usr/bin/pkill', { resolvedPath: '/usr/local/bin/pgrep' }],
    ['/usr/bin/mount', { resolvedPath: '/tmp/mount' }],
    ['/usr/bin/mount', { gid: 1 }],
    ['/usr/bin/mount', { mode: 0o6755 }],
    ['/usr/bin/unshare', { mode: 0o4755 }],
  ]) {
    const forged = structuredClone(result);
    Object.assign(
      forged.files.find((row) => row.path === path),
      changes,
    );
    assert.throws(
      () => validateFirstCutoverCloudSources(forged, options),
      /CUTOVER_CLOUD_SOURCES_UNPROVEN/,
    );
  }
});

test('cloud sources binds the procps pkill symlink to its exact pgrep executable', async () => {
  const f = await sourceNativeFixture();
  f.add('/usr/bin/pgrep', 'reviewed procps executable');
  f.links.set('/usr/bin/pkill', '/usr/bin/pgrep');
  const result = await firstRuntime.readFirstCutoverCloudRecoverySources(f.input, f.io);
  const tool = result.files.find((row) => row.path === '/usr/bin/pkill');
  assert.equal(tool.resolvedPath, '/usr/bin/pgrep');
  assert.equal(
    tool.digest,
    createHash('sha256').update('reviewed procps executable').digest('hex'),
  );
});
for (const path of ['/usr/local/bin/pgrep', '/tmp/pgrep', '/usr/bin/pgrep.other']) {
  test(`cloud sources refuses pkill redirected to ${path}`, async () => {
    const f = await sourceNativeFixture();
    f.add(path, 'other executable');
    f.links.set('/usr/bin/pkill', path);
    await assert.rejects(
      firstRuntime.readFirstCutoverCloudRecoverySources(f.input, f.io),
      /CUTOVER_CLOUD_SOURCES_UNPROVEN/,
    );
  });
}

test('cloud sources retains exact root-owned setuid mount metadata for the fixed root bootstrap', async () => {
  const f = await sourceNativeFixture();
  f.modes.set('/usr/bin/mount', 0o104755);
  const result = await firstRuntime.readFirstCutoverCloudRecoverySources(f.input, f.io);
  const mount = result.files.find((row) => row.path === '/usr/bin/mount');
  assert.equal(mount.mode, 0o4755);
  assert.equal(mount.uid, 0);
  assert.equal(mount.gid, 0);
  assert.equal(mount.resolvedPath, '/usr/bin/mount');
});

for (const [path, mode] of [
  ['/usr/bin/mount', 0o102755],
  ['/usr/bin/mount', 0o106755],
  ['/usr/bin/mount', 0o105755],
  ['/usr/bin/mount', 0o104775],
  ['/usr/bin/mount', 0o104744],
  ['/usr/bin/unshare', 0o104755],
  ['/usr/bin/python3.10', 0o104755],
  ['/usr/bin', 0o44755],
]) {
  test(`cloud sources still refuses special permission ${path} ${mode.toString(8)}`, async () => {
    const f = await sourceNativeFixture();
    f.modes.set(path, mode);
    await assert.rejects(
      firstRuntime.readFirstCutoverCloudRecoverySources(f.input, f.io),
      /CUTOVER_CLOUD_SOURCES_UNPROVEN/,
    );
  });
}
for (const field of ['uid', 'gid']) {
  test(`cloud sources refuses setuid mount with non-root ${field}`, async () => {
    const f = await sourceNativeFixture();
    f.modes.set('/usr/bin/mount', 0o104755);
    const read = f.io.lstat;
    f.io.lstat = async (path) => {
      const stat = await read(path);
      return path === '/usr/bin/mount' ? { ...stat, [field]: 1 } : stat;
    };
    await assert.rejects(
      firstRuntime.readFirstCutoverCloudRecoverySources(f.input, f.io),
      /CUTOVER_CLOUD_SOURCES_UNPROVEN/,
    );
  });
}
test('cloud sources refuses setuid mount permission drift during observation', async () => {
  const f = await sourceNativeFixture();
  f.modes.set('/usr/bin/mount', 0o104755);
  const read = f.io.lstat;
  let visits = 0;
  f.io.lstat = async (path) => {
    if (path === '/usr/bin/mount' && ++visits === 3) f.modes.set(path, 0o100755);
    return read(path);
  };
  await assert.rejects(
    firstRuntime.readFirstCutoverCloudRecoverySources(f.input, f.io),
    /CUTOVER_CLOUD_SOURCES_UNPROVEN/,
  );
});

async function reviewedPythonHooksFixture() {
  const f = await sourceNativeFixture();
  const fixture = JSON.parse(
    await fs.readFile(
      new URL('./fixtures/browser-cloud-reviewed-python-hooks.json', import.meta.url),
      'utf8',
    ),
  );
  for (const [path, bytes] of Object.entries(fixture.files))
    f.add(path, Buffer.from(bytes, 'base64'));
  f.links.set('/usr/lib/python3.10/sitecustomize.py', '/etc/python3.10/sitecustomize.py');
  return f;
}

test('cloud sources binds exact reviewed startup hooks and matching compiled caches', async () => {
  const f = await reviewedPythonHooksFixture();
  const result = await firstRuntime.readFirstCutoverCloudRecoverySources(f.input, f.io);
  const site = result.files.find((r) => r.path === '/usr/lib/python3.10/sitecustomize.py');
  assert.equal(site.resolvedPath, '/etc/python3.10/sitecustomize.py');
  assert.equal(site.digest, '43d81125d92376b1a69d53a71126a041cc9a18d8080e92dea0a2ae23be138b1e');
  assert.equal(
    result.files.find((r) => r.path.endsWith('/apport_python_hook.cpython-310.pyc')).digest,
    '4beeaf52bfd13b80ecd323ddce720028f9560aa189b22b643683c2eac0696187',
  );
  assert.equal(result.files.filter((r) => r.path.endsWith('-nspkg.pth')).length, 4);
});

for (const mode of [
  'changed-source',
  'changed-cache',
  'changed-pth',
  'alternate-cache',
  'orphan-cache',
  'entry-shadow',
  'stdlib-shadow',
  'local-shadow',
  'unknown-pth',
  'redirected-site',
]) {
  test(`cloud sources reviewed hooks refuse ${mode}`, async () => {
    const f = await reviewedPythonHooksFixture();
    if (mode === 'changed-source')
      f.add('/usr/lib/python3/dist-packages/apport_python_hook.py', '# changed');
    if (mode === 'changed-cache')
      f.add(
        '/usr/lib/python3/dist-packages/__pycache__/apport_python_hook.cpython-310.pyc',
        'changed',
      );
    if (mode === 'changed-pth')
      f.add('/usr/lib/python3/dist-packages/zope.event-4.4-nspkg.pth', 'import evil');
    if (mode === 'alternate-cache')
      f.add('/usr/lib/python3.10/__pycache__/sitecustomize.cpython-310.opt-1.pyc', 'other');
    if (mode === 'orphan-cache')
      f.data.delete('/usr/lib/python3/dist-packages/apport_python_hook.py');
    if (mode === 'entry-shadow') f.add('/usr/bin/apport_python_hook.py', 'other');
    if (mode === 'stdlib-shadow') f.add('/usr/lib/python3.10/apport_python_hook.py', 'other');
    if (mode === 'local-shadow')
      f.add('/usr/local/lib/python3.10/dist-packages/apport_python_hook.py', 'other');
    if (mode === 'unknown-pth')
      f.add('/usr/lib/python3/dist-packages/zope.other-nspkg.pth', 'other');
    if (mode === 'redirected-site') {
      f.add('/etc/other/sitecustomize.py', 'other');
      f.links.set('/usr/lib/python3.10/sitecustomize.py', '/etc/other/sitecustomize.py');
    }
    await assert.rejects(
      firstRuntime.readFirstCutoverCloudRecoverySources(f.input, f.io),
      /CUTOVER_CLOUD_SOURCES_UNPROVEN/,
    );
  });
}

test('cloud sources accepts reviewed source-only startup when no compiled caches are selected', async () => {
  const f = await reviewedPythonHooksFixture();
  for (const path of [...f.data.keys()]) if (path.endsWith('.pyc')) f.data.delete(path);
  const result = await firstRuntime.readFirstCutoverCloudRecoverySources(f.input, f.io);
  assert.equal(
    result.files.some((r) => r.path.endsWith('.pyc')),
    false,
  );
  assert.equal(
    result.files.some((r) => r.path.endsWith('/apport_python_hook.py')),
    true,
  );
});

test('cloud sources compatibility binds the measured optional LF metadata marker', async () => {
  const f = await sourceNativeFixture();
  const path = '/usr/lib/python3/dist-packages/websockify-0.10.0.egg-info/not-zip-safe';
  f.add(path, '\n');
  f.modes.set(path, 0o100644);
  const result = await firstRuntime.readFirstCutoverCloudRecoverySources(f.input, f.io);
  assert.deepEqual(
    result.files.find((row) => row.path === path),
    {
      path,
      resolvedPath: path,
      uid: 0,
      gid: 0,
      mode: 0o644,
      size: 1,
      digest: '01ba4719c80b6fe911b091a7c05124b64eeece964e09c058ef8f9805daca546b',
    },
  );
});
for (const [name, content] of [
  ['empty', ''],
  ['different byte', 'x'],
  ['extra LF', '\n\n'],
]) {
  test(`cloud sources compatibility refuses marker ${name}`, async () => {
    const f = await sourceNativeFixture();
    f.add('/usr/lib/python3/dist-packages/websockify-0.10.0.egg-info/not-zip-safe', content);
    await assert.rejects(
      firstRuntime.readFirstCutoverCloudRecoverySources(f.input, f.io),
      /CUTOVER_CLOUD_SOURCES_UNPROVEN/,
    );
  });
}
for (const kind of ['directory', 'alias']) {
  test(`cloud sources compatibility refuses marker ${kind} before opening target`, async () => {
    const f = await sourceNativeFixture();
    const path = '/usr/lib/python3/dist-packages/websockify-0.10.0.egg-info/not-zip-safe';
    const target = '/usr/lib/python3/dist-packages/websockify-0.10.0.egg-info/dependency_links.txt';
    if (kind === 'directory') f.dirs.add(path);
    else {
      f.add(target, '\n');
      f.links.set(path, target);
    }
    const opened = [];
    const open = f.io.open;
    f.io.open = async (p, ...args) => {
      opened.push(p);
      return open(p, ...args);
    };
    await assert.rejects(
      firstRuntime.readFirstCutoverCloudRecoverySources(f.input, f.io),
      /CUTOVER_CLOUD_SOURCES_UNPROVEN/,
    );
    assert.equal(opened.includes(path), false);
    // dependency_links is independently read by the ordinary sorted metadata loop;
    // the alias must never trigger a second open of its target.
    assert.ok(opened.filter((p) => p === target).length <= 1);
  });
}
test('cloud sources compatibility binds actual synthetic date bytes', async () => {
  const f = await sourceNativeFixture();
  const before = await firstRuntime.readFirstCutoverCloudRecoverySources(f.input, f.io);
  assert.equal(
    before.files.find((row) => row.path === '/usr/bin/date')?.digest,
    createHash('sha256').update('binary').digest('hex'),
  );
  f.add('/usr/bin/date', 'changed synthetic date');
  const after = await firstRuntime.readFirstCutoverCloudRecoverySources(f.input, f.io);
  assert.notDeepEqual(before.files, after.files);
});
for (const fault of ['missing', 'PATH shadow', 'untrusted']) {
  test(`cloud sources compatibility refuses date ${fault}`, async () => {
    const f = await sourceNativeFixture();
    if (fault === 'missing') f.data.delete('/usr/bin/date');
    if (fault === 'untrusted') f.modes.set('/usr/bin/date', 0o100777);
    if (fault === 'PATH shadow') {
      f.add('/opt/earlier/date', 'synthetic executable shadow');
      f.input.configs[0].config.env.PATH = '/opt/earlier:/usr/bin';
    }
    await assert.rejects(
      firstRuntime.readFirstCutoverCloudRecoverySources(f.input, f.io),
      /CUTOVER_CLOUD_SOURCES_UNPROVEN/,
    );
  });
}
test('cloud sources native reads bounded current bytes and stable private recovery selections', async () => {
  const f = await sourceNativeFixture();
  const saved = structuredClone(f.input);
  const a = await firstRuntime.readFirstCutoverCloudRecoverySources(f.input, f.io);
  assert.equal(a.files.length, 29);
  assert.equal(a.roles.length, 2);
  assert.equal(JSON.stringify(a).includes('never-export-this'), false);
  assert.deepEqual(f.input, saved);
  for (const r of f.input.configs) {
    r.config.status = 'stopped';
    r.config.axm_monitor = { latency: 42 };
  }
  const b = await firstRuntime.readFirstCutoverCloudRecoverySources(f.input, f.io);
  assert.deepEqual(
    a.roles.map((r) => r.selectionDigest),
    b.roles.map((r) => r.selectionDigest),
  );
  assert.notEqual(a.roles[0].configDigest, b.roles[0].configDigest);
});
test('cloud sources native refuses escaped resolved target before opening it', async () => {
  const f = await sourceNativeFixture();
  f.add('/outside/secret', 'must-not-read');
  f.links.set('/usr/bin/Xvfb', '/outside/secret');
  const opened = [];
  const open = f.io.open;
  f.io.open = async (p, ...args) => {
    opened.push(p);
    return open(p, ...args);
  };
  await assert.rejects(
    firstRuntime.readFirstCutoverCloudRecoverySources(f.input, f.io),
    /CUTOVER_CLOUD_SOURCES_UNPROVEN/,
  );
  assert.equal(opened.includes('/outside/secret'), false);
});
test('cloud sources native binds standard package caches and empty optional metadata', async () => {
  const f = await sourceNativeFixture();
  f.add(
    '/usr/lib/python3/dist-packages/websockify/__pycache__/websocket.cpython-310.pyc',
    'synthetic cached bytes',
  );
  f.add('/usr/lib/python3/dist-packages/websockify-0.10.0.egg-info/dependency_links.txt', '');
  const result = await firstRuntime.readFirstCutoverCloudRecoverySources(f.input, f.io);
  assert.equal(result.files.find((f) => f.path.endsWith('dependency_links.txt')).size, 0);
  assert.ok(result.files.some((f) => f.path.endsWith('websocket.cpython-310.pyc')));
});
test('cloud sources native refuses case-normalized alternate distribution', async () => {
  const f = await sourceNativeFixture();
  f.add(
    '/usr/lib/python3/dist-packages/WebSockify-2.dist-info/METADATA',
    'Name: websockify\nVersion: 2.0\n',
  );
  await assert.rejects(
    firstRuntime.readFirstCutoverCloudRecoverySources(f.input, f.io),
    /CUTOVER_CLOUD_SOURCES_UNPROVEN/,
  );
});
for (const candidate of [
  'websockify-9.0.dist-info',
  'WebSockify_9.0.EGG-INFO',
  'websockify.cpython-310-x86_64-linux-gnu.so',
  'websockify.abi3.so',
]) {
  for (const closing of [false, true]) {
    test(`cloud sources I2 refuses entry shadow ${candidate} ${closing ? 'at closing bracket' : 'already present'}`, async () => {
      const f = await sourceNativeFixture();
      const introduce = () =>
        f.add(
          `/usr/bin/${candidate}${/info$/i.test(candidate) ? '/METADATA' : ''}`,
          'unreviewed shadow',
        );
      if (!closing) introduce();
      const opendir = f.io.opendir;
      let scans = 0;
      f.io.opendir = async function (path) {
        if (path === '/usr/bin' && ++scans === 2 && closing) introduce();
        return opendir.call(this, path);
      };
      await assert.rejects(
        firstRuntime.readFirstCutoverCloudRecoverySources(f.input, f.io),
        /CUTOVER_CLOUD_SOURCES_UNPROVEN/,
      );
      if (closing) assert.equal(scans, 2, 'closing scan must observe the new candidate');
    });
  }
}
test('cloud sources I2 allows more than 512 unrelated entry-directory names and scans twice', async () => {
  const f = await sourceNativeFixture();
  for (let i = 0; i < 600; i++) f.add(`/usr/bin/unrelated-tool-${i}`);
  const opendir = f.io.opendir;
  let scans = 0;
  f.io.opendir = async function (path) {
    if (path === '/usr/bin') scans++;
    return opendir.call(this, path);
  };
  const result = await firstRuntime.readFirstCutoverCloudRecoverySources(f.input, f.io);
  assert.equal(result.roles.length, 2);
  assert.equal(scans, 2);
});
test('cloud sources I2 bounds total entry enumeration independently of candidate count', async () => {
  const f = await sourceNativeFixture();
  let readCount = 0;
  f.io.opendir = async () => ({
    read: async () => ({ name: `unrelated-${++readCount}` }),
    close: async () => {},
  });
  await assert.rejects(
    firstRuntime.readFirstCutoverCloudRecoverySources(f.input, f.io),
    /CUTOVER_CLOUD_SOURCES_UNPROVEN/,
  );
  assert.ok(readCount <= 16385);
});
test('cloud sources native refuses unexpected metadata before opening bytes', async () => {
  const f = await sourceNativeFixture();
  const path = '/usr/lib/python3/dist-packages/websockify-0.10.0.egg-info/unreviewed';
  f.add(path, 'do-not-read');
  const opened = [];
  const open = f.io.open;
  f.io.open = async (p, ...args) => {
    opened.push(p);
    return open(p, ...args);
  };
  await assert.rejects(
    firstRuntime.readFirstCutoverCloudRecoverySources(f.input, f.io),
    /CUTOVER_CLOUD_SOURCES_UNPROVEN/,
  );
  assert.equal(opened.includes(path), false);
});
test('cloud sources native binds environment absence and detects global source drift', async () => {
  const f = await sourceNativeFixture();
  const first = await firstRuntime.readFirstCutoverCloudRecoverySources(f.input, f.io);
  f.input.configs[0].config.env.PYTHONPATH = '';
  const second = await firstRuntime.readFirstCutoverCloudRecoverySources(f.input, f.io);
  assert.notEqual(first.roles[0].selectionDigest, second.roles[0].selectionDigest);
  const stat = f.io.lstat;
  let reads = 0;
  f.io.lstat = async (p) => {
    const value = await stat(p);
    if (p === '/usr/bin/Xvfb' && ++reads > 3) return { ...value, mtimeMs: 2 };
    return value;
  };
  await assert.rejects(
    firstRuntime.readFirstCutoverCloudRecoverySources(f.input, f.io),
    /CUTOVER_CLOUD_SOURCES_UNPROVEN/,
  );
});
test('cloud sources native streams through real filesystem IO with private synthetic source tree', async () => {
  const f = await sourceNativeFixture();
  const directory = await fs.realpath(await fs.mkdtemp(join(tmpdir(), 'cloud-source-io-')));
  const physical = (p) => join(directory, p);
  const logical = (p) =>
    p === directory ? '/' : p.startsWith(`${directory}/`) ? p.slice(directory.length) : p;
  try {
    for (const d of [...f.dirs].sort((a, b) => a.length - b.length))
      await fs.mkdir(physical(d), { recursive: true, mode: 0o755 });
    for (const [p, bytes] of f.data) await fs.writeFile(physical(p), bytes, { mode: 0o755 });
    for (const [p, target] of f.links) await fs.symlink(physical(target), physical(p));
    // Mac metadata is explicitly synthetic; Linux root runs use actual uid/gid.
    const owned = (s) =>
      process.getuid?.() === 0 ? s : Object.assign(Object.create(s), { uid: 0, gid: 0 });
    const io = {
      ...f.io,
      lstat: async (p) => owned(await fs.lstat(physical(p))),
      realpath: async (p) => logical(await fs.realpath(physical(p))),
      readdir: (p) => fs.readdir(physical(p)),
      opendir: (p) => fs.opendir(physical(p)),
      open: async (p, flags) => {
        const h = await fs.open(physical(p), flags);
        return {
          read: (...a) => h.read(...a),
          stat: async () => owned(await h.stat()),
          close: () => h.close(),
        };
      },
    };
    const result = await firstRuntime.readFirstCutoverCloudRecoverySources(f.input, io);
    assert.equal(result.files.length, 29);
    assert.equal(JSON.stringify(result).includes(directory), false);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});
for (const [name, change] of [
  ['daemon option', (f) => f.data.set('/proc/40/environ', Buffer.from('PM2_NODE_OPTIONS=-c\0'))],
  [
    'duplicate daemon key',
    (f) => f.data.set('/proc/40/environ', Buffer.from('PM2_NODE_OPTIONS=\0PM2_NODE_OPTIONS=\0')),
  ],
  [
    'nested command',
    (f) => {
      f.input.configs[0].config.env.pm_exec_path = '/tmp/evil';
    },
  ],
  [
    'loader',
    (f) => {
      f.input.configs[0].config.env.LD_PRELOAD = '/tmp/evil';
    },
  ],
  [
    'shell hook',
    (f) => {
      f.input.configs[0].config.env.BASH_ENV = '/tmp/evil';
    },
  ],
  [
    'python override',
    (f) => {
      f.input.configs[0].config.env.PYTHONPATH = '/tmp/evil';
    },
  ],
  [
    'interpreter arguments',
    (f) => {
      f.input.configs[0].config.node_args = ['-c', 'evil'];
    },
  ],
  [
    'relative PATH',
    (f) => {
      f.input.configs[0].config.env.PATH = '.:/usr/bin';
    },
  ],
  [
    'metadata duplicate',
    (f) =>
      f.add(
        '/usr/lib/python3/dist-packages/websockify-2.dist-info/METADATA',
        'Name: websockify\nVersion: 2.0\n',
      ),
  ],
  ['pth hook', (f) => f.add('/usr/lib/python3/dist-packages/custom.pth', 'import evil')],
  ['writable binary', (f) => f.modes.set('/usr/bin/Xvfb', 0o100777)],
  ['PM2 drift', (f) => f.data.set('/usr/lib/node_modules/pm2/lib/God.js', Buffer.from('changed'))],
  [
    'deadline',
    (f) => {
      let n = 0;
      f.io.monotonic = () => n++ * 60001;
    },
  ],
])
  test(`cloud sources native refuses ${name} without mutation`, async () => {
    const f = await sourceNativeFixture();
    change(f);
    const saved = structuredClone(f.input);
    await assert.rejects(
      firstRuntime.readFirstCutoverCloudRecoverySources(f.input, f.io),
      /CUTOVER_CLOUD_SOURCES_UNPROVEN/,
    );
    assert.deepEqual(f.input, saved);
  });

function cloudManagersFixture() {
  const vnc = {
    pm_id: 6,
    name: 'holaday-vnc',
    pid: 40,
    pm2_env: {
      pm_id: 6,
      name: 'holaday-vnc',
      status: 'online',
      restart_time: 12,
      pm_exec_path: '/opt/holaday-vnc/start.sh',
      args: ['--retained', 'literal value'],
      env: { PRIVATE_VALUE: 'selected-private-value' },
      unknown_future_option: { values: [null, false, 1.5, 'kept'] },
      axm_monitor: { value: 2 },
    },
    extra: 'not part of the private projection',
  };
  const headed = {
    pm_id: 7,
    name: 'holaday-chromium-headed',
    pid: 41,
    pm2_env: {
      pm_id: 7,
      name: 'holaday-chromium-headed',
      status: 'online',
      restart_time: 9,
      pm_exec_path: '/opt/holaday-headed/start.sh',
      args: [],
      env: { DISPLAY: ':98' },
    },
  };
  const unrelated = {
    pm_id: 8,
    name: 'unrelated',
    pid: 42,
    pm2_env: { pm_id: 8, name: 'unrelated', env: { PRIVATE_VALUE: 'unrelated-private-value' } },
  };
  const rows = [headed, unrelated, vnc];
  const calls = [];
  const io = {
    platform: 'linux',
    uid: 0,
    rpc: async (method, payload) => {
      calls.push({ method, payload });
      return rows;
    },
    exec: async () => assert.fail('no PM2 CLI or daemon startup'),
    writeFile: async () => assert.fail('no daemon files'),
  };
  return { vnc, headed, unrelated, rows, calls, io };
}

test('cloud managers privately returns only the ordered fixed pair with lossless detached configurations', async () => {
  const f = cloudManagersFixture();
  assert.equal(typeof firstRuntime.readFirstCutoverCloudManagers, 'function');
  const result = await firstRuntime.readFirstCutoverCloudManagers(f.io);
  assert.deepEqual(result, [
    { pm_id: 6, name: 'holaday-vnc', pid: 40, pm2_env: f.vnc.pm2_env },
    { pm_id: 7, name: 'holaday-chromium-headed', pid: 41, pm2_env: f.headed.pm2_env },
  ]);
  assert.deepEqual(f.calls, [{ method: 'getMonitorData', payload: {} }]);
  assert.equal(JSON.stringify(result).includes('unrelated-private-value'), false);
  result[0].pm2_env.env.PRIVATE_VALUE = 'changed';
  result[0].pm2_env.args.push('changed');
  assert.equal(f.vnc.pm2_env.env.PRIVATE_VALUE, 'selected-private-value');
  assert.deepEqual(f.vnc.pm2_env.args, ['--retained', 'literal value']);
});

test('cloud managers preserves fixed-pair facts when unrelated PM2 records omit pid', async () => {
  const f = cloudManagersFixture();
  Reflect.deleteProperty(f.unrelated, 'pid');
  const result = await firstRuntime.readFirstCutoverCloudManagers(f.io);
  assert.deepEqual(
    result.map(({ name, pid }) => ({ name, pid })),
    [
      { name: 'holaday-vnc', pid: 40 },
      { name: 'holaday-chromium-headed', pid: 41 },
    ],
  );
  assert.equal(Object.hasOwn(f.unrelated, 'pid'), false, 'never infer a stopped pid');
  assert.deepEqual(f.calls, [{ method: 'getMonitorData', payload: {} }]);
});
for (const role of ['vnc', 'headed']) {
  test(`cloud managers still refuses omitted pid on the fixed ${role} role`, async () => {
    const f = cloudManagersFixture();
    Reflect.deleteProperty(f[role], 'pid');
    await assert.rejects(firstRuntime.readFirstCutoverCloudManagers(f.io), /MANAGERS_UNPROVEN/);
  });
}
for (const fault of ['duplicate-id', 'role-mismatch', 'accessor-pid', 'invalid-present-pid']) {
  test(`cloud managers refuses unrelated ${fault} despite optional pid`, async () => {
    const f = cloudManagersFixture();
    Reflect.deleteProperty(f.unrelated, 'pid');
    let getterCalled = false;
    if (fault === 'duplicate-id') {
      f.unrelated.pm_id = f.vnc.pm_id;
      f.unrelated.pm2_env.pm_id = f.vnc.pm_id;
    }
    if (fault === 'role-mismatch') f.unrelated.pm2_env.name = f.vnc.name;
    if (fault === 'invalid-present-pid') f.unrelated.pid = undefined;
    if (fault === 'accessor-pid')
      Object.defineProperty(f.unrelated, 'pid', {
        enumerable: true,
        get() {
          getterCalled = true;
          throw Error('must not execute a getter');
        },
      });
    await assert.rejects(firstRuntime.readFirstCutoverCloudManagers(f.io), /MANAGERS_UNPROVEN/);
    assert.equal(getterCalled, false);
  });
}

test('cloud managers reads the stopped pair without interpreting it as recovery proof', async () => {
  const f = cloudManagersFixture();
  for (const row of [f.vnc, f.headed]) {
    row.pid = 0;
    row.pm2_env.status = 'stopped';
  }
  assert.equal(typeof firstRuntime.readFirstCutoverCloudManagers, 'function');
  const result = await firstRuntime.readFirstCutoverCloudManagers(f.io);
  assert.equal(result[0].pid, 0);
  assert.equal(result[1].pid, 0);
  assert.equal(result[0].pm2_env.restart_time, 12);
});

test('cloud managers accepts numeric PM2 ID zero without normalising it', async () => {
  const f = cloudManagersFixture();
  f.vnc.pm_id = 0;
  f.vnc.pm2_env.pm_id = 0;
  const result = await firstRuntime.readFirstCutoverCloudManagers(f.io);
  assert.equal(result[0].pm_id, 0);
  assert.equal(result[0].pm2_env.pm_id, 0);
});

for (const [name, fault] of [
  [
    'missing VNC',
    (f) => {
      f.rows.pop();
    },
  ],
  [
    'missing headed',
    (f) => {
      f.rows.shift();
    },
  ],
  [
    'duplicate fixed role',
    (f) => {
      const duplicate = structuredClone(f.vnc);
      duplicate.pm_id = 9;
      duplicate.pm2_env.pm_id = 9;
      f.rows.push(duplicate);
    },
  ],
  [
    'same ID across roles',
    (f) => {
      f.headed.pm_id = 6;
      f.headed.pm2_env.pm_id = 6;
    },
  ],
  [
    'unrelated ID collision',
    (f) => {
      f.unrelated.pm_id = 6;
      f.unrelated.pm2_env.pm_id = 6;
    },
  ],
  [
    'nested ID collision',
    (f) => {
      f.unrelated.pm2_env.pm_id = 6;
    },
  ],
  [
    'wrong nested role',
    (f) => {
      f.vnc.pm2_env.name = 'unrelated';
    },
  ],
  [
    'wrong top-level role',
    (f) => {
      f.vnc.name = 'unrelated';
    },
  ],
  [
    'missing nested name',
    (f) => {
      f.vnc.pm2_env.name = undefined;
    },
  ],
  [
    'wrong nested ID',
    (f) => {
      f.vnc.pm2_env.pm_id = 9;
    },
  ],
  [
    'missing nested ID',
    (f) => {
      f.vnc.pm2_env.pm_id = undefined;
    },
  ],
  [
    'string ID',
    (f) => {
      f.vnc.pm_id = '6';
    },
  ],
  [
    'unsafe ID',
    (f) => {
      f.vnc.pm_id = Number.MAX_SAFE_INTEGER + 1;
    },
  ],
  [
    'negative ID',
    (f) => {
      f.vnc.pm_id = -1;
    },
  ],
  [
    'negative-zero ID',
    (f) => {
      f.vnc.pm_id = -0;
      f.vnc.pm2_env.pm_id = 0;
    },
  ],
  [
    'invalid pid',
    (f) => {
      f.vnc.pid = 1.5;
    },
  ],
  [
    'negative pid',
    (f) => {
      f.vnc.pid = -1;
    },
  ],
  [
    'negative-zero pid',
    (f) => {
      f.vnc.pid = -0;
    },
  ],
  [
    'missing config',
    (f) => {
      f.vnc.pm2_env = undefined;
    },
  ],
  [
    'array config',
    (f) => {
      f.vnc.pm2_env = [];
    },
  ],
  [
    'malformed list entry',
    (f) => {
      f.rows.push(null);
    },
  ],
  [
    'undefined config value',
    (f) => {
      f.vnc.pm2_env.extra = undefined;
    },
  ],
  [
    'nonfinite config value',
    (f) => {
      f.vnc.pm2_env.extra = Number.NaN;
    },
  ],
  [
    'unsafe integer config value',
    (f) => {
      f.vnc.pm2_env.extra = Number.MAX_SAFE_INTEGER + 1;
    },
  ],
  [
    'negative zero config value',
    (f) => {
      f.vnc.pm2_env.extra = -0;
    },
  ],
  [
    'bigint config value',
    (f) => {
      f.vnc.pm2_env.extra = 1n;
    },
  ],
  [
    'date config value',
    (f) => {
      f.vnc.pm2_env.extra = new Date(0);
    },
  ],
  [
    'map config value',
    (f) => {
      f.vnc.pm2_env.extra = new Map([['key', 'value']]);
    },
  ],
  [
    'sparse config array',
    (f) => {
      f.vnc.pm2_env.extra = Array(2);
    },
  ],
  [
    'symbol config key',
    (f) => {
      f.vnc.pm2_env[Symbol('hidden')] = 'private';
    },
  ],
  [
    'nonenumerable config key',
    (f) => {
      Object.defineProperty(f.vnc.pm2_env, 'hidden', { value: 'private' });
    },
  ],
  [
    'accessor config value',
    (f) => {
      Object.defineProperty(f.vnc.pm2_env, 'extra', { enumerable: true, get: () => 'private' });
    },
  ],
  [
    'cyclic config',
    (f) => {
      f.vnc.pm2_env.extra = f.vnc.pm2_env;
    },
  ],
]) {
  test(`cloud managers refuses ${name} without raw errors or retries`, async () => {
    const f = cloudManagersFixture();
    fault(f);
    assert.equal(typeof firstRuntime.readFirstCutoverCloudManagers, 'function');
    await assert.rejects(
      firstRuntime.readFirstCutoverCloudManagers(f.io),
      /^Error: CUTOVER_CLOUD_MANAGERS_UNPROVEN$/,
    );
    assert.deepEqual(f.calls, [{ method: 'getMonitorData', payload: {} }]);
  });
}

test('cloud managers refuses non-Linux or non-root before reading RPC', async () => {
  for (const override of [{ platform: 'darwin' }, { uid: 998 }]) {
    const f = cloudManagersFixture();
    Object.assign(f.io, override);
    assert.equal(typeof firstRuntime.readFirstCutoverCloudManagers, 'function');
    await assert.rejects(firstRuntime.readFirstCutoverCloudManagers(f.io), /MANAGERS_UNPROVEN/);
    assert.equal(f.calls.length, 0);
  }
});

test('cloud managers sanitises transport and non-array responses without retrying', async () => {
  for (const kind of ['throw', 'non-array']) {
    let calls = 0;
    assert.equal(typeof firstRuntime.readFirstCutoverCloudManagers, 'function');
    await assert.rejects(
      firstRuntime.readFirstCutoverCloudManagers({
        platform: 'linux',
        uid: 0,
        rpc: async () => {
          calls++;
          if (kind === 'throw') throw Error('raw unrelated environment secret');
          return { private: 'must-not-escape' };
        },
      }),
      (error) => {
        assert.equal(error.message, 'CUTOVER_CLOUD_MANAGERS_UNPROVEN');
        assert.equal(error.cause, undefined);
        return true;
      },
    );
    assert.equal(calls, 1);
  }
});

test('cloud managers missing native socket does not create daemon files or invoke a CLI', async (t) => {
  const directory = await fs.mkdtemp(join(tmpdir(), 'cutover-cloud-managers-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  let cliCalls = 0;
  assert.equal(typeof firstRuntime.readFirstCutoverCloudManagers, 'function');
  await assert.rejects(
    firstRuntime.readFirstCutoverCloudManagers({
      platform: 'linux',
      uid: 0,
      rpcSocket: join(directory, 'rpc.sock'),
      exec: async () => {
        cliCalls++;
        throw Error('no PM2 startup');
      },
    }),
    /^Error: CUTOVER_CLOUD_MANAGERS_UNPROVEN$/,
  );
  assert.equal(cliCalls, 0);
  assert.deepEqual(await fs.readdir(directory), []);
});

test('cloud managers refuses an unowned or non-socket native endpoint before transport use', async () => {
  for (const stat of [
    { uid: 998, mode: 0o140600 },
    { uid: 0, mode: 0o100600 },
  ]) {
    let reads = 0;
    let cliCalls = 0;
    await assert.rejects(
      firstRuntime.readFirstCutoverCloudManagers({
        platform: 'linux',
        uid: 0,
        lstat: async (path) => {
          assert.equal(path, '/root/.pm2/rpc.sock');
          reads++;
          return stat;
        },
        exec: async () => {
          cliCalls++;
          throw Error('no fallback');
        },
      }),
      /^Error: CUTOVER_CLOUD_MANAGERS_UNPROVEN$/,
    );
    assert.equal(reads, 1);
    assert.equal(cliCalls, 0);
  }
});

function cloudRestartFixture() {
  const f = cloudRecoveryObservationFixture();
  const manager = structuredClone(f.manager);
  manager.pid = 0;
  Object.assign(manager.pm2_env, {
    pm_id: 7,
    status: 'stopped',
    pm_exec_path: '/opt/holaday-headed/start.sh',
    args: [],
    exec_mode: 'fork_mode',
    autorestart: true,
    restart_time: 12,
    max_memory_restart: 1572864000,
  });
  const launchDigest = createHash('sha256')
    .update(
      JSON.stringify(
        firstRuntime.firstCutoverCloudBrowserRecoveryLaunch({ attempt: f.input.attempt }),
      ),
    )
    .digest('hex');
  const scope = [
    { name: 'holaday-vnc', pmId: 6, scopeDigest: 'a'.repeat(64), recoveryDigest: 'b'.repeat(64) },
    { name: manager.name, pmId: 7, scopeDigest: 'c'.repeat(64), recoveryDigest: launchDigest },
  ];
  const binding = {
    attempt: f.input.attempt,
    candidate: 'a'.repeat(40),
    configDigest: 'b'.repeat(64),
    migrationDigest: 'c'.repeat(64),
    inventoryDigest: 'd'.repeat(64),
  };
  const record = {
    ...binding,
    phase: 'verified',
    executionSiteDigest: 'e'.repeat(64),
    cloudMaintenanceScope: scope,
    cloudMaintenanceEvents: scope.flatMap((entry) =>
      ['cloud-stop-intent', 'cloud-stopped'].map((phase) => ({
        ...entry,
        attempt: binding.attempt,
        inventoryDigest: binding.inventoryDigest,
        host: 'vultr',
        phase,
      })),
    ),
  };
  const input = {
    ...f.input,
    stoppedConfigDigest: cutoverRegistrationConfigDigest(manager.pm2_env),
    maintenanceEndsAtMs: 8000,
  };
  const calls = [];
  let now = 1000;
  const io = {
    platform: 'linux',
    uid: 0,
    now: () => now,
    journal: {
      assertOwnership: async () => structuredClone(binding),
      readFirstCutoverEffects: async () => structuredClone(record),
      recordCloudMaintenanceEvent: async (event) => {
        assert.equal(record.cloudMaintenanceEvents.length, 4);
        assert.equal(event.phase, 'cloud-restore-intent');
        record.cloudMaintenanceEvents.push(structuredClone(event));
      },
    },
    assertRecoveryScope: async (actual) => {
      assert.deepEqual(actual, input);
    },
    rpc: async (method, args, beforeSend) => {
      if (method === 'getMonitorData') return structuredClone([manager]);
      if (beforeSend) await beforeSend();
      calls.push({ method, args });
      assert.equal(record.cloudMaintenanceEvents.length, 5, 'durable intent precedes RPC');
      assert.equal(method, 'restartProcessId');
      assert.equal(args.id, 7);
      assert.equal(args.env.current_conf.pm_exec_path, '/usr/bin/unshare');
      assert.equal(args.env.current_conf.autorestart, false);
      assert.equal(args.env.current_conf.max_memory_restart, 'null');
      assert.equal(args.env.current_conf.watch, false);
      assert.equal(args.env.current_conf.cron_restart, '');
      return {};
    },
  };
  return {
    input,
    io,
    record,
    manager,
    binding,
    calls,
    setTime: (v) => {
      now = v;
    },
  };
}

test('cloud browser same-ID restore records one original-journal intent before fixed RPC and never retries it', async () => {
  const f = cloudRestartFixture();
  assert.equal(typeof firstRuntime.restoreFirstCutoverCloudBrowser, 'function');
  await firstRuntime.restoreFirstCutoverCloudBrowser(f.input, f.io);
  assert.equal(f.calls.length, 1);
  assert.equal(
    JSON.parse(JSON.stringify(f.calls[0].args)).env.current_conf.max_memory_restart,
    'null',
  );
  assert.equal(f.record.cloudMaintenanceEvents.length, 5, 'RPC ACK is not physical recovery proof');
  await assert.rejects(firstRuntime.restoreFirstCutoverCloudBrowser(f.input, f.io), /UNPROVEN/);
  assert.equal(f.calls.length, 1);
});

test('cloud browser same-ID restore rejects missing scope, drift, partial stops and deadline before dispatch', async () => {
  assert.equal(typeof firstRuntime.restoreFirstCutoverCloudBrowser, 'function');
  for (const fault of [
    (f) => {
      f.io.assertRecoveryScope = undefined;
    },
    (f) => {
      f.io.assertRecoveryScope = async () => false;
    },
    (f) => {
      f.io.assertRecoveryScope = async () => {
        throw Error('unknown writer');
      };
    },
    (f) => {
      f.manager.pid = 40;
      f.manager.pm2_env.status = 'online';
    },
    (f) => {
      f.manager.pm2_env.args = ['old-action'];
    },
    (f) => {
      f.record.cloudMaintenanceEvents.pop();
    },
    (f) => {
      f.record.phase = 'candidate_started';
    },
    (f) => {
      f.record.maintenanceEndsAtMs = 7000;
    },
    (f) => {
      f.record.failureObservation = {};
    },
    (f) => {
      f.binding.attempt = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    },
    (f) => {
      f.record.cloudMaintenanceScope[1].recoveryDigest = '0'.repeat(64);
    },
    (f) => {
      f.setTime(8000);
    },
    (f) => {
      f.input.command = '/bin/sh';
    },
    (f) => {
      f.io.uid = 998;
    },
  ]) {
    const f = cloudRestartFixture();
    fault(f);
    await assert.rejects(firstRuntime.restoreFirstCutoverCloudBrowser(f.input, f.io), /UNPROVEN/);
    assert.equal(f.calls.length, 0);
  }
});

test('cloud browser same-ID restore rechecks live scope after connection delay before sending', async () => {
  const f = cloudRestartFixture();
  const rpc = f.io.rpc;
  f.io.rpc = async (method, args, beforeSend) => {
    if (method === 'restartProcessId') f.setTime(8000);
    return rpc(method, args, beforeSend);
  };
  await assert.rejects(
    firstRuntime.restoreFirstCutoverCloudBrowser(f.input, f.io),
    /UNPROVEN|UNCERTAIN/,
  );
  assert.equal(f.calls.length, 0, 'deadline expired while connecting, do not send the write');
  assert.equal(f.record.cloudMaintenanceEvents.length, 5);
});

test('cloud browser same-ID restore keeps uncertain intent and refuses late drift without retry', async () => {
  assert.equal(typeof firstRuntime.restoreFirstCutoverCloudBrowser, 'function');
  for (const kind of ['lost-ack', 'expired', 'drift', 'scope']) {
    const f = cloudRestartFixture();
    if (kind === 'scope')
      f.io.assertRecoveryScope = async () => {
        if (f.record.cloudMaintenanceEvents.length === 5) throw Error('unproven');
      };
    if (kind === 'lost-ack') {
      const rpc = f.io.rpc;
      f.io.rpc = async (...args) => {
        const result = await rpc(...args);
        if (args[0] === 'restartProcessId') throw Error('secret raw error');
        return result;
      };
    } else {
      const record = f.io.journal.recordCloudMaintenanceEvent;
      f.io.journal.recordCloudMaintenanceEvent = async (event) => {
        await record(event);
        if (kind === 'expired') f.setTime(8000);
        if (kind === 'drift') f.manager.pm2_env.args.push('unsafe');
      };
    }
    await assert.rejects(
      firstRuntime.restoreFirstCutoverCloudBrowser(f.input, f.io),
      kind === 'lost-ack' ? /^Error: CUTOVER_CLOUD_RESTORE_UNCERTAIN$/ : /UNPROVEN/,
    );
    assert.equal(f.record.cloudMaintenanceEvents.length, 5);
    assert.equal(f.calls.length, kind === 'lost-ack' ? 1 : 0);
    await assert.rejects(firstRuntime.restoreFirstCutoverCloudBrowser(f.input, f.io), /UNPROVEN/);
    assert.equal(f.calls.length, kind === 'lost-ack' ? 1 : 0);
  }
});

function expectedVncRecoveryMaterial(attempt) {
  return {
    attempt,
    command: '/opt/holaday-vnc/start.sh',
    exec_interpreter: 'bash',
    current_conf: {
      autorestart: false,
      watch: false,
      cron_restart: '',
      max_memory_restart: 'null',
    },
  };
}

function cloudVncRestartFixture() {
  const f = cloudRestartFixture();
  f.input.pmId = 6;
  f.manager.name = 'holaday-vnc';
  f.manager.pm_id = 6;
  Object.assign(f.manager.pm2_env, {
    name: 'holaday-vnc',
    pm_id: 6,
    pm_exec_path: '/opt/holaday-vnc/start.sh',
    exec_interpreter: 'bash',
    autorestart: true,
    max_memory_restart: 524288000,
    pm_cwd: '/root',
    uid: 0,
    gid: 0,
    env: { DISPLAY: ':98', PRIVATE_VALUE: 'must-not-escape' },
    originalUnknownField: { retained: true },
  });
  const recoveryDigest = createHash('sha256')
    .update(JSON.stringify(expectedVncRecoveryMaterial(f.input.attempt)))
    .digest('hex');
  f.record.cloudMaintenanceScope[0].recoveryDigest = recoveryDigest;
  for (const event of f.record.cloudMaintenanceEvents)
    if (event.name === 'holaday-vnc') event.recoveryDigest = recoveryDigest;
  f.input.stoppedConfigDigest = cutoverRegistrationConfigDigest(f.manager.pm2_env);
  const headed = f.record.cloudMaintenanceEvents[2];
  f.record.cloudMaintenanceEvents.push(
    { ...headed, phase: 'cloud-restore-intent' },
    { ...headed, phase: 'cloud-restored' },
  );
  const guardInputs = [];
  f.io.assertRecoveryScope = async (input) => {
    guardInputs.push(structuredClone(input));
    assert.deepEqual(input, f.input);
  };
  f.io.journal.recordCloudMaintenanceEvent = async (event) => {
    assert.equal(f.record.cloudMaintenanceEvents.length, 6);
    f.record.cloudMaintenanceEvents.push(structuredClone(event));
  };
  f.io.rpc = async (method, args, beforeSend) => {
    if (method === 'getMonitorData') return structuredClone([f.manager]);
    assert.equal(method, 'restartProcessId', 'no delete/start/save or other mutation');
    await beforeSend();
    assert.equal(f.record.cloudMaintenanceEvents.length, 7, 'intent precedes dispatch');
    f.calls.push({ method, args: structuredClone(args) });
    return {};
  };
  return { ...f, guardInputs };
}

test('cloud VNC same-ID restore requests only bound PM2 safety overrides with one dispatch and no restored ACK', async () => {
  const f = cloudVncRestartFixture();
  const prior = structuredClone(f.record.cloudMaintenanceEvents);
  assert.equal(typeof firstRuntime.restoreFirstCutoverCloudVnc, 'function');
  assert.equal(await firstRuntime.restoreFirstCutoverCloudVnc(f.input, f.io), undefined);
  // This proves the requested payload only; the double does not execute PM2.
  assert.deepEqual(JSON.parse(JSON.stringify(f.calls)), f.calls);
  assert.deepEqual(f.calls, [
    {
      method: 'restartProcessId',
      args: {
        id: 6,
        env: {
          current_conf: {
            autorestart: false,
            watch: false,
            cron_restart: '',
            max_memory_restart: 'null',
          },
        },
      },
    },
  ]);
  assert.deepEqual(f.record.cloudMaintenanceEvents, [
    ...prior,
    {
      name: 'holaday-vnc',
      pmId: 6,
      scopeDigest: 'a'.repeat(64),
      recoveryDigest: f.record.cloudMaintenanceScope[0].recoveryDigest,
      attempt: '12345678-1234-4234-8234-123456789abc',
      inventoryDigest: 'd'.repeat(64),
      host: 'vultr',
      phase: 'cloud-restore-intent',
    },
  ]);
  assert.equal(f.guardInputs.length, 3, 'live site guard runs again immediately before send');
  await assert.rejects(firstRuntime.restoreFirstCutoverCloudVnc(f.input, f.io), /UNPROVEN/);
  assert.equal(f.calls.length, 1);
});

test('cloud VNC recovery material binds only the fixed source and explicit PM2 safety override', () => {
  const build = firstRuntime.firstCutoverCloudVncRecoveryMaterial;
  assert.equal(typeof build, 'function');
  const attempt = '12345678-1234-4234-8234-123456789abc';
  assert.deepEqual(build({ attempt }), expectedVncRecoveryMaterial(attempt));
  for (const input of [
    undefined,
    null,
    [],
    { attempt: 'bad' },
    { attempt, args: [] },
    { attempt, command: '/bin/sh' },
    { attempt, current_conf: { autorestart: true } },
  ])
    assert.throws(() => build(input), /UNPROVEN/);
  const material = build({ attempt });
  material.current_conf.max_memory_restart = 0;
  assert.deepEqual(build({ attempt }), expectedVncRecoveryMaterial(attempt));
});

test('cloud VNC refuses a coherently journaled material that does not approve the fixed safety override', async () => {
  const f = cloudVncRestartFixture();
  f.record.cloudMaintenanceScope[0].recoveryDigest = 'b'.repeat(64);
  for (const event of f.record.cloudMaintenanceEvents)
    if (event.name === 'holaday-vnc') event.recoveryDigest = 'b'.repeat(64);
  await assert.rejects(firstRuntime.restoreFirstCutoverCloudVnc(f.input, f.io), /UNPROVEN/);
  assert.equal(f.record.cloudMaintenanceEvents.length, 6);
  assert.equal(f.calls.length, 0);
});

for (const value of [524288000, 0, null, false, 'null', undefined]) {
  test(`cloud VNC explicitly overrides pre-bound stopped PM2 policy with memory=${JSON.stringify(value)}`, async () => {
    const f = cloudVncRestartFixture();
    Object.assign(f.manager.pm2_env, {
      autorestart: true,
      cron_restart: '* * * * *',
      max_memory_restart: value,
    });
    f.input.stoppedConfigDigest = cutoverRegistrationConfigDigest(f.manager.pm2_env);
    await firstRuntime.restoreFirstCutoverCloudVnc(f.input, f.io);
    assert.deepEqual(f.calls, [
      {
        method: 'restartProcessId',
        args: {
          id: 6,
          env: {
            current_conf: {
              autorestart: false,
              watch: false,
              cron_restart: '',
              max_memory_restart: 'null',
            },
          },
        },
      },
    ]);
    assert.equal(f.record.cloudMaintenanceEvents.length, 7);
  });
}

for (const role of ['headed', 'VNC']) {
  for (const value of [524288000, 0, null, false, 'null', undefined]) {
    test(`cloud ${role} refuses nested environment memory=${JSON.stringify(value)} before intent`, async () => {
      const f = role === 'headed' ? cloudRestartFixture() : cloudVncRestartFixture();
      f.manager.pm2_env.env = { max_memory_restart: value };
      f.input.stoppedConfigDigest = cutoverRegistrationConfigDigest(f.manager.pm2_env);
      const restore =
        role === 'headed'
          ? firstRuntime.restoreFirstCutoverCloudBrowser
          : firstRuntime.restoreFirstCutoverCloudVnc;
      await assert.rejects(restore(f.input, f.io), /UNPROVEN/);
      assert.equal(f.record.cloudMaintenanceEvents.length, role === 'headed' ? 4 : 6);
      assert.equal(f.calls.length, 0);
    });
  }
}

test('cloud VNC refuses an array carrying the four approved input fields', async () => {
  const f = cloudVncRestartFixture();
  f.input = Object.assign([], f.input);
  f.io.assertRecoveryScope = async () => {};
  await assert.rejects(firstRuntime.restoreFirstCutoverCloudVnc(f.input, f.io), /UNPROVEN/);
  assert.equal(f.calls.length, 0);
  assert.equal(f.record.cloudMaintenanceEvents.length, 6);
});

for (const role of ['headed', 'VNC']) {
  for (const [field, value] of [
    ['autorestart', true],
    ['watch', true],
    ['cron_restart', '* * * * *'],
    ['pm_exec_path', '/opt/holaday-headed/start.sh'],
    ['args', ['https://example.invalid/old-action']],
    ['exec_interpreter', role === 'headed' ? 'bash' : 'node'],
    ['exec_mode', 'cluster_mode'],
  ]) {
    test(`cloud ${role} refuses conflicting nested ${field} before intent or restart`, async () => {
      const f = role === 'headed' ? cloudRestartFixture() : cloudVncRestartFixture();
      f.manager.pm2_env.env = { PRIVATE_VALUE: 'retained', [field]: value };
      f.input.stoppedConfigDigest = cutoverRegistrationConfigDigest(f.manager.pm2_env);
      const restore =
        role === 'headed'
          ? firstRuntime.restoreFirstCutoverCloudBrowser
          : firstRuntime.restoreFirstCutoverCloudVnc;
      await assert.rejects(restore(f.input, f.io), /UNPROVEN/);
      assert.equal(f.record.cloudMaintenanceEvents.length, role === 'headed' ? 4 : 6);
      assert.equal(f.calls.length, 0);
    });
  }
  test(`cloud ${role} permits matching nested safety fields and unrelated environment values`, async () => {
    const f = role === 'headed' ? cloudRestartFixture() : cloudVncRestartFixture();
    const launch = firstRuntime.firstCutoverCloudBrowserRecoveryLaunch({
      attempt: f.input.attempt,
    });
    if (role === 'VNC') f.manager.pm2_env.args = ['--approved', 'literal value'];
    f.manager.pm2_env.env = {
      PRIVATE_VALUE: 'retained',
      autorestart: false,
      watch: false,
      cron_restart: '',
      ...(role === 'headed'
        ? {
            pm_exec_path: launch.command,
            args: structuredClone(launch.args),
            exec_interpreter: 'none',
            exec_mode: 'fork_mode',
            DISPLAY: ':77',
          }
        : {
            pm_exec_path: '/opt/holaday-vnc/start.sh',
            args: ['--approved', 'literal value'],
            exec_interpreter: 'bash',
            exec_mode: 'fork_mode',
          }),
    };
    f.input.stoppedConfigDigest = cutoverRegistrationConfigDigest(f.manager.pm2_env);
    const restore =
      role === 'headed'
        ? firstRuntime.restoreFirstCutoverCloudBrowser
        : firstRuntime.restoreFirstCutoverCloudVnc;
    await restore(f.input, f.io);
    assert.equal(f.calls.length, 1);
    assert.equal(f.record.cloudMaintenanceEvents.length, role === 'headed' ? 5 : 7);
    assert.equal(Object.hasOwn(f.calls[0].args.env, 'PRIVATE_VALUE'), false);
    if (role === 'headed') assert.equal(f.calls[0].args.env.DISPLAY, ':98');
  });
}

test('cloud VNC refuses an absent existing daemon socket without invoking a CLI or recording recovery', async () => {
  const f = cloudVncRestartFixture();
  f.io.rpc = undefined;
  f.io.lstat = async (path) => {
    assert.equal(path, '/root/.pm2/rpc.sock');
    throw Error('ENOENT');
  };
  f.io.exec = async () => assert.fail('no daemon autostart or CLI fallback');
  await assert.rejects(firstRuntime.restoreFirstCutoverCloudVnc(f.input, f.io), /UNPROVEN/);
  assert.equal(f.calls.length, 0);
  assert.equal(f.record.cloudMaintenanceEvents.length, 6);
});

for (const [name, fault] of [
  [
    'missing guard',
    (f) => {
      f.io.assertRecoveryScope = undefined;
    },
  ],
  [
    'false guard',
    (f) => {
      f.io.assertRecoveryScope = async () => false;
    },
  ],
  [
    'true guard',
    (f) => {
      f.io.assertRecoveryScope = async () => true;
    },
  ],
  [
    'site source/tools/display/fences not proven',
    (f) => {
      f.io.assertRecoveryScope = async () => {
        throw Error('private source mismatch');
      };
    },
  ],
  [
    'wrong input ID',
    (f) => {
      f.input.pmId = 7;
    },
  ],
  [
    'string input ID',
    (f) => {
      f.input.pmId = '6';
    },
  ],
  [
    'unsafe input ID',
    (f) => {
      f.input.pmId = Number.MAX_SAFE_INTEGER + 1;
    },
  ],
  [
    'unknown input field',
    (f) => {
      f.input.command = '/bin/sh';
    },
  ],
  [
    'invalid attempt',
    (f) => {
      f.input.attempt = 'not-an-attempt';
    },
  ],
  [
    'invalid stopped digest',
    (f) => {
      f.input.stoppedConfigDigest = 'bad';
    },
  ],
  [
    'non-root caller',
    (f) => {
      f.io.uid = 998;
    },
  ],
  [
    'non-Linux caller',
    (f) => {
      f.io.platform = 'darwin';
    },
  ],
  [
    'wrong phase',
    (f) => {
      f.record.phase = 'candidate_started';
    },
  ],
  [
    'failed attempt',
    (f) => {
      f.record.failureObservation = {};
    },
  ],
  [
    'wrong owner attempt',
    (f) => {
      f.binding.attempt = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    },
  ],
  [
    'wrong record binding',
    (f) => {
      f.record.inventoryDigest = 'f'.repeat(64);
    },
  ],
  [
    'missing site binding',
    (f) => {
      f.record.executionSiteDigest = undefined;
    },
  ],
  [
    'wrong approved window',
    (f) => {
      f.record.maintenanceEndsAtMs = 7000;
    },
  ],
  [
    'expired window',
    (f) => {
      f.setTime(8000);
    },
  ],
  [
    'excessive window',
    (f) => {
      f.input.maintenanceEndsAtMs = 901001;
    },
  ],
  [
    'wrong scope name',
    (f) => {
      f.record.cloudMaintenanceScope[0].name = 'other-vnc';
    },
  ],
  [
    'wrong scope ID',
    (f) => {
      f.record.cloudMaintenanceScope[0].pmId = 8;
    },
  ],
  [
    'duplicate scope ID',
    (f) => {
      f.record.cloudMaintenanceScope[1].pmId = 6;
    },
  ],
  [
    'wrong headed scope name',
    (f) => {
      f.record.cloudMaintenanceScope[1].name = 'other';
    },
  ],
  [
    'wrong headed recovery material',
    (f) => {
      f.record.cloudMaintenanceScope[1].recoveryDigest = 'f'.repeat(64);
    },
  ],
  [
    'missing VNC recovery material',
    (f) => {
      f.record.cloudMaintenanceScope[0].recoveryDigest = undefined;
    },
  ],
  [
    'unknown scope field',
    (f) => {
      f.record.cloudMaintenanceScope[0].command = '/bin/sh';
    },
  ],
  [
    'missing headed restored observation',
    (f) => {
      f.record.cloudMaintenanceEvents.pop();
    },
  ],
  [
    'intent substituted for headed observation',
    (f) => {
      f.record.cloudMaintenanceEvents[5].phase = 'cloud-restore-intent';
    },
  ],
  [
    'prior event wrong service',
    (f) => {
      f.record.cloudMaintenanceEvents[5].name = 'holaday-vnc';
    },
  ],
  [
    'prior event wrong ID',
    (f) => {
      f.record.cloudMaintenanceEvents[0].pmId = 8;
    },
  ],
  [
    'prior event wrong source digest',
    (f) => {
      f.record.cloudMaintenanceEvents[5].recoveryDigest = 'f'.repeat(64);
    },
  ],
  [
    'prior event wrong attempt',
    (f) => {
      f.record.cloudMaintenanceEvents[5].attempt = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    },
  ],
  [
    'prior event wrong host',
    (f) => {
      f.record.cloudMaintenanceEvents[5].host = 'aliyun';
    },
  ],
  [
    'unknown prior event field',
    (f) => {
      f.record.cloudMaintenanceEvents[5].command = '/bin/sh';
    },
  ],
  [
    'swapped prior events',
    (f) => {
      f.record.cloudMaintenanceEvents.reverse();
    },
  ],
  [
    'wrong manager name',
    (f) => {
      f.manager.name = 'holaday-chromium-headed';
    },
  ],
  [
    'wrong manager ID',
    (f) => {
      f.manager.pm_id = 8;
    },
  ],
  [
    'wrong nested manager ID',
    (f) => {
      f.manager.pm2_env.pm_id = 8;
    },
  ],
  [
    'wrong nested manager name',
    (f) => {
      f.manager.pm2_env.name = 'other';
    },
  ],
  [
    'live VNC process',
    (f) => {
      f.manager.pid = 40;
    },
  ],
  [
    'non-stopped VNC registration',
    (f) => {
      f.manager.pm2_env.status = 'online';
    },
  ],
  [
    'command drift',
    (f) => {
      f.manager.pm2_env.pm_exec_path = '/opt/holaday-headed/start.sh';
    },
  ],
  [
    'arguments drift',
    (f) => {
      f.manager.pm2_env.args.push('unsafe');
    },
  ],
  [
    'environment drift',
    (f) => {
      f.manager.pm2_env.env.PRIVATE_VALUE = 'changed';
    },
  ],
  [
    'unknown configuration drift',
    (f) => {
      f.manager.pm2_env.originalUnknownField.retained = false;
    },
  ],
  [
    'historical restart-count drift',
    (f) => {
      f.manager.pm2_env.restart_time = 13;
    },
  ],
]) {
  test(`cloud VNC refuses ${name} before any restore intent or dispatch`, async () => {
    const f = cloudVncRestartFixture();
    fault(f);
    const events = structuredClone(f.record.cloudMaintenanceEvents);
    assert.equal(typeof firstRuntime.restoreFirstCutoverCloudVnc, 'function');
    await assert.rejects(firstRuntime.restoreFirstCutoverCloudVnc(f.input, f.io), /UNPROVEN/);
    assert.deepEqual(f.record.cloudMaintenanceEvents, events);
    assert.equal(f.calls.length, 0);
  });
}

for (const [field, value] of [
  ['pm_exec_path', '/opt/holaday-headed/start.sh'],
  ['pm_exec_path', '/bin/sh'],
  ['exec_interpreter', 'node'],
  ['watch', true],
  ['watch', []],
  ['watch', undefined],
  ['exec_mode', 'cluster_mode'],
  ['exec_mode', undefined],
  ['restart_time', -1],
  ['restart_time', undefined],
]) {
  test(`cloud VNC refuses reviewed unsafe or missing manager policy ${field}=${value} without rewriting it`, async () => {
    const f = cloudVncRestartFixture();
    f.manager.pm2_env[field] = value;
    f.input.stoppedConfigDigest = cutoverRegistrationConfigDigest(f.manager.pm2_env);
    const original = structuredClone(f.manager.pm2_env);
    assert.equal(typeof firstRuntime.restoreFirstCutoverCloudVnc, 'function');
    await assert.rejects(firstRuntime.restoreFirstCutoverCloudVnc(f.input, f.io), /UNPROVEN/);
    assert.deepEqual(f.manager.pm2_env, original);
    assert.equal(f.calls.length, 0);
    assert.equal(f.record.cloudMaintenanceEvents.length, 6);
  });
}

test('cloud VNC refuses duplicate numeric-ID or fixed-name manager rows', async () => {
  for (const duplicate of [
    { pm_id: 6, name: 'other' },
    { pm_id: 8, name: 'holaday-vnc' },
  ]) {
    const f = cloudVncRestartFixture();
    const rpc = f.io.rpc;
    f.io.rpc = async (method, ...args) =>
      method === 'getMonitorData' ? structuredClone([f.manager, duplicate]) : rpc(method, ...args);
    assert.equal(typeof firstRuntime.restoreFirstCutoverCloudVnc, 'function');
    await assert.rejects(firstRuntime.restoreFirstCutoverCloudVnc(f.input, f.io), /UNPROVEN/);
    assert.equal(f.calls.length, 0);
    assert.equal(f.record.cloudMaintenanceEvents.length, 6);
  }
});

for (const [name, fault] of [
  ['deadline', (f) => f.setTime(8000)],
  ['clock rollback', (f) => f.setTime(999)],
  [
    'owner',
    (f) => {
      f.binding.candidate = 'f'.repeat(40);
    },
  ],
  [
    'config',
    (f) => {
      f.manager.pm2_env.env.PRIVATE_VALUE = 'drift';
    },
  ],
  [
    'prior observation',
    (f) => {
      f.record.cloudMaintenanceEvents[5].phase = 'cloud-restore-intent';
    },
  ],
  [
    'site scope',
    (f) => {
      f.record.executionSiteDigest = 'f'.repeat(64);
    },
  ],
  [
    'coherent VNC scope change',
    (f) => {
      f.record.cloudMaintenanceScope[0].recoveryDigest = 'f'.repeat(64);
      for (const event of f.record.cloudMaintenanceEvents)
        if (event.name === 'holaday-vnc') event.recoveryDigest = 'f'.repeat(64);
    },
  ],
]) {
  for (const boundary of ['intent', 'connection']) {
    test(`cloud VNC rechecks ${name} after ${boundary}, retains seventh intent and never sends or retries`, async () => {
      const f = cloudVncRestartFixture();
      if (boundary === 'intent') {
        const append = f.io.journal.recordCloudMaintenanceEvent;
        f.io.journal.recordCloudMaintenanceEvent = async (event) => {
          await append(event);
          fault(f);
        };
      } else {
        const rpc = f.io.rpc;
        f.io.rpc = async (method, ...args) => {
          if (method === 'restartProcessId') fault(f);
          return rpc(method, ...args);
        };
      }
      assert.equal(typeof firstRuntime.restoreFirstCutoverCloudVnc, 'function');
      await assert.rejects(
        firstRuntime.restoreFirstCutoverCloudVnc(f.input, f.io),
        /UNPROVEN|UNCERTAIN/,
      );
      assert.equal(f.calls.length, 0);
      assert.equal(f.record.cloudMaintenanceEvents.length, 7);
      await assert.rejects(firstRuntime.restoreFirstCutoverCloudVnc(f.input, f.io), /UNPROVEN/);
      assert.equal(f.calls.length, 0);
    });
  }
}

test('cloud VNC requires the same live site guard before intent, after intent and immediately before dispatch', async () => {
  for (const refusedCall of [1, 2, 3]) {
    const f = cloudVncRestartFixture();
    let calls = 0;
    f.io.assertRecoveryScope = async () => {
      if (++calls === refusedCall) throw Error('source/tools/display/fences changed');
    };
    assert.equal(typeof firstRuntime.restoreFirstCutoverCloudVnc, 'function');
    await assert.rejects(
      firstRuntime.restoreFirstCutoverCloudVnc(f.input, f.io),
      /UNPROVEN|UNCERTAIN/,
    );
    assert.equal(f.calls.length, 0);
    assert.equal(f.record.cloudMaintenanceEvents.length, refusedCall === 1 ? 6 : 7);
  }
});

for (const change of ['deadline', 'ownership']) {
  test(`cloud VNC refuses ${change} lost while awaiting the final journal read before dispatch`, async () => {
    const f = cloudVncRestartFixture();
    let reads = 0;
    const read = f.io.journal.readFirstCutoverEffects;
    f.io.journal.readFirstCutoverEffects = async () => {
      const record = await read();
      if (++reads === 6) {
        if (change === 'deadline') f.setTime(8000);
        else f.binding.candidate = 'f'.repeat(40);
      }
      return record;
    };
    await assert.rejects(
      firstRuntime.restoreFirstCutoverCloudVnc(f.input, f.io),
      /UNPROVEN|UNCERTAIN/,
    );
    assert.equal(f.calls.length, 0);
    assert.equal(f.record.cloudMaintenanceEvents.length, 7);
  });
}

test('cloud VNC preserves the seventh intent on uncertain RPC failure without leaking or retrying', async () => {
  for (const failure of ['lost-ack', 'post-dispatch-window', 'post-dispatch-binding']) {
    const f = cloudVncRestartFixture();
    const rpc = f.io.rpc;
    f.io.rpc = async (method, ...args) => {
      const result = await rpc(method, ...args);
      if (method === 'restartProcessId') {
        if (failure === 'lost-ack') throw Error('secret raw environment');
        if (failure === 'post-dispatch-window') f.setTime(8000);
        if (failure === 'post-dispatch-binding') f.binding.configDigest = 'f'.repeat(64);
      }
      return result;
    };
    assert.equal(typeof firstRuntime.restoreFirstCutoverCloudVnc, 'function');
    await assert.rejects(
      firstRuntime.restoreFirstCutoverCloudVnc(f.input, f.io),
      /^Error: CUTOVER_CLOUD_RESTORE_UNCERTAIN$/,
    );
    assert.equal(f.calls.length, 1);
    assert.equal(f.record.cloudMaintenanceEvents.length, 7);
    await assert.rejects(firstRuntime.restoreFirstCutoverCloudVnc(f.input, f.io), /UNPROVEN/);
    assert.equal(f.calls.length, 1);
  }
});

const digest = 'a'.repeat(64);
function cloudRecoveryObservationFixture() {
  const input = { attempt: '12345678-1234-4234-8234-123456789abc', pmId: 7 };
  const launch = firstRuntime.firstCutoverCloudBrowserRecoveryLaunch({ attempt: input.attempt });
  const policy = '/etc/brave/policies/managed';
  const source = `/var/lib/holaday-deploy/maintenance/${input.attempt}/cloud-browser-policy`;
  const privatePolicy = `/proc/40/root${policy}`;
  const files = new Map([
    ['/proc/sys/kernel/random/boot_id', '12345678-1234-4234-8234-123456789def\n'],
    ['/proc/40/stat', `40 (brave) S 20 ${Array(17).fill('0').join(' ')} 1234 0`],
    [
      '/proc/40/cmdline',
      `${launch.args.slice(launch.args.indexOf('/opt/brave.com/brave/brave')).join('\0')}\0`,
    ],
    ['/proc/40/environ', 'DISPLAY=:98\0PRIVATE_VALUE=never-exported\0'],
    [
      '/proc/40/status',
      'Uid:\t0\t0\t0\t0\nCapInh:\t00000000\nCapPrm:\t00000000\nCapEff:\t00000000\nCapBnd:\t00000000\nCapAmb:\t00000000\nNoNewPrivs:\t1\n',
    ],
    ['/proc/40/mountinfo', `23 21 0:1 /private ${policy} ro,relatime - ext4 /dev/qa rw\n`],
  ]);
  for (const path of [policy, source, privatePolicy]) {
    files.set(`${path}/existing.json`, '{"HomepageLocation":"about:blank"}');
    if (path !== policy) files.set(`${path}/recovery.json`, '{"RestoreOnStartup":5}');
  }
  const links = new Map([
    ['/proc/40/exe', '/opt/brave.com/brave/brave'],
    ['/proc/40/ns/mnt', 'mnt:[2]'],
    ['/proc/self/ns/mnt', 'mnt:[1]'],
  ]);
  const manager = {
    name: 'holaday-chromium-headed',
    pm_id: 7,
    pid: 40,
    pm2_env: {
      name: 'holaday-chromium-headed',
      status: 'online',
      pm_exec_path: launch.command,
      args: launch.args,
      exec_interpreter: 'none',
      autorestart: false,
      watch: false,
      restart_time: 0,
      exec_mode: 'fork_mode',
      cron_restart: '',
      DISPLAY: ':98',
    },
  };
  const stat = (path) => ({
    uid: 0,
    mode: files.has(path) ? 0o100644 : 0o40755,
    dev: 1,
    ino: path.includes('recovery.json') ? 4 : path.endsWith('.json') ? 3 : 2,
    size: Buffer.byteLength(files.get(path) ?? ''),
    mtimeMs: 1,
    ctimeMs: 1,
    nlink: 1,
  });
  const io = {
    platform: 'linux',
    uid: 0,
    now: () => 1000,
    readManagers: async () => structuredClone([manager]),
    exec: async () => {
      throw new Error('read-only observation must never launch the PM2 CLI');
    },
    readFile: async (path) => {
      assert.ok(files.has(path), path);
      return files.get(path);
    },
    readlink: async (path) => {
      assert.ok(links.has(path), path);
      return links.get(path);
    },
    readdir: async (path) =>
      path === policy ? ['existing.json'] : ['existing.json', 'recovery.json'],
    lstat: async (path) => stat(path),
  };
  return { input, io, manager, files, links, source, privatePolicy, policy };
}
function cloudNativeRecoveryFixture() {
  const f = cloudRecoveryObservationFixture();
  const caps = { CapInh: '0', CapPrm: '0', CapEff: '0', CapBnd: '0', CapAmb: '0' };
  const process = (pid, ppid, exe, namespace = 'mnt:[1]') => ({
    pid,
    ppid,
    start: String(pid * 10),
    uids: [0, 0, 0, 0],
    exe,
    cwd: '/',
    argvDigest: 'a'.repeat(64),
    cgroup: '0::/shared\n',
    mountNamespace: namespace,
    state: 'live',
    noNewPrivs: 1,
    capabilities: { ...caps },
  });
  const before = {
    hostname: 'native-qa',
    bootId: '12345678-1234-4234-8234-123456789def',
    observedAtMs: 900,
    processes: [
      process(1, 0, '/sbin/init'),
      process(20, 1, '/opt/node22/bin/node'),
      process(60, 1, '/bin/sleep'),
    ],
  };
  const root = process(40, 20, '/opt/brave.com/brave/brave', 'mnt:[2]');
  root.start = '1234';
  root.argvDigest = createHash('sha256')
    .update(JSON.stringify(f.files.get('/proc/40/cmdline')))
    .digest('hex');
  const current = {
    ...structuredClone(before),
    observedAtMs: 1000,
    processes: [
      ...structuredClone(before.processes),
      root,
      process(41, 40, '/opt/brave.com/brave/brave', 'mnt:[2]'),
      process(42, 1, '/opt/brave.com/brave/chrome_crashpad_handler', 'mnt:[2]'),
      {
        ...process(43, 40, '/usr/bin/Xvfb', 'mnt:[2]'),
        argvDigest: createHash('sha256')
          .update(
            JSON.stringify(
              `${['/usr/bin/Xvfb', ':98', '-screen', '0', '1280x800x24', '-nolisten', 'tcp'].join('\0')}\0`,
            ),
          )
          .digest('hex'),
      },
    ].sort((a, b) => a.pid - b.pid),
  };
  const input = {
    ...f.input,
    name: 'holaday-chromium-headed',
    beforeCensus: before,
    restoreStartedAtMs: 950,
  };
  return {
    ...f,
    input,
    before,
    current,
    io: {
      ...f.io,
      readCensus: async () => structuredClone(current),
      readDisplayListeners: async () => [
        { path: '/tmp/.X11-unix/X98', inode: '501' },
        { path: '@/tmp/.X11-unix/X98', inode: '502' },
      ],
    },
  };
}

test('native recovery proof accounts for rooted and detached private-namespace members against the pre-effect census', async () => {
  assert.equal(typeof firstRuntime.readFirstCutoverCloudRecovery, 'function');
  const f = cloudNativeRecoveryFixture();
  const original = structuredClone(f.input);
  const proof = await firstRuntime.readFirstCutoverCloudRecovery(f.input, f.io);
  assert.equal(proof.purpose, 'cloud-recovery-native-observation');
  assert.deepEqual(
    proof.processes.map((p) => p.pid),
    [40, 41, 42, 43],
  );
  assert.equal(
    proof.beforeCensusDigest,
    createHash('sha256').update(JSON.stringify(f.before)).digest('hex'),
  );
  assert.equal(
    proof.censusDigest,
    createHash('sha256').update(JSON.stringify(f.current)).digest('hex'),
  );
  assert.equal(proof.configDigest, cutoverRegistrationConfigDigest(f.manager.pm2_env));
  assert.equal(proof.mountNamespace, 'mnt:[2]');
  assert.deepEqual(f.input, original);
  assert.equal(JSON.stringify(proof).includes('never-exported'), false);
  assert.deepEqual(
    Object.keys(proof).sort(),
    [
      'beforeCensusDigest',
      'bootId',
      'censusDigest',
      'configDigest',
      'display',
      'hostname',
      'launchDigest',
      'mountNamespace',
      'name',
      'observedAtMs',
      'pid',
      'pmId',
      'policyDigest',
      'ppid',
      'processes',
      'purpose',
      'restartCount',
      'start',
    ].sort(),
  );
});

for (const mode of [
  'missing',
  'extra',
  'foreign-parent',
  'argv',
  'namespace',
  'missing-listener',
  'duplicate-listener',
  'listener-drift',
]) {
  test(`native recovery exclusive display refuses ${mode}`, async () => {
    const f = cloudNativeRecoveryFixture();
    const display = f.current.processes.find((p) => p.pid === 43);
    if (mode === 'missing') f.current.processes = f.current.processes.filter((p) => p.pid !== 43);
    if (mode === 'extra') f.current.processes.push({ ...display, pid: 44 });
    if (mode === 'foreign-parent') display.ppid = 1;
    if (mode === 'argv') display.argvDigest = 'b'.repeat(64);
    if (mode === 'namespace') display.mountNamespace = 'mnt:[1]';
    const read = f.io.readDisplayListeners;
    let calls = 0;
    f.io.readDisplayListeners = async () => {
      const rows = await read();
      if (mode === 'missing-listener') rows.pop();
      if (mode === 'duplicate-listener') rows[1] = { ...rows[0] };
      if (mode === 'listener-drift' && ++calls === 2) rows[0].inode = '503';
      return rows;
    };
    await assert.rejects(
      firstRuntime.readFirstCutoverCloudRecovery(f.input, f.io),
      /CUTOVER_CLOUD_RECOVERY_UNPROVEN/,
    );
  });
}

test('exclusive display launch uses isolated fixed bootstrap before same-PID Brave exec', () => {
  const launch = firstRuntime.firstCutoverCloudBrowserRecoveryLaunch({
    attempt: '12345678-1234-4234-8234-123456789abc',
  });
  assert.deepEqual(launch.args.slice(8, 12), ['/usr/bin/python3', '-I', '-S', '-c']);
  assert.equal(typeof launch.args[12], 'string');
  assert.equal(launch.args[13], '/opt/brave.com/brave/brave');
});

for (const mode of [
  'outside-birth',
  'outside-exit',
  'outside-reparent',
  'outside-exec',
  'pid-reuse',
  'preexisting-namespace',
  'escaped-child',
  'unknown-member',
  'deleted-exe',
  'capability',
  'no-new-privileges',
  'uid',
  'root-start',
  'root-parent',
  'boot',
  'hostname',
  'future-before',
  'stale-before',
  'stale-current',
  'census-race',
  'root-race',
  'extra-input',
  'duplicate-pid',
  'missing-census',
]) {
  test(`native recovery proof refuses ${mode}`, async () => {
    assert.equal(typeof firstRuntime.readFirstCutoverCloudRecovery, 'function');
    const f = cloudNativeRecoveryFixture();
    const root = f.current.processes.find((p) => p.pid === 40);
    const child = f.current.processes.find((p) => p.pid === 41);
    const outside = f.current.processes.find((p) => p.pid === 60);
    if (mode === 'outside-birth') f.current.processes.push({ ...outside, pid: 61 });
    if (mode === 'outside-exit')
      f.current.processes = f.current.processes.filter((p) => p.pid !== 60);
    if (mode === 'outside-reparent') outside.ppid = 20;
    if (mode === 'outside-exec') outside.argvDigest = 'b'.repeat(64);
    if (mode === 'pid-reuse') f.before.processes.push({ ...root, start: 'old' });
    if (mode === 'preexisting-namespace') f.before.processes[0].mountNamespace = 'mnt:[2]';
    if (mode === 'escaped-child') child.mountNamespace = 'mnt:[3]';
    if (mode === 'unknown-member') child.exe = '/bin/sh';
    if (mode === 'deleted-exe') child.exe += ' (deleted)';
    if (mode === 'capability') child.capabilities.CapEff = '1';
    if (mode === 'no-new-privileges') child.noNewPrivs = 0;
    if (mode === 'uid') child.uids = [998, 998, 998, 998];
    if (mode === 'root-start') root.start = '1235';
    if (mode === 'root-parent') root.ppid = 1;
    if (mode === 'boot') f.current.bootId = '22222222-2222-4222-8222-222222222222';
    if (mode === 'hostname') f.current.hostname = 'other';
    if (mode === 'future-before') f.before.observedAtMs = 951;
    if (mode === 'stale-before') {
      f.io.now = () => 62000;
      f.current.observedAtMs = 62000;
    }
    if (mode === 'stale-current') f.current.observedAtMs = 800;
    if (mode === 'extra-input') f.input.approved = true;
    if (mode === 'duplicate-pid') f.current.processes.push({ ...root });
    if (mode === 'missing-census') Reflect.deleteProperty(f.input, 'beforeCensus');
    let reads = 0;
    f.io.readCensus = async () => {
      if (++reads === 2) {
        if (mode === 'census-race') outside.start = 'changed';
        if (mode === 'root-race') f.manager.pm2_env.PRIVATE_CHANGED = 'secret';
      }
      return structuredClone(f.current);
    };
    await assert.rejects(
      firstRuntime.readFirstCutoverCloudRecovery(f.input, f.io),
      /^Error: CUTOVER_CLOUD_RECOVERY_UNPROVEN$/,
    );
  });
}

async function vncNativeObservationFixture(handlerCount = 1) {
  // Synthetic kernel/filesystem IO, real source/manager/policy validators.
  // These facts do not represent production hooks, capability or authorization.
  const h = cloudNativeRecoveryFixture();
  const s = await sourceNativeFixture();
  const bootId = h.current.bootId;
  const sha = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
  Object.assign(h.manager.pm2_env, {
    pm_id: 7,
    autostart: true,
    pm_cwd: '/root',
    env: { PATH: '/usr/bin', HOME: '/root', DISPLAY: ':98' },
  });
  const vnc = {
    name: 'holaday-vnc',
    pm_id: 6,
    pid: 70,
    pm2_env: {
      ...structuredClone(s.input.configs[0].config),
      autorestart: false,
      watch: false,
      cron_restart: '',
    },
  };
  const managers = [vnc, h.manager];
  h.io.readManagers = async () => structuredClone(managers);
  const headedRecovery = await firstRuntime.readFirstCutoverCloudRecovery(h.input, h.io);
  const before = { ...structuredClone(h.current), observedAtMs: 1100 };
  const paths = new Map();
  const fds = new Map();
  const args = {
    bash: ['bash', '/opt/holaday-vnc/start.sh'],
    x11: [
      'x11vnc',
      '-display',
      ':98',
      '-forever',
      '-nopw',
      '-shared',
      '-noxdamage',
      '-listen',
      '127.0.0.1',
      '-rfbport',
      '5901',
    ],
    web: [
      '/usr/bin/python3',
      '/usr/bin/websockify',
      '--heartbeat',
      '30',
      '--web',
      '/usr/share/novnc',
      '127.0.0.1:6080',
      '127.0.0.1:5901',
    ],
  };
  const proc = (pid, ppid, exe, argv) => {
    const cmd = `${argv.join('\0')}\0`;
    s.add(`/proc/${pid}/cmdline`, cmd);
    paths.set(`/proc/${pid}/exe`, exe);
    fds.set(pid, new Map());
    return {
      ...structuredClone(before.processes.find((p) => p.pid === 60)),
      pid,
      ppid,
      start: String(pid * 10),
      exe,
      cwd: exe === '/usr/bin/python3.10' ? '/usr/share/novnc' : '/root',
      argvDigest: sha(cmd),
      // Actual VNC need not inherit headed hardening or private namespace.
      noNewPrivs: 0,
      capabilities: { CapInh: '0', CapPrm: '1', CapEff: '1', CapBnd: '1', CapAmb: '0' },
    };
  };
  const group = [
    proc(70, 20, '/usr/bin/bash', args.bash),
    proc(71, 70, '/usr/bin/bash', args.bash),
    proc(72, 71, '/usr/bin/x11vnc', args.x11),
    proc(73, 70, '/usr/bin/python3.10', args.web),
  ];
  for (let i = 0; i < handlerCount; i++)
    group.push(proc(74 + i, 73, '/usr/bin/python3.10', args.web));
  const current = {
    ...structuredClone(before),
    observedAtMs: 1200,
    processes: [...structuredClone(before.processes), ...group].sort((a, b) => a.pid - b.pid),
  };
  s.add('/root/.pm2/pm2.pid', '20\n');
  for (const part of ['stat', 'cmdline', 'status', 'environ'])
    s.add(`/proc/20/${part}`, s.data.get(`/proc/40/${part}`));
  s.add('/proc/20/stat', `20 (PM2 daemon) S 1 ${Array(17).fill('0').join(' ')} 200\n`);
  s.add('/proc/sys/kernel/random/boot_id', `${bootId}\n`);
  fds.set(
    43,
    new Map([
      ['4', '501'],
      ['5', '502'],
      ['6', '700'],
    ]),
  );
  fds.get(72).set('6', '701');
  fds.get(72).set('7', '801');
  fds.get(73).set('7', '800');
  for (let i = 0; i < handlerCount; i++) fds.get(74 + i).set('7', '800');
  const owner = (pid, fd) => `("qa",pid=${pid},fd=${fd})`;
  const sockets = {
    unix: [
      `u_str LISTEN 0 128 /tmp/.X11-unix/X98 501 * 0 users:(${owner(43, 4)})`,
      `u_str LISTEN 0 128 @/tmp/.X11-unix/X98 502 * 0 users:(${owner(43, 5)})`,
      `u_str ESTAB 0 0 /tmp/.X11-unix/X98 700 * 701 users:(${owner(43, 6)})`,
      `u_str ESTAB 0 0 * 701 * 700 users:(${owner(72, 6)})`,
    ],
    ipv4: [
      `LISTEN 0 32 127.0.0.1:5901 0.0.0.0:* users:(${owner(72, 7)}) ino:801`,
      `LISTEN 0 32 127.0.0.1:6080 0.0.0.0:* users:(${[owner(73, 7), ...Array.from({ length: handlerCount }, (_, i) => owner(74 + i, 7))].join(',')}) ino:800`,
    ],
    ipv6: [],
  };
  let now = 1200;
  const io = {
    ...s.io,
    now: () => now,
    hostname: () => current.hostname,
    readManagers: h.io.readManagers,
    readCensus: async () => structuredClone(current),
    readDisplayListeners: h.io.readDisplayListeners,
    readFile: async (path) =>
      h.files.has(path) ? h.files.get(path) : s.data.get(path)?.toString('utf8'),
    readlink: async (path) => {
      const fd = /^\/proc\/(\d+)\/fd\/(\d+)$/.exec(path);
      if (fd) {
        assert.ok(fds.get(Number(fd[1]))?.has(fd[2]), path);
        return `socket:[${fds.get(Number(fd[1])).get(fd[2])}]`;
      }
      const value = paths.get(path) ?? h.links.get(path) ?? s.links.get(path);
      assert.ok(value, path);
      return value;
    },
    lstat: async (path) =>
      path.startsWith('/etc/brave') ||
      path.startsWith('/var/lib/holaday-deploy') ||
      path.startsWith('/proc/40/root')
        ? h.io.lstat(path)
        : s.io.lstat(path),
    stat: async (path) => s.io.lstat(paths.get(path) ?? path),
    readdir: async (path) => {
      const fd = /^\/proc\/(\d+)\/fd$/.exec(path);
      if (fd) {
        assert.ok(fds.has(Number(fd[1])), path);
        return [...fds.get(Number(fd[1])).keys()];
      }
      if (path === h.policy || path === h.source || path === h.privatePolicy)
        return h.io.readdir(path);
      return s.io.readdir(path);
    },
    exec: async (command, argv) => {
      assert.equal(command, '/usr/bin/ss');
      if (JSON.stringify(argv) === JSON.stringify(['-H', '-xapn'])) return sockets.unix.join('\n');
      if (JSON.stringify(argv) === JSON.stringify(['-H', '-4', '-ltnpe']))
        return sockets.ipv4.join('\n');
      assert.deepEqual(argv, ['-H', '-6', '-ltnpe']);
      return sockets.ipv6.join('\n');
    },
  };
  const sources = await firstRuntime.readFirstCutoverCloudRecoverySources(
    {
      attempt: h.input.attempt,
      configs: managers.map((r) => ({ name: r.name, pmId: r.pm_id, config: r.pm2_env })),
    },
    io,
  );
  return {
    input: {
      attempt: h.input.attempt,
      name: 'holaday-vnc',
      pmId: 6,
      beforeCensus: before,
      restoreStartedAtMs: 1150,
      headedRecovery,
      sources,
    },
    io,
    current,
    before,
    managers,
    sockets,
    fds,
    paths,
    data: s.data,
    setNow: (value) => {
      now = value;
    },
  };
}

for (const count of [0, 1, 2]) {
  test(`native VNC observation accounts for ${count} actual handlers without headed policy inheritance`, async () => {
    const f = await vncNativeObservationFixture(count);
    const result = await firstRuntime.readFirstCutoverCloudRecovery(f.input, f.io);
    assert.equal(result.pmId, 6);
    assert.equal(result.pid, 70);
    assert.equal(result.mountNamespace, 'mnt:[1]');
    assert.equal(Object.hasOwn(result, 'policyDigest'), false);
    assert.equal(result.processes.length, 4 + count);
    assert.deepEqual(
      result.vnc.handlers.map((p) => p.pid),
      Array.from({ length: count }, (_, i) => 74 + i),
    );
    assert.deepEqual(result.vnc.displayPeers, [
      {
        client: { pid: 72, start: '720', fd: 6, inode: '701' },
        server: { pid: 43, start: '430', fd: 6, inode: '700' },
      },
    ]);
    assert.equal(result.vnc.listeners.length, 2);
    assert.equal(JSON.stringify(result).includes('never-export'), false);
  });
}

for (const mode of [
  'root-cwd',
  'supervisor-cwd',
  'x11-cwd',
  'web-cwd',
  'handler-cwd',
  'missing-headed',
  'missing-sources',
  'forged-headed',
  'headed-history',
  'headed-display',
  'source-digest',
  'source-stale',
  'source-future',
  'config-drift',
  'clock-rollback',
  'deleted-python',
  'detached-handler',
  'outside-drift',
  'wrong-peer',
  'unowned-peer',
  'unknown-display-client',
  'missing-listener',
  'shared-listener',
  'fd-drift',
  'census-drift',
  'manager-drift',
  'source-drift',
  'socket-drift',
]) {
  test(`native VNC observation refuses ${mode}`, async () => {
    const f = await vncNativeObservationFixture();
    const row = (pid) => f.current.processes.find((p) => p.pid === pid);
    const cwdPid = {
      'root-cwd': 70,
      'supervisor-cwd': 71,
      'x11-cwd': 72,
      'web-cwd': 73,
      'handler-cwd': 74,
    }[mode];
    if (cwdPid) row(cwdPid).cwd = cwdPid >= 73 ? '/root' : '/usr/share/novnc';
    if (mode === 'missing-headed') Reflect.deleteProperty(f.input, 'headedRecovery');
    if (mode === 'missing-sources') Reflect.deleteProperty(f.input, 'sources');
    if (mode === 'forged-headed') f.input.headedRecovery.policyDigest = 'f'.repeat(64);
    if (mode === 'headed-history') f.input.headedRecovery.restartCount++;
    if (mode === 'headed-display') f.input.headedRecovery.display.pid = 60;
    if (mode === 'source-digest') f.input.sources.files[0].digest = 'f'.repeat(64);
    if (mode === 'source-stale') f.setNow(62000);
    if (mode === 'source-future') f.input.sources.observedAtMs = 1201;
    if (mode === 'config-drift') f.managers[0].pm2_env.env.PRIVATE_VALUE = 'changed';
    if (mode === 'clock-rollback') {
      let calls = 0;
      f.io.now = () => (++calls < 3 ? 1200 : 1199);
    }
    if (mode === 'deleted-python') f.paths.set('/proc/73/exe', '/usr/bin/python3.10 (deleted)');
    if (mode === 'detached-handler') row(74).ppid = 1;
    if (mode === 'outside-drift') row(60).start = '999';
    if (mode === 'wrong-peer') f.sockets.unix[3] = f.sockets.unix[3].replace('* 700', '* 999');
    if (mode === 'unowned-peer') f.sockets.unix[3] = f.sockets.unix[3].replace(/ users:.*/, '');
    if (mode === 'unknown-display-client') {
      f.sockets.unix[3] = f.sockets.unix[3].replace('pid=72', 'pid=60');
      f.fds.set(60, new Map([['6', '701']]));
    }
    if (mode === 'missing-listener') f.sockets.ipv4.shift();
    if (mode === 'shared-listener') {
      f.sockets.ipv4[0] = f.sockets.ipv4[0].replace(')) ino:', '),("outside",pid=60,fd=8)) ino:');
      f.fds.set(60, new Map([['8', '801']]));
    }
    if (mode === 'fd-drift') f.fds.get(72).set('6', '999');
    if (mode === 'census-drift') {
      let calls = 0;
      f.io.readCensus = async () => {
        const value = structuredClone(f.current);
        if (++calls > 1) value.processes.find((p) => p.pid === 73).start = '999';
        return value;
      };
    }
    if (mode === 'manager-drift') {
      const read = f.io.readManagers;
      let calls = 0;
      f.io.readManagers = async () => {
        const rows = await read();
        if (++calls > 1) rows[0].pm2_env.restart_time++;
        return rows;
      };
    }
    if (mode === 'source-drift') {
      const read = f.io.exec;
      f.io.exec = async (...args) => {
        f.data.set('/usr/bin/x11vnc', Buffer.from('changed-binary'));
        return read(...args);
      };
    }
    if (mode === 'socket-drift') {
      const read = f.io.exec;
      let calls = 0;
      f.io.exec = async (...args) => {
        const value = await read(...args);
        return ++calls > 3 ? value.replaceAll('701', '702') : value;
      };
    }
    await assert.rejects(
      firstRuntime.readFirstCutoverCloudRecovery(f.input, f.io),
      /CUTOVER_CLOUD_(?:VNC_NATIVE_SOURCE|RECOVERY)_UNPROVEN/,
    );
  });
}

test('native VNC observation returns extra listeners without granting endpoint approval', async () => {
  const f = await vncNativeObservationFixture(0);
  f.sockets.ipv6.push('LISTEN 0 32 [::]:5900 [::]:* users:(("x11vnc",pid=72,fd=8)) ino:802');
  f.fds.get(72).set('8', '802');
  const result = await firstRuntime.readFirstCutoverCloudRecovery(f.input, f.io);
  assert.deepEqual(
    result.vnc.listeners.find((r) => r.port === 5900),
    {
      family: 'ipv6',
      address: '::',
      port: 5900,
      inode: '802',
      owners: [{ pid: 72, start: '720', fd: 8 }],
    },
  );
  assert.equal(result.vnc.handlers.length, 0);
  assert.equal(Object.hasOwn(result.vnc, 'capabilityVerified'), false);
});

test('native recovery proof refuses VNC without a native source capability verifier, even with an accepting boolean hook', async () => {
  assert.equal(typeof firstRuntime.readFirstCutoverCloudRecovery, 'function');
  const f = cloudNativeRecoveryFixture();
  f.input.name = 'holaday-vnc';
  f.io.verifyVncSource = async () => true;
  f.io.readCensus = async () => {
    assert.fail('missing prerequisite must be discovered before observation');
  };
  await assert.rejects(
    firstRuntime.readFirstCutoverCloudRecovery(f.input, f.io),
    /^Error: CUTOVER_CLOUD_VNC_NATIVE_SOURCE_UNPROVEN$/,
  );
});

test('cloud recovery observation reads actual fixed manager, process and private policy without returning configuration contents', async () => {
  const f = cloudRecoveryObservationFixture();
  assert.equal(typeof firstRuntime.readFirstCutoverCloudBrowserRecovery, 'function');
  const proof = await firstRuntime.readFirstCutoverCloudBrowserRecovery(f.input, f.io);
  assert.equal(proof.pid, 40);
  assert.equal(proof.start, '1234');
  assert.equal(proof.pmId, 7);
  assert.equal(proof.observedAtMs, 1000);
  assert.equal(proof.purpose, 'cloud-browser-runtime-observation');
  assert.match(proof.policyDigest, /^[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(proof).includes('HomepageLocation'), false);
  assert.equal('unknownWriters' in proof, false);
});
test('cloud recovery observation retains historical PM2 restart count without treating it as a new recovery retry', async () => {
  const f = cloudRecoveryObservationFixture();
  f.manager.pm2_env.restart_time = 12;
  const proof = await firstRuntime.readFirstCutoverCloudBrowserRecovery(f.input, f.io);
  assert.equal(proof.restartCount, 12);
});
test('cloud recovery observation binds the full stable manager config while excluding monitoring counters', async () => {
  const f = cloudRecoveryObservationFixture();
  f.manager.pm2_env.env = { PRIVATE_VALUE: 'must-not-escape' };
  let calls = 0;
  const read = f.io.readManagers;
  f.io.readManagers = async () => {
    f.manager.pm2_env.axm_monitor = { changing: calls++ };
    return read();
  };
  const proof = await firstRuntime.readFirstCutoverCloudBrowserRecovery(f.input, f.io);
  assert.equal(proof.configDigest, cutoverRegistrationConfigDigest(f.manager.pm2_env));
  assert.equal(JSON.stringify(proof).includes('must-not-escape'), false);
});
for (const [field, value] of [
  ['cron_restart', '* * * * *'],
  ['max_memory_restart', 1024],
  ['max_memory_restart', 0],
  ['max_memory_restart', null],
  ['max_memory_restart', false],
  ['max_memory_restart', 'null'],
  ['exec_mode', 'cluster_mode'],
  ['cron_restart', undefined],
  ['max_memory_restart', undefined],
  ['exec_mode', undefined],
])
  test(`cloud recovery refuses mismatched fixed lifecycle field ${field}=${JSON.stringify(value)}`, async () => {
    const f = cloudRecoveryObservationFixture();
    f.manager.pm2_env[field] = value;
    await assert.rejects(
      firstRuntime.readFirstCutoverCloudBrowserRecovery(f.input, f.io),
      /CUTOVER_CLOUD_RECOVERY_UNPROVEN/,
    );
  });
test('cloud recovery memory policy accepts only actual field absence', async () => {
  const f = cloudRecoveryObservationFixture();
  assert.equal(Object.hasOwn(f.manager.pm2_env, 'max_memory_restart'), false);
  const proof = await firstRuntime.readFirstCutoverCloudBrowserRecovery(f.input, f.io);
  assert.equal(proof.pmId, 7);
});
for (const value of [524288000, 0, null, false, 'null', undefined]) {
  test(`cloud recovery refuses nested environment memory=${JSON.stringify(value)} even when outer field is absent`, async () => {
    const f = cloudRecoveryObservationFixture();
    f.manager.pm2_env.env = { max_memory_restart: value };
    await assert.rejects(
      firstRuntime.readFirstCutoverCloudBrowserRecovery(f.input, f.io),
      /UNPROVEN/,
    );
  });
}
for (const field of ['env', 'pm_cwd', 'unknown_future_option'])
  test(`cloud recovery refuses full config drift during observation: ${field}`, async () => {
    const f = cloudRecoveryObservationFixture();
    let calls = 0;
    const read = f.io.readManagers;
    f.io.readManagers = async () => {
      if (calls++) f.manager.pm2_env[field] = { changed: true };
      return read();
    };
    await assert.rejects(
      firstRuntime.readFirstCutoverCloudBrowserRecovery(f.input, f.io),
      /CUTOVER_CLOUD_RECOVERY_UNPROVEN/,
    );
  });
test('cloud recovery observation refuses unsafe launch, missing protection, conflicting policy and identity races', async () => {
  assert.equal(typeof firstRuntime.readFirstCutoverCloudBrowserRecovery, 'function');
  const faults = {
    platform: (f) => {
      f.io.platform = 'darwin';
    },
    uid: (f) => {
      f.io.uid = 998;
    },
    arbitraryInput: (f) => {
      f.input.pid = 40;
    },
    manager: (f) => {
      f.manager.pm_id++;
    },
    restart: (f) => {
      f.manager.pm2_env.autorestart = true;
    },
    replay: (f) => {
      f.manager.pm2_env.args = [...f.manager.pm2_env.args, 'https://example.invalid/action'];
    },
    script: (f) => {
      f.manager.pm2_env.pm_exec_path = '/opt/holaday-headed/start.sh';
    },
    display: (f) => {
      f.manager.pm2_env.DISPLAY = ':0';
    },
    actualDisplay: (f) => {
      f.files.set('/proc/40/environ', 'DISPLAY=:0\0');
    },
    environmentDisplayDuplicate: (f) => {
      f.files.set('/proc/40/environ', 'DISPLAY=:98\0DISPLAY=:0\0');
    },
    actualArgv: (f) => {
      f.files.set('/proc/40/cmdline', '/opt/brave.com/brave/brave\0--restore-last-session\0');
    },
    actualExe: (f) => {
      f.links.set('/proc/40/exe', '/usr/bin/sleep');
    },
    sameNamespace: (f) => {
      f.links.set('/proc/40/ns/mnt', 'mnt:[1]');
    },
    writableMount: (f) => {
      f.files.set('/proc/40/mountinfo', f.files.get('/proc/40/mountinfo').replace(' ro,', ' rw,'));
    },
    privilege: (f) => {
      f.files.set(
        '/proc/40/status',
        f.files.get('/proc/40/status').replace('CapBnd:\t00000000', 'CapBnd:\t00000001'),
      );
    },
    newPrivileges: (f) => {
      f.files.set(
        '/proc/40/status',
        f.files.get('/proc/40/status').replace('NoNewPrivs:\t1', 'NoNewPrivs:\t0'),
      );
    },
    policyOverride: (f) => {
      f.files.set(`${f.privatePolicy}/recovery.json`, '{"RestoreOnStartup":1}');
    },
    sourceDrift: (f) => {
      f.files.set(`${f.source}/recovery.json`, '{"RestoreOnStartup":1}');
    },
    parentDrift: (f) => {
      f.files.set(`${f.policy}/existing.json`, '{"RestoreOnStartup":1}');
    },
    symlink: (f) => {
      const stat = f.io.lstat;
      f.io.lstat = async (p) => ({ ...(await stat(p)), mode: 0o120777 });
    },
    writable: (f) => {
      const stat = f.io.lstat;
      f.io.lstat = async (p) => ({ ...(await stat(p)), mode: (await stat(p)).mode | 0o002 });
    },
    identityRace: (f) => {
      const read = f.io.readFile;
      let n = 0;
      f.io.readFile = async (p) =>
        p === '/proc/40/stat' && n++ ? (await read(p)).replace('1234', '1235') : read(p);
    },
    managerRace: (f) => {
      const readManagers = f.io.readManagers;
      let n = 0;
      f.io.readManagers = async () => {
        if (n++) f.manager.pid++;
        return readManagers();
      };
    },
    restartRace: (f) => {
      const readManagers = f.io.readManagers;
      let n = 0;
      f.io.readManagers = async () => {
        if (n++) f.manager.pm2_env.restart_time++;
        return readManagers();
      };
    },
    policyRace: (f) => {
      const read = f.io.readFile;
      let n = 0;
      f.io.readFile = async (p) =>
        p === `${f.source}/recovery.json` && n++ ? '{"RestoreOnStartup":1}' : read(p);
    },
  };
  for (const [name, mutate] of Object.entries(faults)) {
    const f = cloudRecoveryObservationFixture();
    mutate(f);
    await assert.rejects(
      () => firstRuntime.readFirstCutoverCloudBrowserRecovery(f.input, f.io),
      /CUTOVER_CLOUD_RECOVERY_UNPROVEN/,
      name,
    );
  }
});
test('cloud recovery launch cannot select another profile, command, policy directory or restart behavior', () => {
  const build = firstRuntime.firstCutoverCloudBrowserRecoveryLaunch;
  assert.equal(typeof build, 'function');
  const attempt = '12345678-1234-4234-8234-123456789abc';
  for (const input of [
    undefined,
    { attempt: '../other' },
    { attempt, profile: '/another/profile' },
    { attempt, command: '/bin/sh' },
    { attempt, policyDirectory: '/etc/brave/policies/managed' },
    { attempt, autorestart: true },
    { attempt, args: ['https://example.invalid/action'] },
  ])
    assert.throws(() => build(input), /UNPROVEN/);
  const launch = build({ attempt });
  assert.equal(launch.command, '/usr/bin/unshare');
  assert.deepEqual(launch.env, { DISPLAY: ':98' });
  assert.equal(launch.autorestart, false);
  assert.ok(launch.args.includes('--user-data-dir=/var/lib/holaday-headed-brave'));
  assert.ok(launch.args.includes('--remote-debugging-port=9223'));
  assert.ok(launch.args.includes('--no-startup-window'));
  assert.ok(
    launch.args.includes(`/var/lib/holaday-deploy/maintenance/${attempt}/cloud-browser-policy`),
  );
  launch.args.push('https://example.invalid/action');
  launch.env.DISPLAY = ':0';
  assert.equal(build({ attempt }).args.includes('https://example.invalid/action'), false);
  assert.deepEqual(build({ attempt }).env, { DISPLAY: ':98' });
});

function interruptionWork() {
  const approval = {
    schemaVersion: 2,
    kind: 'first-cutover',
    attempt: '12345678-1234-4234-8234-123456789abc',
    candidate: 'a'.repeat(40),
    configDigest: 'b'.repeat(64),
    migrationDigest: 'c'.repeat(64),
    inventoryDigest: digest,
    legacyDigest: 'd'.repeat(64),
    maintenanceEndsAtMs: 2000,
    reconcileByMs: 3000,
    operatorRef: 'qa-operator',
    legacyInterruption: {
      mode: 'controlled-interruption',
      scope: 'legacy-non-payment-memory',
      approvalRef: 'legacy-interruption-20260928',
      capabilityDigest: '7'.repeat(64),
      observeUntilMs: 1800,
      noAutomaticReplay: true,
    },
  };
  return {
    approval,
    phase: 'before-stop',
    nowMs: 1000,
    observation: {
      schemaVersion: 2,
      inventoryDigest: digest,
      observedAtMs: 999,
      unsettledWork: 0,
      unknownWriters: 0,
      knownExternalWork: [],
      activeRequests: { kind: 'unobservable', reason: 'legacy-no-inflight-api' },
      externalWork: { kind: 'unobservable', reason: 'legacy-no-inflight-api' },
      capabilityDigest: '7'.repeat(64),
      replaySourcesDigest: '8'.repeat(64),
      pendingReplay: 0,
    },
  };
}
test('legacy work boundary distinguishes approved unobservable from zero, positive, malformed and expired observations', () => {
  assert.equal(typeof firstRuntime.validateLegacyWorkBoundary, 'function');
  const input = interruptionWork();
  const result = firstRuntime.validateLegacyWorkBoundary(input);
  assert.equal(result.mode, 'controlled-interruption');
  assert.match(result.riskDigest, /^[a-f0-9]{64}$/);
  for (const field of ['activeRequests', 'externalWork']) {
    const zero = structuredClone(input);
    zero.observation[field] = { kind: 'observed', count: 0 };
    assert.deepEqual(firstRuntime.validateLegacyWorkBoundary(zero), result);
    for (const value of [
      null,
      undefined,
      0,
      { kind: 'observed', count: 1 },
      { kind: 'observed', count: -1 },
      { kind: 'unobservable', reason: 'timeout' },
      { kind: 'unobservable', reason: 'legacy-no-inflight-api', count: 0 },
    ]) {
      const bad = structuredClone(input);
      bad.observation[field] = value;
      assert.throws(() => firstRuntime.validateLegacyWorkBoundary(bad), /CUTOVER_/);
    }
  }
  for (const [key, value] of [
    ['unsettledWork', 1],
    ['unknownWriters', 1],
    ['knownExternalWork', ['known-action']],
    ['pendingReplay', 1],
    ['replaySourcesDigest', null],
    ['capabilityDigest', '0'.repeat(64)],
    ['inventoryDigest', '0'.repeat(64)],
    ['observedAtMs', 1001],
    ['schemaVersion', 1],
  ]) {
    const bad = structuredClone(input);
    bad.observation[key] = value;
    assert.throws(() => firstRuntime.validateLegacyWorkBoundary(bad), /CUTOVER_/, key);
  }
  assert.throws(
    () => firstRuntime.validateLegacyWorkBoundary({ ...input, nowMs: 1801 }),
    /CUTOVER_/,
  );
  assert.deepEqual(
    firstRuntime.validateLegacyWorkBoundary({ ...input, nowMs: 1801, phase: 'after-stop' }),
    result,
  );
  assert.throws(
    () => firstRuntime.validateLegacyWorkBoundary({ ...input, nowMs: 2000, phase: 'preopen' }),
    /CUTOVER_/,
  );
  assert.throws(
    () => firstRuntime.validateLegacyWorkBoundary({ ...input, phase: 'unknown' }),
    /CUTOVER_/,
  );
  assert.throws(
    () =>
      firstRuntime.validateLegacyWorkBoundary({
        ...input,
        approval: { ...input.approval, kind: 'ordinary' },
      }),
    /CUTOVER_/,
  );
  const strict = {
    ...input,
    approval: { schemaVersion: 1, inventoryDigest: digest },
    observation: {
      inventoryDigest: digest,
      observedAtMs: 999,
      unsettledWork: 0,
      externalWork: 0,
      activeRequests: 0,
      unknownWriters: 0,
    },
  };
  assert.deepEqual(firstRuntime.validateLegacyWorkBoundary(strict), { mode: 'drained' });
  strict.observation.externalWork = null;
  assert.throws(() => firstRuntime.validateLegacyWorkBoundary(strict), /CUTOVER_/);
  strict.observation.externalWork = 0;
  strict.approval.schemaVersion = 3;
  assert.throws(() => firstRuntime.validateLegacyWorkBoundary(strict), /CUTOVER_/);
});
test('runtime preserves the actual mixed-case kernel hostname in captured targets', async () => {
  const f = fixture();
  f.inventory.host = 'iZbp1ActualNodeZ';
  f.inventory.processes[0].host = f.inventory.host;
  const captured = await captureLegacyRuntime(
    { inventory: f.inventory, approvedTargets: f.inventory.processes },
    f.io,
  );
  assert.equal(captured.targets[0].host, f.inventory.host);
});
const manager = {
  kind: 'pm2',
  pid: 50,
  start: '200',
  exe: '/opt/node22/bin/node',
  argvDigest: 'b'.repeat(64),
  pm2Home: '/root/.pm2',
  version: '6.0.14',
  pmId: 2,
  name: 'holaday-orchestrator',
  configDigest: 'c'.repeat(64),
  killTimeoutMs: 1600,
  killSignal: 'SIGINT',
  watch: false,
  cron: false,
  memoryRestart: 0,
};
const target = {
  host: 'vultr',
  bootId: 'd'.repeat(32),
  pid: 100,
  ppid: 50,
  start: '300',
  uids: [998, 998, 998, 998],
  exe: '/opt/node22/bin/node',
  cwd: '/opt/holaday-monorepo/apps/orchestrator',
  argvDigest: 'e'.repeat(64),
  role: 'main',
  managerIdentity: manager,
};
function fixture() {
  let now = 1000;
  const inventory = {
    inventoryDigest: digest,
    host: 'vultr',
    bootId: target.bootId,
    observedAtMs: now,
    processes: [structuredClone(target)],
    unknownLaunchers: [],
    managers: [{ ...manager, status: 'online', rootPid: 100 }],
    listeners: [{ port: 4001, pid: 100 }],
    ports: [4001, 4002],
  };
  const events = [];
  const io = {
    now: () => now,
    sleep: async (ms) => {
      now += ms;
    },
    readInventory: async () => structuredClone({ ...inventory, observedAtMs: now }),
    assertJournalOwnership: async () => ({ inventoryDigest: digest }),
    verifyFence: async () => ({
      inventoryDigest: digest,
      stage: 'all-writers',
      unsettledWork: 0,
      externalWork: 0,
      producersRunning: 0,
    }),
    pm2Stop: async (p) => {
      events.push(['pm2', p.pid, p.managerIdentity.pmId]);
      inventory.processes = [];
      inventory.listeners = [];
      inventory.managers[0].status = 'stopped';
      inventory.managers[0].rootPid = 0;
    },
    signalPinned: async (p) => {
      events.push(['pidfd', p.pid]);
      inventory.processes = [];
      inventory.listeners = [];
    },
  };
  return { inventory, io, events };
}
const capture = (f) =>
  captureLegacyRuntime(
    { inventory: structuredClone(f.inventory), approvedTargets: [structuredClone(target)] },
    f.io,
  );

// Registration deletion must use the real scheduler settings; treating memory
// restart as zero or inventing a PID for a stopped cron job hides a live source.
test('registration capture preserves memory restart and stopped cron without weakening stop capture', async () => {
  assert.equal(typeof firstRuntime.captureLegacyRegistrations, 'function');
  const f = fixture();
  const workerManager = {
    ...manager,
    name: 'holaday-account-closure-worker',
    memoryRestart: 536870912,
    killTimeoutMs: 660000,
  };
  const worker = { ...target, role: 'worker', managerIdentity: workerManager };
  const cron = {
    ...manager,
    pmId: 5,
    name: 'holaday-files-cron',
    cron: '0 * * * *',
    status: 'stopped',
    rootPid: 0,
  };
  f.inventory.processes = [worker];
  f.inventory.managers = [{ ...workerManager, status: 'online', rootPid: 100 }, cron];
  await assert.rejects(
    captureLegacyRuntime({ inventory: f.inventory, approvedTargets: [worker] }, f.io),
    /CUTOVER_/,
  );
  const captured = await firstRuntime.captureLegacyRegistrations(
    {
      inventory: f.inventory,
      approvedTargets: [worker],
      approvedRegistrations: f.inventory.managers,
    },
    f.io,
  );
  assert.equal(captured.retirement, 'delete-registration');
  assert.equal(captured.managers[0].memoryRestart, 536870912);
  assert.equal(captured.managers[1].rootPid, 0);
  assert.deepEqual(captured.targets, [worker]);
  await assert.rejects(retireLegacyRuntime({ captured, deadlineMs: 900000 }, f.io), /CUTOVER_/);
  assert.deepEqual(f.events, []);
});

test('stopped cron alone can be captured only with zero physical processes and listeners', async () => {
  assert.equal(typeof firstRuntime.captureLegacyRegistrations, 'function');
  const f = fixture();
  f.inventory.processes = [];
  f.inventory.listeners = [];
  f.inventory.managers = [
    {
      ...manager,
      name: 'holaday-files-cron',
      pmId: 5,
      cron: '0 * * * *',
      status: 'stopped',
      rootPid: 0,
    },
  ];
  const input = {
    inventory: f.inventory,
    approvedTargets: [],
    approvedRegistrations: f.inventory.managers,
  };
  const result = await firstRuntime.captureLegacyRegistrations(input, f.io);
  assert.equal(result.targets.length, 0);
  for (const change of [
    (s) => {
      s.managers[0].name = 'unrelated';
    },
    (s) => {
      s.managers[0].rootPid = 999;
    },
    (s) => {
      s.managers[0].status = 'online';
    },
    (s) => {
      s.managers[0].version = '6.0.13';
    },
    (s) => {
      s.managers[0].watch = true;
    },
    (s) => {
      s.managers[0].memoryRestart = -1;
    },
    (s) => {
      s.managers[0].cron = '* * * * *';
    },
    (s) => {
      s.managers.push(structuredClone(s.managers[0]));
    },
    (s) => {
      s.listeners = [{ pid: 999, port: 4001 }];
    },
    (s) => {
      s.unknownLaunchers = ['unexpected'];
    },
  ]) {
    const inventory = structuredClone(f.inventory);
    change(inventory);
    await assert.rejects(
      firstRuntime.captureLegacyRegistrations(
        { inventory, approvedTargets: [], approvedRegistrations: inventory.managers },
        f.io,
      ),
      /CUTOVER_/,
    );
  }
});

test('registration capture refuses omitted, drifted and role-mismatched managed scopes', async () => {
  assert.equal(typeof firstRuntime.captureLegacyRegistrations, 'function');
  for (const change of [
    (i) => {
      i.approvedRegistrations = [];
    },
    (i) => {
      i.approvedRegistrations[0].configDigest = 'f'.repeat(64);
    },
    (i) => {
      i.inventory.managers[0].rootPid = 999;
    },
    (i) => {
      i.approvedTargets[0].managerIdentity.name = 'holaday-cn-payment';
      i.inventory.processes = structuredClone(i.approvedTargets);
      i.inventory.managers[0].name = 'holaday-cn-payment';
      i.approvedRegistrations[0].name = 'holaday-cn-payment';
    },
  ]) {
    const f = fixture();
    const input = structuredClone({
      inventory: f.inventory,
      approvedTargets: f.inventory.processes,
      approvedRegistrations: f.inventory.managers,
    });
    change(input);
    await assert.rejects(firstRuntime.captureLegacyRegistrations(input, f.io), /CUTOVER_/);
    assert.deepEqual(f.events, []);
  }
});

function producerFixture() {
  const f = fixture();
  f.io.verifyFence = async () => ({
    inventoryDigest: digest,
    stage: 'orders',
    observedAtMs: f.io.now(),
    unsettledWork: 0,
    externalWork: 0,
    activeRequests: 0,
    unknownWriters: 0,
    producersRunning: f.inventory.processes.length,
    runningProducers: structuredClone(f.inventory.processes),
  });
  return f;
}
test('interrupted producer stop needs the live owned receipt and rejects replay on the post-stop read', async () => {
  for (const fault of [
    undefined,
    'missing-reader',
    'missing-receipt',
    'wrong-risk',
    'wrong-owner',
    'wrong-phase',
    'failure',
    'known-work',
    'stripped',
    'post-stop-replay',
  ]) {
    const f = producerFixture();
    const input = interruptionWork();
    const riskDigest = firstRuntime.validateLegacyWorkBoundary(input).riskDigest;
    const effects = {
      ...input.approval,
      riskDigest,
      recordDigest: '1'.repeat(64),
      phase: 'producers_stopped',
      interruptionObservation: {
        riskDigest,
        sourceDigest: '2'.repeat(64),
        fenceDigest: '3'.repeat(64),
        observedAtMs: 999,
      },
    };
    if (fault === 'missing-receipt') effects.interruptionObservation = undefined;
    if (fault === 'wrong-risk') effects.riskDigest = '0'.repeat(64);
    if (fault === 'wrong-phase') effects.phase = 'orders_fenced';
    if (fault === 'failure') effects.failureObservation = {};
    if (fault !== 'missing-reader')
      f.io.readFirstCutoverEffects = async () => structuredClone(effects);
    f.io.assertJournalOwnership = async () => ({
      inventoryDigest: digest,
      attempt: fault === 'wrong-owner' ? 'other' : effects.attempt,
    });
    const base = f.io.verifyFence;
    f.io.verifyFence = async () => {
      const observation = structuredClone(input.observation);
      if (fault === 'known-work') observation.knownExternalWork = ['identified-action'];
      if (fault === 'post-stop-replay' && f.events.length) observation.pendingReplay = 1;
      if (fault === 'stripped') return base();
      return {
        ...(await base()),
        activeRequests: observation.activeRequests,
        externalWork: observation.externalWork,
        riskDigest,
        legacyWork: { before: observation, after: structuredClone(observation) },
      };
    };
    const captured = await capture(f);
    if (fault) {
      await assert.rejects(
        retireLegacyProducers({ captured, deadlineMs: 5000 }, f.io),
        /CUTOVER_/,
        fault,
      );
      assert.equal(f.events.length, fault === 'post-stop-replay' ? 1 : 0, fault);
    } else {
      assert.equal(
        (await retireLegacyProducers({ captured, deadlineMs: 5000 }, f.io)).phase,
        'producers-stopped',
      );
      assert.deepEqual(f.events, [['pm2', 100, 2]]);
    }
  }
});
test('producer-first stop accepts observed running producers only after orders isolation and work checks', async () => {
  const f = producerFixture();
  const captured = await capture(f);
  const receipt = await retireLegacyProducers({ captured, deadlineMs: 5000 }, f.io);
  assert.equal(receipt.phase, 'producers-stopped');
  assert.deepEqual(f.events, [['pm2', 100, 2]]);
  assert.equal(f.inventory.processes.length, 0);
  await assert.rejects(
    retireLegacyRuntime({ captured, producerReceipt: receipt, deadlineMs: 5000 }, f.io),
    /CUTOVER_/,
  );
  f.io.verifyFence = fixture().io.verifyFence;
  const stopped = await retireLegacyRuntime(
    { captured, producerReceipt: receipt, deadlineMs: 5000 },
    f.io,
  );
  assert.equal(stopped.phase, 'stopped');
  assert.equal(f.events.length, 1); // Never signal an already-retired producer again.
});
test('producer-first work, source age and complete producer identity independently guard every stop', async () => {
  for (const bad of [
    { activeRequests: 1 },
    { unsettledWork: 1 },
    { externalWork: 1 },
    { unknownWriters: 1 },
    { observedAtMs: -60000 },
    { observedAtMs: 1001 },
    { producersRunning: 0 },
    { runningProducers: [] },
    { stage: 'unfenced' },
    { runningProducers: [{ ...target, pid: 999 }] },
  ]) {
    const f = producerFixture();
    const verify = f.io.verifyFence;
    f.io.verifyFence = async () => ({ ...(await verify()), ...bad });
    await assert.rejects(
      retireLegacyProducers({ captured: await capture(f), deadlineMs: 5000 }, f.io),
      /CUTOVER_/,
    );
    assert.deepEqual(f.events, []);
  }
});
test('producer-first gateway or unapproved host process is never silently treated as a producer', async () => {
  const f = producerFixture();
  const gateway = {
    ...target,
    role: 'gateway',
    cwd: '/opt/holaday-cn-payment/releases/083a6232aca7-20260804125641',
  };
  f.inventory.processes = [gateway];
  const captured = await captureLegacyRuntime(
    { inventory: f.inventory, approvedTargets: [gateway] },
    f.io,
  );
  await assert.rejects(retireLegacyProducers({ captured, deadlineMs: 5000 }, f.io), /CUTOVER_/);
  assert.deepEqual(f.events, []);
});
test('producer receipt cannot be copied, altered or used after a producer respawns', async () => {
  for (const change of ['copy', 'alter', 'respawn', 'manager', 'port']) {
    const f = producerFixture();
    const captured = await capture(f);
    let receipt = await retireLegacyProducers({ captured, deadlineMs: 5000 }, f.io);
    if (change === 'copy') receipt = structuredClone(receipt);
    if (change === 'alter') receipt.inventoryDigest = 'f'.repeat(64);
    if (change === 'respawn') f.inventory.processes = [{ ...target, start: '999' }];
    if (change === 'manager') f.inventory.managers[0].status = 'online';
    if (change === 'port') f.inventory.listeners = [{ pid: 999, port: 4001 }];
    f.io.verifyFence = fixture().io.verifyFence;
    await assert.rejects(
      retireLegacyRuntime({ captured, producerReceipt: receipt, deadlineMs: 5000 }, f.io),
      /CUTOVER_/,
    );
    assert.equal(f.events.length, 1);
  }
});
test('producer command boundary accepts orders stage without weakening the ordinary first-stop factory', async () => {
  const f = producerFixture();
  const captured = await capture(f);
  const calls = [];
  const system = {
    platform: 'linux',
    uid: 0,
    exec: async (...args) => {
      calls.push(args);
    },
  };
  const producer = createLegacyProducerEffects(f.io, captured, system);
  await producer.pm2Stop(target);
  assert.deepEqual(calls[0].slice(0, 2), ['pm2', ['stop', '2', '--watch']]);
  await assert.rejects(createLegacyRuntimeEffects(f.io, system).pm2Stop(target), /CUTOVER_/);
  f.io.verifyFence = async () => ({
    stage: 'orders',
    unsettledWork: 0,
    externalWork: 0,
    producersRunning: 0,
  });
  await assert.rejects(producer.pm2Stop(target), /CUTOVER_/);
  assert.equal(calls.length, 1);
});

test('PM2 capture accepts auto-restarting legacy app but records exact identity and stops only its id', async () => {
  const f = fixture();
  const captured = await capture(f);
  assert.equal(captured.targets[0].pid, 100);
  assert.equal(captured.inventoryDigest, digest);
  const stopped = await retireLegacyRuntime({ captured, deadlineMs: 5000 }, f.io);
  assert.deepEqual(f.events, [['pm2', 100, 2]]);
  assert.equal(stopped.inventoryDigest, digest);
  assert.equal(stopped.phase, 'stopped');
});

test('system Node PM2 manager is distinct from the UID998 Node22 application identity', async () => {
  const f = fixture();
  const approved = structuredClone(target);
  approved.managerIdentity.exe = '/usr/bin/node';
  f.inventory.processes = [structuredClone(approved)];
  f.inventory.managers[0].exe = '/usr/bin/node';
  const captured = await captureLegacyRuntime(
    { inventory: f.inventory, approvedTargets: [approved] },
    f.io,
  );
  assert.equal(captured.targets[0].exe, '/opt/node22/bin/node');
  assert.deepEqual(captured.targets[0].uids, [998, 998, 998, 998]);
  assert.equal(captured.managers[0].exe, '/usr/bin/node');
  const calls = [];
  await createLegacyRuntimeEffects(f.io, {
    platform: 'linux',
    uid: 0,
    exec: async (...args) => calls.push(args),
  }).pm2Stop(approved);
  assert.deepEqual(calls[0].slice(0, 2), ['pm2', ['stop', '2', '--watch']]);
  await retireLegacyRuntime({ captured, deadlineMs: 5000 }, f.io);
  assert.deepEqual(f.events, [['pm2', 100, 2]]);
});

test('system manager support does not accept a root application or arbitrary executable', async () => {
  for (const change of [
    (p) => {
      p.uids = [0, 0, 0, 0];
    },
    (p) => {
      p.exe = '/usr/bin/node';
    },
    (p) => {
      p.managerIdentity.exe = '/tmp/node';
    },
  ]) {
    const f = fixture();
    const p = structuredClone(target);
    p.managerIdentity.exe = '/usr/bin/node';
    change(p);
    f.inventory.processes = [p];
    f.inventory.managers = [{ ...p.managerIdentity, status: 'online', rootPid: p.pid }];
    await assert.rejects(
      captureLegacyRuntime({ inventory: f.inventory, approvedTargets: [p] }, f.io),
      /CUTOVER_RUNTIME_UNPROVEN/,
    );
    assert.deepEqual(f.events, []);
  }
});

test('approved system manager replacement is refused immediately before the command', async () => {
  const f = fixture();
  const p = structuredClone(target);
  p.managerIdentity.exe = '/usr/bin/node';
  f.inventory.processes = [structuredClone(p)];
  f.inventory.managers = [{ ...p.managerIdentity, status: 'online', rootPid: p.pid }];
  const captured = await captureLegacyRuntime(
    { inventory: f.inventory, approvedTargets: [p] },
    f.io,
  );
  // Both are otherwise eligible executables; approval is still for one exact daemon.
  f.inventory.managers[0].exe = '/opt/node22/bin/node';
  await assert.rejects(retireLegacyRuntime({ captured, deadlineMs: 5000 }, f.io), /CUTOVER_/);
  let calls = 0;
  await assert.rejects(
    createLegacyRuntimeEffects(f.io, {
      platform: 'linux',
      uid: 0,
      exec: async () => {
        calls++;
      },
    }).pm2Stop(p),
    /CUTOVER_/,
  );
  assert.equal(calls, 0);
});

test('explicit eleven-minute stop policy fits a bounded window without shortening PM2 timeout', async () => {
  const f = fixture();
  const p = structuredClone(target);
  p.role = 'worker';
  p.managerIdentity.killTimeoutMs = 660000;
  p.managerIdentity.name = 'holaday-account-closure-worker';
  f.inventory.processes = [p];
  f.inventory.managers = [{ ...p.managerIdentity, status: 'online', rootPid: p.pid }];
  const captured = await captureLegacyRuntime(
    { inventory: f.inventory, approvedTargets: [p] },
    f.io,
  );
  const stop = f.io.pm2Stop;
  f.io.pm2Stop = async (approved) => {
    assert.equal(approved.managerIdentity.killTimeoutMs, 660000);
    await f.io.sleep(660000);
    await stop(approved);
  };
  const receipt = await retireLegacyRuntime({ captured, deadlineMs: 720000 }, f.io);
  assert.equal(receipt.phase, 'stopped');
  assert.equal(receipt.observedAtMs, 661100);
  assert.deepEqual(f.events, [['pm2', 100, 2]]);
});

test('insufficient total stop budget refuses before stopping even the first approved process', async () => {
  const f = fixture();
  const worker = structuredClone(target);
  worker.pid = 101;
  worker.role = 'worker';
  worker.managerIdentity.pmId = 3;
  worker.managerIdentity.name = 'holaday-account-closure-worker';
  worker.managerIdentity.killTimeoutMs = 4000;
  f.inventory.processes.push(worker);
  f.inventory.managers.push({ ...worker.managerIdentity, status: 'online', rootPid: worker.pid });
  const captured = await captureLegacyRuntime(
    { inventory: f.inventory, approvedTargets: f.inventory.processes },
    f.io,
  );
  await assert.rejects(retireLegacyRuntime({ captured, deadlineMs: 5000 }, f.io), /CUTOVER_/);
  assert.deepEqual(f.events, []);
});

test('unknown timeout and restart policies stay blocked instead of being silently normalized', async () => {
  for (const bad of [
    { killTimeoutMs: null },
    { killTimeoutMs: 660001 },
    { killTimeoutMs: 0 },
    { memoryRestart: 536870912 },
    { cron: '0 * * * *' },
    { watch: true },
  ]) {
    const f = fixture();
    const p = { ...target, managerIdentity: { ...manager, ...bad } };
    f.inventory.processes = [p];
    f.inventory.managers = [{ ...p.managerIdentity, status: 'online', rootPid: p.pid }];
    await assert.rejects(
      captureLegacyRuntime({ inventory: f.inventory, approvedTargets: [p] }, f.io),
      /CUTOVER_/,
    );
    assert.deepEqual(f.events, []);
  }
});

function gatewayTreeFixture() {
  const f = fixture();
  const cwd = '/opt/holaday-cn-payment/releases/604ddf17e84a-20260827133820/apps/cn-payment';
  const m = { ...manager, exe: '/usr/bin/node', name: 'holaday-cn-payment', pmId: 1 };
  const executables = [
    '/usr/bin/node',
    '/usr/bin/dash',
    '/usr/bin/node',
    '/usr/bin/node',
    '/opt/holaday-cn-payment/releases/604ddf17e84a-20260827133820/node_modules/.pnpm/@esbuild+linux-x64@0.27.7/node_modules/@esbuild/linux-x64/bin/esbuild',
  ];
  const tree = executables.map((exe, i) => ({
    ...target,
    host: 'aliyun',
    pid: 100 + i,
    ppid: i ? 99 + i : 50,
    start: String(300 + i),
    exe,
    cwd,
    role: 'gateway',
    uids: [0, 0, 0, 0],
    managerIdentity: { ...m },
  }));
  Object.assign(f.inventory, {
    host: 'aliyun',
    processes: tree,
    managers: [{ ...m, status: 'online', rootPid: 100 }],
    ports: [4010],
    listeners: [{ port: 4010, pid: 103 }],
  });
  return { ...f, tree };
}

test('audited root gateway Node-shell-esbuild tree is captured whole and stopped by one PM2 id', async () => {
  const f = gatewayTreeFixture();
  const captured = await captureLegacyRuntime(
    { inventory: f.inventory, approvedTargets: f.tree },
    f.io,
  );
  assert.equal(captured.targets.length, 5);
  const calls = [];
  await createLegacyRuntimeEffects(f.io, {
    platform: 'linux',
    uid: 0,
    exec: async (...args) => calls.push(args),
  }).pm2Stop(f.tree[0], f.tree);
  assert.deepEqual(calls[0].slice(0, 2), ['pm2', ['stop', '1', '--watch']]);
  await retireLegacyRuntime({ captured, deadlineMs: 5000 }, f.io);
  assert.deepEqual(f.events, [['pm2', 100, 1]]);
});

test('root gateway exceptions never include another release, app, uid mix or executable', async () => {
  for (const change of [
    (tree) => {
      tree[4].exe = tree[4].exe.replace('604ddf17e84a', 'aaaaaaaaaaaa');
    },
    (tree) => {
      tree[1].exe = '/usr/bin/bash';
    },
    (tree) => {
      tree[3].cwd = '/opt/holaday-monorepo/apps/orchestrator';
    },
    (tree) => {
      tree[3].uids = [0, 998, 0, 0];
    },
    (tree) => {
      tree[3].role = 'worker';
    },
    (tree) => {
      tree[3].cwd = tree[3].cwd.replace('604ddf17e84a', 'aaaaaaaaaaaa');
    },
    (tree) => {
      for (const p of tree) p.managerIdentity.name = 'unrelated';
    },
    (tree) => {
      tree[0].exe = '/usr/bin/dash';
    },
    (tree) => {
      tree[3].ppid = 999;
    },
  ]) {
    const f = gatewayTreeFixture();
    change(f.tree);
    f.inventory.managers[0] = { ...f.tree[0].managerIdentity, status: 'online', rootPid: 100 };
    await assert.rejects(
      captureLegacyRuntime({ inventory: f.inventory, approvedTargets: f.tree }, f.io),
      /CUTOVER_/,
    );
    assert.deepEqual(f.events, []);
  }
});

test('unmanaged root gateway stays restricted to system Node and exact release application path', async () => {
  const f = gatewayTreeFixture();
  const p = { ...f.tree[0], ppid: 1, managerIdentity: { kind: 'unmanaged' } };
  f.inventory.processes = [p];
  f.inventory.managers = [];
  f.inventory.listeners = [{ pid: p.pid, port: 4010 }];
  const captured = await captureLegacyRuntime(
    { inventory: f.inventory, approvedTargets: [p] },
    f.io,
  );
  const calls = [];
  await createLegacyRuntimeEffects(f.io, {
    platform: 'linux',
    uid: 0,
    exec: async (...args) => calls.push(args),
  }).signalPinned(p);
  assert.deepEqual(JSON.parse(calls[0][2].input), p);
  await retireLegacyRuntime({ captured, deadlineMs: 5000 }, f.io);
  assert.deepEqual(f.events, [['pidfd', 100]]);
  for (const change of [{ exe: '/usr/bin/dash' }, { cwd: p.cwd.replace('/apps/cn-payment', '') }]) {
    const invalid = { ...p, ...change };
    f.inventory.processes = [invalid];
    await assert.rejects(
      captureLegacyRuntime({ inventory: f.inventory, approvedTargets: [invalid] }, f.io),
      /CUTOVER_/,
    );
  }
});

test('a managed root gateway cannot mix the older UID998 profile into its approved tree', async () => {
  const f = gatewayTreeFixture();
  f.tree[3].uids = [998, 998, 998, 998];
  f.tree[3].exe = '/opt/node22/bin/node';
  // Keep a leaf so no other child's ancestry check hides the mixed-profile defect.
  f.tree.pop();
  await assert.rejects(
    captureLegacyRuntime({ inventory: f.inventory, approvedTargets: f.tree }, f.io),
    /CUTOVER_/,
  );
  assert.deepEqual(f.events, []);
});

test('command boundary independently refuses an orphan in an otherwise matching gateway tree', async () => {
  const f = gatewayTreeFixture();
  f.tree[4].ppid = 999;
  let calls = 0;
  await assert.rejects(
    createLegacyRuntimeEffects(f.io, {
      platform: 'linux',
      uid: 0,
      exec: async () => {
        calls++;
      },
    }).pm2Stop(f.tree[0], f.tree),
    /CUTOVER_/,
  );
  assert.equal(calls, 0);
});

for (const [field, value] of [
  ['pid', 101],
  ['start', '301'],
  ['uids', [998, 0, 998, 998]],
  ['exe', '/tmp/node'],
  ['cwd', '/opt/other'],
  ['argvDigest', 'f'.repeat(64)],
  ['bootId', 'f'.repeat(32)],
  ['managerIdentity', { ...manager, pmId: 3 }],
]) {
  test(`changed ${field} refuses before any stop`, async () => {
    const f = fixture();
    const captured = await capture(f);
    f.inventory.processes[0][field] = value;
    await assert.rejects(retireLegacyRuntime({ captured, deadlineMs: 5000 }, f.io), /CUTOVER_/);
    assert.deepEqual(f.events, []);
  });
}

test('unknown process, orphan child or launcher cannot disappear from approval scope', async () => {
  for (const change of [
    (f) => f.inventory.processes.push({ ...target, pid: 101, ppid: 1 }),
    (f) => f.inventory.unknownLaunchers.push('unmapped-systemd'),
    (f) => {
      f.inventory.managers[0].cron = '* * * * *';
    },
  ]) {
    const f = fixture();
    change(f);
    await assert.rejects(capture(f), /CUTOVER_/);
    assert.deepEqual(f.events, []);
  }
});

test('busy work, invalid fence or lost journal prevents stop', async () => {
  for (const bad of [
    { unsettledWork: 1 },
    { externalWork: 1 },
    { producersRunning: 1 },
    { stage: 'orders' },
    { inventoryDigest: '0'.repeat(64) },
  ]) {
    const f = fixture();
    const captured = await capture(f);
    const verify = f.io.verifyFence;
    f.io.verifyFence = async () => ({ ...(await verify()), ...bad });
    await assert.rejects(retireLegacyRuntime({ captured, deadlineMs: 5000 }, f.io), /CUTOVER_/);
    assert.deepEqual(f.events, []);
  }
  const f = fixture();
  const captured = await capture(f);
  f.io.assertJournalOwnership = async () => {
    throw new Error('lost-lock');
  };
  await assert.rejects(retireLegacyRuntime({ captured, deadlineMs: 5000 }, f.io));
  assert.deepEqual(f.events, []);
});

test('original survivor times out, and a respawn is never signalled a second time', async () => {
  for (const respawn of [false, true]) {
    const f = fixture();
    const captured = await capture(f);
    f.io.pm2Stop = async () => {
      f.events.push('stop');
      if (respawn) f.inventory.processes[0].start = '500';
    };
    await assert.rejects(retireLegacyRuntime({ captured, deadlineMs: 5000 }, f.io), /CUTOVER_/);
    assert.deepEqual(f.events, ['stop']);
  }
});

test('remaining port owner or manager still online prevents stopped receipt', async () => {
  for (const which of ['port', 'manager']) {
    const f = fixture();
    const captured = await capture(f);
    f.io.pm2Stop = async () => {
      f.inventory.processes = [];
      if (which === 'manager') f.inventory.listeners = [];
      else {
        f.inventory.managers[0].status = 'stopped';
        f.inventory.managers[0].rootPid = 0;
      }
    };
    await assert.rejects(retireLegacyRuntime({ captured, deadlineMs: 5000 }, f.io), /CUTOVER_/);
  }
});

test('unmanaged gateway uses pinned TERM, not PM2 or main identity', async () => {
  const f = fixture();
  const gateway = {
    ...target,
    ppid: 1,
    role: 'gateway',
    cwd: '/opt/holaday-cn-payment/releases/083a6232aca7-20260804125641',
    managerIdentity: { kind: 'unmanaged' },
  };
  f.inventory.processes = [gateway];
  f.inventory.managers = [];
  const captured = await captureLegacyRuntime(
    { inventory: f.inventory, approvedTargets: [gateway] },
    f.io,
  );
  await retireLegacyRuntime({ captured, deadlineMs: 5000 }, f.io);
  assert.deepEqual(f.events, [['pidfd', 100]]);
});

test('first-cutover never relaxes normal runtime proof', async () => {
  await assert.rejects(
    retireMaintenanceRuntime({
      identity: { candidate: 'a'.repeat(40), bootId: 'b'.repeat(32) },
      main: {
        pid: 100,
        start: '123',
        uid: 998,
        command: 'main',
        autorestart: false,
        cwd: '/opt/holaday-monorepo/apps/orchestrator',
      },
      effects: {},
      deadlineMs: 1000,
    }),
    /MAINTENANCE_STOP_INPUT/,
  );
});

async function stateFixture(t) {
  const root = await fs.realpath(await fs.mkdtemp(join(tmpdir(), 'holaday-first-state-')));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const base = '/var/lib/holaday';
  const path = (p) =>
    p === base || p.startsWith(`${base}/`)
      ? root + p.slice(base.length)
      : (() => {
          throw new Error('unexpected path');
        })();
  const changes = [];
  let seed;
  const io = {
    platform: 'linux',
    uid: 0,
    applicationGid: 998,
    now: () => 1000,
    assertJournalOwnership: async () => ({
      candidate: 'c'.repeat(40),
      attempt: '11111111-1111-4111-8111-111111111111',
      inventoryDigest: digest,
    }),
    assertStopped: async () => ({
      inventoryDigest: digest,
      observedAtMs: 1000,
      phase: 'stopped',
      survivors: [],
      listeners: [],
      unknownLaunchers: [],
    }),
    verifyFence: async () => ({
      inventoryDigest: digest,
      stage: 'all-writers',
      unsettledWork: 0,
      externalWork: 0,
      producersRunning: 0,
    }),
    recordBootstrap: async (value) => {
      seed = value;
      changes.push('journal');
    },
    fs: {
      ...fs,
      realpath: async (p) => (await fs.realpath(path(p))).replace(root, base),
      lstat: async (p) => Object.assign(await fs.lstat(path(p)), { uid: 998 }),
      mkdir: async (p, options) => {
        changes.push('mkdir');
        return fs.mkdir(path(p), options);
      },
      chown: async (p, uid, gid) => {
        changes.push(['chown', p, uid, gid]);
      },
      open: async (p, flags, mode) => {
        const handle = await fs.open(path(p), flags, mode);
        handle.chown = async (uid, gid) => {
          changes.push(['file-chown', uid, gid]);
        };
        return handle;
      },
    },
  };
  const input = {
    candidate: 'c'.repeat(40),
    attempt: '11111111-1111-4111-8111-111111111111',
    stoppedEvidence: { inventoryDigest: digest, observedAtMs: 1000, phase: 'stopped' },
  };
  return { io, input, root, changes, seed: () => seed };
}

test('first state is canonical closed state; seed is journaled before any filesystem creation', async (t) => {
  const f = await stateFixture(t);
  const result = await initializeFirstMaintenanceState(f.input, f.io);
  assert.match(result.bootstrapSeed, /^[a-f0-9]{32}$/);
  assert.equal(result.bootstrapSeed, f.seed());
  assert.deepEqual(f.changes.slice(0, 2), ['journal', 'mkdir']);
  const directory = join(f.root, 'ordinary-maintenance');
  assert.equal((await fs.stat(directory)).mode & 0o777, 0o700);
  assert.equal((await fs.stat(join(directory, 'state.json'))).mode & 0o777, 0o600);
  assert.equal(
    await fs.readFile(join(directory, 'state.json'), 'utf8'),
    `{"schemaVersion":1,"candidate":"${f.input.candidate}","bootId":"${result.bootstrapSeed}","mode":"closed","needsReconciliation":false}\n`,
  );
  assert(f.changes.some((x) => Array.isArray(x) && x[0] === 'file-chown' && x[1] === 998));
});

test('existing or half-written state directory is never overwritten', async (t) => {
  const f = await stateFixture(t);
  const directory = join(f.root, 'ordinary-maintenance');
  await fs.mkdir(directory, { mode: 0o700 });
  await fs.writeFile(join(directory, 'writer.lock'), 'uncertain');
  await assert.rejects(initializeFirstMaintenanceState(f.input, f.io), /CUTOVER_STATE_/);
  assert.deepEqual(f.changes, []);
  assert.equal(await fs.readFile(join(directory, 'writer.lock'), 'utf8'), 'uncertain');
});

test('stale stop proof, resumed writer or foreign journal prevents state creation', async (t) => {
  for (const kind of ['stale', 'live', 'journal', 'fence']) {
    const f = await stateFixture(t);
    if (kind === 'stale') f.input.stoppedEvidence.observedAtMs = -100000;
    if (kind === 'live') f.io.assertStopped = async () => ({ survivors: [100] });
    if (kind === 'journal') f.io.assertJournalOwnership = async () => ({ attempt: 'foreign' });
    if (kind === 'fence') f.io.verifyFence = async () => ({ stage: 'orders' });
    await assert.rejects(initializeFirstMaintenanceState(f.input, f.io), /CUTOVER_STATE_/);
    assert.deepEqual(await fs.readdir(f.root), []);
  }
});

test('failed state write leaves unmistakable incomplete directory and never permits retry overwrite', async (t) => {
  const f = await stateFixture(t);
  const open = f.io.fs.open;
  f.io.fs.open = async (p, ...args) => {
    if (p.endsWith('state.json')) throw new Error('disk-full');
    return open(p, ...args);
  };
  await assert.rejects(initializeFirstMaintenanceState(f.input, f.io), /CUTOVER_STATE_/);
  assert.deepEqual(await fs.readdir(join(f.root, 'ordinary-maintenance')), []);
  f.io.fs.open = open;
  await assert.rejects(initializeFirstMaintenanceState(f.input, f.io), /CUTOVER_STATE_/);
});

test('real command boundary uses fixed PM2 argv for exactly one observed id', async () => {
  const f = fixture();
  const calls = [];
  const effects = createLegacyRuntimeEffects(f.io, {
    platform: 'linux',
    uid: 0,
    exec: async (command, args, options) => {
      calls.push({ command, args, options });
      return '';
    },
  });
  await effects.pm2Stop(target);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, 'pm2');
  assert.deepEqual(calls[0].args, ['stop', '2', '--watch']);
  assert.equal(calls[0].options.env.PM2_HOME, '/root/.pm2');
  assert.equal(calls[0].options.env.PATH, '/opt/node22/bin:/usr/local/bin:/usr/bin:/bin');
  assert.equal(calls[0].options.env.DASHSCOPE_API_KEY, undefined);
});

test('command boundary rechecks tree after earlier runtime checks and sanitizes errors', async () => {
  const f = fixture();
  let calls = 0;
  const effects = createLegacyRuntimeEffects(f.io, {
    platform: 'linux',
    uid: 0,
    exec: async () => {
      calls++;
      throw new Error('secret command output');
    },
  });
  f.inventory.processes.push({ ...target, pid: 101, ppid: 100 });
  await assert.rejects(effects.pm2Stop(target, [target]), /CUTOVER_/);
  assert.equal(calls, 0);
  f.inventory.processes.pop();
  await assert.rejects(effects.pm2Stop(target), { message: 'CUTOVER_STOP_UNCERTAIN' });
  assert.equal(calls, 1);
});

test('unmanaged command target is JSON stdin, never a shell argument or PM2 stop', async () => {
  const f = fixture();
  const calls = [];
  const p = { ...target, ppid: 1, managerIdentity: { kind: 'unmanaged' } };
  f.inventory.processes = [p];
  f.inventory.managers = [];
  const effects = createLegacyRuntimeEffects(f.io, {
    platform: 'linux',
    uid: 0,
    exec: async (...args) => {
      calls.push(args);
      return '';
    },
  });
  await effects.signalPinned(p);
  assert.equal(calls[0][0], '/usr/bin/python3');
  assert.equal(calls[0][1].at(-1), '--stdin');
  assert.deepEqual(JSON.parse(calls[0][2].input), p);
});

async function oldBrowserAssociationFixture() {
  const f = await ownedDisplayFixture();
  const handler = '/opt/brave.com/brave/chrome_crashpad_handler';
  const directories = new Map();
  const handlerRows = [];
  const addHandler = (pid, fd, inode, peerPid, peerFd, peerInode) => {
    const cmd = `${handler}\0--initial-client-fd=${fd}\0`;
    const p = {
      ...f.census.processes.find((p) => p.pid === 46),
      pid,
      ppid: 1,
      start: String(pid * 10),
      exe: handler,
      argvDigest: f.sha(cmd),
    };
    f.census.processes.push(p);
    f.add(`/proc/${pid}/cmdline`, cmd);
    f.namespaces.set(`/proc/${pid}/exe`, handler);
    f.namespaces.set(`/proc/${pid}/fd/${fd}`, `socket:[${inode}]`);
    f.namespaces.set(`/proc/${peerPid}/fd/${peerFd}`, `socket:[${peerInode}]`);
    directories.set(pid, [String(fd)]);
    handlerRows.push(
      `u_str ESTAB 0 0 * ${inode} * ${peerInode} users:(("handler",pid=${pid},fd=${fd}))`,
      `u_str ESTAB 0 0 * ${peerInode} * ${inode} users:(("peer",pid=${peerPid},fd=${peerFd}))`,
    );
    return p;
  };
  addHandler(47, 6, '300', 46, 10, '400');
  addHandler(48, 4, '301', 47, 3, '401');
  directories.get(47).push('3');
  for (const fd of [0, 1, 2])
    f.namespaces.set(`/proc/42/fd/${fd}`, fd === 0 ? '/dev/null' : `pipe:[${fd + 10}]`);
  const readdir = f.io.readdir;
  f.io.readdir = async (path) => {
    const match = /^\/proc\/(\d+)\/fd$/.exec(path);
    return match ? [...(directories.get(Number(match[1])) ?? [])] : readdir(path);
  };
  f.setUnix(() => `${f.sockets()}${handlerRows.join('\n')}\n`);
  const displayObservation = await firstRuntime.readFirstCutoverCloudOwnedDisplay(f.request, f.io);
  return {
    ...f,
    handler,
    directories,
    handlerRows,
    addHandler,
    request: { sources: f.sources, displayObservation, maintenanceEndsAtMs: 15000 },
  };
}
test('old browser association observes primary and secondary orphan IPC without profile argv ownership', async () => {
  const f = await oldBrowserAssociationFixture();
  assert.equal(typeof firstRuntime.readFirstCutoverCloudOldBrowserAssociations, 'function');
  const result = await firstRuntime.readFirstCutoverCloudOldBrowserAssociations(f.request, f.io);
  assert.equal(result.purpose, 'cloud-old-browser-association-observation');
  assert.deepEqual(
    result.members.map((p) => p.pid),
    [47, 48],
  );
  assert(result.members.every((p) => p.ppid === 1));
  assert.match(result.socketDigest, /^[a-f0-9]{64}$/);
  assert.equal(result.displayObservationDigest, f.sha(f.request.displayObservation));
  assert.equal(Object.hasOwn(result, 'stopAuthorized'), false);
  assert.equal(JSON.stringify(result).includes('initial-client-fd'), false);
});
for (const fault of [
  'extra',
  'expired',
  'wrong-display',
  'wrong-sources',
  'census-drift',
  'initial-fd',
  'missing-peer',
  'foreign-primary-peer',
  'mixed-primary-peer',
  'foreign-secondary-peer',
  'extra-foreign-socket',
  'changed-loaded-image',
]) {
  test(`old browser association refuses ${fault}`, async () => {
    const f = await oldBrowserAssociationFixture();
    if (fault === 'extra') f.request.ready = true;
    if (fault === 'expired') f.request.maintenanceEndsAtMs = 1000;
    if (fault === 'wrong-display') f.request.displayObservation.purpose = 'ready';
    if (fault === 'wrong-sources') f.request.displayObservation.sourcesDigest = 'f'.repeat(64);
    if (fault === 'census-drift') f.census.processes.find((p) => p.pid === 47).start = '999';
    if (fault === 'initial-fd') f.namespaces.set('/proc/47/fd/6', 'socket:[999]');
    if (fault === 'missing-peer') f.handlerRows.splice(1, 1);
    if (fault === 'foreign-primary-peer') {
      f.handlerRows[1] = f.handlerRows[1].replace('pid=46,fd=10', 'pid=99,fd=10');
      f.namespaces.set('/proc/99/fd/10', 'socket:[400]');
    }
    if (fault === 'mixed-primary-peer') {
      f.handlerRows[1] = f.handlerRows[1].replace('))', '),("foreign",pid=99,fd=10))');
      f.namespaces.set('/proc/99/fd/10', 'socket:[400]');
    }
    if (fault === 'foreign-secondary-peer') {
      f.handlerRows[3] = f.handlerRows[3].replace('pid=47,fd=3', 'pid=99,fd=3');
      f.namespaces.set('/proc/99/fd/3', 'socket:[401]');
    }
    if (fault === 'extra-foreign-socket') {
      f.directories.get(47).push('8');
      f.namespaces.set('/proc/47/fd/8', 'socket:[302]');
      f.namespaces.set('/proc/99/fd/11', 'socket:[402]');
      f.handlerRows.push(
        'u_str ESTAB 0 0 * 302 * 402 users:(("handler",pid=47,fd=8))',
        'u_str ESTAB 0 0 * 402 * 302 users:(("foreign",pid=99,fd=11))',
      );
    }
    if (fault === 'changed-loaded-image') {
      const stat = f.io.stat;
      f.io.stat = async (path) => {
        const s = await stat(path);
        return path === '/proc/47/exe' ? { ...s, ino: s.ino + 1 } : s;
      };
    }
    await assert.rejects(
      firstRuntime.readFirstCutoverCloudOldBrowserAssociations(f.request, f.io),
      /CUTOVER_CLOUD_OLD_BROWSER_ASSOCIATION_UNPROVEN/,
    );
  });
}

async function refreshAssociationDisplay(f) {
  f.request.displayObservation = await firstRuntime.readFirstCutoverCloudOwnedDisplay(
    { sources: f.sources, maintenanceEndsAtMs: 15000 },
    f.io,
  );
}
test('old browser association leaves an independently connected unrelated handler outside admitted members', async () => {
  const f = await oldBrowserAssociationFixture();
  f.addHandler(49, 6, '303', 99, 12, '403');
  await refreshAssociationDisplay(f);
  const result = await firstRuntime.readFirstCutoverCloudOldBrowserAssociations(f.request, f.io);
  assert.deepEqual(
    result.members.map((p) => p.pid),
    [47, 48],
  );
});
for (const mode of ['exact', 'wrong-root-fd', 'foreign-daemon-peer']) {
  test(`old browser association admits only exact inherited PM2 stdio ${mode}`, async () => {
    const f = await oldBrowserAssociationFixture();
    f.directories.get(47).push('1');
    f.namespaces.set('/proc/47/fd/1', 'socket:[500]');
    f.namespaces.set('/proc/42/fd/1', 'socket:[500]');
    f.namespaces.set('/proc/40/fd/9', 'socket:[600]');
    f.handlerRows.push(
      'u_str ESTAB 0 0 * 500 * 600 users:(("handler",pid=47,fd=1),("root",pid=42,fd=1))',
      'u_str ESTAB 0 0 * 600 * 500 users:(("PM2",pid=40,fd=9))',
    );
    if (mode === 'wrong-root-fd') f.namespaces.set('/proc/42/fd/1', 'pipe:[11]');
    if (mode === 'foreign-daemon-peer') {
      f.namespaces.set('/proc/99/fd/9', 'socket:[600]');
      f.handlerRows[5] = f.handlerRows[5].replace('pid=40,fd=9', 'pid=99,fd=9');
    }
    if (mode === 'exact')
      assert.deepEqual(
        (
          await firstRuntime.readFirstCutoverCloudOldBrowserAssociations(f.request, f.io)
        ).members.map((p) => p.pid),
        [47, 48],
      );
    else
      await assert.rejects(
        firstRuntime.readFirstCutoverCloudOldBrowserAssociations(f.request, f.io),
        /CUTOVER_CLOUD_OLD_BROWSER_ASSOCIATION_UNPROVEN/,
      );
  });
}
for (const fault of [
  'deleted-loaded-handlers',
  'uid',
  'namespace',
  'cgroup',
  'outside-parent',
  'source-bytes',
  'manager-drift',
  'closing-manager-drift',
  'closing-census-time',
  'closing-census-pid',
  'closing-fd-drift',
  'monotonic-nan',
]) {
  test(`old browser association refuses retained identity boundary ${fault}`, async () => {
    const f = await oldBrowserAssociationFixture();
    if (fault === 'deleted-loaded-handlers') {
      for (const pid of [47, 48]) {
        f.census.processes.find((p) => p.pid === pid).exe = `${f.handler} (deleted)`;
        f.namespaces.set(`/proc/${pid}/exe`, `${f.handler} (deleted)`);
      }
      await refreshAssociationDisplay(f);
    }
    if (['uid', 'namespace', 'cgroup', 'outside-parent'].includes(fault)) {
      const p = f.census.processes.find((p) => p.pid === 47);
      if (fault === 'uid') p.uids = [998, 998, 998, 998];
      if (fault === 'namespace') p.mountNamespace = 'mnt:[99]';
      if (fault === 'cgroup') p.cgroup = '0::/other';
      if (fault === 'outside-parent') p.ppid = 99;
      await refreshAssociationDisplay(f);
    }
    if (fault === 'source-bytes') f.data.set(f.handler, Buffer.from('changed public source'));
    if (fault === 'manager-drift') f.rows[1].pm2_env.restart_time++;
    if (fault === 'closing-manager-drift') {
      const rpc = f.io.rpc;
      let calls = 0;
      f.io.rpc = async (...args) => {
        if (++calls === 2) f.rows[1].pm2_env.restart_time++;
        return rpc(...args);
      };
    }
    if (fault === 'closing-census-time' || fault === 'closing-census-pid') {
      const read = f.io.readCensus;
      let calls = 0;
      f.io.readCensus = async () => {
        const c = await read();
        if (++calls === 2) {
          if (fault === 'closing-census-time') c.observedAtMs = 'not-time';
          else c.processes.find((p) => p.pid === 47).start = '999';
        }
        return c;
      };
    }
    if (fault === 'closing-fd-drift') {
      const readdir = f.io.readdir;
      let calls = 0;
      f.io.readdir = async (path) => {
        if (path === '/proc/47/fd' && ++calls === 2)
          f.namespaces.set('/proc/47/fd/6', 'socket:[999]');
        return readdir(path);
      };
    }
    if (fault === 'monotonic-nan') f.io.monotonic = () => Number.NaN;
    await assert.rejects(
      firstRuntime.readFirstCutoverCloudOldBrowserAssociations(f.request, f.io),
      /CUTOVER_CLOUD_OLD_BROWSER_ASSOCIATION_UNPROVEN/,
    );
  });
}

test('old browser association accepts reciprocal sequenced packets and binds their type', async () => {
  const f = await oldBrowserAssociationFixture();
  const stream = await firstRuntime.readFirstCutoverCloudOldBrowserAssociations(f.request, f.io);
  f.handlerRows.splice(
    0,
    f.handlerRows.length,
    ...f.handlerRows.map((r) => r.replace('u_str ', 'u_seq ')),
  );
  const sequenced = await firstRuntime.readFirstCutoverCloudOldBrowserAssociations(f.request, f.io);
  assert.deepEqual(sequenced.members, stream.members);
  assert.notEqual(sequenced.socketDigest, stream.socketDigest);
});
for (const fault of ['mixed-peer-type', 'datagram', 'unconnected', 'type-drift']) {
  test(`old browser association refuses socket ${fault}`, async () => {
    const f = await oldBrowserAssociationFixture();
    const seq = f.handlerRows.map((r) => r.replace('u_str ', 'u_seq '));
    if (fault === 'mixed-peer-type') seq[0] = seq[0].replace('u_seq ', 'u_str ');
    if (fault === 'datagram')
      seq.splice(0, seq.length, ...seq.map((r) => r.replace('u_seq ', 'u_dgr ')));
    if (fault === 'unconnected') seq[0] = seq[0].replace('ESTAB', 'UNCONN');
    let calls = 0;
    f.setUnix(
      () =>
        `${f.sockets()}${(fault === 'type-drift' && ++calls > 1 ? f.handlerRows : seq).join('\n')}\n`,
    );
    await assert.rejects(
      firstRuntime.readFirstCutoverCloudOldBrowserAssociations(f.request, f.io),
      /^Error: CUTOVER_CLOUD_OLD_BROWSER_ASSOCIATION_UNPROVEN$/,
    );
  });
}

for (const fault of [
  'valid',
  'replayed-census',
  'forged-anchor',
  'new-root',
  'source-config',
  'namespace',
  'unknown-member',
]) {
  test(`fresh native reobservation keeps the historical anchor and refuses ${fault}`, async () => {
    const f = cloudNativeRecoveryFixture();
    const origin = await firstRuntime.readFirstCutoverCloudRecovery(f.input, f.io);
    const historical = structuredClone(origin);
    let time = 70000;
    f.io.now = () => time;
    f.current.observedAtMs = time;
    const baseRead = f.io.readFile;
    // This clock moves only the actual new reads, never the anchor timestamp.
    f.io.readFile = async (...args) => baseRead(...args);
    if (fault === 'replayed-census') f.current.observedAtMs = 1000;
    if (fault === 'forged-anchor') origin.pid = 41;
    if (fault === 'new-root') f.current.processes.find((p) => p.pid === 40).start = '9999';
    if (fault === 'namespace')
      f.current.processes.find((p) => p.pid === 40).mountNamespace = 'mnt:[8]';
    if (fault === 'source-config') f.manager.pm2_env.restart_time++;
    if (fault === 'unknown-member')
      f.current.processes.push({
        ...f.current.processes.find((p) => p.pid === 41),
        pid: 80,
        exe: '/bin/sleep',
      });
    if (fault !== 'valid')
      await assert.rejects(
        firstRuntime.reobserveFirstCutoverCloudRecovery(f.input, origin, f.io),
        /CUTOVER_CLOUD_RECOVERY_UNPROVEN/,
      );
    else {
      const observation = await firstRuntime.reobserveFirstCutoverCloudRecovery(
        f.input,
        origin,
        f.io,
      );
      assert.equal(observation.pid, historical.pid);
      assert.equal(observation.observedAtMs, time);
      assert.deepEqual(origin, historical);
    }
  });
}

for (const fault of ['valid', 'stale-current', 'drift-root', 'anchor-replay', 'untrusted-member']) {
  test(`VNC fresh native reobservation refuses ${fault} after the origin expires`, async () => {
    const f = await vncNativeObservationFixture();
    const origin = await firstRuntime.readFirstCutoverCloudRecovery(f.input, f.io);
    const historical = structuredClone(origin);
    f.setNow(70000);
    f.current.observedAtMs = 70000;
    f.input.sources = await firstRuntime.readFirstCutoverCloudRecoverySources(
      {
        attempt: f.input.attempt,
        configs: f.managers.map((r) => ({ name: r.name, pmId: r.pm_id, config: r.pm2_env })),
      },
      f.io,
    );
    if (fault === 'stale-current') f.current.observedAtMs = 1200;
    if (fault === 'drift-root') f.current.processes.find((p) => p.pid === origin.pid).start = '999';
    if (fault === 'anchor-replay') origin.beforeCensusDigest = 'a'.repeat(64);
    if (fault === 'untrusted-member')
      f.current.processes.push({
        ...f.current.processes.at(-1),
        pid: 99,
        ppid: origin.pid,
        exe: '/bin/sleep',
      });
    if (fault !== 'valid')
      await assert.rejects(
        firstRuntime.reobserveFirstCutoverCloudRecovery(f.input, origin, f.io),
        /CUTOVER_CLOUD_RECOVERY_UNPROVEN/,
      );
    else {
      const fresh = await firstRuntime.reobserveFirstCutoverCloudRecovery(f.input, origin, f.io);
      assert.equal(fresh.observedAtMs, 70000);
      assert.deepEqual(origin, historical);
    }
  });
}

test('runtime first-only work boundary retains exact ten unknown outcomes and refuses ordinary or changed declarations', () => {
  const input = interruptionWork();
  input.approval.exactLegacyNavigationDeferral = {
    approvalRef: 'exact-legacy-navigation-deferral-20261002',
    sourceResultSha256: '653d441102e3ef314816d94165dea9daf633d01d0923c36e7d31bc7d589ed727',
    setFingerprint: '192900b8bbd82d0456952f07f66cffe145f7131e738ab1c74f97ee327205f446',
    noAutomaticReplay: true,
  };
  const retained = [
    '029963afa7b27f4fc0ec9e7289aebc636c8b890c7672c733931d6cddd19dae18',
    '13df21db0a1a7fb34d60940fdca443533798a782331109f6e92524f183d06779',
    '16a0d3cd0c433214a3b768a4ffc562571681322fe1e6fafa44d6ab6088097a15',
    '3b82a649a25a426a20bcd94834b12de2803a556b4c39e662e0eaedb7e4e8747e',
    '43dfb2616214e972bd20abdd6567e05771addc8e6bf1a1d83d94544a0f4ce6ea',
    '93f0b00043eec228c8c066d7c86a4d4f623caf874b6109be24b409fa899c6e04',
    'abb03cb495fbe99ff332a2efdc0b5fd6fa75ee2d4c767dae4d7c0cc9e4a3792c',
    'c14af57146be89e84c250d9e250f9ff9d50fe5b9cdf57f05ba18ac074bc8d8bf',
    'd00f2b41837dced30a1d45ae9c8c43743521ec61e7a23b898ecab9ee78067ca7',
    'e5d3f7f2bc421528e90d34b1d4d823cd8e2895c105c5498f372c89a0e3051fd7',
  ].map((recordFingerprint) => ({
    table: 'task_steps',
    status: 'executing',
    recordFingerprint,
    approvalRef: input.approval.exactLegacyNavigationDeferral.approvalRef,
    outcome: 'unverified',
    automaticReplay: false,
  }));
  Object.assign(input.observation, {
    knownExternalWork: retained,
    deferredUnverifiedWork: retained,
    unresolvedWorkCount: 10,
    eligibleReplay: 0,
    pendingReplay: 10,
  });
  assert.equal(firstRuntime.validateLegacyWorkBoundary(input).mode, 'controlled-interruption');
  const missing = structuredClone(input);
  delete missing.observation.deferredUnverifiedWork;
  assert.throws(() => firstRuntime.validateLegacyWorkBoundary(missing));
  const ordinary = structuredClone(input);
  ordinary.approval.schemaVersion = 1;
  assert.throws(() => firstRuntime.validateLegacyWorkBoundary(ordinary));
  const changed = structuredClone(input);
  changed.approval.exactLegacyNavigationDeferral.sourceResultSha256 = '0'.repeat(64);
  assert.throws(() => firstRuntime.validateLegacyWorkBoundary(changed));
});
