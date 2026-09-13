import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';

const candidate = 'a'.repeat(40);
const boot = 'b'.repeat(32);
const base = `/usr/local/lib/holaday-pool-broker/releases/${candidate}`;
const real = {
  open: fs.openSync,
  close: fs.closeSync,
  stat: fs.lstatSync,
  fstat: fs.fstatSync,
  dlopen: process.dlopen.bind(process),
};
const platform = process.platform;
const dispose: Array<() => void> = [];
afterEach(() => {
  vi.doUnmock('node:worker_threads');
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  for (const close of dispose.splice(0).reverse()) close();
});

async function fixture(nativeBundles = false) {
  vi.resetModules();
  // Vitest itself runs this test in a worker; the production loader refuses it.
  vi.doMock('node:worker_threads', () => ({ isMainThread: true }));
  const directory = fs.mkdtempSync(join(tmpdir(), 'loader-native-'));
  fs.chmodSync(directory, 0o755);
  dispose.push(() => fs.rmSync(directory, { recursive: true, force: true }));
  const release = join(directory, base.slice(1));
  fs.mkdirSync(release, { recursive: true, mode: 0o755 });
  const payloads: Record<string, Buffer> = {
    'egress-listener.node': Buffer.from('synthetic-loader-egress-artifact'),
    'control-connector.node': Buffer.from('synthetic-loader-control-artifact'),
  };
  for (const [name, bytes] of Object.entries(payloads))
    fs.writeFileSync(join(release, name), bytes, { mode: 0o644 });
  if (nativeBundles) {
    const sources = join(process.cwd(), '../../scripts/pool-broker');
    for (const [stem, artifact, macro] of [
      ['egress', 'egress-listener.node', 'HE_TEST_PATH'],
      ['control', 'control-connector.node', 'HC_TEST_PATH'],
    ] as const) {
      const output = join(release, artifact);
      execFileSync(
        '/usr/bin/clang',
        [
          '-std=c11',
          '-Wall',
          '-Wextra',
          '-Werror',
          '-bundle',
          '-undefined',
          'dynamic_lookup',
          '-I/usr/local/include/node',
          `-D${macro}=${JSON.stringify(join(directory, 'unused.sock'))}`,
          join(sources, `${stem}_native_core.c`),
          join(sources, `${stem}_native_napi.c`),
          join(sources, `tests-fixtures/${stem}_native_socket.c`),
          '-o',
          output,
        ],
        { timeout: 20000, maxBuffer: 65536 },
      );
      fs.chmodSync(output, 0o644);
      payloads[artifact] = fs.readFileSync(output);
    }
  }
  const bootstrap = fs.readFileSync(
    join(process.cwd(), '../../scripts/pool-broker/bootstrap.py'),
    'utf8',
  );
  const modules =
    bootstrap
      .match(/_MODULES = \(([\s\S]*?)\)\n_FILES/)?.[1]
      ?.match(/'[^']+'/g)
      ?.map((s) => `${s.slice(1, -1)}.py`) ?? [];
  const extras =
    bootstrap
      .match(/_FILES = [^\n]+\| \{([^\n]+)\}/)?.[1]
      ?.match(/'[^']+'/g)
      ?.map((s) => s.slice(1, -1)) ?? [];
  const files = Object.fromEntries(
    [...new Set([...modules, ...extras])].map((name) => [
      name,
      payloads[name] ? createHash('sha256').update(payloads[name]).digest('hex') : '1'.repeat(64),
    ]),
  );
  const tools = Object.fromEntries(
    [
      '/usr/bin/python3',
      '/usr/bin/setpriv',
      '/opt/node22/bin/node',
      '/usr/bin/busctl',
      '/usr/bin/Xvfb',
    ].map((name) => [name, { resolved: name, sha256: '1'.repeat(64) }]),
  );
  const manifest = {
    version: 1,
    status: 'linux-verified',
    candidate,
    architecture: 'x86_64',
    files,
    tools,
  };
  const manifestPath = join(release, 'native-build-manifest.json');
  const save = () => {
    const fd = real.open(manifestPath, 'w', 0o644);
    try {
      fs.writeSync(fd, JSON.stringify(manifest));
    } finally {
      real.close(fd);
    }
  };
  save();
  const owned = new Map<number, string>();
  const map = (value: fs.PathLike) => {
    const text = value.toString();
    const held = /^\/proc\/self\/fd\/(\d+)(.*)$/.exec(text);
    if (held) {
      const original = owned.get(Number(held[1]));
      if (!original) throw new Error('synthetic FD not owned');
      return original + held[2];
    }
    return join(directory, text.slice(1));
  };
  vi.spyOn(fs, 'openSync').mockImplementation((path, flags) => {
    const mapped = map(path);
    const fd = real.open(mapped, flags);
    owned.set(fd, mapped);
    return fd;
  });
  vi.spyOn(fs, 'closeSync').mockImplementation((fd) => {
    owned.delete(fd);
    real.close(fd);
  });
  vi.spyOn(fs, 'fstatSync').mockImplementation(((fd: number) =>
    Object.assign(real.fstat(fd), { uid: 0, gid: 0 })) as typeof fs.fstatSync);
  vi.spyOn(fs, 'lstatSync').mockImplementation(((path: fs.PathLike) =>
    Object.assign(real.stat(map(path)), { uid: 0, gid: 0 })) as typeof fs.lstatSync);
  const unix = process as Required<NodeJS.Process>;
  vi.spyOn(unix, 'getuid').mockReturnValue(998);
  vi.spyOn(unix, 'geteuid').mockReturnValue(998);
  vi.spyOn(unix, 'getgid').mockReturnValue(998);
  vi.spyOn(unix, 'getegid').mockReturnValue(998);
  vi.spyOn(unix, 'getgroups').mockReturnValue([998]);
  vi.stubGlobal('process', {
    ...process,
    platform: 'linux',
    arch: 'x64',
    execPath: '/opt/node22/bin/node',
    versions: { ...process.versions, node: '22.23.2' },
  });
  vi.stubEnv('HOLADAY_POOL_CANDIDATE', candidate);
  vi.stubEnv('HOLADAY_POOL_BOOT', boot);
  const loaded: number[] = [];
  const dlopen = vi.spyOn(process, 'dlopen').mockImplementation((module, path, flags) => {
    const fd = Number(path.match(/\/(\d+)$/)?.[1]);
    loaded.push(fd);
    const original = owned.get(fd);
    if (!original) throw new Error('not original FD');
    // The actual Darwin dynamic linker uses /dev/fd, not Linux /proc/self/fd.
    // The same original held FD is loaded; no pathname reopen or fake exports.
    if (nativeBundles) {
      real.dlopen(module, `/dev/fd/${fd}`, flags);
      return;
    }
    (module as { exports: unknown }).exports = Object.freeze(
      original.endsWith('egress-listener.node')
        ? {
            createListener: () => {
              throw new Error('not a native factory fixture');
            },
          }
        : {
            connectControl: () => {
              throw new Error('not a native factory fixture');
            },
          },
    );
  });
  dispose.push(() => {
    for (const fd of owned.keys()) real.close(fd);
  });
  const loader = await import('./broker-native-loader.js');
  return { loader, manifest, save, release, owned, dlopen, loaded };
}

it('pins two distinct verified original files before either loader call and never reloads', async () => {
  const f = await fixture();
  const value = f.loader.loadOriginalBrokerNative();
  expect(f.loaded.length).toBe(2);
  expect(f.loaded[0]).not.toBe(f.loaded[1]);
  expect(f.loaded.every((fd) => f.owned.has(fd))).toBe(true);
  expect(value.candidate).toBe(candidate);
  expect(value.boot).toBe(boot);
  expect(() => f.loader.loadOriginalBrokerNative()).toThrow('POOL_NATIVE_LOAD_UNPROVEN');
  expect(f.dlopen).toHaveBeenCalledTimes(2);
});

it.skipIf(platform !== 'darwin')(
  'loads both actual compiled N-API export objects through held FD aliases',
  async () => {
    const f = await fixture(true);
    const value = f.loader.loadOriginalBrokerNative();
    expect(typeof value.egress.createListener).toBe('function');
    expect(typeof value.control.connectControl).toBe('function');
    expect(Object.isFrozen(value.egress)).toBe(true);
    expect(Object.isFrozen(value.control)).toBe(true);
    expect(f.loaded).toHaveLength(2);
    expect(f.loaded.every((fd) => f.owned.has(fd))).toBe(true);
  },
);

it.each([
  'unverified',
  'hash',
  'writable',
  'missing',
  'extra',
  'missing-root-entry',
  'architecture',
  'parent-writable',
  'symlink',
  'duplicate',
  'oversize',
])('rejects %s before any executable is loaded', async (mode) => {
  const f = await fixture();
  if (mode === 'unverified') f.manifest.status = 'unverified';
  if (mode === 'hash') f.manifest.files['control-connector.node'] = '0'.repeat(64);
  if (mode === 'writable') fs.chmodSync(join(f.release, 'control-connector.node'), 0o664);
  if (mode === 'missing') fs.unlinkSync(join(f.release, 'control-connector.node'));
  if (mode === 'extra') f.manifest.files['unexpected.node'] = '1'.repeat(64);
  if (mode === 'missing-root-entry') Reflect.deleteProperty(f.manifest.files, 'root-native-entry');
  if (mode === 'architecture') f.manifest.architecture = 'aarch64';
  if (mode === 'parent-writable') fs.chmodSync(f.release, 0o777);
  if (mode === 'symlink') {
    fs.renameSync(join(f.release, 'control-connector.node'), join(f.release, 'renamed.node'));
    fs.symlinkSync(join(f.release, 'renamed.node'), join(f.release, 'control-connector.node'));
  }
  f.save();
  if (mode === 'duplicate' || mode === 'oversize') {
    const fd = real.open(join(f.release, 'native-build-manifest.json'), 'w');
    try {
      fs.writeSync(
        fd,
        mode === 'duplicate'
          ? JSON.stringify(f.manifest).replace('{', '{"version":1,')
          : ' '.repeat(65537),
      );
    } finally {
      real.close(fd);
    }
  }
  expect(() => f.loader.loadOriginalBrokerNative()).toThrow('POOL_NATIVE_LOAD_UNPROVEN');
  expect(f.dlopen).not.toHaveBeenCalled();
  expect(f.owned.size).toBe(0);
});

it.each(['platform', 'node', 'uid', 'groups', 'worker'])(
  'refuses incompatible %s context with zero loads',
  async (mode) => {
    const f = await fixture();
    if (mode === 'platform') vi.stubGlobal('process', { ...process, platform: 'darwin' });
    if (mode === 'node')
      vi.stubGlobal('process', { ...process, versions: { ...process.versions, node: '24.0.0' } });
    if (mode === 'uid') vi.spyOn(process as Required<NodeJS.Process>, 'geteuid').mockReturnValue(0);
    if (mode === 'groups')
      vi.spyOn(process as Required<NodeJS.Process>, 'getgroups').mockReturnValue([998, 20]);
    if (mode === 'worker') {
      vi.resetModules();
      vi.doMock('node:worker_threads', () => ({ isMainThread: false }));
      f.loader = await import('./broker-native-loader.js');
    }
    expect(() => f.loader.loadOriginalBrokerNative()).toThrow('POOL_NATIVE_LOAD_UNPROVEN');
    expect(f.dlopen).not.toHaveBeenCalled();
    expect(f.owned.size).toBe(0);
  },
);

it.each(['22.1.0', '22.23.1', '22.23.2-pre', '22.23.2-extra'])(
  'rejects Node %s without the fixed HTTP header-count security boundary',
  async (version) => {
    const f = await fixture();
    vi.stubGlobal('process', { ...process, versions: { ...process.versions, node: version } });
    expect(() => f.loader.loadOriginalBrokerNative()).toThrow('POOL_NATIVE_LOAD_UNPROVEN');
    expect(f.dlopen).not.toHaveBeenCalled();
    expect(f.owned.size).toBe(0);
  },
);

it('does not replace metadata captured at import with later environment changes', async () => {
  const f = await fixture();
  vi.stubEnv('HOLADAY_POOL_CANDIDATE', 'c'.repeat(40));
  vi.stubEnv('HOLADAY_POOL_BOOT', 'd'.repeat(32));
  const value = f.loader.loadOriginalBrokerNative();
  expect(value.candidate).toBe(candidate);
  expect(value.boot).toBe(boot);
});

it('vetoes a replaced second artifact after the first dlopen without recycling original FDs', async () => {
  const f = await fixture();
  const original = f.dlopen.getMockImplementation();
  f.dlopen.mockImplementation((...args) => {
    original?.(...args);
    fs.renameSync(join(f.release, 'control-connector.node'), join(f.release, 'retired.node'));
    const fd = real.open(join(f.release, 'control-connector.node'), 'wx', 0o644);
    try {
      fs.writeSync(fd, 'replacement');
    } finally {
      real.close(fd);
    }
  });
  expect(() => f.loader.loadOriginalBrokerNative()).toThrow('POOL_NATIVE_LOAD_UNPROVEN');
  expect(f.loaded.length).toBe(1);
  expect(f.owned.size).toBeGreaterThan(0);
});

it('does not begin loading when the original five-second budget expires', async () => {
  const f = await fixture();
  let calls = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => (calls++ < 5 ? 0 : 5001));
  expect(() => f.loader.loadOriginalBrokerNative()).toThrow('POOL_NATIVE_LOAD_UNPROVEN');
  expect(f.dlopen).not.toHaveBeenCalled();
  expect(f.owned.size).toBe(0);
});

it('does not return a partial factory or permit retry after a second load failure', async () => {
  const f = await fixture();
  const original = f.dlopen.getMockImplementation();
  f.dlopen.mockImplementation((...args) => {
    if (f.loaded.length) throw new Error('synthetic');
    original?.(...args);
  });
  expect(() => f.loader.loadOriginalBrokerNative()).toThrow('POOL_NATIVE_LOAD_UNPROVEN');
  expect(f.loaded.length).toBe(1);
  expect(f.loaded.every((fd) => f.owned.has(fd))).toBe(true);
  expect(() => f.loader.loadOriginalBrokerNative()).toThrow('POOL_NATIVE_LOAD_UNPROVEN');
});
