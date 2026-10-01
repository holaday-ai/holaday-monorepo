import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import * as fs from 'node:fs/promises';
import { posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual as equal } from 'node:util';
import {
  readFirstCutoverCloudRecoveryContext,
  readFirstCutoverCloudRecoverySources,
  readFirstCutoverCloudManagers,
} from './browser-first-cutover-runtime.mjs';

const fail = () => {
  throw new Error('CUTOVER_CLOUD_NATIVE_PREFLIGHT_UNPROVEN');
};
const sha = (v) =>
  createHash('sha256')
    .update(Buffer.isBuffer(v) ? v : JSON.stringify(v))
    .digest('hex');
const hash = (v) => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const keys = (v, k) => v && Object.keys(v).sort().join(',') === k;
export function validateFirstCutoverNativeProbe(p, parent) {
  if (
    !p ||
    ![
      'capabilities,entry,libraries,modules,mountNamespace,noNewPrivs,parentMountNamespace,purpose,python,roles,schemaVersion,uids,version',
      'capabilities,entry,libraries,modules,mountNamespace,noNewPrivs,parentMountNamespace,purpose,python,roles,schemaVersion,uids,version,versionDigests',
    ].includes(Object.keys(p).sort().join(',')) ||
    p.schemaVersion !== 1 ||
    p.purpose !== 'cloud-recovery-native-preflight' ||
    p.parentMountNamespace !== parent ||
    !/^mnt:\[\d+\]$/.test(p.mountNamespace) ||
    p.mountNamespace === parent ||
    !equal(p.uids, [0, 0, 0, 0]) ||
    p.noNewPrivs !== 1 ||
    !keys(p.capabilities, 'CapAmb,CapBnd,CapEff,CapInh,CapPrm') ||
    Object.values(p.capabilities).some((v) => typeof v !== 'string' || !/^0{1,16}$/.test(v)) ||
    p.python !== '/usr/bin/python3.10' ||
    p.entry !== 'websockify.websocketproxy:websockify_init' ||
    p.version !== '0.10.0' ||
    !equal(p.roles, ['holaday-chromium-headed', 'holaday-vnc']) ||
    !Array.isArray(p.modules) ||
    !p.modules.length ||
    p.modules.length > 2048 ||
    !Array.isArray(p.libraries) ||
    !p.libraries.length ||
    p.libraries.length > 512 ||
    [...p.modules, ...p.libraries].some(
      (path) =>
        typeof path !== 'string' ||
        posix.normalize(path) !== path ||
        (!/^\/usr\/(?:lib|bin)\//.test(path) && path !== '/etc/python3.10/sitecustomize.py') ||
        path.includes('\0'),
    ) ||
    !p.modules.some((path) =>
      /^\/usr\/lib\/python3\/dist-packages\/websockify\/websocketproxy\.(?:py|pyc)$/.test(path),
    )
  )
    fail();
  if (
    !p.versionDigests ||
    !keys(p.versionDigests, 'holaday-chromium-headed,holaday-vnc') ||
    !Object.values(p.versionDigests).every(hash)
  )
    fail();
}

/** Run once before either restore intent. The mount and capability probe stays
 * in its own namespace; no PM2 launch, X server, profile or network listener.
 * Every selected source is freshly bound, and all time/byte budgets are shared.
 */
export async function readFirstCutoverCloudNativePreflight(input, overrides = {}) {
  const io = {
    ...fs,
    platform: process.platform,
    uid: process.getuid?.(),
    now: Date.now,
    readSources: readFirstCutoverCloudRecoverySources,
    readContext: readFirstCutoverCloudRecoveryContext,
    readManagers: readFirstCutoverCloudManagers,
    exec: (command, args, options) =>
      new Promise((resolve, reject) =>
        execFile(command, args, options, (error, stdout) =>
          error ? reject(error) : resolve(stdout),
        ),
      ),
    ...overrides,
  };
  try {
    if (
      !keys(input, 'attempt,maintenanceEndsAtMs,sources,vacancy') ||
      io.platform !== 'linux' ||
      io.uid !== 0
    )
      fail();
    const { attempt, sources, vacancy, maintenanceEndsAtMs } = structuredClone(input);
    if (!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(attempt))
      fail();
    const began = io.now();
    let last = began;
    let bytes = 0;
    const clock = () => {
      const now = io.now();
      if (
        !Number.isSafeInteger(now) ||
        now < last ||
        now - began > 15000 ||
        !Number.isSafeInteger(maintenanceEndsAtMs) ||
        now >= maintenanceEndsAtMs
      )
        fail();
      last = now;
      return now;
    };
    const records = new Map();
    const selected = async (path) => {
      clock();
      const resolved = await io.realpath(path);
      if (!resolved.startsWith('/') || posix.normalize(resolved) !== resolved) fail();
      let part = '/';
      for (const segment of resolved.slice(1).split('/')) {
        const st = await io.lstat(part);
        if (!st.isDirectory() || st.uid !== 0 || st.mode & 0o022) fail();
        part = posix.join(part, segment);
      }
      const handle = await io.open(
        resolved,
        constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
      );
      try {
        const st = await handle.stat();
        if (
          !st.isFile() ||
          st.uid !== 0 ||
          st.mode & 0o022 ||
          !Number.isSafeInteger(st.size) ||
          st.size < 0 ||
          st.size > 32 * 1024 * 1024
        )
          fail();
        bytes += st.size;
        if (bytes > 128 * 1024 * 1024) fail();
        const value = Buffer.alloc(st.size + 1);
        let size = 0;
        while (size < value.length) {
          const n = (await handle.read(value, size, value.length - size, size)).bytesRead;
          if (!Number.isSafeInteger(n) || n < 0) fail();
          if (!n) break;
          size += n;
          clock();
        }
        const metadata = (s) =>
          Object.fromEntries(
            ['dev', 'ino', 'uid', 'gid', 'mode', 'size', 'mtimeMs', 'ctimeMs'].map((k) => [
              k,
              s[k],
            ]),
          );
        if (
          size !== st.size ||
          !equal(metadata(st), metadata(await handle.stat())) ||
          !equal(metadata(st), metadata(await io.lstat(resolved))) ||
          (await io.realpath(path)) !== resolved
        )
          fail();
        const result = { path, resolved, digest: sha(value.subarray(0, size)), ...metadata(st) };
        const prior = records.get(path);
        if (prior && !equal(prior, result)) fail();
        records.set(path, result);
        return result;
      } finally {
        await handle.close();
      }
    };
    const rows = structuredClone(await io.readManagers());
    if (rows.length !== 2 || rows.some((r) => r.pid !== 0 || r.pm2_env.status !== 'stopped'))
      fail();
    const configs = rows.map((r) => ({ name: r.name, pmId: r.pm_id, config: r.pm2_env }));
    const material = ({ observedAtMs, ...v }) => v;
    if (!equal(material(sources), material(await io.readSources({ attempt, configs })))) fail();
    const absentPackages = [];
    for (const command of ['/usr/bin/unshare', '/opt/holaday-vnc/start.sh']) {
      let dir = posix.dirname(command);
      for (;;) {
        const path = posix.join(dir, 'package.json');
        try {
          await io.lstat(path);
          fail();
        } catch (error) {
          if (error.code !== 'ENOENT') throw error;
        }
        absentPackages.push(path);
        if (dir === '/') break;
        dir = posix.dirname(dir);
      }
    }
    const context = await io.readContext({ sources });
    if (
      context.daemon.contextDigest !== vacancy.contextDigest ||
      context.sourcesDigest !== vacancy.sourcesDigest
    )
      fail();
    const parent = await io.readlink('/proc/self/ns/mnt');
    const daemonNamespace = await io.readlink(`/proc/${context.daemon.pid}/ns/mnt`);
    const controls = async (pid) => {
      const status = await io.readFile(`/proc/${pid}/status`, 'utf8');
      const values = {};
      for (const name of [
        'Uid',
        'Gid',
        'CapInh',
        'CapPrm',
        'CapEff',
        'CapBnd',
        'CapAmb',
        'NoNewPrivs',
        'Seccomp',
      ]) {
        const lines = status.split('\n').filter((line) => line.startsWith(`${name}:`));
        if (lines.length !== 1) fail();
        values[name] = lines[0]
          .slice(name.length + 1)
          .trim()
          .split(/\s+/)
          .join(' ');
      }
      try {
        const label = (await io.readFile(`/proc/${pid}/attr/current`, 'utf8')).trim();
        if (!label || label.length > 4096 || label.includes('\0')) fail();
        values.securityLabel = { kind: 'observed', value: label };
      } catch (error) {
        if (!['ENOENT', 'EINVAL'].includes(error.code)) throw error;
        values.securityLabel = { kind: 'unavailable', reason: error.code };
      }
      return values;
    };
    const control = await controls('self');
    if (
      parent !== daemonNamespace ||
      !equal(control, await controls(context.daemon.pid)) ||
      !equal(control.securityLabel, context.daemon.securityLabel)
    )
      fail();
    const helper = fileURLToPath(
      new URL('./browser-first-cutover-native-preflight.py', import.meta.url),
    );
    await selected(helper);
    const policy = `/var/lib/holaday-deploy/maintenance/${attempt}/cloud-browser-policy`;
    const policyStat = await io.lstat(policy);
    if (
      !policyStat.isDirectory() ||
      policyStat.uid !== 0 ||
      (policyStat.mode & 0o7777) !== 0o700 ||
      (await io.realpath(policy)) !== policy
    )
      fail();
    const script =
      '/usr/bin/mount --bind "$1" /etc/brave/policies/managed && /usr/bin/mount -o remount,bind,ro /etc/brave/policies/managed && exec /usr/bin/setpriv --bounding-set=-all --inh-caps=-all --ambient-caps=-all --no-new-privs /usr/bin/python3 -B "$2" "$3"';
    const raw = await io.exec(
      '/usr/bin/unshare',
      [
        '--mount',
        '--propagation',
        'private',
        '--fork',
        '/bin/sh',
        '-c',
        script,
        'holaday-cloud-preflight',
        policy,
        helper,
        parent,
      ],
      {
        cwd: '/',
        env: { PATH: '/usr/bin:/bin', HOME: '/root', LC_ALL: 'C', PYTHONDONTWRITEBYTECODE: '1' },
        timeout: Math.min(10000, maintenanceEndsAtMs - clock()),
        maxBuffer: 262144,
      },
    );
    if (typeof raw !== 'string' || Buffer.byteLength(raw) > 262144) fail();
    const probe = JSON.parse(raw);
    validateFirstCutoverNativeProbe(probe, parent);
    if (!probe.versionDigests) fail();
    for (const path of [...new Set([...probe.modules, ...probe.libraries])].sort())
      await selected(path);
    if (
      !equal(control, await controls('self')) ||
      !equal(control, await controls(context.daemon.pid)) ||
      parent !== (await io.readlink('/proc/self/ns/mnt')) ||
      !equal(rows, await io.readManagers()) ||
      !equal(material(sources), material(await io.readSources({ attempt, configs }))) ||
      context.daemon.contextDigest !== (await io.readContext({ sources })).daemon.contextDigest
    )
      fail();
    for (const path of absentPackages) {
      try {
        await io.lstat(path);
        fail();
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
    }
    // Reread all selected files; no path/inode/source change is adopted.
    for (const path of [...records.keys()]) await selected(path);
    return {
      purpose: 'cloud-recovery-native-preflight-observation',
      hostname: sources.hostname,
      bootId: sources.bootId,
      sourcesDigest: context.sourcesDigest,
      contextDigest: context.daemon.contextDigest,
      vacancyDigest: vacancy.observationDigest,
      observationDigest: sha({ probe, files: [...records.values()] }),
      roles: probe.roles,
      observedAtMs: clock(),
    };
  } catch {
    fail();
  }
}
