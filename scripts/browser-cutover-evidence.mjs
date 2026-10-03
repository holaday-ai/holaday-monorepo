import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import * as fs from 'node:fs/promises';
import { readFile, readdir, readlink } from 'node:fs/promises';
import { hostname } from 'node:os';
import { posix } from 'node:path';
import { isDeepStrictEqual, promisify } from 'node:util';
const cloudObservationStages = new Set([
  'CENSUS_ENTRY',
  'CENSUS_IO_01',
  'CENSUS_IO_02',
  'CENSUS_IO_03',
  'CENSUS_IO_04',
  'CENSUS_IO_05',
  'CENSUS_IO_06',
  'CENSUS_IO_07',
  'CENSUS_IO_08',
  'CENSUS_T01',
  'CENSUS_T02',
  'CENSUS_T03',
  'CENSUS_T04',
  'CENSUS_T05',
  'CENSUS_T06',
  'CENSUS_T07',
  'CENSUS_T08',
  'CENSUS_T09',
  'CONTEXT_ENTRY',
  'CONTEXT_IO_01',
  'CONTEXT_IO_02',
  'CONTEXT_IO_03',
  'CONTEXT_IO_04',
  'CONTEXT_IO_05',
  'CONTEXT_IO_06',
  'CONTEXT_IO_07',
  'CONTEXT_IO_08',
  'CONTEXT_IO_09',
  'CONTEXT_IO_10',
  'CONTEXT_IO_11',
  'CONTEXT_IO_12',
  'CONTEXT_IO_13',
  'CONTEXT_IO_14',
  'CONTEXT_IO_15',
  'CONTEXT_IO_16',
  'CONTEXT_IO_17',
  'CONTEXT_IO_18',
  'CONTEXT_IO_19',
  'CONTEXT_IO_20',
  'CONTEXT_IO_21',
  'CONTEXT_IO_22',
  'CONTEXT_IO_23',
  'CONTEXT_IO_24',
  'CONTEXT_IO_25',
  'CONTEXT_IO_26',
  'CONTEXT_IO_27',
  'CONTEXT_IO_28',
  'CONTEXT_IO_29',
  'CONTEXT_IO_30',
  'CONTEXT_IO_31',
  'CONTEXT_IO_32',
  'CONTEXT_R01',
  'CONTEXT_R02',
  'CONTEXT_R03',
  'CONTEXT_R04',
  'CONTEXT_R05',
  'CONTEXT_R06',
  'CONTEXT_R07',
  'CONTEXT_R08',
  'CONTEXT_R09',
  'CONTEXT_R10',
  'CONTEXT_R11',
  'CONTEXT_R12',
  'CONTEXT_R13',
  'CONTEXT_R14',
  'CONTEXT_R15',
  'CONTEXT_R16',
  'CONTEXT_R17',
  'CONTEXT_R18',
  'CONTEXT_R19',
  'CONTEXT_R20',
  'CONTEXT_R21',
  'CONTEXT_R22',
  'CONTEXT_R23',
  'CONTEXT_R24',
  'CONTEXT_R25',
  'CONTEXT_R26',
  'CONTEXT_R27',
  'CONTEXT_R28',
  'CONTEXT_R29',
  'CONTEXT_R30',
  'CONTEXT_R31',
  'CONTEXT_R32',
  'CONTEXT_R33',
  'CONTEXT_R34',
  'CONTEXT_R35',
  'CONTEXT_R36',
  'CONTEXT_R37',
  'DISPLAY_ENTRY',
  'DISPLAY_IO_01',
  'DISPLAY_IO_02',
  'DISPLAY_IO_03',
  'DISPLAY_IO_04',
  'DISPLAY_IO_05',
  'DISPLAY_IO_06',
  'DISPLAY_IO_07',
  'DISPLAY_IO_08',
  'DISPLAY_IO_09',
  'DISPLAY_IO_10',
  'DISPLAY_IO_11',
  'DISPLAY_IO_12',
  'DISPLAY_IO_13',
  'DISPLAY_IO_14',
  'DISPLAY_IO_15',
  'DISPLAY_IO_16',
  'DISPLAY_IO_17',
  'DISPLAY_IO_18',
  'DISPLAY_IO_19',
  'DISPLAY_IO_20',
  'DISPLAY_IO_21',
  'DISPLAY_IO_22',
  'DISPLAY_IO_23',
  'DISPLAY_IO_24',
  'DISPLAY_IO_25',
  'DISPLAY_IO_26',
  'DISPLAY_IO_27',
  'DISPLAY_R01',
  'DISPLAY_R02',
  'DISPLAY_R03',
  'DISPLAY_R04',
  'DISPLAY_R05',
  'DISPLAY_R06',
  'DISPLAY_R07',
  'DISPLAY_R08',
  'DISPLAY_R09',
  'DISPLAY_R10',
  'DISPLAY_R11',
  'DISPLAY_R12',
  'DISPLAY_R13',
  'DISPLAY_R14',
  'DISPLAY_R15',
  'DISPLAY_R16',
  'DISPLAY_R17',
  'DISPLAY_R18',
  'DISPLAY_R19',
  'DISPLAY_R20',
  'DISPLAY_R21',
  'DISPLAY_R22',
  'DISPLAY_R23',
  'DISPLAY_R24',
  'DISPLAY_R25',
  'DISPLAY_R26',
  'DISPLAY_R27',
  'DISPLAY_R28',
  'DISPLAY_R29',
  'DISPLAY_R30',
  'DISPLAY_R31',
  'DISPLAY_R32',
  'DISPLAY_R33',
  'HOST_ENTRY',
  'HOST_IO_01',
  'HOST_IO_02',
  'HOST_IO_03',
  'HOST_IO_04',
  'HOST_IO_05',
  'HOST_IO_06',
  'HOST_IO_07',
  'HOST_IO_08',
  'HOST_IO_09',
  'HOST_IO_10',
  'HOST_IO_11',
  'HOST_IO_12',
  'HOST_IO_13',
  'HOST_IO_14',
  'HOST_IO_15',
  'HOST_IO_16',
  'HOST_IO_17',
  'HOST_IO_18',
  'HOST_IO_19',
  'HOST_T01',
  'HOST_T02',
  'HOST_T03',
  'HOST_T04',
  'HOST_T05',
  'HOST_T06',
  'HOST_T07',
  'HOST_T08',
  'HOST_T09',
  'HOST_T10',
  'HOST_T11',
  'HOST_T12',
  'HOST_T13',
  'HOST_T14',
  'HOST_T15',
  'HOST_T16',
  'MANAGERS_ENTRY',
  'MANAGERS_IO_01',
  'MANAGERS_R01',
  'MANAGERS_R02',
  'MANAGERS_R03',
  'MANAGERS_R04',
  'MANAGERS_R05',
  'MANAGERS_R06',
  'MANAGERS_R07',
  'MANAGERS_R08',
  'MANAGERS_R09',
  'MANAGERS_R10',
  'MANAGERS_R11',
  'UNKNOWN',
]);
const cloudObservationErrnos = new Set([
  'ENOENT',
  'EACCES',
  'EPERM',
  'EINVAL',
  'EBADF',
  'ENOTDIR',
  'ELOOP',
  'ETIMEDOUT',
  'ECONNRESET',
]);
const cloudObservationErrors = new WeakMap();
function cloudObservationOwnData(value, key) {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value ?? {}, key);
    return descriptor && Object.hasOwn(descriptor, 'value') ? descriptor.value : undefined;
  } catch {
    return undefined;
  }
}
/** Non-authoritative fixed failure metadata. Never used by a guard or retry decision. */
export function cutoverCloudObservationError(message, stage, cause) {
  const error = new Error(message);
  const safeStage = cloudObservationStages.has(stage) ? stage : 'UNKNOWN';
  const inherited = cloudObservationErrors.get(cause);
  const errno = inherited?.errno ?? cloudObservationOwnData(cause, 'code');
  cloudObservationErrors.set(
    error,
    Object.freeze({
      ...(inherited
        ? inherited
        : /_(T|R)\d+$/.test(safeStage)
          ? { failureStage: safeStage }
          : { lastEnteredStage: safeStage }),
      errno: cloudObservationErrnos.has(errno) ? errno : null,
    }),
  );
  return error;
}
export function rememberCutoverCloudObservationFailure(error, stage) {
  if ((typeof error !== 'object' || error === null) && typeof error !== 'function') return;
  if (cloudObservationErrors.has(error)) return;
  const errno = cloudObservationOwnData(error, 'code');
  cloudObservationErrors.set(
    error,
    Object.freeze({
      failureStage: cloudObservationStages.has(stage) ? stage : 'UNKNOWN',
      errno: cloudObservationErrnos.has(errno) ? errno : null,
    }),
  );
}
export function readCutoverCloudObservationDiagnostic(error) {
  const value = cloudObservationErrors.get(error);
  return value ? { ...value } : undefined;
}

// Finite source material, not capability, loaded-code equality or authorization.
const cloudSourceTools = [
  '/usr/bin/unshare',
  '/bin/sh',
  '/usr/bin/mount',
  '/usr/bin/setpriv',
  '/usr/bin/python3',
  '/usr/bin/Xvfb',
  '/opt/brave.com/brave/brave',
  '/opt/brave.com/brave/chrome_crashpad_handler',
  '/opt/holaday-vnc/start.sh',
  '/usr/bin/bash',
  '/usr/bin/x11vnc',
  '/usr/bin/websockify',
  '/usr/bin/pkill',
  '/usr/bin/sleep',
  '/usr/bin/date',
  ...[
    'package.json',
    'lib/God.js',
    'lib/God/ForkMode.js',
    'lib/Utility.js',
    'lib/God/ActionMethods.js',
  ].map((p) => `/usr/lib/node_modules/pm2/${p}`),
  '/usr/lib/python3.10/site.py',
  '/usr/lib/python3.10/importlib/metadata/__init__.py',
];
// Exact reviewed Ubuntu startup material. Optional presence is observed, never
// a wildcard permission for other hooks. Cache bytes were reproduced with the
// matching Ubuntu compiler from reviewed source without executing that source.
export const firstCutoverCloudReviewedPythonStartup = Object.freeze(
  [
    {
      path: '/usr/lib/python3.10/sitecustomize.py',
      resolvedPath: '/etc/python3.10/sitecustomize.py',
      size: 155,
      digest: '43d81125d92376b1a69d53a71126a041cc9a18d8080e92dea0a2ae23be138b1e',
    },
    {
      path: '/usr/lib/python3/dist-packages/apport_python_hook.py',
      size: 8063,
      digest: '7f56fc0bcfe9e80e8152f32262ec190c4db3b10bf2081c0db73e976285cab69e',
    },
    {
      path: '/usr/lib/python3.10/__pycache__/sitecustomize.cpython-310.pyc',
      size: 225,
      digest: '2132f162f1b1622dbfd3d9b01b43d769e5432fdd6551dfe685243394579ce0b5',
    },
    {
      path: '/usr/lib/python3/dist-packages/__pycache__/apport_python_hook.cpython-310.pyc',
      size: 4661,
      digest: '4beeaf52bfd13b80ecd323ddce720028f9560aa189b22b643683c2eac0696187',
    },
    ...[
      'zope.component-4.3.0',
      'zope.event-4.4',
      'zope.hookable-5.1.0',
      'zope.interface-5.4.0',
    ].map((name) => ({
      path: `/usr/lib/python3/dist-packages/${name}-nspkg.pth`,
      size: 529,
      digest: '4961151fe8c45ac298acbd2aa02e86049692b71fe22b11a8018f4f432705542e',
    })),
  ].map((row) => Object.freeze({ resolvedPath: row.path, ...row })),
);
const cloudPythonRoot = '/usr/lib/python3/dist-packages';
const cloudMetadataName = /^websockify(?:-[0-9][a-zA-Z0-9._+-]{0,63})?\.(?:egg|dist)-info$/;
const cloudMetadataFiles = [
  'PKG-INFO',
  'METADATA',
  'entry_points.txt',
  'top_level.txt',
  'SOURCES.txt',
  'installed-files.txt',
  'dependency_links.txt',
  'requires.txt',
  'RECORD',
  'WHEEL',
  'INSTALLER',
  'not-zip-safe',
];
const cloudSourceKeys = (value, keys) =>
  value !== null &&
  Object.getPrototypeOf(value) === Object.prototype &&
  Object.keys(value).sort().join(',') === [...keys].sort().join(',');
const cloudSourceHash = (value) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
export function validateFirstCutoverCloudSources(value, { scope, observed = false } = {}) {
  const reject = () => {
    throw new Error('CUTOVER_CLOUD_SOURCES_UNPROVEN');
  };
  try {
    if (
      typeof observed !== 'boolean' ||
      !cloudSourceKeys(value, [
        'host',
        'hostname',
        'bootId',
        'files',
        'roles',
        'pythonEntry',
        ...(observed ? ['observedAtMs'] : []),
      ]) ||
      value.host !== 'vultr' ||
      typeof value.hostname !== 'string' ||
      !/^[a-zA-Z0-9][a-zA-Z0-9.-]{0,252}$/.test(value.hostname) ||
      !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(value.bootId)
    )
      reject();
    if (observed && (!Number.isSafeInteger(value.observedAtMs) || value.observedAtMs < 0)) reject();
    if (
      !Array.isArray(scope) ||
      scope.length !== 2 ||
      !Array.isArray(value.roles) ||
      value.roles.length !== 2
    )
      reject();
    for (const [i, name] of ['holaday-vnc', 'holaday-chromium-headed'].entries()) {
      const role = value.roles[i];
      if (
        scope[i]?.name !== name ||
        !Number.isSafeInteger(scope[i].pmId) ||
        scope[i].pmId < 0 ||
        !cloudSourceKeys(role, [
          'name',
          'pmId',
          'selectionDigest',
          ...(observed ? ['configDigest'] : []),
        ]) ||
        role.name !== name ||
        role.pmId !== scope[i].pmId ||
        !cloudSourceHash(role.selectionDigest) ||
        (observed && !cloudSourceHash(role.configDigest))
      )
        reject();
    }
    if (scope[0].pmId === scope[1].pmId) reject();
    const entry = value.pythonEntry;
    if (
      !cloudSourceKeys(entry, ['metadataPath', 'name', 'version', 'group', 'entry', 'target']) ||
      entry.name !== 'websockify' ||
      entry.group !== 'console_scripts' ||
      entry.entry !== 'websockify' ||
      entry.target !== 'websockify.websocketproxy:websockify_init' ||
      typeof entry.version !== 'string' ||
      !/^[0-9]+(?:\.[0-9]+){1,3}(?:[a-zA-Z0-9.+-]{0,32})$/.test(entry.version) ||
      posix.dirname(entry.metadataPath) !== cloudPythonRoot ||
      !cloudMetadataName.test(posix.basename(entry.metadataPath))
    )
      reject();
    if (
      !Array.isArray(value.files) ||
      value.files.length < cloudSourceTools.length + 7 ||
      value.files.length > 128
    )
      reject();
    let previous = '';
    let total = 0;
    const paths = new Set();
    for (const file of value.files) {
      // The fixed root bootstrap uses this exact tool before dropping caps.
      // Preserve the measured mode; do not normalise it to an ordinary 0755 file.
      const rootMount =
        file?.path === '/usr/bin/mount' &&
        file.resolvedPath === '/usr/bin/mount' &&
        file.uid === 0 &&
        file.gid === 0 &&
        file.mode === 0o4755;
      if (
        !cloudSourceKeys(file, ['path', 'resolvedPath', 'uid', 'gid', 'mode', 'size', 'digest']) ||
        typeof file.path !== 'string' ||
        file.path <= previous ||
        !cloudSourceHash(file.digest) ||
        file.uid !== 0 ||
        !Number.isSafeInteger(file.gid) ||
        file.gid < 0 ||
        !Number.isSafeInteger(file.mode) ||
        file.mode < 0 ||
        (file.mode > 0o777 && !rootMount) ||
        file.mode & 0o022 ||
        !Number.isSafeInteger(file.size) ||
        file.size < 0 ||
        file.size > 512 * 1024 * 1024
      )
        reject();
      const startupFile = firstCutoverCloudReviewedPythonStartup.find(
        (row) => row.path === file.path,
      );
      if (startupFile && (file.digest !== startupFile.digest || file.size !== startupFile.size))
        reject();
      const packageFile =
        posix.dirname(file.path) === `${cloudPythonRoot}/websockify` &&
        /^[a-zA-Z_][a-zA-Z0-9_]*\.py$/.test(posix.basename(file.path));
      const cachedFile =
        posix.dirname(file.path) === `${cloudPythonRoot}/websockify/__pycache__` &&
        /^([a-zA-Z_][a-zA-Z0-9_]*)\.cpython-310(?:\.opt-[12])?\.pyc$/.test(
          posix.basename(file.path),
        );
      const metadataFile =
        posix.dirname(file.path) === entry.metadataPath &&
        cloudMetadataFiles.includes(posix.basename(file.path));
      if (
        !cloudSourceTools.includes(file.path) &&
        !startupFile &&
        !packageFile &&
        !cachedFile &&
        !metadataFile
      )
        reject();
      if (
        metadataFile &&
        posix.basename(file.path) === 'not-zip-safe' &&
        (file.size !== 1 ||
          file.digest !== '01ba4719c80b6fe911b091a7c05124b64eeece964e09c058ef8f9805daca546b')
      )
        reject();
      const allowedTargets = startupFile
        ? [startupFile.resolvedPath]
        : file.path === '/bin/sh'
          ? ['/bin/sh', '/usr/bin/sh', '/usr/bin/dash', '/usr/bin/bash']
          : file.path === '/usr/bin/python3'
            ? ['/usr/bin/python3', '/usr/bin/python3.10']
            : file.path === '/usr/bin/pkill'
              ? ['/usr/bin/pkill', '/usr/bin/pgrep']
              : [file.path];
      if (!allowedTargets.includes(file.resolvedPath)) reject();
      if (
        (packageFile ||
          cachedFile ||
          metadataFile ||
          file.path.endsWith('.js') ||
          file.path.endsWith('.json') ||
          file.path.endsWith('.py') ||
          file.path.endsWith('.sh') ||
          file.path === '/usr/bin/websockify') &&
        file.size > 256 * 1024
      )
        reject();
      if (file.size === 0 && !packageFile && !metadataFile) reject();
      total += file.size;
      paths.add(file.path);
      previous = file.path;
    }
    for (const [cache, source] of [
      [
        '/usr/lib/python3.10/__pycache__/sitecustomize.cpython-310.pyc',
        '/usr/lib/python3.10/sitecustomize.py',
      ],
      [
        '/usr/lib/python3/dist-packages/__pycache__/apport_python_hook.cpython-310.pyc',
        '/usr/lib/python3/dist-packages/apport_python_hook.py',
      ],
    ])
      if (paths.has(cache) && !paths.has(source)) reject();
    for (const p of paths)
      if (
        p.includes('/websockify/__pycache__/') &&
        !paths.has(`${cloudPythonRoot}/websockify/${posix.basename(p).split('.cpython-')[0]}.py`)
      )
        reject();
    if (
      total > 1024 * 1024 * 1024 ||
      cloudSourceTools.some((p) => !paths.has(p)) ||
      ['__init__', 'websocket', 'websocketserver', 'websocketproxy', 'websockifyserver'].some(
        (p) => !paths.has(`${cloudPythonRoot}/websockify/${p}.py`),
      ) ||
      !paths.has(`${entry.metadataPath}/entry_points.txt`) ||
      Number(paths.has(`${entry.metadataPath}/PKG-INFO`)) +
        Number(paths.has(`${entry.metadataPath}/METADATA`)) !==
        1
    )
      reject();
  } catch {
    reject();
  }
}

// This reviewed legacy revision has no complete in-flight request observation
// API. Matching its bytes proves only that limitation, never absence of work.
const legacyCapability = {
  schemaVersion: 1,
  sourceCandidate: '107857fe70503e30691073f267d87275596edb20',
  scope: 'legacy-non-payment-memory',
  reason: 'legacy-no-inflight-api',
  sources: [
    ['http.ts', '8380c38abb207c932bc08823d3bfcaf8c976bb2aaef968981c494628de4c4536'],
    ['index.ts', '2ba90ffb6bb0cb0d84a8746cef7eeccd02ae746292e8e3c42e9cb924781e8e64'],
    ['trpc/router.ts', '4d3c781e814242973acca1b2fc728c6334ba8850ec7fa475922d74350ada829d'],
    ['queue/task-queue.ts', 'c8bd31c21aa3bbe6975960f98b01506215e9b7b863bc793c82596dd7e64c3e9c'],
    ['agent/batch-executor.ts', '2c73b7521e1ebdd9946fa9a4a6ed558dbc66b72195f11723704b42b558f3b746'],
    [
      'browser-pool/browser-pool.ts',
      'cb5d3a54e56fa922206dc640a93fdfb8ab32aefe658f21b42acef0242d71e1a3',
    ],
  ].map(([path, digest]) => ({ path: `apps/orchestrator/src/${path}`, digest })),
};
const legacyCapabilityDigest = createHash('sha256')
  .update(JSON.stringify(legacyCapability))
  .digest('hex');
const legacyCapabilitySystem = {
  platform: process.platform,
  uid: process.getuid?.(),
  now: Date.now,
  async digestSource(path) {
    if ((await fs.realpath(path)) !== path) throw new Error('path');
    const handle = await fs.open(
      path,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    try {
      const before = await handle.stat();
      if (!before.isFile() || before.size < 1 || before.size > 2 * 1024 * 1024)
        throw new Error('file');
      const bytes = Buffer.alloc(before.size + 1);
      let size = 0;
      while (size < bytes.length) {
        const { bytesRead } = await handle.read(bytes, size, bytes.length - size, size);
        if (!bytesRead) break;
        size += bytesRead;
      }
      const after = await handle.stat();
      const current = await fs.lstat(path);
      if (
        size !== before.size ||
        !current.isFile() ||
        (await fs.realpath(path)) !== path ||
        ['dev', 'ino', 'size', 'mtimeMs', 'ctimeMs'].some(
          (key) => before[key] !== after[key] || after[key] !== current[key],
        )
      )
        throw new Error('changed');
      return createHash('sha256').update(bytes.subarray(0, size)).digest('hex');
    } finally {
      await handle.close();
    }
  },
};
export function validateCutoverLegacyCapability(proof, nowMs) {
  if (
    !proof ||
    Object.keys(proof).sort().join(',') !==
      'capabilityDigest,observedAtMs,schemaVersion,sourceCandidate' ||
    proof.schemaVersion !== 1 ||
    proof.sourceCandidate !== legacyCapability.sourceCandidate ||
    proof.capabilityDigest !== legacyCapabilityDigest ||
    !Number.isSafeInteger(nowMs) ||
    !Number.isSafeInteger(proof.observedAtMs) ||
    proof.observedAtMs < 0 ||
    proof.observedAtMs > nowMs ||
    nowMs - proof.observedAtMs > 60000
  )
    throw new Error('CUTOVER_LEGACY_CAPABILITY_UNPROVEN');
  return legacyCapabilityDigest;
}
export async function readCutoverLegacyCapability({ sourceCandidate }, overrides = {}) {
  const io = { ...legacyCapabilitySystem, ...overrides };
  try {
    if (
      io.platform !== 'linux' ||
      io.uid !== 0 ||
      sourceCandidate !== legacyCapability.sourceCandidate
    )
      throw new Error('source');
    const observedAtMs = io.now();
    for (let pass = 0; pass < 2; pass++) {
      for (const { path, digest } of legacyCapability.sources) {
        if ((await io.digestSource(`/opt/holaday-monorepo/${path}`)) !== digest)
          throw new Error('bytes');
      }
    }
    const proof = {
      schemaVersion: 1,
      sourceCandidate,
      observedAtMs,
      capabilityDigest: legacyCapabilityDigest,
    };
    validateCutoverLegacyCapability(proof, io.now());
    return proof;
  } catch {
    throw new Error('CUTOVER_LEGACY_CAPABILITY_UNPROVEN');
  }
}
// Shared with exact-registration retirement. Heap/latency gauges are volatile;
// all environment, launch, restart and scheduling fields remain identity-bearing.
export const cutoverRegistrationConfigDigest = (value) =>
  createHash('sha256')
    .update(
      JSON.stringify(
        Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'axm_monitor')),
      ),
    )
    .digest('hex');
// PM2's acknowledged stop changes status and exit_code. Keep the original full
// config identity above; this additional comparison is ONLY for the temporary
// cloud stop transition, never a registration deletion/recovery authorization.
export const cutoverCloudStopConfigDigest = (value) =>
  cutoverRegistrationConfigDigest(
    Object.fromEntries(
      Object.entries(value).filter(([key]) => !['status', 'exit_code'].includes(key)),
    ),
  );

// Fixed launch bytes shared only by the canonical material and finite comparator.
// Not a standalone executable selector or source/capability approval.
export const firstCutoverCloudDisplayBootstrap = String.raw`import os, sys, signal, time
child = None
stamp = None
reaped = False
def bounded(path, limit=65536):
    with open(path, "rb", buffering=0) as f:
        data = f.read(limit + 1)
    if len(data) > limit:
        raise RuntimeError("size")
    return data.decode("utf-8")
def exited():
    global reaped
    if not reaped:
        reaped = os.waitpid(child, os.WNOHANG)[0] == child
    return reaped
def identity():
    fields = bounded("/proc/%d/stat" % child).rsplit(")", 1)[1].split()
    if int(fields[1]) != os.getpid():
        raise RuntimeError("identity")
    return fields[19]
def sockets():
    rows = bounded("/proc/net/unix", 1048576).splitlines()
    if len(rows) > 16384:
        raise RuntimeError("count")
    return [r.split() for r in rows[1:] if r.split()[-1:] and r.split()[-1] in ("/tmp/.X11-unix/X98", "@/tmp/.X11-unix/X98")]
def ready():
    if exited():
        raise RuntimeError("exit")
    if identity() != stamp or os.readlink("/proc/%d/ns/mnt" % child) != os.readlink("/proc/self/ns/mnt"):
        raise RuntimeError("drift")
    # fork returns before child exec; the startup alarm remains unmasked here.
    if os.readlink("/proc/%d/exe" % child) != "/usr/bin/Xvfb":
        return False
    with os.scandir("/proc/%d/fd" % child) as entries:
        fds = []
        for entry in entries:
            if len(fds) >= 1024:
                raise RuntimeError("fds")
            fds.append(os.readlink(entry.path))
    rows = sockets()
    paths = sorted(r[-1] for r in rows)
    if paths != ["/tmp/.X11-unix/X98", "@/tmp/.X11-unix/X98"]:
        return False
    if any(len(r) != 8 or r[3:6] != ["00010000", "0001", "01"] or "socket:[%s]" % r[6] not in fds for r in rows):
        raise RuntimeError("ownership")
    if len(set(r[6] for r in rows)) != 2 or identity() != stamp or exited():
        raise RuntimeError("drift")
    return True
def interrupted(signum, frame):
    raise RuntimeError("signal")
for sig in (signal.SIGINT, signal.SIGTERM, signal.SIGALRM):
    signal.signal(sig, interrupted)
signal.setitimer(signal.ITIMER_REAL, 5)
try:
    if os.path.lexists("/tmp/.X98-lock") or os.path.lexists("/tmp/.X11-unix/X98") or sockets():
        raise RuntimeError("conflict")
    # No exec error-pipe handshake. Parent retains its unreaped child PID
    # before unmasking; only fork/PID assignment is in the masked region.
    mask = signal.pthread_sigmask(signal.SIG_BLOCK, {signal.SIGINT, signal.SIGTERM, signal.SIGALRM})
    try:
        child = os.fork()
        if child == 0:
            try:
                for sig in (signal.SIGINT, signal.SIGTERM, signal.SIGALRM):
                    signal.signal(sig, signal.SIG_DFL)
                signal.pthread_sigmask(signal.SIG_SETMASK, mask)
                null = os.open("/dev/null", os.O_RDWR)
                for fd in (0, 1, 2):
                    os.dup2(null, fd)
                fds = os.listdir("/proc/self/fd")
                if len(fds) > 1024:
                    os._exit(127)
                for entry in fds:
                    fd = int(entry)
                    if fd > 2:
                        try:
                            os.close(fd)
                        except OSError:
                            pass
                os.execv("/usr/bin/Xvfb", ["/usr/bin/Xvfb", ":98", "-screen", "0", "1280x800x24", "-nolisten", "tcp"])
            except BaseException:
                os._exit(127)
    finally:
        signal.pthread_sigmask(signal.SIG_SETMASK, mask)
    stamp = identity()
    deadline = time.monotonic() + 4.5
    while not ready():
        if time.monotonic() >= deadline:
            raise RuntimeError("timeout")
        time.sleep(0.025)
    signal.setitimer(signal.ITIMER_REAL, 0)
    os.execv("/opt/brave.com/brave/brave", sys.argv[1:])
except BaseException:
    signal.setitimer(signal.ITIMER_REAL, 0)
    signal.pthread_sigmask(signal.SIG_BLOCK, {signal.SIGINT, signal.SIGTERM, signal.SIGALRM})
    if child is not None and not exited():
        # Unreaped child cannot be PID-reused. Recheck start immediately before
        # the only cleanup signal; never signal after waitpid reports exit.
        current = identity()
        if stamp is None:
            stamp = current
        if current != stamp:
            raise SystemExit("CLOUD_DISPLAY_CLEANUP_UNPROVEN")
        os.kill(child, signal.SIGKILL)
        deadline = time.monotonic() + 2
        while not exited():
            if time.monotonic() >= deadline:
                raise SystemExit("CLOUD_DISPLAY_CLEANUP_UNPROVEN")
            time.sleep(0.025)
    raise SystemExit("CLOUD_DISPLAY_BOOTSTRAP_UNPROVEN")
`;

/** Actual bounded X98 listener ownership, not source approval or readiness by
 * pathname. The caller binds this identity to its independent full census. */
export async function readFirstCutoverCloudDisplayListeners(identity, overrides = {}) {
  const io = {
    ...fs,
    platform: process.platform,
    uid: process.getuid?.(),
    now: Date.now,
    ...overrides,
  };
  try {
    const { pid, start, mountNamespace } = identity;
    if (
      io.platform !== 'linux' ||
      io.uid !== 0 ||
      Object.keys(identity).sort().join(',') !== 'mountNamespace,pid,start' ||
      !Number.isSafeInteger(pid) ||
      pid <= 1 ||
      !/^[0-9]+$/.test(start) ||
      !/^mnt:\[\d+\]$/.test(mountNamespace)
    )
      throw Error('identity');
    const began = io.now();
    const read = async (path, limit) => {
      const handle = await io.open(
        path,
        constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
      );
      try {
        const bytes = Buffer.alloc(limit + 1);
        let size = 0;
        while (size < bytes.length) {
          const { bytesRead } = await handle.read(bytes, size, bytes.length - size, size);
          if (!Number.isSafeInteger(bytesRead) || bytesRead < 0 || bytesRead > bytes.length - size)
            throw Error('read');
          if (!bytesRead) break;
          size += bytesRead;
        }
        if (size > limit) throw Error('size');
        return bytes.subarray(0, size).toString('utf8');
      } finally {
        await handle.close();
      }
    };
    const proc = `/proc/${pid}`;
    const check = async () => {
      const stat = await read(`${proc}/stat`, 16384);
      const fields = stat
        .slice(stat.lastIndexOf(')') + 2)
        .trim()
        .split(/\s+/);
      if (
        !['R', 'S', 'D', 'I'].includes(fields[0]) ||
        fields[19] !== start ||
        (await io.readlink(`${proc}/ns/mnt`)) !== mountNamespace
      )
        throw Error('drift');
    };
    await check();
    const paths = ['/tmp/.X11-unix/X98', '@/tmp/.X11-unix/X98'];
    const rows = (await read('/proc/net/unix', 1048576)).trim().split('\n');
    if (rows.length > 16384 || !rows.shift()?.startsWith('Num')) throw Error('table');
    const matching = rows
      .map((line) => line.trim().split(/\s+/))
      .filter((row) => paths.includes(row.at(-1)));
    // Accepted client sockets may carry the server pathname too. This proves
    // listener ownership only; client exclusivity remains a separate gate.
    if (
      matching.some(
        (row) =>
          row.length !== 8 ||
          !/^[1-9][0-9]{0,19}$/.test(row[6]) ||
          row[4] !== '0001' ||
          !(
            (row[3] === '00010000' && row[5] === '01') ||
            (row[3] === '00000000' && row[5] === '03')
          ),
      )
    )
      throw Error('table');
    const selected = matching.filter((row) => row[3] === '00010000');
    if (
      selected.length !== 2 ||
      selected.some(
        (row) =>
          row.length !== 8 ||
          row[3] !== '00010000' ||
          row[4] !== '0001' ||
          row[5] !== '01' ||
          !/^[1-9][0-9]{0,19}$/.test(row[6]),
      )
    )
      throw Error('listeners');
    const fds = await io.readdir(`${proc}/fd`);
    if (fds.length > 1024 || fds.some((fd) => !/^[0-9]+$/.test(fd))) throw Error('fds');
    const sockets = new Set();
    for (const fd of fds) {
      const target = await io.readlink(`${proc}/fd/${fd}`);
      if (typeof target !== 'string' || target.length > 4096) throw Error('fd');
      if (/^socket:\[[0-9]+\]$/.test(target)) sockets.add(target.slice(8, -1));
    }
    const result = selected
      .map((row) => ({ path: row[7], inode: row[6] }))
      .sort((a, b) => paths.indexOf(a.path) - paths.indexOf(b.path));
    if (
      !isDeepStrictEqual(
        result.map((r) => r.path),
        paths,
      ) ||
      new Set(result.map((r) => r.inode)).size !== 2 ||
      result.some((r) => !sockets.has(r.inode))
    )
      throw Error('owner');
    await check();
    const now = io.now();
    if (
      !Number.isSafeInteger(began) ||
      !Number.isSafeInteger(now) ||
      now < began ||
      now - began > 5000
    )
      throw Error('time');
    return result;
  } catch {
    throw Error('CUTOVER_CLOUD_DISPLAY_UNPROVEN');
  }
}

/** Configuration proof for the existing fixed headed stopped-registration
 * restart only. This does NOT prove a process/tree, authorize a restart/open,
 * or relax the original observer. The caller supplies protected raw configs,
 * the runtime's fixed launch MATERIAL, its separately journal-bound digest,
 * and independently bracketed timestamps. This trusted internal interface is
 * not a verifier of caller-supplied approval/digests.
 * PM2 6.0.14 source: ActionMethods.restartProcessId/startProcessId,
 * Methods.resetState, Utility.extend/extendExtraConfig, God.executeApp/readyCb.
 * The fixed /usr/bin/unshare is outside a package (version = 'N/A'); tools and
 * that package-lookup premise must still be verified on the actual host.
 */
export function compareCutoverCloudBrowserRecoveryConfig(input) {
  return compareCloudRecoveryConfig(input, 'headed');
}

/** Same protected nine-field contract as headed recovery, but retain the
 * original VNC wrapper, interpreter, exact argv and entire environment. Only
 * the canonical current_conf safety policy and finite PM2 lifecycle may change.
 * The caller must verify the actual wrapper's package lookup yields N/A (and
 * no asynchronous versioning branch); this pure comparison cannot prove that
 * host premise or any physical tree. No runtime import or new authorization.
 */
export function compareCutoverCloudVncRecoveryConfig(input) {
  return compareCloudRecoveryConfig(input, 'vnc');
}

// Strictly private role selection: shared PM2 6.0.14 stopped-start semantics,
// not caller-selectable transformation rules or a new volatile exclusion list.
function compareCloudRecoveryConfig(input, role) {
  const reject = () => {
    throw new Error('CUTOVER_CLOUD_RECOVERY_CONFIG_UNPROVEN');
  };
  try {
    const copy = structuredClone(input);
    // Raw RPC JSON only: refuse lossy values rather than letting a digest hide
    // undefined/function/nonfinite values or special object serialization.
    if (!isDeepStrictEqual(copy, JSON.parse(JSON.stringify(copy)))) reject();
    const {
      attempt,
      pmId,
      pm2Version,
      stoppedConfig: before,
      recoveredConfig: after,
      launch,
      expectedLaunchDigest,
      restoreStartedAtMs,
      observedAtMs,
    } = copy;
    const record = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
    if (
      Object.keys(copy).sort().join(',') !==
        'attempt,expectedLaunchDigest,launch,observedAtMs,pm2Version,pmId,recoveredConfig,restoreStartedAtMs,stoppedConfig' ||
      !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(
        attempt ?? '',
      ) ||
      !Number.isSafeInteger(pmId) ||
      pmId < 0 ||
      pm2Version !== '6.0.14' ||
      !record(before) ||
      !record(after) ||
      !record(before.env) ||
      Object.hasOwn(before.env, 'max_memory_restart') ||
      before.name !== (role === 'vnc' ? 'holaday-vnc' : 'holaday-chromium-headed') ||
      before.pm_id !== pmId ||
      before.status !== 'stopped' ||
      before.watch !== false ||
      before.exec_mode !== 'fork_mode' ||
      before.autostart !== true ||
      !Number.isSafeInteger(before.restart_time) ||
      before.restart_time < 0 ||
      !Number.isSafeInteger(restoreStartedAtMs) ||
      restoreStartedAtMs < 0 ||
      !Number.isSafeInteger(observedAtMs) ||
      observedAtMs < restoreStartedAtMs ||
      observedAtMs - restoreStartedAtMs > 900000 ||
      !Number.isSafeInteger(after.created_at) ||
      after.created_at < restoreStartedAtMs ||
      !Number.isSafeInteger(after.pm_uptime) ||
      after.pm_uptime < after.created_at ||
      after.pm_uptime > observedAtMs
    )
      reject();
    // No runtime import (runtime imports this module), and no second copy of
    // the shell/argv recipe. The parent supplies the canonical runtime material
    // plus the original journal's independently bound recoveryDigest. Shape
    // checks constrain the role; the bound hash checks ALL exact launch bytes.
    if (!record(launch)) reject();
    if (role === 'vnc') {
      if (
        !isDeepStrictEqual(launch, {
          attempt,
          command: '/opt/holaday-vnc/start.sh',
          exec_interpreter: 'bash',
          current_conf: {
            autorestart: false,
            watch: false,
            cron_restart: '',
            max_memory_restart: 'null',
          },
        }) ||
        before.pm_exec_path !== launch.command ||
        before.exec_interpreter !== launch.exec_interpreter
      )
        reject();
      // Match dispatch's fixed-policy/retained-launch shadow refusal, even for
      // object values PM2 would skip. Preserve matching and unrelated env keys.
      for (const [key, value] of Object.entries({
        ...launch.current_conf,
        pm_exec_path: launch.command,
        exec_interpreter: launch.exec_interpreter,
        exec_mode: 'fork_mode',
        args: before.args,
      })) {
        if (Object.hasOwn(before.env, key) && !isDeepStrictEqual(before.env[key], value)) reject();
      }
    } else if (
      Object.keys(launch).sort().join(',') !== 'args,autorestart,command,env' ||
      launch.command !== '/usr/bin/unshare' ||
      launch.autorestart !== false ||
      !isDeepStrictEqual(launch.env, { DISPLAY: ':98' }) ||
      !Array.isArray(launch.args) ||
      launch.args.length !== 28 ||
      launch.args.some((arg) => typeof arg !== 'string' || !arg || arg.includes('\0')) ||
      launch.args[6] !== 'holaday-private-browser-policy' ||
      launch.args[7] !== `/var/lib/holaday-deploy/maintenance/${attempt}/cloud-browser-policy` ||
      !isDeepStrictEqual(launch.args, [
        '--mount',
        '--propagation',
        'private',
        '/bin/sh',
        '-ceu',
        '/usr/bin/mount --bind "$1" /etc/brave/policies/managed; /usr/bin/mount -o remount,bind,ro /etc/brave/policies/managed; shift; exec /usr/bin/setpriv --bounding-set=-all --inh-caps=-all --ambient-caps=-all --no-new-privs "$@"',
        'holaday-private-browser-policy',
        launch.args[7],
        '/usr/bin/python3',
        '-I',
        '-S',
        '-c',
        firstCutoverCloudDisplayBootstrap,
        '/opt/brave.com/brave/brave',
        '--no-sandbox',
        '--disable-dev-shm-usage',
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-background-networking',
        '--disable-sync',
        '--disable-extensions',
        '--password-store=basic',
        '--hide-crash-restore-bubble',
        '--disable-session-crashed-bubble',
        '--remote-debugging-address=127.0.0.1',
        '--remote-debugging-port=9223',
        '--user-data-dir=/var/lib/holaday-headed-brave',
        '--no-startup-window',
      ])
    )
      reject();
    if (
      typeof expectedLaunchDigest !== 'string' ||
      !/^[a-f0-9]{64}$/.test(expectedLaunchDigest) ||
      createHash('sha256').update(JSON.stringify(launch)).digest('hex') !== expectedLaunchDigest
    )
      reject();
    const expected = {
      ...before,
      ...(role === 'headed'
        ? {
            pm_exec_path: launch.command,
            args: launch.args,
            exec_interpreter: 'none',
            exec_mode: 'fork_mode',
            DISPLAY: ':98',
            env: { ...before.env, DISPLAY: ':98' },
          }
        : {}),
      autorestart: false,
      watch: false,
      cron_restart: '',
      created_at: after.created_at,
      unstable_restarts: 0,
      prev_restart_delay: 0,
    };
    // The fixed RPC uses current_conf.max_memory_restart = STRING 'null'.
    // Utility.extendMix deletes that exact top-level key. Numeric 0/null/false
    // remain defined thresholds and PM2 Worker can reload even autorestart=false.
    // A nested env key was refused above: executeApp would flatten it back in.
    Reflect.deleteProperty(expected, 'max_memory_restart');
    // Utility.extend skips values coercing to '[object Object]', including the
    // RPC's current_conf object; extendExtraConfig merges its fields only at
    // top level. executeApp then flattens the preserved env again. Refuse an
    // incoherent baseline/shadowing key instead of silently changing arbitrary
    // original configuration or accepting an unsafe inherited launch.
    for (const [key, value] of Object.entries(expected.env)) {
      // biome-ignore lint/suspicious/noDoubleEquals: match PM2 6.0.14 Utility.extend coercion exactly.
      if (value != '[object Object]') {
        if (!Object.hasOwn(expected, key) || !isDeepStrictEqual(expected[key], value)) reject();
        expected[key] = value;
      }
    }
    Object.assign(expected, {
      status: 'online',
      pm_uptime: after.pm_uptime,
      axm_actions: [],
      axm_monitor: {},
      axm_options: {},
      axm_dynamic: {},
      vizion_running: expected.vizion_running !== undefined ? expected.vizion_running : false,
      version: 'N/A',
    });
    // Keep the shared digest's sole pre-existing monitor exception. Every
    // other field, including unknown fields, nested env, uid/gid/cwd,
    // historical restart_time AND stopped exit_code, must match the transform.
    const stable = (value) =>
      Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'axm_monitor'));
    if (!isDeepStrictEqual(stable(expected), stable(after))) reject();
    return {
      stoppedConfigDigest: cutoverRegistrationConfigDigest(before),
      recoveredConfigDigest: cutoverRegistrationConfigDigest(after),
      restartCount: before.restart_time,
    };
  } catch {
    reject();
  }
}
const publicationSystem = {
  ...fs,
  platform: process.platform,
  uid: process.getuid?.(),
  now: Date.now,
};
/** Integrity reader, not a provider verifier: receipts must be produced by the
 * separately authorized provider rehearsal, never a CLI success/approval flag. */
export async function readCutoverRehearsalArtifacts(
  { binding, merchants },
  io = publicationSystem,
) {
  try {
    checkBinding(binding);
    if (io.platform !== 'linux' || io.uid !== 0 || !Array.isArray(merchants))
      throw new Error('input');
    const directory = '/var/lib/holaday-deploy/evidence-private';
    const folder = await io.lstat(directory);
    if (
      !folder.isDirectory() ||
      folder.uid !== 0 ||
      (folder.mode & 0o7777) !== 0o700 ||
      (await io.realpath(directory)) !== directory
    )
      throw new Error('directory');
    const read = async (name) => {
      const path = `${directory}/${name}`;
      const handle = await io.open(
        path,
        constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
      );
      try {
        const before = await handle.stat();
        if (
          !before.isFile() ||
          before.uid !== 0 ||
          (before.mode & 0o7777) !== 0o600 ||
          before.nlink !== 1 ||
          before.size < 1 ||
          before.size > 2 * 1024 * 1024
        )
          throw new Error('file');
        const bytes = await handle.readFile();
        const after = await handle.stat();
        const current = await io.lstat(path);
        const currentFolder = await io.lstat(directory);
        if (
          bytes.length !== before.size ||
          !Buffer.from(bytes.toString('utf8')).equals(bytes) ||
          before.ino !== after.ino ||
          before.dev !== after.dev ||
          before.size !== after.size ||
          before.mtimeMs !== after.mtimeMs ||
          before.ctimeMs !== after.ctimeMs ||
          after.ino !== current.ino ||
          after.dev !== current.dev ||
          after.mode !== current.mode ||
          current.uid !== 0 ||
          current.nlink !== 1 ||
          folder.ino !== currentFolder.ino ||
          folder.dev !== currentFolder.dev ||
          currentFolder.uid !== 0 ||
          (currentFolder.mode & 0o7777) !== 0o700 ||
          (await io.realpath(directory)) !== directory
        )
          throw new Error('changed');
        return bytes;
      } finally {
        await handle.close();
      }
    };
    const record = JSON.parse(
      (await read(`rehearsal-${binding.configDigest}.json`)).toString('utf8'),
    );
    if (
      record.schemaVersion !== 1 ||
      record.configDigest !== binding.configDigest ||
      record.inventoryDigest !== binding.inventoryDigest ||
      record.candidate !== binding.candidate ||
      !Number.isSafeInteger(record.observedAtMs) ||
      record.observedAtMs < 0 ||
      record.observedAtMs > io.now() ||
      !Number.isSafeInteger(record.recoveryUntilMs) ||
      record.recoveryUntilMs <= io.now() ||
      !['retry-proven', 'query-and-existing-settlement-proven'].includes(record.recovery) ||
      !Array.isArray(record.artifacts) ||
      record.artifacts.length !== merchants.length
    )
      throw new Error('record');
    const seen = new Set();
    for (const artifact of record.artifacts) {
      const key = JSON.stringify([
        artifact.provider,
        artifact.environment,
        artifact.merchantDigest,
      ]);
      const merchant = merchants.find(
        (m) =>
          m.provider === artifact.provider &&
          m.environment === artifact.environment &&
          m.merchantDigest === artifact.merchantDigest,
      );
      if (
        seen.has(key) ||
        !merchant ||
        !hash(artifact.codeDigest) ||
        artifact.codeDigest !== merchant.codeDigest
      )
        throw new Error('binding');
      seen.add(key);
      for (const field of [
        'transcriptDigest',
        ...(record.recovery === 'retry-proven'
          ? ['retryDigest']
          : ['queryDigest', 'settlementDigest']),
      ]) {
        const expected = artifact[field];
        if (!hash(expected)) throw new Error('digest');
        const bytes = await read(`${expected}.json`);
        if (createHash('sha256').update(bytes).digest('hex') !== expected)
          throw new Error('digest mismatch');
      }
    }
    const { schemaVersion: _schemaVersion, ...result } = record;
    return result;
  } catch {
    fail('MAINTENANCE_REHEARSAL_UNPROVEN');
  }
}

/** Called only by the collector's host adapter, under the shared release journal lock.
 * Fixed pre-provisioned directories; raw evidence is never application-readable. */
export async function publishCutoverEvidence(evidence, options, io = publicationSystem) {
  const handles = [];
  try {
    const report = evidence?.report;
    const binding = Object.fromEntries(bindingKeys.map((k) => [k, report?.[k]]));
    checkBinding(binding);
    if (
      io.platform !== 'linux' ||
      io.uid !== 0 ||
      !Number.isSafeInteger(options?.applicationGid) ||
      options.applicationGid <= 0 ||
      !['prepare', 'preopen'].includes(report.stage) ||
      !fresh(report.observedAtMs, io.now()) ||
      !evidence.raw
    )
      throw new Error('input');
    const assertJournal = async () => {
      const current = await options.assertJournalOwnership();
      if (!bindingKeys.every((key) => current?.[key] === binding[key])) throw new Error('journal');
      const first = await options.readFirstCutoverEffects?.();
      const projection = firstInterruptionProjection(
        first,
        {
          binding,
          stage: report.stage,
          identity: report.identity,
          kind: report.kind,
          riskDigest: report.legacyInterruption?.riskDigest,
          ...(report.host.deferredUnverifiedWork
            ? { deferredWorkSetFingerprint: navigationSet }
            : {}),
          window: report,
        },
        evidence.raw,
        io.now(),
      );
      if (projection) {
        validateCutoverDeferredWork({ ...report.host, unsettled: [] }, first);
        if (
          report.schemaVersion !== 2 ||
          !same(projection, report.legacyInterruption) ||
          !same(first, evidence.raw.firstCutover)
        )
          throw new Error('risk');
      } else if (
        report.schemaVersion !== 1 ||
        report.legacyInterruption !== undefined ||
        evidence.raw.firstCutover?.schemaVersion === 2
      )
        throw new Error('version');
    };
    await assertJournal();
    const folders = [
      { path: '/var/lib/holaday-deploy/evidence-private', mode: 0o700 },
      { path: '/var/lib/holaday-deploy/evidence', mode: 0o750 },
    ];
    for (const folder of folders) {
      const before = await io.lstat(folder.path);
      if (
        !before.isDirectory() ||
        before.uid !== 0 ||
        (before.mode & 0o7777) !== folder.mode ||
        (folder.mode === 0o750 && before.gid !== options.applicationGid) ||
        (await io.realpath(folder.path)) !== folder.path
      )
        throw new Error('directory');
      folder.stat = before;
      folder.handle = await io.open(
        folder.path,
        constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_DIRECTORY,
      );
      handles.push(folder.handle);
      const opened = await folder.handle.stat();
      if (opened.ino !== before.ino || opened.dev !== before.dev)
        throw new Error('directory changed');
    }
    const assertFolders = async () => {
      for (const folder of folders) {
        const current = await io.lstat(folder.path);
        if (
          current.ino !== folder.stat.ino ||
          current.dev !== folder.stat.dev ||
          current.uid !== 0 ||
          current.gid !== folder.stat.gid ||
          (current.mode & 0o7777) !== folder.mode ||
          (await io.realpath(folder.path)) !== folder.path
        )
          throw new Error('directory changed');
      }
    };
    const atomic = async (folder, name, bytes, mode) => {
      await assertFolders();
      const destination = `${folder.path}/${name}`;
      try {
        const existing = await io.lstat(destination);
        if (
          !existing.isFile() ||
          existing.uid !== 0 ||
          existing.nlink !== 1 ||
          (existing.mode & 0o7777) !== mode ||
          (mode === 0o640 && existing.gid !== options.applicationGid)
        )
          throw new Error('existing');
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
      const temporary = `${folder.path}/${report.attempt}.${randomUUID()}.tmp`;
      const file = await io.open(
        temporary,
        constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
        0o600,
      );
      try {
        const created = await file.stat();
        if (
          !created.isFile() ||
          created.uid !== 0 ||
          created.nlink !== 1 ||
          (created.mode & 0o7777) !== 0o600
        )
          throw new Error('file');
        await file.writeFile(bytes);
        if (mode === 0o640) await file.chown(0, options.applicationGid);
        await file.chmod(mode);
        await file.sync();
      } finally {
        await file.close();
      }
      await assertFolders();
      await assertJournal();
      await io.rename(temporary, destination);
      await folder.handle.sync();
    };
    const rawBytes = Buffer.from(`${JSON.stringify(evidence.raw)}\n`);
    const reportBytes = Buffer.from(`${JSON.stringify(report)}\n`);
    if (rawBytes.length > 32 * 1024 * 1024 || reportBytes.length > 256 * 1024)
      throw new Error('size');
    await atomic(
      folders[0],
      `${report.attempt}.${report.stage}.${randomUUID()}.json`,
      rawBytes,
      0o600,
    );
    await atomic(folders[1], `${report.attempt}.json`, reportBytes, 0o640);
    const reportDigest = createHash('sha256').update(reportBytes).digest('hex');
    const index = {
      ...binding,
      ...(report.schemaVersion === 2
        ? {
            kind: 'first-cutover',
            riskDigest: report.legacyInterruption.riskDigest,
            ...(report.host.deferredUnverifiedWork
              ? { deferredWorkSetFingerprint: navigationSet }
              : {}),
          }
        : {}),
      stage: report.stage,
      ...(report.identity ? { identity: report.identity } : {}),
      reportDigest,
    };
    if (!fresh(report.observedAtMs, io.now())) throw new Error('expired');
    await atomic(folders[1], 'active.json', Buffer.from(`${JSON.stringify(index)}\n`), 0o640);
    return { reportDigest, rawDigest: createHash('sha256').update(rawBytes).digest('hex') };
  } catch {
    fail('MAINTENANCE_EVIDENCE_PUBLICATION_UNPROVEN');
  } finally {
    for (const handle of handles.reverse()) await handle.close();
  }
}

const execFileAsync = promisify(execFile);
// This is the separately accepted legacy logger patch, never candidate dirty-tree permission.
export const reviewedLegacyLoggerPatch = Object.freeze({
  sourceCandidate: '107857fe70503e30691073f267d87275596edb20',
  path: 'apps/orchestrator/src/config/logger.ts',
  oldSha256: '62fba7e8e9bb31424a31a16e5ec7e3fcc3c26f0f247e04e3c5323710fdd8b30f',
  newSha256: '6267b11797b532cfa6469e977c53bf894d834dd1a360af92ddee0d7e07f59451',
  implementationCommit: '7b53058d',
  postObservationSha256: '79e7efb7173bbebe74aedb6c8f273fe880698ab2f7bd4964336184a307281719',
  acceptanceSha256: '670e7f39f580486bc0dc5a18bf9bc2a4fd1c7de307ee65dc0b5b51dbcac00a7c',
  configurationWitnessSha256: '8ce4fc2941b7d8952749dd051e40e32999f5b59b39cf9492b4d433fd6f042b72',
});

export function validateReviewedLegacyLoggerPatch(proof, sourceCandidate) {
  if (proof === undefined) return;
  if (
    sourceCandidate !== reviewedLegacyLoggerPatch.sourceCandidate ||
    !isDeepStrictEqual(proof, reviewedLegacyLoggerPatch)
  )
    throw new Error('CUTOVER_LEGACY_PATCH_UNPROVEN');
}

export async function readReviewedLegacyCheckout(io = hostSystem) {
  const root = '/opt/holaday-monorepo';
  const git = (args) => io.exec('git', ['-C', root, ...args]);
  const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
  const stableStat = (s) => [
    s.dev,
    s.ino,
    s.uid,
    s.gid,
    s.mode,
    s.nlink,
    s.size,
    s.mtimeMs,
    s.ctimeMs,
  ];
  const head = () => git(['rev-parse', '--verify', 'HEAD^{commit}']);
  // Preserve the original tracked-source gate; unrelated historical artifacts are not a clean-workdir claim.
  const status = () => git(['status', '--porcelain=v1', '--untracked-files=no']);
  try {
    const candidate = (await head()).trim();
    if (!/^[a-f0-9]{40}$/.test(candidate)) throw new Error('head');
    const beforeStatus = await status();
    if (beforeStatus === '') {
      await git(['diff', '--no-ext-diff', '--no-textconv', '--quiet', 'HEAD', '--']);
      if ((await head()).trim() !== candidate || (await status()) !== beforeStatus)
        throw new Error('changed');
      return { sourceCandidate: candidate };
    }
    const policy = reviewedLegacyLoggerPatch;
    if (candidate !== policy.sourceCandidate || beforeStatus !== ` M ${policy.path}\n`)
      throw new Error('scope');
    const path = `${root}/${policy.path}`;
    const before = await io.lstat(path);
    if (
      !before.isFile() ||
      before.isSymbolicLink() ||
      before.uid !== 0 ||
      before.gid !== 0 ||
      before.nlink !== 1 ||
      (before.mode & 0o777) !== 0o644 ||
      before.size < 1 ||
      before.size > 65536
    )
      throw new Error('file');
    const handle = await io.open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    let bytes;
    try {
      if (!isDeepStrictEqual(stableStat(before), stableStat(await handle.stat())))
        throw new Error('opened');
      bytes = await handle.readFile();
      if (
        bytes.length !== before.size ||
        digest(bytes) !== policy.newSha256 ||
        !isDeepStrictEqual(stableStat(before), stableStat(await handle.stat()))
      )
        throw new Error('content');
    } finally {
      await handle.close();
    }
    const original = await git(['show', `HEAD:${policy.path}`]);
    if (
      Buffer.byteLength(original) > 65536 ||
      digest(original) !== policy.oldSha256 ||
      !isDeepStrictEqual(stableStat(before), stableStat(await io.lstat(path))) ||
      (await head()).trim() !== candidate ||
      (await status()) !== beforeStatus
    )
      throw new Error('changed');
    return { sourceCandidate: candidate, reviewedPatch: structuredClone(policy) };
  } catch {
    throw new Error('CUTOVER_LEGACY_CHECKOUT_UNPROVEN');
  }
}

const hostSystem = {
  ...fs,
  platform: process.platform,
  uid: process.getuid?.(),
  now: Date.now,
  readFile,
  readlink,
  readdir,
  exec: async (command, args) => {
    const result = await execFileAsync(command, args, {
      encoding: 'utf8',
      timeout: 10_000,
      maxBuffer: 8 * 1024 * 1024,
      env: { ...process.env, PM2_HOME: '/root/.pm2', LC_ALL: 'C' },
    });
    return result.stdout;
  },
  nginxSnapshot: () => readCutoverNginxSnapshot(),
  startupSnapshot: () => readCutoverStartupSnapshot(),
  pm2RuntimeSnapshot: () => readCutoverPM2RuntimeSnapshot(),
};

/** Observe the installed, explicitly supported PM2 stop defaults and the live
 * daemon's overrides. Never execute source text or return its other environment.
 * Version/source/daemon drift is refusal, not a guessed 1600ms/SIGINT fallback. */
export async function readCutoverPM2RuntimeSnapshot(io = hostSystem) {
  try {
    if (io.platform !== 'linux' || io.uid !== 0) throw new Error('host');
    const started = io.now();
    const read = async (path) => {
      const value = await io.readFile(path, 'utf8');
      if (typeof value !== 'string' || Buffer.byteLength(value) > 2 * 1024 * 1024)
        throw new Error('source');
      return value;
    };
    const pass = async () => {
      const rawPid = await read('/root/.pm2/pm2.pid');
      if (!/^[1-9]\d*\n?$/.test(rawPid)) throw new Error('pid');
      const pid = Number(rawPid.trim());
      if (!Number.isSafeInteger(pid) || pid <= 1) throw new Error('pid');
      const pkg = await read('/usr/lib/node_modules/pm2/package.json');
      const source = await read('/usr/lib/node_modules/pm2/constants.js');
      const version = JSON.parse(pkg).version;
      if (
        version !== '6.0.14' ||
        (await read(`/proc/${pid}/cmdline`)).replace(/\0+$/, '') !==
          'PM2 v6.0.14: God Daemon (/root/.pm2)' ||
        !/^\s*KILL_TIMEOUT\s*:\s*process\.env\.PM2_KILL_TIMEOUT \|\| 1600,\s*$/m.test(source) ||
        !/^\s*KILL_SIGNAL\s*:\s*process\.env\.PM2_KILL_SIGNAL \|\| 'SIGINT',\s*$/m.test(source)
      )
        throw new Error('unsupported defaults');
      const entries = (await read(`/proc/${pid}/environ`))
        .split('\0')
        .filter((value) => /^PM2_KILL_(SIGNAL|TIMEOUT)=/.test(value));
      const pairs = entries.map((value) => [
        value.slice(0, value.indexOf('=')),
        value.slice(value.indexOf('=') + 1),
      ]);
      if (new Set(pairs.map(([key]) => key)).size !== pairs.length) throw new Error('duplicate');
      const settings = Object.fromEntries(pairs);
      const timeout = settings.PM2_KILL_TIMEOUT || '1600';
      const killSignal = settings.PM2_KILL_SIGNAL || 'SIGINT';
      if (!/^[1-9]\d*$/.test(timeout) || !['SIGINT', 'SIGTERM'].includes(killSignal))
        throw new Error('settings');
      const killTimeoutMs = Number(timeout);
      if (!Number.isSafeInteger(killTimeoutMs) || killTimeoutMs > 900000)
        throw new Error('timeout');
      return {
        pid,
        version,
        killSignal,
        killTimeoutMs,
        sourceDigest: digest({ pkg, source, settings }),
      };
    };
    const result = await pass();
    if (!same(result, await pass()) || !fresh(started, io.now())) throw new Error('drift');
    return result;
  } catch {
    fail('MAINTENANCE_PM2_OBSERVATION_UNPROVEN');
  }
}

/** Private raw startup evidence only, not an authorization to retire anything.
 * Covers PM2's two independent dumps, its effective system unit, local/runtime
 * systemd configuration, system cron and Debian/Ubuntu per-user crontabs.
 * Unit contents may refer to further scripts/configuration: the site classifier
 * must resolve those dependencies; this does not claim all launchers are known. */
export async function readCutoverStartupSnapshot(io = hostSystem) {
  try {
    if (io.platform !== 'linux' || io.uid !== 0) throw new Error('host');
    const observedAtMs = io.now();
    const fixedFiles = [
      '/root/.pm2/dump.pm2',
      '/root/.pm2/dump.pm2.bak',
      '/etc/crontab',
      '/etc/anacrontab',
      '/etc/rc.local',
      '/opt/holaday-cn-payment/start.sh',
      '/var/lib/holaday-deploy/start-orchestrator-production.sh',
      '/var/lib/holaday-deploy/start-account-closure-worker-production.sh',
      '/opt/holaday-monorepo/start-files-cron.sh',
      '/opt/holaday-headed/start.sh',
      '/opt/holaday-vnc/start.sh',
    ];
    const fixedDirectories = [
      '/etc/systemd/system',
      '/run/systemd/system',
      '/etc/cron.d',
      '/etc/cron.hourly',
      '/etc/cron.daily',
      '/etc/cron.weekly',
      '/etc/cron.monthly',
      '/etc/cron.yearly',
      '/var/spool/cron/crontabs',
    ];
    const metadata = (s) =>
      Object.fromEntries(
        ['dev', 'ino', 'uid', 'gid', 'mode', 'nlink', 'size', 'mtimeMs', 'ctimeMs'].map((k) => [
          k,
          s[k],
        ]),
      );
    const pathOK = (p) =>
      typeof p === 'string' && p.startsWith('/') && posix.normalize(p) === p && !/[\r\n\0]/.test(p);
    const pass = async () => {
      const pm2Unit = await io.exec('systemctl', [
        'show',
        'pm2-root.service',
        '--no-pager',
        '--property=Id,LoadState,ActiveState,SubState,UnitFileState,FragmentPath,DropInPaths,ExecStart,ExecStop,Restart',
      ]);
      if (typeof pm2Unit !== 'string' || Buffer.byteLength(pm2Unit) > 1024 * 1024)
        throw new Error('unit');
      const properties = new Map(
        pm2Unit
          .trimEnd()
          .split('\n')
          .map((line) => {
            const i = line.indexOf('=');
            if (i < 1) throw new Error('property');
            return [line.slice(0, i), line.slice(i + 1)];
          }),
      );
      if (properties.get('Id') !== 'pm2-root.service' || properties.get('LoadState') !== 'loaded')
        throw new Error('unit not loaded');
      const fragment = properties.get('FragmentPath');
      const dropIns = properties.get('DropInPaths');
      if (!pathOK(fragment) || typeof dropIns !== 'string' || /[\\\r\n]/.test(dropIns))
        throw new Error('unit paths');
      const unitFiles = [fragment, ...dropIns.split(' ').filter(Boolean)];
      const files = [];
      const directories = [];
      const visited = new Set();
      let totalBytes = 0;
      const visit = async (path, optional, ancestors = []) => {
        if (!pathOK(path) || ancestors.length > 12) throw new Error('path');
        if (visited.has(path)) return;
        if (visited.size >= 2048) throw new Error('inventory limit');
        visited.add(path);
        let link;
        try {
          link = await io.lstat(path);
        } catch (error) {
          if (optional && error.code === 'ENOENT') {
            files.push({ path, present: false });
            return;
          }
          throw error;
        }
        const resolved = await io.realpath(path);
        if (!pathOK(resolved)) throw new Error('resolved');
        const before = await io.lstat(resolved);
        const record = {
          path,
          present: true,
          resolved,
          link: metadata(link),
          stat: metadata(before),
        };
        if (before.isDirectory()) {
          if (ancestors.includes(resolved)) throw new Error('directory cycle');
          const entries = (await io.readdir(path)).sort();
          if (
            entries.length > 2048 ||
            entries.some((name) => !name || name === '.' || name === '..' || /[/\r\n\0]/.test(name))
          )
            throw new Error('entries');
          directories.push({ ...record, entries });
          for (const name of entries)
            await visit(`${path}/${name}`, false, [...ancestors, resolved]);
          if (!same(entries, (await io.readdir(path)).sort())) throw new Error('directory drift');
        } else if (
          resolved === '/dev/null' &&
          link.isSymbolicLink() &&
          before.isCharacterDevice()
        ) {
          files.push({ ...record, masked: true });
        } else {
          if (!before.isFile() || before.size > 8 * 1024 * 1024) throw new Error('file');
          totalBytes += before.size;
          if (totalBytes > 12 * 1024 * 1024) throw new Error('bytes');
          const handle = await io.open(
            resolved,
            constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
          );
          try {
            if (!same(metadata(before), metadata(await handle.stat())))
              throw new Error('opened drift');
            const buffer = Buffer.alloc(before.size + 1);
            let count = 0;
            while (count < buffer.length) {
              const { bytesRead } = await handle.read(buffer, count, buffer.length - count, null);
              if (!bytesRead) break;
              count += bytesRead;
            }
            const bytes = buffer.subarray(0, count);
            if (
              count !== before.size ||
              !Buffer.from(bytes.toString('utf8')).equals(bytes) ||
              !same(metadata(before), metadata(await handle.stat()))
            )
              throw new Error('read drift');
            files.push({
              ...record,
              digest: createHash('sha256').update(bytes).digest('hex'),
              content: bytes.toString('utf8'),
            });
          } finally {
            await handle.close();
          }
        }
        if (
          (await io.realpath(path)) !== resolved ||
          !same(metadata(link), metadata(await io.lstat(path))) ||
          !same(metadata(before), metadata(await io.lstat(resolved)))
        )
          throw new Error('path drift');
      };
      for (const path of [...fixedFiles, ...fixedDirectories]) await visit(path, true);
      for (const path of unitFiles) await visit(path, false);
      return { files, directories, pm2Unit };
    };
    const result = await pass();
    if (!same(result, await pass()) || !fresh(observedAtMs, io.now())) throw new Error('changed');
    return { observedAtMs, ...result };
  } catch {
    fail('MAINTENANCE_STARTUP_OBSERVATION_UNPROVEN');
  }
}

/** Disk configuration tested by nginx, NOT proof of the running workers' config.
 * Preserve all included source bytes and resolved ownership for the host classifier.
 * A linked release owned by another UID is observed, never treated as root-writable.
 * Raw sources belong only in the existing private evidence archive, not public reports. */
export async function readCutoverNginxSnapshot(io = hostSystem) {
  try {
    if (io.platform !== 'linux' || io.uid !== 0) throw new Error('host');
    const observedAtMs = io.now();
    const dump = await io.exec('nginx', ['-T']);
    if (typeof dump !== 'string' || !dump.length || Buffer.byteLength(dump) > 8 * 1024 * 1024)
      throw new Error('dump');
    const statKeys = ['dev', 'ino', 'uid', 'gid', 'mode', 'nlink', 'size', 'mtimeMs', 'ctimeMs'];
    const sameStat = (a, b) => statKeys.every((key) => a[key] === b[key]);
    const readSource = async (path) => {
      if (!path.startsWith('/') || posix.normalize(path) !== path || /[\r\n\0]/.test(path))
        throw new Error('path');
      const resolved = await io.realpath(path);
      const handle = await io.open(
        resolved,
        constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
      );
      try {
        const before = await handle.stat();
        if (!before.isFile() || before.size > 1024 * 1024) throw new Error('source');
        // Bound reads even if the file grows after fstat; readFile would be unbounded.
        const buffer = Buffer.alloc(before.size + 1);
        let count = 0;
        while (count < buffer.length) {
          const { bytesRead } = await handle.read(buffer, count, buffer.length - count, null);
          if (!bytesRead) break;
          count += bytesRead;
        }
        const bytes = buffer.subarray(0, count);
        const after = await handle.stat();
        const current = await io.lstat(resolved);
        if (
          count !== before.size ||
          !sameStat(before, after) ||
          !sameStat(after, current) ||
          (await io.realpath(path)) !== resolved ||
          !Buffer.from(bytes.toString('utf8')).equals(bytes)
        )
          throw new Error('drift');
        return {
          record: {
            path,
            resolved,
            uid: after.uid,
            gid: after.gid,
            mode: after.mode & 0o7777,
            digest: createHash('sha256').update(bytes).digest('hex'),
            content: bytes.toString('utf8'),
          },
          stat: after,
        };
      } finally {
        await handle.close();
      }
    };
    const sources = [];
    const seen = new Set();
    let offset = 0;
    // nginx emits each header followed by exact file bytes and one added newline.
    // Consume the source length, not a regex split that could mistake a source comment
    // containing '# configuration file' for another included file.
    while (offset < dump.length) {
      const header = /^# configuration file (\/[^\r\n\0]+):\n/.exec(dump.slice(offset));
      if (!header || seen.has(header[1]) || sources.length >= 128) throw new Error('inventory');
      seen.add(header[1]);
      const source = await readSource(header[1]);
      const segment = `${header[0]}${source.record.content}\n`;
      if (!dump.startsWith(segment, offset)) throw new Error('mismatch');
      sources.push(source);
      offset += segment.length;
    }
    if ((await io.exec('nginx', ['-T'])) !== dump) throw new Error('dump changed');
    for (const source of sources) {
      const last = await readSource(source.record.path);
      if (
        last.record.resolved !== source.record.resolved ||
        last.record.digest !== source.record.digest ||
        !sameStat(source.stat, last.stat)
      )
        throw new Error('source changed');
    }
    if (!fresh(observedAtMs, io.now())) throw new Error('clock');
    return { observedAtMs, dump, files: sources.map((source) => source.record) };
  } catch {
    fail('MAINTENANCE_NGINX_OBSERVATION_UNPROVEN');
  }
}

// Shared collector; ordinary host snapshots keep their original filtered shape.
// Complete mode is private recovery evidence, never a new process allowlist.
async function readHostProcesses(io, complete = false) {
  let cloudDiagnosticStage = 'HOST_ENTRY';
  const atStage = (stage, read) => {
    cloudDiagnosticStage = stage;
    return read();
  };
  const start = (raw, pid) => {
    const value = String(raw);
    if (!value.startsWith(`${pid} (`)) throw cutoverCloudObservationError('pid', 'HOST_T01');
    const stamp = value
      .slice(value.lastIndexOf(')') + 2)
      .trim()
      .split(/\s+/)[19];
    if (!/^\d+$/.test(stamp ?? '')) throw cutoverCloudObservationError('start', 'HOST_T02');
    return stamp;
  };
  const all = [];
  const excluded = [];
  const included = new Set();
  const names = (await atStage('HOST_IO_01', () => io.readdir('/proc')))
    .filter((p) => /^[1-9]\d*$/.test(p))
    .sort();
  if (complete && (names.length > 16384 || new Set(names).size !== names.length))
    throw cutoverCloudObservationError('count', 'HOST_T03');
  const metadata = async (pid) => {
    const raw = String(await atStage('HOST_IO_02', () => io.readFile(`/proc/${pid}/stat`, 'utf8')));
    const stamp = start(raw, pid);
    const fields = raw
      .slice(raw.lastIndexOf(')') + 2)
      .trim()
      .split(/\s+/);
    const ppid = Number(fields[1]);
    const flags = Number(fields[6]);
    if (
      !Number.isSafeInteger(pid) ||
      !Number.isSafeInteger(ppid) ||
      ppid < 0 ||
      !Number.isSafeInteger(flags) ||
      flags < 0 ||
      flags > 0xffffffff
    )
      throw cutoverCloudObservationError('stat', 'HOST_T04');
    // PF_KTHREAD is a kernel fact, not an inference from empty cmdline. Zombies
    // cannot execute; retain their identity privately across both census passes.
    if ((flags & 0x00200000) !== 0 || fields[0] === 'Z')
      return {
        pid,
        start: stamp,
        ppid,
        flags,
        state: fields[0] === 'Z' ? 'zombie' : 'kernel',
        excluded: true,
      };
    const state = ['R', 'S', 'D', 'I'].includes(fields[0])
      ? 'live'
      : ['T', 't'].includes(fields[0])
        ? 'stopped'
        : null;
    if (!state) throw cutoverCloudObservationError('state', 'HOST_T05');
    const status = String(
      await atStage('HOST_IO_03', () => io.readFile(`/proc/${pid}/status`, 'utf8')),
    );
    if (Number(/^PPid:\s+(\d+)/m.exec(status)?.[1]) !== ppid)
      throw cutoverCloudObservationError('parent', 'HOST_T06');
    const noNewPrivs = Number(/^NoNewPrivs:\s+([01])\s*$/m.exec(status)?.[1]);
    if (![0, 1].includes(noNewPrivs)) throw cutoverCloudObservationError('privileges', 'HOST_T07');
    const capabilities = {};
    for (const key of ['CapInh', 'CapPrm', 'CapEff', 'CapBnd', 'CapAmb']) {
      const value = new RegExp(`^${key}:\\s+([0-9a-f]{1,16})\\s*$`, 'm').exec(status)?.[1];
      if (!value) throw cutoverCloudObservationError('capability', 'HOST_T08');
      capabilities[key] = value;
    }
    const mountNamespace = await atStage('HOST_IO_04', () => io.readlink(`/proc/${pid}/ns/mnt`));
    if (!/^mnt:\[\d+\]$/.test(mountNamespace))
      throw cutoverCloudObservationError('namespace', 'HOST_T09');
    return { start: stamp, ppid, extra: { mountNamespace, state, noNewPrivs, capabilities } };
  };
  for (const name of names) {
    const pid = Number(name);
    const root = `/proc/${pid}`;
    try {
      const meta = complete ? await atStage('HOST_IO_05', () => metadata(pid)) : null;
      if (meta?.excluded) {
        if (!same(meta, await atStage('HOST_IO_06', () => metadata(pid))))
          throw cutoverCloudObservationError('changed', 'HOST_T10');
        excluded.push(meta);
        continue;
      }
      const cmdline = String(
        await atStage('HOST_IO_07', () => io.readFile(`${root}/cmdline`, 'utf8')),
      );
      if (!cmdline) {
        if (complete) throw cutoverCloudObservationError('empty userspace command', 'HOST_T11');
        continue;
      }
      const status = String(
        await atStage('HOST_IO_08', () => io.readFile(`${root}/status`, 'utf8')),
      );
      const match = /^Uid:\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*$/m.exec(status);
      if (!match) throw cutoverCloudObservationError('uid', 'HOST_T12');
      const uids = match.slice(1).map(Number);
      const before = start(
        await atStage('HOST_IO_09', () => io.readFile(`${root}/stat`, 'utf8')),
        pid,
      );
      const cwd = await atStage('HOST_IO_10', () => io.readlink(`${root}/cwd`));
      const exe = await atStage('HOST_IO_11', () => io.readlink(`${root}/exe`));
      const cgroup = String(
        await atStage('HOST_IO_12', () => io.readFile(`${root}/cgroup`, 'utf8')),
      );
      const after = start(
        await atStage('HOST_IO_13', () => io.readFile(`${root}/stat`, 'utf8')),
        pid,
      );
      const ppid = Number(/^PPid:\s+(\d+)/m.exec(status)?.[1]);
      if (!Number.isSafeInteger(ppid) || ppid < 0)
        throw cutoverCloudObservationError('parent', 'HOST_T13');
      if (
        complete &&
        (meta.start !== before ||
          meta.ppid !== ppid ||
          !same(meta, await atStage('HOST_IO_14', () => metadata(pid))) ||
          uids.some((uid) => !Number.isSafeInteger(uid) || uid < 0) ||
          ![cwd, exe].every(
            (path) => typeof path === 'string' && path.startsWith('/') && path.length <= 4096,
          ))
      )
        throw cutoverCloudObservationError('identity', 'HOST_T14');
      const afterStatus = String(
        await atStage('HOST_IO_15', () => io.readFile(`${root}/status`, 'utf8')),
      );
      const afterUids = /^Uid:\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*$/m
        .exec(afterStatus)
        ?.slice(1)
        .map(Number);
      if (
        before !== after ||
        cmdline !==
          String(await atStage('HOST_IO_16', () => io.readFile(`${root}/cmdline`, 'utf8'))) ||
        !same(uids, afterUids) ||
        ppid !== Number(/^PPid:\s+(\d+)/m.exec(afterStatus)?.[1]) ||
        cwd !== (await atStage('HOST_IO_17', () => io.readlink(`${root}/cwd`))) ||
        exe !== (await atStage('HOST_IO_18', () => io.readlink(`${root}/exe`))) ||
        cgroup !== String(await atStage('HOST_IO_19', () => io.readFile(`${root}/cgroup`, 'utf8')))
      )
        throw cutoverCloudObservationError('changed', 'HOST_T15');
      if (
        uids.includes(998) ||
        /holaday|(?:^|\/)node(?:\0|$)/i.test(cmdline) ||
        /\/node(?: \(deleted\))?$/.test(exe) ||
        // Crashpad reparents to PID 1 and may have no project marker in argv.
        // Retain exact executable candidates for review, including deleted
        // loaded images. Selection does NOT associate or authorize a stop.
        /^\/opt\/brave\.com\/brave\/chrome_crashpad_handler(?: \(deleted\))?$/.test(exe)
      )
        included.add(pid);
      all.push({
        pid,
        start: before,
        ppid,
        uids,
        cwd,
        exe,
        argvDigest: digest(cmdline),
        cgroup,
        ...(complete ? meta.extra : {}),
      });
    } catch (error) {
      // Preserve only an actual missing /proc entry for bounded COMPLETE
      // recollection. Never skip this PID or turn permission/identity errors
      // into process exit. All partial rows from this pass are discarded.
      if (complete && error?.code === 'ENOENT')
        throw Object.assign(
          cutoverCloudObservationError('PROCESS_SAMPLE_DISAPPEARED', cloudDiagnosticStage, error),
          { code: 'ENOENT' },
        );
      throw cutoverCloudObservationError(
        'MAINTENANCE_HOST_OBSERVATION_UNPROVEN',
        cloudDiagnosticStage,
        error,
      );
    }
  }
  if (complete) return { processes: all.sort((a, b) => a.pid - b.pid), excluded };
  // Select after reading the parent graph: shell/esbuild/browser descendants
  // need not carry a recognizable name, and /proc order is not tree order.
  let changed;
  do {
    changed = false;
    for (const process of all) {
      if (included.has(process.ppid) && !included.has(process.pid)) {
        included.add(process.pid);
        changed = true;
      }
    }
  } while (changed);
  return all.filter((process) => included.has(process.pid));
}

/** Bounded, unfiltered native census for the original recovery consumer. Raw
 * cmdline/status never escape; errors intentionally contain no private bytes.
 * Two equal samples bound observation, not continuous lineage or past effects.
 */
function sameExecutableCensus(first, second) {
  const firstPids = new Set(first.excluded.map((row) => row.pid));
  const secondPids = new Set(second.excluded.map((row) => row.pid));
  // Every excluded identity has already passed its original metadata double read.
  // Ignore only unshared, PF_KTHREAD-proven kernel additions/removals. Shared
  // identities and zombies retain every original field in the strict comparison.
  const retained = (row, otherPids) =>
    otherPids.has(row.pid) || row.state !== 'kernel' || (row.flags & 0x00200000) === 0;
  return same(
    { ...first, excluded: first.excluded.filter((row) => retained(row, secondPids)) },
    { ...second, excluded: second.excluded.filter((row) => retained(row, firstPids)) },
  );
}

export async function readFirstCutoverCloudRecoveryCensus(overrides = {}) {
  let cloudDiagnosticStage = 'CENSUS_ENTRY';
  const atStage = (stage, read) => {
    cloudDiagnosticStage = stage;
    return read();
  };
  const io = {
    ...fs,
    platform: process.platform,
    uid: process.getuid?.(),
    hostname,
    now: Date.now,
    ...overrides,
  };
  try {
    if (io.platform !== 'linux' || io.uid !== 0)
      throw cutoverCloudObservationError('host', 'CENSUS_T01');
    const began = io.now();
    let last = began;
    let budget = 64 * 1024 * 1024;
    const clock = () => {
      const now = io.now();
      if (
        !Number.isSafeInteger(began) ||
        began < 0 ||
        !Number.isSafeInteger(now) ||
        now < last ||
        now - began > 60000
      )
        throw cutoverCloudObservationError('clock', 'CENSUS_T02');
      last = now;
      return now;
    };
    const readFile = async (path) => {
      clock();
      const handle = await atStage('CENSUS_IO_01', () =>
        io.open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK),
      );
      try {
        const buffer = Buffer.alloc(262145);
        let size = 0;
        while (size < buffer.length) {
          const { bytesRead } = await atStage('CENSUS_IO_02', () =>
            handle.read(buffer, size, buffer.length - size, size),
          );
          if (!Number.isSafeInteger(bytesRead) || bytesRead < 0 || bytesRead > buffer.length - size)
            throw cutoverCloudObservationError('read', 'CENSUS_T03');
          if (!bytesRead) break;
          size += bytesRead;
        }
        budget -= size;
        if (size > 262144 || budget < 0) throw cutoverCloudObservationError('size', 'CENSUS_T04');
        const bytes = buffer.subarray(0, size);
        const value = bytes.toString('utf8');
        if (!Buffer.from(value).equals(bytes))
          throw cutoverCloudObservationError('encoding', 'CENSUS_T05');
        return value;
      } catch (error) {
        rememberCutoverCloudObservationFailure(error, cloudDiagnosticStage);
        throw error;
      } finally {
        await atStage('CENSUS_IO_03', () => handle.close());
      }
    };
    const machine = io.hostname();
    const bootId = (
      await atStage('CENSUS_IO_04', () => readFile('/proc/sys/kernel/random/boot_id'))
    ).trim();
    if (
      !/^[a-zA-Z0-9.-]{1,128}$/.test(machine) ||
      !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(bootId)
    )
      throw cutoverCloudObservationError('identity', 'CENSUS_T06');
    const sampling = { ...io, readFile };
    // Three complete attempts share one time/byte budget. Only a genuine
    // disappearing /proc entry can restart the read; two unequal successful
    // samples, changed identity, malformed data and permissions remain fatal.
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const first = await atStage('CENSUS_IO_05', () => readHostProcesses(sampling, true));
        if (
          !sameExecutableCensus(
            first,
            await atStage('CENSUS_IO_06', () => readHostProcesses(sampling, true)),
          ) ||
          machine !== io.hostname() ||
          bootId !==
            (
              await atStage('CENSUS_IO_07', () => readFile('/proc/sys/kernel/random/boot_id'))
            ).trim()
        )
          throw cutoverCloudObservationError('changed', 'CENSUS_T07');
        return { hostname: machine, bootId, observedAtMs: clock(), processes: first.processes };
      } catch (error) {
        if (error?.code !== 'ENOENT' || attempt === 2) throw error;
        clock();
        if (
          machine !== io.hostname() ||
          bootId !==
            (
              await atStage('CENSUS_IO_08', () => readFile('/proc/sys/kernel/random/boot_id'))
            ).trim()
        )
          throw cutoverCloudObservationError('changed', 'CENSUS_T08');
      }
    }
  } catch (error) {
    throw cutoverCloudObservationError(
      'CUTOVER_CLOUD_RECOVERY_CENSUS_UNPROVEN',
      cloudDiagnosticStage,
      error,
    );
  }
}

/** Read facts only; callers must classify every process/startup/route before acceptance.
 * No environment-variable absence or missing PM2 row establishes non-writer status. */
export async function readCutoverHostSnapshot(io = hostSystem) {
  if (io.platform !== 'linux' || io.uid !== 0) fail('MAINTENANCE_HOST_OBSERVATION_UNPROVEN');
  try {
    const observedAtMs = io.now();
    const machine = (io.hostname ?? hostname)();
    if (!/^[a-zA-Z0-9.-]{1,128}$/.test(machine)) throw new Error('host identity');
    const bootId = String(await io.readFile('/proc/sys/kernel/random/boot_id', 'utf8')).trim();
    if (!/^[a-f0-9-]{36}$/.test(bootId)) throw new Error('boot identity');
    const readProcesses = () => readHostProcesses(io);
    const processes = await readProcesses();
    const pm2Runtime = await io.pm2RuntimeSnapshot();
    const readManagers = async () => {
      const rows = JSON.parse(await io.exec('pm2', ['jlist']));
      if (
        !Array.isArray(rows) ||
        rows.length > 10000 ||
        rows.some(
          (row) =>
            !row?.pm2_env ||
            typeof row.pm2_env !== 'object' ||
            Array.isArray(row.pm2_env) ||
            !Number.isSafeInteger(row.pm_id) ||
            row.pm_id < 0 ||
            typeof row.name !== 'string' ||
            (['holaday-vnc', 'holaday-chromium-headed'].includes(row.name) &&
              (!Number.isSafeInteger(row.pm2_env.restart_time) || row.pm2_env.restart_time < 0)),
        ) ||
        new Set(rows.map((row) => row.pm_id)).size !== rows.length
      )
        throw new Error('manager');
      return rows
        .map((row) => ({
          pid: row.pid,
          name: row.name,
          pmId: row.pm_id,
          cwd: row.pm2_env?.pm_cwd,
          execPath: row.pm2_env?.pm_exec_path,
          interpreter: row.pm2_env?.exec_interpreter,
          argsDigest: digest(row.pm2_env?.args ?? []),
          status: row.pm2_env?.status,
          autorestart: row.pm2_env?.autorestart,
          watch: row.pm2_env?.watch,
          maxMemoryRestart: row.pm2_env?.max_memory_restart,
          cronRestart: row.pm2_env?.cron_restart,
          killTimeoutMs: row.pm2_env.kill_timeout,
          configDigest: cutoverRegistrationConfigDigest(row.pm2_env),
          ...(['holaday-vnc', 'holaday-chromium-headed'].includes(row.name)
            ? {
                stopConfigDigest: cutoverCloudStopConfigDigest(row.pm2_env),
                restartCount: row.pm2_env.restart_time,
              }
            : {}),
        }))
        .sort((a, b) => a.pmId - b.pmId);
    };
    const managers = await readManagers();
    const listeners = await io.exec('ss', ['-H', '-ltnp']);
    const tcpBefore = await io.exec('ss', ['-H', '-antp']);
    const nginx = await io.nginxSnapshot();
    const systemd = await io.exec('systemctl', [
      'list-units',
      '--type=service',
      '--all',
      '--no-pager',
      '--no-legend',
    ]);
    const unitFiles = await io.exec('systemctl', [
      'list-unit-files',
      '--type=service',
      '--no-pager',
      '--no-legend',
    ]);
    const timers = await io.exec('systemctl', [
      'list-timers',
      '--all',
      '--no-pager',
      '--no-legend',
    ]);
    const readRootCrontab = async () => {
      try {
        return { present: true, content: await io.exec('crontab', ['-l']) };
      } catch (error) {
        // LC_ALL=C: only this exact, successful observation of absence is normal.
        // Permission errors, partial output and interrupted commands remain fatal.
        if (
          error.code === 1 &&
          error.stdout === '' &&
          error.stderr === 'no crontab for root\n' &&
          error.killed === false &&
          error.signal === null
        )
          return { present: false, content: '' };
        throw error;
      }
    };
    const rootCrontab = await readRootCrontab();
    const startup = await io.startupSnapshot();
    const tcpAfter = await io.exec('ss', ['-H', '-antp']);
    if (
      [tcpBefore, tcpAfter].some(
        (value) => typeof value !== 'string' || Buffer.byteLength(value) > 8 * 1024 * 1024,
      ) ||
      String(await io.readFile('/proc/sys/kernel/random/boot_id', 'utf8')).trim() !== bootId ||
      (io.hostname ?? hostname)() !== machine ||
      !same(processes, await readProcesses()) ||
      !same(managers, await readManagers()) ||
      !same(pm2Runtime, await io.pm2RuntimeSnapshot()) ||
      !same(rootCrontab, await readRootCrontab()) ||
      !fresh(observedAtMs, io.now())
    )
      throw new Error('changed');
    return {
      observedAtMs,
      bootId,
      hostname: machine,
      processes,
      managers,
      pm2Runtime,
      listeners,
      tcp: { before: tcpBefore, after: tcpAfter },
      nginx: nginx.dump,
      nginxFiles: nginx.files,
      systemd,
      unitFiles,
      timers,
      cron: rootCrontab.content,
      rootCrontabPresent: rootCrontab.present,
      startup,
    };
  } catch {
    fail('MAINTENANCE_HOST_OBSERVATION_UNPROVEN');
  }
}

const digest = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const hash = (value) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const fresh = (stamp, now) =>
  Number.isSafeInteger(stamp) && stamp >= 0 && stamp <= now && now - stamp <= 60_000;
const fail = (code = 'MAINTENANCE_PAYMENT_BOUNDARY_UNPROVEN') => {
  throw new Error(code);
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const deferralRef = 'paypal-sandbox-20260927';
const alipayDeferralRef = 'alipay-historical-20260927';
const approvedAlipaySetDigest = '6e81aade39333ad180272497a70b06aeffb57194a643c525fde264684df69686';
function checkAlipayDeferralApproval(approval) {
  if (
    !approval ||
    Object.keys(approval).sort().join(',') !== 'approvalRef,recordDigests' ||
    approval.approvalRef !== alipayDeferralRef ||
    !Array.isArray(approval.recordDigests) ||
    approval.recordDigests.length !== 9 ||
    !approval.recordDigests.every(hash) ||
    new Set(approval.recordDigests).size !== 9
  )
    fail();
}
function checkDeferralApproval(approval) {
  if (
    !approval ||
    Object.keys(approval).sort().join(',') !== 'approvalRef,recordDigest' ||
    approval.approvalRef !== deferralRef ||
    !hash(approval.recordDigest)
  )
    fail();
}
function checkDeferredScope(scope, inventory) {
  const deferred = scope.deferredUnverified ?? [];
  const approval = inventory.deferredSandboxPayment;
  const alipayApproval = inventory.deferredAlipayPayments;
  if (!Array.isArray(deferred) || deferred.length > 10) fail();
  const paypal = deferred.filter((row) => row?.approvalRef === deferralRef);
  const alipay = deferred.filter((row) => row?.approvalRef === alipayDeferralRef);
  if (paypal.length + alipay.length !== deferred.length) fail();
  if (approval !== undefined) {
    checkDeferralApproval(approval);
    // One user-approved historical record, not a configurable allowlist.
    if (
      approval.recordDigest !== '75467f5b0aec5367761433a57fbd45aa9a41347e638f385178c12f5af7740b95'
    )
      fail();
    if (
      inventory.paypalCheckoutEnabled !== false ||
      paypal.length !== 1 ||
      paypal[0].recordDigest !== approval.recordDigest ||
      scope.orders.some((row) => row.provider === 'paypal')
    )
      fail();
  } else if (paypal.length) fail();
  if (alipayApproval !== undefined) {
    checkAlipayDeferralApproval(alipayApproval);
    if (
      digest([...alipayApproval.recordDigests].sort()) !== approvedAlipaySetDigest ||
      alipay.length !== 9 ||
      digest(alipay.map((row) => row.recordDigest).sort()) !== approvedAlipaySetDigest
    )
      fail();
  } else if (alipay.length) fail();
  for (const row of deferred) {
    if (
      !row ||
      Object.keys(row).sort().join(',') !== 'approvalRef,fieldsDigest,recordDigest,state' ||
      !hash(row.recordDigest) ||
      !hash(row.fieldsDigest) ||
      row.state !== 'unverified-deferred'
    )
      fail();
  }
}
const databaseScopeDigest = (scopeDigest, deferred) =>
  deferred?.length
    ? digest([
        scopeDigest,
        deferred.map((row) => [row.recordDigest, row.fieldsDigest, row.approvalRef, row.state]),
      ])
    : scopeDigest;

// Historical archive contains these fields only. fieldsDigest separately binds
// every currently selected field across the two live database observations.
function alipayRecordDigest(row, table, windowStartMs) {
  if (
    table !== 'payments' ||
    row.provider !== 'alipay' ||
    row.status !== 'pending' ||
    row.currency !== 'CNY' ||
    row.provider_capture_id != null
  )
    return null;
  const date = (value) =>
    new Date(
      typeof value === 'string' && /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d(?:\.\d{3})?$/.test(value)
        ? `${value.replace(' ', 'T')}Z`
        : value,
    ).toISOString();
  const created = date(row.created_at);
  const updated = date(row.updated_at);
  if (Date.parse(created) >= windowStartMs || Date.parse(updated) >= windowStartMs) return null;
  return digest([
    table,
    Number(row.id),
    row.provider,
    row.provider_order_id,
    row.provider_capture_id ?? null,
    Number(row.amount_cents),
    row.currency,
    row.status,
    created,
    updated,
  ]);
}

// Exact historical row fingerprint; no provider contact or merchant inference.
function sandboxRecordDigest(row, table, windowStartMs) {
  if (
    table !== 'payments' ||
    row.provider !== 'paypal' ||
    row.status !== 'pending' ||
    row.provider_capture_id != null
  )
    return null;
  const metadata = typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata;
  if (!metadata || Array.isArray(metadata) || metadata.env !== 'sandbox') return null;
  const date = (value) =>
    new Date(
      typeof value === 'string' && /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d\.\d{3}$/.test(value)
        ? `${value.replace(' ', 'T')}Z`
        : value,
    ).toISOString();
  const created = date(row.created_at);
  const updated = date(row.updated_at);
  if (Date.parse(created) >= windowStartMs || Date.parse(updated) >= windowStartMs) return null;
  return digest([
    table,
    row.external_id,
    row.provider,
    row.provider_order_id,
    row.provider_capture_id ?? null,
    Number(row.amount_cents),
    row.currency,
    row.status,
    Object.keys(metadata)
      .sort()
      .map((key) => [key, metadata[key]]),
    created,
    updated,
  ]);
}
// User-approved exact historical navigation exception. Full row fingerprints
// retain unknown outcomes; neither terminal parents nor low-risk URLs suffice.
const navigationSource = '653d441102e3ef314816d94165dea9daf633d01d0923c36e7d31bc7d589ed727';
const navigationSet = '192900b8bbd82d0456952f07f66cffe145f7131e738ab1c74f97ee327205f446';
const navigationFingerprints = [
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
];
const canonicalNavigationJSON = (value) => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonicalNavigationJSON).join(',') + ']';
  return (
    '{' +
    Object.keys(value)
      .sort()
      .map((k) => JSON.stringify(k) + ':' + canonicalNavigationJSON(value[k]))
      .join(',') +
    '}'
  );
};
const navigationDigest = (value) =>
  createHash('sha256').update(canonicalNavigationJSON(value)).digest('hex');
export function cutoverExactNavigationDeferral(approval) {
  const value = approval?.exactLegacyNavigationDeferral;
  if (value === undefined) return undefined;
  checkBinding(Object.fromEntries(bindingKeys.map((k) => [k, approval[k]])));
  if (
    approval.schemaVersion !== 2 ||
    approval.kind !== 'first-cutover' ||
    !Number.isSafeInteger(approval.maintenanceEndsAtMs) ||
    !Number.isSafeInteger(approval.reconcileByMs) ||
    approval.reconcileByMs < approval.maintenanceEndsAtMs ||
    !same(value, {
      approvalRef: 'exact-legacy-navigation-deferral-20261002',
      sourceResultSha256: navigationSource,
      setFingerprint: navigationSet,
      noAutomaticReplay: true,
    })
  )
    fail('MAINTENANCE_WORK_SCOPE_UNPROVEN');
  return value;
}
export function validateCutoverDeferredWork(value, approval) {
  const policy = cutoverExactNavigationDeferral(approval);
  if (!policy) {
    if (
      value?.deferredUnverifiedWork !== undefined ||
      value?.unresolvedWorkCount !== undefined ||
      value?.eligibleReplay !== undefined
    )
      fail('MAINTENANCE_WORK_SCOPE_UNPROVEN');
    return;
  }
  const expected = navigationFingerprints.map((recordFingerprint) => ({
    table: 'task_steps',
    status: 'executing',
    recordFingerprint,
    approvalRef: policy.approvalRef,
    outcome: 'unverified',
    automaticReplay: false,
  }));
  if (
    !value ||
    !same(value.deferredUnverifiedWork, expected) ||
    value.unresolvedWorkCount !== 10 + (value.unsettled?.length ?? 0) ||
    value.eligibleReplay !== (value.unsettled?.length ?? 0)
  )
    fail('MAINTENANCE_WORK_SCOPE_UNPROVEN');
}
export function cutoverWorkScopeReady(value, approval, { requireReplay = false } = {}) {
  validateCutoverDeferredWork(value, approval);
  return (
    Array.isArray(value?.unsettled) &&
    value.unsettled.length === 0 &&
    ((!requireReplay && value.pendingReplay === undefined) ||
      value.pendingReplay === (cutoverExactNavigationDeferral(approval) ? 10 : 0))
  );
}
async function readExactNavigationDeferral(db, approval, nowMs) {
  const policy = cutoverExactNavigationDeferral(approval);
  if (!policy) return undefined;
  if (!Number.isSafeInteger(nowMs) || nowMs >= approval.reconcileByMs)
    fail('MAINTENANCE_WORK_SCOPE_UNPROVEN');
  const [sizes] = await db.query(
    "SELECT COUNT(*) AS count, MAX(OCTET_LENGTH(input)) AS inputBytes, MAX(OCTET_LENGTH(output)) AS outputBytes, MAX(OCTET_LENGTH(error_message)) AS errorBytes FROM task_steps WHERE status='executing' AND created_at <= '2026-08-30 13:29:21.615'",
  );
  if (
    !Array.isArray(sizes) ||
    sizes.length !== 1 ||
    Number(sizes[0].count) !== 10 ||
    ['inputBytes', 'outputBytes', 'errorBytes'].some((k) => Number(sizes[0][k] ?? 0) > 65536)
  )
    fail('MAINTENANCE_WORK_SCOPE_UNPROVEN');
  const [rows] = await db.query(
    "SELECT s.id,s.external_id,s.task_id,s.parent_step_id,s.seq,s.kind,s.status,s.risk_level,s.retry_count,s.input,s.output,s.error_code,s.error_message,s.created_at,s.started_at,s.completed_at,t.status AS parentStatus,t.error_code AS parentErrorCode,t.created_at AS parentCreatedAt,t.updated_at AS parentUpdatedAt,t.completed_at AS parentCompletedAt FROM task_steps s JOIN tasks t ON t.id=s.task_id WHERE s.status='executing' AND s.created_at <= '2026-08-30 13:29:21.615' ORDER BY s.id LIMIT 100",
  );
  if (!Array.isArray(rows) || rows.length !== 10) fail('MAINTENANCE_WORK_SCOPE_UNPROVEN');
  const fingerprints = rows.map(navigationDigest).sort();
  if (
    !same(fingerprints, navigationFingerprints) ||
    navigationDigest(fingerprints) !== navigationSet ||
    rows.some(
      (r) =>
        r.kind !== 'goto' ||
        !['failed', 'cancelled'].includes(r.parentStatus) ||
        r.output !== null ||
        r.completed_at !== null ||
        r.error_code !== null ||
        r.error_message !== null,
    )
  )
    fail('MAINTENANCE_WORK_SCOPE_UNPROVEN');
  return {
    ids: new Set(rows.map((r) => Number(r.id))),
    deferredUnverifiedWork: fingerprints.map((recordFingerprint) => ({
      table: 'task_steps',
      status: 'executing',
      recordFingerprint,
      approvalRef: policy.approvalRef,
      outcome: 'unverified',
      automaticReplay: false,
    })),
  };
}

const bindingKeys = ['attempt', 'candidate', 'configDigest', 'migrationDigest', 'inventoryDigest'];
/** First-release exception only. This digest is separate from inventory, so
 * neither the approval nor its later receipt introduces a circular binding. */
export function cutoverLegacyInterruptionRisk(approval) {
  const binding = Object.fromEntries(bindingKeys.map((key) => [key, approval?.[key]]));
  checkBinding(binding);
  const policy = approval?.legacyInterruption;
  const keys = [
    'mode',
    'scope',
    'approvalRef',
    'capabilityDigest',
    'observeUntilMs',
    'noAutomaticReplay',
  ];
  if (
    approval.schemaVersion !== 2 ||
    approval.kind !== 'first-cutover' ||
    !hash(approval.legacyDigest) ||
    !Number.isSafeInteger(approval.maintenanceEndsAtMs) ||
    approval.maintenanceEndsAtMs <= 0 ||
    !Number.isSafeInteger(approval.reconcileByMs) ||
    approval.reconcileByMs < approval.maintenanceEndsAtMs ||
    typeof approval.operatorRef !== 'string' ||
    !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(approval.operatorRef) ||
    !policy ||
    Object.keys(policy).length !== keys.length ||
    !keys.every((key) => Object.hasOwn(policy, key)) ||
    policy.mode !== 'controlled-interruption' ||
    policy.scope !== 'legacy-non-payment-memory' ||
    policy.approvalRef !== 'legacy-interruption-20260928' ||
    !hash(policy.capabilityDigest) ||
    !Number.isSafeInteger(policy.observeUntilMs) ||
    policy.observeUntilMs < 0 ||
    policy.observeUntilMs > approval.maintenanceEndsAtMs ||
    policy.noAutomaticReplay !== true
  )
    throw new Error('CUTOVER_INTERRUPTION_UNPROVEN');
  return createHash('sha256')
    .update(
      JSON.stringify({
        binding,
        legacyDigest: approval.legacyDigest,
        maintenanceEndsAtMs: approval.maintenanceEndsAtMs,
        reconcileByMs: approval.reconcileByMs,
        operatorRef: approval.operatorRef,
        legacyInterruption: Object.fromEntries(keys.map((key) => [key, policy[key]])),
        ...(cutoverExactNavigationDeferral(approval)
          ? { exactLegacyNavigationDeferral: approval.exactLegacyNavigationDeferral }
          : {}),
      }),
    )
    .digest('hex');
}
function checkBinding(value) {
  if (
    !value ||
    Object.keys(value).length !== bindingKeys.length ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(
      value.attempt ?? '',
    ) ||
    !/^[a-f0-9]{40}$/.test(value.candidate ?? '') ||
    !['configDigest', 'migrationDigest', 'inventoryDigest'].every((k) => hash(value[k]))
  )
    fail();
}
// Reads a live, owned journal projection; a caller-supplied report is not an
// approval. The original host/payment checks remain required independently.
/** Observability is a tagged fact, never a fallback for a read error. The caller
 * must independently own the approval/journal and verify actual writer fences. */
export function validateLegacyWorkBoundary({ observation, approval, phase, nowMs } = {}) {
  try {
    if (
      !['prepare', 'before-stop', 'after-stop', 'preopen'].includes(phase) ||
      !Number.isSafeInteger(nowMs) ||
      nowMs < 0 ||
      !observation ||
      !Number.isSafeInteger(observation.observedAtMs) ||
      observation.observedAtMs < 0 ||
      observation.observedAtMs > nowMs ||
      nowMs - observation.observedAtMs > 60000 ||
      !hash(observation.inventoryDigest) ||
      observation.inventoryDigest !== approval?.inventoryDigest ||
      observation.unsettledWork !== 0 ||
      observation.unknownWriters !== 0
    )
      fail('MAINTENANCE_WORK_SCOPE_UNPROVEN');
    if (approval.schemaVersion !== 2) {
      if (
        (approval.schemaVersion !== undefined && approval.schemaVersion !== 1) ||
        (observation.schemaVersion !== undefined && observation.schemaVersion !== 1) ||
        observation.activeRequests !== 0 ||
        observation.externalWork !== 0 ||
        approval.legacyInterruption !== undefined ||
        approval.riskDigest !== undefined
      )
        fail('MAINTENANCE_WORK_SCOPE_UNPROVEN');
      return { mode: 'drained' };
    }
    const riskDigest = cutoverLegacyInterruptionRisk(approval);
    const deferral = cutoverExactNavigationDeferral(approval);
    if (deferral) validateCutoverDeferredWork({ ...observation, unsettled: [] }, approval);
    const keys = [
      'schemaVersion',
      'inventoryDigest',
      'observedAtMs',
      'unsettledWork',
      'unknownWriters',
      'knownExternalWork',
      'activeRequests',
      'externalWork',
      'capabilityDigest',
      'replaySourcesDigest',
      'pendingReplay',
      ...(deferral ? ['deferredUnverifiedWork', 'unresolvedWorkCount', 'eligibleReplay'] : []),
    ];
    if (
      Object.keys(observation).length !== keys.length ||
      !keys.every((key) => Object.hasOwn(observation, key)) ||
      observation.schemaVersion !== 2 ||
      observation.capabilityDigest !== approval.legacyInterruption.capabilityDigest ||
      !hash(observation.replaySourcesDigest) ||
      observation.pendingReplay !== (deferral ? 10 : 0) ||
      !Array.isArray(observation.knownExternalWork) ||
      !same(observation.knownExternalWork, deferral ? observation.deferredUnverifiedWork : []) ||
      (approval.riskDigest !== undefined && approval.riskDigest !== riskDigest) ||
      nowMs >= approval.maintenanceEndsAtMs ||
      (phase === 'before-stop' && nowMs > approval.legacyInterruption.observeUntilMs)
    )
      fail('MAINTENANCE_WORK_SCOPE_UNPROVEN');
    for (const key of ['activeRequests', 'externalWork']) {
      const value = observation[key];
      if (
        !value ||
        typeof value !== 'object' ||
        Array.isArray(value) ||
        Object.keys(value).length !== 2 ||
        !Object.hasOwn(value, 'kind') ||
        !Object.hasOwn(value, value.kind === 'observed' ? 'count' : 'reason') ||
        (value.kind === 'observed'
          ? value.count !== 0
          : value.kind !== 'unobservable' || value.reason !== 'legacy-no-inflight-api')
      )
        fail('MAINTENANCE_WORK_SCOPE_UNPROVEN');
    }
    // A currently observed zero cannot erase accepted historical uncertainty.
    return {
      mode: 'controlled-interruption',
      riskDigest,
      ...(deferral
        ? {
            deferredUnverifiedWork: observation.deferredUnverifiedWork,
            unresolvedWorkCount: 10,
            eligibleReplay: 0,
          }
        : {}),
    };
  } catch {
    fail('MAINTENANCE_WORK_SCOPE_UNPROVEN');
  }
}
function firstInterruptionProjection(first, input, raw, now) {
  const { binding, stage, identity, window } = input;
  if (first?.schemaVersion !== 2) {
    if (
      input.kind !== undefined ||
      input.riskDigest !== undefined ||
      input.deferredWorkSetFingerprint !== undefined ||
      [raw?.host, raw?.lastHost, raw?.fence].some(
        (value) => value?.riskDigest !== undefined || value?.legacyWork !== undefined,
      ) ||
      (first?.schemaVersion !== undefined && first.schemaVersion !== 1)
    )
      fail('MAINTENANCE_JOURNAL_UNPROVEN');
    return undefined;
  }
  if (
    input.kind !== 'first-cutover' ||
    !hash(first.recordDigest) ||
    first.failureObservation ||
    !bindingKeys.every((key) => first[key] === binding[key]) ||
    first.riskDigest !== cutoverLegacyInterruptionRisk(first) ||
    input.riskDigest !== first.riskDigest ||
    input.deferredWorkSetFingerprint !== cutoverExactNavigationDeferral(first)?.setFingerprint ||
    !['maintenanceEndsAtMs', 'reconcileByMs', 'operatorRef'].every(
      (key) => first[key] === window[key],
    ) ||
    (stage === 'prepare' && !['preflight', 'prepared'].includes(first.phase)) ||
    now >= first.maintenanceEndsAtMs
  )
    fail('MAINTENANCE_JOURNAL_UNPROVEN');
  if (!raw) return undefined; // Early binding check before gathering external observations.
  const { host, lastHost, fence } = raw;
  for (const value of [host, lastHost]) {
    if (
      value?.riskDigest !== first.riskDigest ||
      !value.legacyWork ||
      Object.keys(value.legacyWork).length !== 2
    )
      fail('MAINTENANCE_WORK_SCOPE_UNPROVEN');
    for (const observation of [value.legacyWork.before, value.legacyWork.after]) {
      validateLegacyWorkBoundary({ observation, approval: first, phase: stage, nowMs: now });
      if (!same(value.externalWork, observation.knownExternalWork))
        fail('MAINTENANCE_WORK_SCOPE_UNPROVEN');
    }
  }
  if (
    ![host, lastHost].every(
      (value) =>
        value &&
        fresh(value.observedAtMs, now) &&
        digest(value.inventory) === binding.inventoryDigest &&
        Array.isArray(value.unknownWriters) &&
        value.unknownWriters.length === 0 &&
        same(
          value.externalWork,
          cutoverExactNavigationDeferral(first)
            ? value.legacyWork?.before?.deferredUnverifiedWork
            : [],
        ),
    ) ||
    !fence ||
    !fresh(fence.observedAtMs, now) ||
    fence.inventoryDigest !== binding.inventoryDigest ||
    !Array.isArray(fence.uncovered) ||
    fence.uncovered.length
  )
    fail();
  if (stage === 'preopen') {
    const receipt = first.interruptionObservation;
    if (
      !['candidate_started', 'verified', 'opened', 'reconciled'].includes(first.phase) ||
      !same(first.identity, identity) ||
      !receipt ||
      receipt.riskDigest !== first.riskDigest ||
      !hash(receipt.sourceDigest) ||
      !hash(receipt.fenceDigest) ||
      !Number.isSafeInteger(receipt.observedAtMs) ||
      receipt.observedAtMs < 0 ||
      receipt.observedAtMs > first.legacyInterruption.observeUntilMs ||
      ![host, lastHost].every(
        (value) => Array.isArray(value.producersRunning) && value.producersRunning.length === 0,
      ) ||
      fence.stage !== 'all-writers' ||
      !['liveLegacy', 'regeneratedLegacy'].every(
        (key) => Array.isArray(fence[key]) && fence[key].length === 0,
      )
    )
      fail('MAINTENANCE_JOURNAL_UNPROVEN');
  }
  return {
    riskDigest: first.riskDigest,
    capabilityDigest: first.legacyInterruption.capabilityDigest,
    status: stage === 'prepare' ? 'authorized-not-stopped' : 'accepted-unknown',
    sourceDigest: digest({ host, lastHost, fence }),
    ...(stage === 'preopen' ? { stopDigest: digest({ lastHost, fence }) } : {}),
  };
}
const orderKey = (row) =>
  JSON.stringify([row.provider, row.environment, row.merchantDigest, row.orderRef]);
function checkScope(scope, now, approval) {
  validateCutoverDeferredWork(scope, approval);
  if (
    !scope ||
    !fresh(scope.observedAtMs, now) ||
    !Array.isArray(scope.orders) ||
    scope.orders.length > 10_000 ||
    !Array.isArray(scope.unsettled) ||
    scope.unsettled.length
  )
    fail();
  const keys = new Set();
  for (const row of scope.orders) {
    if (
      !['alipay', 'wechat', 'paypal'].includes(row.provider) ||
      !['sandbox', 'production'].includes(row.environment) ||
      !hash(row.merchantDigest) ||
      !hash(row.orderRef) ||
      !hash(row.fieldsDigest) ||
      keys.has(orderKey(row))
    )
      fail();
    keys.add(orderKey(row));
  }
}

/** All IO is a named fact reader owned by the root host adapter. No success JSON CLI. */
export async function collectCutoverEvidence(input, io) {
  const { binding, stage, identity, window } = input ?? {};
  checkBinding(binding);
  if (
    !['prepare', 'preopen'].includes(stage) ||
    (stage === 'prepare'
      ? identity !== undefined
      : identity?.candidate !== binding.candidate ||
        !/^[a-f0-9]{32}$/.test(identity?.bootId ?? '')) ||
    !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(window?.operatorRef ?? '') ||
    !Number.isSafeInteger(window?.maintenanceEndsAtMs) ||
    !Number.isSafeInteger(window?.reconcileByMs) ||
    window.reconcileByMs < window.maintenanceEndsAtMs
  )
    fail();
  const journal = await io.assertJournalOwnership();
  if (!bindingKeys.every((key) => journal?.[key] === binding[key]))
    fail('MAINTENANCE_JOURNAL_UNPROVEN');
  const firstCutover = structuredClone(await io.readFirstCutoverEffects?.());
  firstInterruptionProjection(firstCutover, input, undefined, io.now());
  const host = structuredClone(await io.readHostInventory());
  const before = structuredClone(await io.readDatabaseScope());
  checkScope(before, io.now(), firstCutover);
  checkDeferredScope(before, host.inventory);
  const observations = structuredClone(await io.queryOrders(before));
  const after = structuredClone(await io.readDatabaseScope());
  checkScope(after, io.now(), firstCutover);
  checkDeferredScope(after, host.inventory);
  if (
    !same(before.orders, after.orders) ||
    !same(before.unsettled, after.unsettled) ||
    !same(before.deferredUnverifiedWork, after.deferredUnverifiedWork) ||
    !same(before.deferredUnverified ?? [], after.deferredUnverified ?? [])
  )
    fail('MAINTENANCE_PAYMENT_SCOPE_CHANGED');
  const rehearsal = structuredClone(await io.readRehearsalArtifacts());
  const fence = structuredClone(await io.readFenceState());
  const lastHost = structuredClone(await io.readHostInventory());
  const now = io.now();
  for (const snapshot of [host, lastHost]) {
    if (
      !fresh(snapshot?.observedAtMs, now) ||
      digest(snapshot.inventory) !== binding.inventoryDigest ||
      !(
        Array.isArray(snapshot.unknownWriters) &&
        snapshot.unknownWriters.length === 0 &&
        same(
          snapshot.externalWork,
          cutoverExactNavigationDeferral(firstCutover) ? before.deferredUnverifiedWork : [],
        )
      ) ||
      !Array.isArray(snapshot.producersRunning) ||
      (stage === 'preopen' && snapshot.producersRunning.length !== 0)
    )
      fail();
    // Preparation is observation, not permission to stop. Every still-running
    // producer must be an exact member of the approved inventory. Actual stop
    // effects independently recheck ingress isolation and in-flight work.
    const seen = new Set();
    for (const producer of snapshot.producersRunning) {
      const key = JSON.stringify([producer?.host, producer?.pid]);
      if (
        !producer ||
        typeof producer.host !== 'string' ||
        !producer.host ||
        !Number.isSafeInteger(producer.pid) ||
        producer.pid <= 0 ||
        !/^[1-9][0-9]*$/.test(producer.start ?? '') ||
        !['main', 'worker'].includes(producer.role) ||
        seen.has(key) ||
        !Array.isArray(snapshot.inventory.targets) ||
        snapshot.inventory.targets.filter((target) => same(target, producer)).length !== 1
      )
        fail();
      seen.add(key);
    }
  }
  if (
    !fresh(before.observedAtMs, now) ||
    !fresh(after.observedAtMs, now) ||
    !fresh(fence?.observedAtMs, now) ||
    fence.inventoryDigest !== binding.inventoryDigest ||
    !(stage === 'prepare' ? ['observed', 'orders'] : ['all-writers']).includes(fence.stage) ||
    !Array.isArray(fence.uncovered) ||
    fence.uncovered.length ||
    (stage === 'preopen' &&
      !['liveLegacy', 'regeneratedLegacy'].every(
        (k) => Array.isArray(fence[k]) && fence[k].length === 0,
      )) ||
    now >= window.maintenanceEndsAtMs
  )
    fail();
  const merchants = host.inventory.merchants;
  if (
    !Array.isArray(merchants) ||
    !Array.isArray(host.inventory.configurationDigests) ||
    !host.inventory.configurationDigests.length ||
    !host.inventory.configurationDigests.every(hash) ||
    !rehearsal ||
    rehearsal.candidate !== binding.candidate ||
    rehearsal.configDigest !== binding.configDigest ||
    rehearsal.inventoryDigest !== binding.inventoryDigest ||
    !Number.isSafeInteger(rehearsal.observedAtMs) ||
    rehearsal.observedAtMs < 0 ||
    rehearsal.observedAtMs > now ||
    !['retry-proven', 'query-and-existing-settlement-proven'].includes(rehearsal.recovery) ||
    !Number.isSafeInteger(rehearsal.recoveryUntilMs) ||
    rehearsal.recoveryUntilMs < window.reconcileByMs ||
    !Array.isArray(rehearsal.artifacts) ||
    rehearsal.artifacts.length !== merchants.length
  )
    fail();
  const merchantKey = (row) => JSON.stringify([row.provider, row.environment, row.merchantDigest]);
  const merchantKeys = new Set(merchants.map(merchantKey));
  const artifactKeys = new Set(rehearsal.artifacts.map(merchantKey));
  if (merchantKeys.size !== merchants.length || artifactKeys.size !== merchants.length) fail();
  for (const artifact of rehearsal.artifacts) {
    const merchant = merchants.find((row) => merchantKey(row) === merchantKey(artifact));
    if (
      !merchantKeys.has(merchantKey(artifact)) ||
      !hash(artifact.codeDigest) ||
      artifact.codeDigest !== merchant?.codeDigest ||
      !hash(artifact.transcriptDigest) ||
      (rehearsal.recovery === 'query-and-existing-settlement-proven'
        ? !hash(artifact.queryDigest) || !hash(artifact.settlementDigest)
        : !hash(artifact.retryDigest))
    )
      fail();
  }
  if (!Array.isArray(observations) || observations.length !== before.orders.length)
    fail('MAINTENANCE_PAYMENT_SCOPE_CHANGED');
  const map = new Map();
  for (const row of observations) {
    if (
      !fresh(row.observedAtMs, now) ||
      !hash(row.rawDigest) ||
      map.has(orderKey(row)) ||
      !['settled', 'closed', 'unpaid-valid'].includes(row.state)
    )
      fail();
    map.set(orderKey(row), row);
  }
  for (const row of before.orders)
    if (!map.has(orderKey(row)) || !merchantKeys.has(merchantKey(row)))
      fail('MAINTENANCE_PAYMENT_SCOPE_CHANGED');
  const scopeDigest = digest(before.orders);
  const rehearsalDigest = digest(rehearsal);
  const followup = observations
    .filter((row) => row.state === 'unpaid-valid')
    .map((row) => row.orderRef)
    .sort();
  const legacyInterruption = firstInterruptionProjection(
    firstCutover,
    input,
    { host, lastHost, fence },
    now,
  );
  const report = {
    schemaVersion: firstCutover?.schemaVersion === 2 ? 2 : 1,
    ...(firstCutover?.schemaVersion === 2
      ? {
          kind: 'first-cutover',
          legacyInterruption,
        }
      : {}),
    ...binding,
    stage,
    ...(identity ? { identity } : {}),
    observedAtMs: now,
    ...window,
    sources: [
      {
        kind: 'host',
        digest: binding.inventoryDigest,
        targetDigest: binding.inventoryDigest,
        observedAtMs: Math.min(host.observedAtMs, lastHost.observedAtMs, fence.observedAtMs),
      },
      {
        kind: 'database',
        digest: databaseScopeDigest(scopeDigest, before.deferredUnverified),
        targetDigest: binding.configDigest,
        observedAtMs: before.observedAtMs,
      },
      {
        kind: 'provider-query',
        digest: scopeDigest,
        targetDigest: binding.configDigest,
        observedAtMs: observations.length
          ? Math.min(...observations.map((row) => row.observedAtMs))
          : after.observedAtMs,
      },
      {
        kind: 'provider-rehearsal',
        digest: rehearsalDigest,
        targetDigest: binding.configDigest,
        observedAtMs: rehearsal.observedAtMs,
      },
    ],
    host: {
      inventoryDigest: binding.inventoryDigest,
      unknownWriters: 0,
      unsettledWork: 0,
      ...(before.deferredUnverifiedWork
        ? {
            deferredUnverifiedWork: before.deferredUnverifiedWork,
            unresolvedWorkCount: before.unresolvedWorkCount,
            eligibleReplay: before.eligibleReplay,
          }
        : {}),
      phase: stage === 'prepare' ? 'prepared' : 'fenced-stopped',
    },
    payments: {
      scopeDigest,
      queriedScopeDigest: scopeDigest,
      unresolved: 0,
      validUnpaid: followup.length,
      followupDigest: digest(followup),
      recovery: rehearsal.recovery,
      recoveryUntilMs: rehearsal.recoveryUntilMs,
      rehearsalDigest,
      ...(before.deferredUnverified?.length
        ? { deferredUnverified: before.deferredUnverified }
        : {}),
    },
  };
  const finalJournal = await io.assertJournalOwnership();
  if (!bindingKeys.every((key) => finalJournal?.[key] === binding[key]))
    fail('MAINTENANCE_JOURNAL_UNPROVEN');
  if (firstCutover?.schemaVersion === 2 && !same(firstCutover, await io.readFirstCutoverEffects()))
    fail('MAINTENANCE_JOURNAL_UNPROVEN');
  await io.publishPrivate({
    report,
    raw: {
      host,
      lastHost,
      before,
      after,
      observations,
      rehearsal,
      fence,
      followup,
      ...(firstCutover?.schemaVersion === 2 ? { firstCutover } : {}),
    },
  });
  return report;
}
/** mysql2 connection must be dedicated; queries never enter a write transaction. */
// These are persisted work observations, not proof that memory-only requests or
// provider-side work have drained. The site must still independently observe
// those facts. Never expire/cancel a row or swallow a missing-table error here.
async function readPersistedCutoverWork(db, approval, nowMs) {
  const deferred = await readExactNavigationDeferral(db, approval, nowMs);
  const scopes = [
    [
      'tasks',
      'status',
      "status NOT IN ('completed','partial_success','failed','cancelled','paused','awaiting_user')",
    ],
    // Step effects have their own durable state. A terminal/paused parent is
    // not proof that an executing child effect finished. Dormant/confirmation
    // steps are not automatic dispatch; unknown step states remain blocking.
    [
      'task_steps',
      'status',
      "status NOT IN ('completed','partial_success','failed','cancelled','skipped','pending','awaiting_user') AND NOT (status = 'done' AND started_at IS NOT NULL AND completed_at IS NOT NULL AND completed_at >= started_at)",
    ],
    ['scheduled_tasks', 'status', "status NOT IN ('active','paused','completed','failed')"],
    [
      'planned_task_runs',
      'status',
      "status NOT IN ('completed','partial_success','failed','cancelled')",
    ],
    ['batch_tasks', 'status', "status NOT IN ('completed','partial','cancelled')"],
    // Explorer browse persists halted_sensitive only after its runner returns.
    // This settles the row, not independent browser/provider work.
    [
      'exploration_runs',
      'status',
      "status NOT IN ('completed','failed','cancelled','halted_sensitive')",
    ],
    ['video_edit_render_attempts', 'status', "status NOT IN ('completed','failed')"],
    ['video_edit_versions', 'render_status', "render_status NOT IN ('idle','completed','failed')"],
    [
      'account_closure_requests',
      'status',
      "status NOT IN ('pending_grace','cancelled','completed') OR completion_lease_owner IS NOT NULL OR completion_lease_until IS NOT NULL",
    ],
    [
      'account_closure_steps',
      'status',
      "status NOT IN ('pending','succeeded','skipped') OR lease_owner IS NOT NULL OR lease_until IS NOT NULL",
    ],
    [
      'planned_task_run_items',
      'status',
      "status NOT IN ('completed','partial_success','failed','cancelled')",
    ],
    [
      'batch_task_items',
      'status',
      "status NOT IN ('completed','partial_success','failed','cancelled')",
    ],
    [
      'planned_tasks',
      'status',
      // Archived definitions do not dispatch; runs/items above remain independent.
      "status NOT IN ('active','paused','completed','failed','cancelled','archived')",
    ],
  ];
  const unsettled = [];
  const sources = [];
  for (const [table, column, where] of scopes) {
    const sql = `SELECT id, ${column} AS status FROM ${table} WHERE (${where}) OR ${column} IS NULL ORDER BY id LIMIT 100`;
    const [rows] = await db.query(sql);
    if (!Array.isArray(rows) || rows.length >= 100) fail('MAINTENANCE_WORK_SCOPE_UNPROVEN');
    let previous = 0;
    for (const row of rows) {
      const id = Number(row?.id);
      if (
        !Number.isSafeInteger(id) ||
        id <= previous ||
        typeof row.status !== 'string' ||
        !/^[a-z_]{1,32}$/.test(row.status)
      )
        fail('MAINTENANCE_WORK_SCOPE_UNPROVEN');
      previous = id;
      if (!(table === 'task_steps' && deferred?.ids.has(id)))
        unsettled.push({ table, id, status: row.status });
    }
    sources.push({
      table,
      queryDigest: digest(sql),
      rows: unsettled.filter((row) => row.table === table),
    });
  }
  return {
    unsettled,
    sources,
    ...(deferred
      ? {
          deferredUnverifiedWork: deferred.deferredUnverifiedWork,
          unresolvedWorkCount: unsettled.length + 10,
          eligibleReplay: unsettled.length,
        }
      : {}),
  };
}

/** Frequent business checks need no payment credentials or provider queries.
 * Owns one read-only snapshot; call with a dedicated mysql2 connection, not a
 * pool whose query calls could switch sessions, or an existing transaction.
 */
export async function readCutoverWorkScope(
  db,
  { now = Date.now, includeReplaySources = false, firstCutoverApproval } = {},
) {
  let transaction = false;
  try {
    if (typeof includeReplaySources !== 'boolean') fail('MAINTENANCE_WORK_SCOPE_UNPROVEN');
    await db.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
    await db.query('START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY');
    transaction = true;
    const observedAtMs = now();
    const { unsettled, sources, ...deferred } = await readPersistedCutoverWork(
      db,
      firstCutoverApproval,
      observedAtMs,
    );
    const finishedAtMs = now();
    if (
      !Number.isSafeInteger(observedAtMs) ||
      observedAtMs < 0 ||
      !Number.isSafeInteger(finishedAtMs) ||
      finishedAtMs < observedAtMs ||
      finishedAtMs - observedAtMs > 60000 ||
      (firstCutoverApproval?.exactLegacyNavigationDeferral &&
        finishedAtMs >= firstCutoverApproval.reconcileByMs)
    )
      fail('MAINTENANCE_WORK_SCOPE_UNPROVEN');
    return {
      observedAtMs,
      unsettled,
      ...deferred,
      ...(includeReplaySources
        ? {
            // Conservative persisted recovery blockers, not a claim about memory
            // or provider-side effects. Unknown statuses remain blockers as well.
            pendingReplay: deferred.unresolvedWorkCount ?? unsettled.length,
            replaySourcesDigest: digest({ schemaVersion: 1, observedAtMs, sources, ...deferred }),
          }
        : {}),
    };
  } catch {
    fail('MAINTENANCE_WORK_SCOPE_UNPROVEN');
  } finally {
    if (transaction) {
      try {
        await db.query('ROLLBACK');
      } catch {
        fail('MAINTENANCE_WORK_SCOPE_UNPROVEN');
      }
    }
  }
}

export async function readCutoverDatabaseScope(
  db,
  {
    windowStartMs,
    windowEndMs,
    now = Date.now,
    resolveMerchant,
    deferredSandboxPayment,
    deferredAlipayPayments,
    firstCutoverApproval,
  } = {},
) {
  if (!Number.isSafeInteger(windowStartMs) || windowStartMs < 0 || windowStartMs > now())
    fail('MAINTENANCE_PAYMENT_SCOPE_UNPROVEN');
  if (
    windowEndMs !== undefined &&
    (!Number.isSafeInteger(windowEndMs) || windowEndMs < windowStartMs || windowEndMs > now())
  )
    fail('MAINTENANCE_PAYMENT_SCOPE_UNPROVEN');
  let transaction = false;
  try {
    if (deferredSandboxPayment !== undefined) checkDeferralApproval(deferredSandboxPayment);
    if (deferredAlipayPayments !== undefined) checkAlipayDeferralApproval(deferredAlipayPayments);
    await db.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
    await db.query('START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY');
    transaction = true;
    const observedAtMs = now();
    const orders = [];
    const deferredUnverified = [];
    const since = new Date(windowStartMs);
    for (const table of ['payments', 'partner_recharge_orders']) {
      const amountColumn = table === 'payments' ? 'amount_cents' : 'amount_cny_cents';
      const currencyColumn = table === 'payments' ? 'currency' : "'CNY'";
      const where =
        "(status NOT IN ('completed','failed','refunded','cancelled') OR created_at >= ? OR updated_at >= ?)" +
        (windowEndMs !== undefined ? ' AND created_at < ?' : '');
      const scopeParams = [
        since,
        since,
        ...(windowEndMs !== undefined ? [new Date(windowEndMs)] : []),
      ];
      const [countRows] = await db.query(`SELECT COUNT(*) AS total FROM ${table} WHERE ${where}`, [
        ...scopeParams,
      ]);
      const count = Number(countRows?.[0]?.total);
      if (
        countRows?.length !== 1 ||
        !Number.isSafeInteger(count) ||
        count < 0 ||
        count >= 10_000 ||
        orders.length + deferredUnverified.length + count >= 10_000
      )
        fail('MAINTENANCE_PAYMENT_SCOPE_UNPROVEN');
      let cursor = 0;
      let found = 0;
      for (let page = 0; page < 100; page++) {
        const [rows] = await db.query(
          `SELECT id, external_id, provider, provider_order_id, provider_capture_id, ${amountColumn} AS amount_cents, ${currencyColumn} AS currency, status, metadata, created_at, updated_at FROM ${table} WHERE ${where} AND id > ? ORDER BY id LIMIT 100`,
          [...scopeParams, cursor],
        );
        if (!Array.isArray(rows) || rows.length > 100) fail('MAINTENANCE_PAYMENT_SCOPE_UNPROVEN');
        for (const row of rows) {
          const id = Number(row.id);
          if (
            !Number.isSafeInteger(id) ||
            id <= cursor ||
            !row.external_id ||
            !row.provider_order_id ||
            !['alipay', 'wechat', 'paypal'].includes(row.provider) ||
            !Number.isSafeInteger(Number(row.amount_cents)) ||
            Number(row.amount_cents) <= 0 ||
            !['USD', 'CNY'].includes(row.currency)
          )
            fail('MAINTENANCE_PAYMENT_SCOPE_UNPROVEN');
          if (deferredSandboxPayment !== undefined && row.provider === 'paypal') {
            const recordDigest = sandboxRecordDigest(row, table, windowStartMs);
            if (
              recordDigest !== deferredSandboxPayment.recordDigest ||
              deferredUnverified.some((record) => record.approvalRef === deferralRef)
            )
              fail('MAINTENANCE_PAYMENT_SCOPE_UNPROVEN');
            deferredUnverified.push({
              recordDigest,
              approvalRef: deferralRef,
              fieldsDigest: digest(row),
              state: 'unverified-deferred',
            });
            cursor = id;
            found++;
            continue;
          }
          if (deferredAlipayPayments !== undefined && row.provider === 'alipay') {
            const recordDigest = alipayRecordDigest(row, table, windowStartMs);
            if (deferredAlipayPayments.recordDigests.includes(recordDigest)) {
              if (deferredUnverified.some((record) => record.recordDigest === recordDigest))
                fail('MAINTENANCE_PAYMENT_SCOPE_UNPROVEN');
              deferredUnverified.push({
                recordDigest,
                approvalRef: alipayDeferralRef,
                fieldsDigest: digest(row),
                state: 'unverified-deferred',
              });
              cursor = id;
              found++;
              continue;
            }
          }
          if (typeof resolveMerchant !== 'function') fail('MAINTENANCE_PAYMENT_SCOPE_UNPROVEN');
          const merchant = resolveMerchant(row.provider, row, table);
          if (
            !hash(merchant?.merchantDigest) ||
            !['sandbox', 'production'].includes(merchant?.environment)
          )
            fail('MAINTENANCE_PAYMENT_SCOPE_UNPROVEN');
          const orderRef = digest([merchant.merchantDigest, row.provider_order_id]);
          orders.push({ ...row, table, orderRef, ...merchant, fieldsDigest: digest(row) });
          cursor = id;
          found++;
        }
        if (rows.length < 100) break;
        if (page === 99) fail('MAINTENANCE_PAYMENT_SCOPE_UNPROVEN');
      }
      if (found !== count) fail('MAINTENANCE_PAYMENT_SCOPE_UNPROVEN');
    }
    if (
      deferredSandboxPayment !== undefined &&
      deferredUnverified.filter((row) => row.approvalRef === deferralRef).length !== 1
    )
      fail('MAINTENANCE_PAYMENT_SCOPE_UNPROVEN');
    if (
      deferredAlipayPayments !== undefined &&
      deferredUnverified.filter((row) => row.approvalRef === alipayDeferralRef).length !== 9
    )
      fail('MAINTENANCE_PAYMENT_SCOPE_UNPROVEN');
    const {
      unsettled,
      sources: _sources,
      ...deferred
    } = await readPersistedCutoverWork(db, firstCutoverApproval, observedAtMs);
    return {
      observedAtMs,
      orders,
      unsettled,
      ...deferred,
      ...(deferredSandboxPayment !== undefined || deferredAlipayPayments !== undefined
        ? { deferredUnverified }
        : {}),
    };
  } catch {
    fail('MAINTENANCE_PAYMENT_SCOPE_UNPROVEN');
  } finally {
    if (transaction) await db.query('ROLLBACK');
  }
}
