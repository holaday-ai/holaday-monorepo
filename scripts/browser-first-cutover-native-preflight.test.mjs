import assert from 'node:assert/strict';
import test from 'node:test';

test('native recovery canary requires private namespace, actual capability drop and both selected roles', async () => {
  const m = await import('./browser-first-cutover-native-preflight.mjs');
  const probe = {
    schemaVersion: 1,
    purpose: 'cloud-recovery-native-preflight',
    parentMountNamespace: 'mnt:[1]',
    mountNamespace: 'mnt:[2]',
    uids: [0, 0, 0, 0],
    noNewPrivs: 1,
    capabilities: { CapInh: '0', CapPrm: '0', CapEff: '0', CapBnd: '0', CapAmb: '0' },
    python: '/usr/bin/python3.10',
    entry: 'websockify.websocketproxy:websockify_init',
    version: '0.10.0',
    modules: ['/usr/lib/python3/dist-packages/websockify/websocketproxy.py'],
    libraries: ['/usr/lib/aarch64-linux-gnu/libc.so.6'],
    roles: ['holaday-chromium-headed', 'holaday-vnc'],
    versionDigests: { 'holaday-chromium-headed': 'a'.repeat(64), 'holaday-vnc': 'b'.repeat(64) },
  };
  m.validateFirstCutoverNativeProbe(probe, 'mnt:[1]');
  const distro = structuredClone(probe);
  distro.modules.push('/etc/python3.10/sitecustomize.py');
  m.validateFirstCutoverNativeProbe(distro, 'mnt:[1]');
  for (const mutate of [
    (p) => (p.mountNamespace = 'mnt:[1]'),
    (p) => (p.capabilities.CapEff = '1'),
    (p) => (p.noNewPrivs = 0),
    (p) => (p.python = '/tmp/python'),
    (p) => p.roles.pop(),
    (p) => p.modules.push('/tmp/untrusted.py'),
    (p) => p.modules.push('/etc/other.py'),
  ]) {
    const bad = structuredClone(probe);
    mutate(bad);
    assert.throws(
      () => m.validateFirstCutoverNativeProbe(bad, 'mnt:[1]'),
      /CUTOVER_CLOUD_NATIVE_PREFLIGHT_UNPROVEN/,
    );
  }
});

for (const fault of [
  'valid',
  'empty-module',
  'lsm-unavailable',
  'lsm-permission',
  'lsm-mismatch',
  'daemon-cap',
  'source-drift',
  'deadline',
  'budget',
  'loaded-source-drift',
]) {
  test(`whole native preflight binds both roles and refuses ${fault} without launch fallback`, async () => {
    const { readFirstCutoverCloudNativePreflight } = await import(
      './browser-first-cutover-native-preflight.mjs'
    );
    let time = 1000,
      executions = 0,
      sourceReads = 0;
    const attempt = '12345678-1234-4234-8234-123456789abc';
    const sources = {
      hostname: 'qa',
      bootId: '11111111-1111-4111-8111-111111111111',
      observedAtMs: 1000,
      roles: [],
    };
    const vacancy = {
      contextDigest: 'a'.repeat(64),
      sourcesDigest: 'b'.repeat(64),
      observationDigest: 'c'.repeat(64),
    };
    const status =
      'Uid: 0 0 0 0\nGid: 0 0 0 0\nCapInh: 0\nCapPrm: 1\nCapEff: 1\nCapBnd: 1\nCapAmb: 0\nNoNewPrivs: 0\nSeccomp: 0\n';
    const probe = {
      schemaVersion: 1,
      purpose: 'cloud-recovery-native-preflight',
      parentMountNamespace: 'mnt:[1]',
      mountNamespace: 'mnt:[2]',
      uids: [0, 0, 0, 0],
      noNewPrivs: 1,
      capabilities: { CapInh: '0', CapPrm: '0', CapEff: '0', CapBnd: '0', CapAmb: '0' },
      python: '/usr/bin/python3.10',
      entry: 'websockify.websocketproxy:websockify_init',
      version: '0.10.0',
      modules: ['/usr/lib/python3/dist-packages/websockify/websocketproxy.py'],
      libraries: ['/usr/lib/aarch64-linux-gnu/libc.so.6'],
      roles: ['holaday-chromium-headed', 'holaday-vnc'],
      versionDigests: { 'holaday-chromium-headed': 'a'.repeat(64), 'holaday-vnc': 'b'.repeat(64) },
    };
    const lsm =
      fault === 'lsm-unavailable'
        ? { kind: 'unavailable', reason: 'EINVAL' }
        : { kind: 'observed', value: 'unconfined' };
    const missing = () => Object.assign(Error('missing'), { code: 'ENOENT' });
    const file = (path) => path.endsWith('.py') || path.endsWith('.so.6');
    const st = (path) => ({
      uid: 0,
      gid: 0,
      mode: file(path) ? 0o100600 : 0o40700,
      dev: 1,
      ino: 1,
      nlink: 1,
      size: file(path) ? (fault === 'empty-module' && path.endsWith('.py') ? 0 : 2) : 0,
      mtimeMs: fault === 'loaded-source-drift' && executions && path.endsWith('.py') ? 2 : 1,
      ctimeMs: 1,
      isFile: () => file(path),
      isDirectory: () => !file(path),
    });
    const io = {
      platform: 'linux',
      uid: 0,
      now: () => time,
      realpath: async (path) => path,
      lstat: async (path) => {
        if (path.endsWith('/package.json')) throw missing();
        return st(path);
      },
      open: async (path) => ({
        stat: async () => st(path),
        read: async (buffer, offset, length, position) => {
          const bytes = Buffer.from(
            fault === 'empty-module' && path.endsWith('.py') ? '' : 'qa',
          ).subarray(position, position + length);
          bytes.copy(buffer, offset);
          return { bytesRead: bytes.length };
        },
        close: async () => {},
      }),
      readlink: async () => 'mnt:[1]',
      readFile: async (path) => {
        if (path.endsWith('/attr/current')) {
          if (fault === 'lsm-permission') throw Object.assign(Error('denied'), { code: 'EACCES' });
          if (fault === 'lsm-unavailable')
            throw Object.assign(Error('unsupported'), { code: 'EINVAL' });
          return fault === 'lsm-mismatch' && path.includes('/10/') ? 'confined' : 'unconfined';
        }
        return fault === 'daemon-cap' && path.includes('/10/')
          ? status.replace('CapEff: 1', 'CapEff: 0')
          : status;
      },
      readSources: async () => {
        sourceReads++;
        return fault === 'source-drift' && sourceReads === 2
          ? { ...sources, hostname: 'drift' }
          : structuredClone(sources);
      },
      readContext: async () => ({
        sourcesDigest: vacancy.sourcesDigest,
        daemon: { pid: 10, contextDigest: vacancy.contextDigest, securityLabel: lsm },
      }),
      readManagers: async () =>
        [0, 1].map((i) => ({
          name: ['holaday-vnc', 'holaday-chromium-headed'][i],
          pm_id: i,
          pid: 0,
          pm2_env: { status: 'stopped' },
        })),
      exec: async (command, args, opts) => {
        executions++;
        assert.equal(command, '/usr/bin/unshare');
        assert(args.includes('/usr/bin/python3 -B') === false);
        assert.equal(opts.cwd, '/');
        assert.deepEqual(Object.keys(opts.env).sort(), [
          'HOME',
          'LC_ALL',
          'PATH',
          'PYTHONDONTWRITEBYTECODE',
        ]);
        assert(!args.some((a) => /pm2|user-data-dir|Xvfb/.test(a)));
        if (fault === 'deadline') time = 2000;
        if (fault === 'budget') time = 17000;
        return JSON.stringify(probe);
      },
    };
    const input = {
      attempt,
      sources,
      vacancy,
      maintenanceEndsAtMs: fault === 'deadline' ? 2000 : 100000,
    };
    if (['valid', 'empty-module', 'lsm-unavailable'].includes(fault))
      assert.equal(
        (await readFirstCutoverCloudNativePreflight(input, io)).purpose,
        'cloud-recovery-native-preflight-observation',
      );
    else
      await assert.rejects(
        readFirstCutoverCloudNativePreflight(input, io),
        /CUTOVER_CLOUD_NATIVE_PREFLIGHT_UNPROVEN/,
      );
    assert(executions <= 1, 'capability/load probe never retries');
    if (['lsm-permission', 'lsm-mismatch', 'daemon-cap'].includes(fault))
      assert.equal(executions, 0);
  });
}
