import { execFile } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { constants } from 'node:fs';
import * as fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import { hostname } from 'node:os';
import { posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import {
  cutoverLegacyInterruptionRisk,
  cutoverRegistrationConfigDigest,
  firstCutoverCloudDisplayBootstrap,
  firstCutoverCloudReviewedPythonStartup,
  readFirstCutoverCloudDisplayListeners,
  readFirstCutoverCloudRecoveryCensus,
  validateFirstCutoverCloudSources,
  validateLegacyWorkBoundary as validateWork,
} from './browser-cutover-evidence.mjs';
export { readFirstCutoverCloudRecoveryCensus };

/** Private, read-only current-disk/launch selection. Does not prove capability,
 * daemon loaded bytes, Python dynamic closure or authorize either effect. */
export async function readFirstCutoverCloudRecoverySources(input, overrides = {}) {
  const io = {
    ...fs,
    platform: process.platform,
    uid: process.getuid?.(),
    hostname,
    now: Date.now,
    monotonic: () => performance.now(),
    ...overrides,
  };
  const reject = () => {
    throw new Error('CUTOVER_CLOUD_SOURCES_UNPROVEN');
  };
  const digest = (value) =>
    createHash('sha256')
      .update(typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value))
      .digest('hex');
  const started = io.monotonic();
  const clock = () => {
    const elapsed = io.monotonic() - started;
    if (!Number.isFinite(elapsed) || elapsed < 0 || elapsed > 60000) reject();
  };
  const records = new Map();
  const directories = new Map();
  const files = [];
  const texts = new Map();
  let total = 0;
  const sameStat = (a, b) =>
    ['dev', 'ino', 'mode', 'uid', 'gid', 'size', 'mtimeMs', 'ctimeMs'].every((k) => a[k] === b[k]);
  const absolute = (p) =>
    typeof p === 'string' &&
    p.startsWith('/') &&
    posix.normalize(p) === p &&
    !p.includes('\0') &&
    p.length <= 4096;
  const stat = async (p) => {
    clock();
    const s = await io.lstat(p);
    // The fixed bootstrap invokes this root-owned mount as root BEFORE
    // setpriv clears capabilities. Retain its distro setuid bit in the evidence;
    // it does not change the caller UID. No other special mode/path is admitted.
    const rootMount =
      p === '/usr/bin/mount' &&
      s.isFile() &&
      s.uid === 0 &&
      s.gid === 0 &&
      (s.mode & 0o7777) === 0o4755;
    if (
      s.uid !== 0 ||
      (!s.isSymbolicLink() && ((s.mode & 0o022) !== 0 || ((s.mode & 0o7000) !== 0 && !rootMount)))
    )
      reject();
    const old = records.get(p);
    if (old && !sameStat(old, s)) reject();
    records.set(p, s);
    return s;
  };
  const chain = async (p) => {
    if (!absolute(p)) reject();
    let current = '/';
    await stat(current);
    for (const part of p.slice(1).split('/').filter(Boolean)) {
      current = posix.join(current, part);
      await stat(current);
    }
    const resolved = await io.realpath(p);
    if (!absolute(resolved)) reject();
    if (resolved !== p) {
      let c = '/';
      for (const part of resolved.slice(1).split('/')) {
        c = posix.join(c, part);
        await stat(c);
      }
    }
    return resolved;
  };
  const directory = async (p) => {
    const real = await chain(p);
    if (real !== p || !(await stat(p)).isDirectory()) reject();
    const names = (await io.readdir(p)).sort();
    if (
      names.length > 512 ||
      names.some((n) => typeof n !== 'string' || !n || n.includes('/') || n.includes('\0'))
    )
      reject();
    const old = directories.get(p);
    if (old && !isDeepStrictEqual(old, names)) reject();
    directories.set(p, names);
    clock();
    return names;
  };
  const absent = async (p) => {
    try {
      await io.lstat(p);
      reject();
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
    }
  };
  // The script directory precedes system packages for this non-isolated entry.
  // Stream names only: /usr/bin may legitimately contain far more than 512
  // unrelated commands. Never inspect/import candidate contents to accept one.
  const checkEntryDirectory = async () => {
    const path = '/usr/bin';
    if ((await chain(path)) !== path || !(await stat(path)).isDirectory()) reject();
    const handle = await io.opendir(path);
    let count = 0;
    let entrySeen = false;
    try {
      for (;;) {
        clock();
        const entry = await handle.read();
        if (!entry) break;
        if (
          ++count > 16384 ||
          typeof entry.name !== 'string' ||
          !entry.name ||
          Buffer.byteLength(entry.name) > 255 ||
          /[\0/]/.test(entry.name)
        )
          reject();
        const normalized = entry.name.toLowerCase().replace(/[-_.]+/g, '-');
        if (
          !/^(?:websockify|sitecustomize|usercustomize|apport-python-hook|re|importlib)(?:-|$)/.test(
            normalized,
          )
        )
          continue;
        if (entry.name !== 'websockify' || entrySeen) reject();
        entrySeen = true;
      }
      if (!entrySeen) reject();
    } finally {
      await handle.close();
    }
    clock();
  };
  const bounded = async (p, limit) => {
    const handle = await io.open(
      p,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    try {
      const chunks = [];
      let size = 0;
      while (size <= limit) {
        clock();
        const buffer = Buffer.alloc(Math.min(65536, limit + 1 - size));
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
        if (!bytesRead) break;
        chunks.push(buffer.subarray(0, bytesRead));
        size += bytesRead;
      }
      if (size > limit) reject();
      return Buffer.concat(chunks).toString('utf8');
    } finally {
      await handle.close();
    }
  };
  const source = async (p, text = false) => {
    if (files.length >= 128) reject();
    const real = await chain(p);
    const startupFile = firstCutoverCloudReviewedPythonStartup.find((row) => row.path === p);
    const allowed = startupFile
      ? [startupFile.resolvedPath]
      : p === '/bin/sh'
        ? ['/bin/sh', '/usr/bin/sh', '/usr/bin/dash', '/usr/bin/bash']
        : p === '/usr/bin/python3'
          ? ['/usr/bin/python3', '/usr/bin/python3.10']
          : p === '/usr/bin/pkill'
            ? ['/usr/bin/pkill', '/usr/bin/pgrep']
            : [p];
    if (!allowed.includes(real)) reject();
    const before = await stat(real);
    if (
      !before.isFile() ||
      before.size < 0 ||
      before.size > (text ? 256 * 1024 : 512 * 1024 * 1024) ||
      total + before.size > 1024 * 1024 * 1024
    )
      reject();
    const handle = await io.open(
      real,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    const h = createHash('sha256');
    const chunks = [];
    let size = 0;
    try {
      if (!sameStat(before, await handle.stat())) reject();
      const buf = Buffer.alloc(65536);
      for (;;) {
        clock();
        const { bytesRead } = await handle.read(buf, 0, buf.length, null);
        if (!bytesRead) break;
        size += bytesRead;
        if (size > before.size) reject();
        h.update(buf.subarray(0, bytesRead));
        if (text) chunks.push(Buffer.from(buf.subarray(0, bytesRead)));
      }
      if (
        size !== before.size ||
        !sameStat(before, await handle.stat()) ||
        !sameStat(before, await stat(real)) ||
        (await io.realpath(p)) !== real
      )
        reject();
    } finally {
      await handle.close();
    }
    total += size;
    const row = {
      path: p,
      resolvedPath: real,
      uid: before.uid,
      gid: before.gid,
      mode: before.mode & 0o7777,
      size,
      digest: h.digest('hex'),
    };
    files.push(row);
    if (text) texts.set(p, Buffer.concat(chunks).toString('utf8'));
    return row;
  };
  const startupDirectory = async (path, names) => {
    const known = new Set(firstCutoverCloudReviewedPythonStartup.map((row) => row.path));
    const selected = names.filter((n) =>
      /\.pth$|^(?:sitecustomize|usercustomize|apport_python_hook)(?:[.-]|$)/.test(n),
    );
    for (const name of selected) {
      const file = posix.join(path, name);
      if (!known.has(file)) reject();
      await source(file, true);
    }
    if (names.includes('__pycache__')) {
      const directoryPath = posix.join(path, '__pycache__');
      for (const name of await directory(directoryPath)) {
        if (!/^(?:sitecustomize|usercustomize|apport_python_hook)(?:[.-]|$)/.test(name)) continue;
        const file = posix.join(directoryPath, name);
        if (!known.has(file)) reject();
        await source(file, true);
      }
    }
  };
  try {
    if (
      io.platform !== 'linux' ||
      io.uid !== 0 ||
      !input ||
      Object.keys(input).sort().join(',') !== 'attempt,configs'
    )
      reject();
    const { attempt, configs } = input;
    const launch = firstCutoverCloudBrowserRecoveryLaunch({ attempt });
    const material = firstCutoverCloudVncRecoveryMaterial({ attempt });
    if (!Array.isArray(configs) || configs.length !== 2) reject();
    const scope = configs.map(({ name, pmId }) => ({ name, pmId }));
    const bootId = (await bounded('/proc/sys/kernel/random/boot_id', 128)).trim();
    const observedAtMs = io.now();
    const daemon = async () => {
      const pidText = (await bounded('/root/.pm2/pm2.pid', 32)).trim();
      if (!/^[1-9]\d*$/.test(pidText) || Number(pidText) <= 1) reject();
      const pid = Number(pidText);
      const raw = await bounded(`/proc/${pid}/stat`, 4096);
      const parts = raw
        .slice(raw.lastIndexOf(')') + 2)
        .trim()
        .split(/\s+/);
      if (!/^\d+$/.test(parts[19]) || ['Z', 'X'].includes(parts[0])) reject();
      if (
        (await bounded(`/proc/${pid}/cmdline`, 4096)).replace(/\0+$/, '') !==
        'PM2 v6.0.14: God Daemon (/root/.pm2)'
      )
        reject();
      const entries = (await bounded(`/proc/${pid}/environ`, 256 * 1024))
        .split('\0')
        .filter((s) => s.startsWith('PM2_NODE_OPTIONS='));
      if (entries.length > 1 || entries.some((s) => s !== 'PM2_NODE_OPTIONS=')) reject();
      const status = await bounded(`/proc/${pid}/status`, 65536);
      if (!/^Uid:\s+0\s+0\s+0\s+0\s*$/m.test(status) || !/^Gid:\s+0\s+0\s+0\s+0\s*$/m.test(status))
        reject();
      return { pid, start: parts[19], optionsPresent: entries.length === 1 };
    };
    const daemonBefore = await daemon();
    const fixed = [
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
    for (const p of fixed)
      await source(p, /\.(?:json|js|py|sh)$/.test(p) || p === '/usr/bin/websockify');
    if (
      JSON.parse(texts.get('/usr/lib/node_modules/pm2/package.json')).version !== '6.0.14' ||
      files.find((f) => f.path === '/usr/bin/python3').resolvedPath !== '/usr/bin/python3.10'
    )
      reject();
    const pm2Hashes = {
      'lib/God.js': 'a43594c030138c6db8d308ee1647903a72a49fc3ae781e600cc56338aa85ba90',
      'lib/God/ForkMode.js': '3d1f57dee19060862b4856b15cd61ca406047e658071609e545ac5e1e7755cb4',
      'lib/Utility.js': '97dc35e42a3ca1fdb4d79829346e8dbc693f1b180a764c99f202abc3328f3129',
      'lib/God/ActionMethods.js':
        'fac3eb453287059b94461cff459209c2d0a7c10bcb94ebf0f86aad8d087f82f8',
    };
    for (const [p, h] of Object.entries(pm2Hashes))
      if (files.find((f) => f.path === `/usr/lib/node_modules/pm2/${p}`).digest !== h) reject();
    // Exact reviewed Ubuntu entry shape; metadata is still independently read.
    if (
      files.find((f) => f.path === '/usr/bin/websockify').digest !==
      '1a14abe56973818410c2a504f66496645dcb0df1b5a3d499a7b6f0cf0c848388'
    )
      reject();
    const root = '/usr/lib/python3/dist-packages';
    const system = await directory(root);
    await startupDirectory(root, system);
    const metas = system.filter((n) => /^websockify.*\.(?:egg|dist)-info$/i.test(n));
    if (
      metas.some((n) => !/^websockify(?:-[0-9][a-zA-Z0-9._+-]{0,63})?\.(?:egg|dist)-info$/.test(n))
    )
      reject();
    if (
      metas.length !== 1 ||
      system.filter((n) => !metas.includes(n) && /^websockify(?:\.|$)/.test(n)).join(',') !==
        'websockify'
    )
      reject();
    const metadataPath = `${root}/${metas[0]}`;
    const packagePath = `${root}/websockify`;
    const modules = await directory(packagePath);
    for (const n of modules) {
      if (n === '__pycache__') continue;
      if (!/^[a-zA-Z_][a-zA-Z0-9_]*\.py$/.test(n)) reject();
      await source(`${packagePath}/${n}`, true);
    }
    if (modules.includes('__pycache__'))
      for (const n of await directory(`${packagePath}/__pycache__`)) {
        const match = /^([a-zA-Z_][a-zA-Z0-9_]*)\.cpython-310(?:\.opt-[12])?\.pyc$/.exec(n);
        if (!match || !modules.includes(`${match[1]}.py`)) reject();
        await source(`${packagePath}/__pycache__/${n}`, true);
      }
    for (const n of await directory(metadataPath)) {
      if (
        ![
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
        ].includes(n)
      )
        reject();
      const row = await source(`${metadataPath}/${n}`, true);
      if (
        n === 'not-zip-safe' &&
        (row.size !== 1 ||
          row.digest !== '01ba4719c80b6fe911b091a7c05124b64eeece964e09c058ef8f9805daca546b')
      )
        reject();
    }
    const meta = texts.get(`${metadataPath}/PKG-INFO`) ?? texts.get(`${metadataPath}/METADATA`);
    const version = /^Version: (.+)$/m.exec(meta ?? '')?.[1];
    if (
      (meta?.match(/^Name: websockify$/gm) ?? []).length !== 1 ||
      (meta?.match(/^Version: /gm) ?? []).length !== 1
    )
      reject();
    const entryText = texts.get(`${metadataPath}/entry_points.txt`);
    if (
      !/^\[console_scripts\]\s*\nwebsockify\s*=\s*websockify\.websocketproxy:websockify_init\s*$/.test(
        entryText ?? '',
      )
    )
      reject();
    // Finite Ubuntu search model. Never import Python or scan arbitrary homes.
    await checkEntryDirectory();
    const absentPaths = ['/usr/lib/python310.zip', '/usr/bin/pyvenv.cfg', '/usr/pyvenv.cfg'];
    // Ubuntu Python 3.10 searches this user site, not all of ~/.local.
    // Permit unrelated application data under protected real ancestors, while
    // binding the first missing component before/after the complete read.
    if ((await chain('/root')) !== '/root' || !(await stat('/root')).isDirectory()) reject();
    const userSite = '/root/.local/lib/python3.10/site-packages';
    for (const p of ['/root/.local', '/root/.local/lib', '/root/.local/lib/python3.10', userSite]) {
      let metadata;
      try {
        metadata = await stat(p);
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
        absentPaths.push(p);
        break;
      }
      // Check lstat type first: a dangling link must never count as absence.
      if (!metadata.isDirectory() || (await chain(p)) !== p || p === userSite) reject();
    }
    for (const p of [
      '/usr/lib/python3.10',
      '/usr/lib/python3.10/lib-dynload',
      '/usr/local/lib/python3.10/dist-packages',
      '/usr/local/lib/python3.10/site-packages',
    ]) {
      let names;
      try {
        names = await directory(p);
      } catch (e) {
        if (e.code !== 'ENOENT') throw e;
        absentPaths.push(p);
        continue;
      }
      await startupDirectory(p, names);
      if (names.some((n) => /^websockify(?:[.-]|$)/.test(n))) reject();
      if (p.includes('/usr/local/') && names.length) reject();
    }
    for (const p of absentPaths) await absent(p);
    const roles = [];
    for (const [i, row] of configs.entries()) {
      if (
        !row ||
        Object.keys(row).sort().join(',') !== 'config,name,pmId' ||
        row.name !== ['holaday-vnc', 'holaday-chromium-headed'][i] ||
        row.config?.name !== row.name ||
        row.config.pm_id !== row.pmId ||
        !isDeepStrictEqual(row.config, JSON.parse(JSON.stringify(row.config)))
      )
        reject();
      const config = structuredClone(row.config);
      const nested = config.env;
      if (
        !nested ||
        Object.getPrototypeOf(nested) !== Object.prototype ||
        config.exec_mode !== 'fork_mode' ||
        config.autostart !== true ||
        config.increment_var ||
        (config.instance_var && config.instance_var !== 'NODE_APP_INSTANCE')
      )
        reject();
      const fixedFields = {
        ...(i
          ? { pm_exec_path: launch.command, args: launch.args, exec_interpreter: 'none' }
          : { pm_exec_path: material.command, args: config.args, exec_interpreter: 'bash' }),
        exec_mode: 'fork_mode',
        autorestart: false,
        watch: false,
        cron_restart: '',
      };
      if (
        unsafeCloudRecoveryEnvironment(nested, fixedFields) ||
        (!i && (config.pm_exec_path !== material.command || config.exec_interpreter !== 'bash'))
      )
        reject();
      if (i) nested.DISPLAY = ':98';
      Object.assign(config, fixedFields);
      Reflect.deleteProperty(config, 'max_memory_restart');
      for (const [k, v] of Object.entries(nested)) {
        // biome-ignore lint/suspicious/noDoubleEquals: actual PM2 Utility.extend.
        if (v != '[object Object]') config[k] = v;
      }
      if (
        config.exec_mode !== 'fork_mode' ||
        config.autostart !== true ||
        config.increment_var ||
        (config.instance_var && config.instance_var !== 'NODE_APP_INSTANCE') ||
        // Headed recovery sets DISPLAY; VNC selects X via the checked x11vnc argv.
        // A missing VNC variable is distinct from a conflicting retained value.
        ((i || Object.hasOwn(config, 'DISPLAY')) && config.DISPLAY !== ':98') ||
        config.HOME !== '/root' ||
        (config.uid && config.uid !== 0) ||
        (config.gid && config.gid !== 0) ||
        !absolute(config.pm_cwd) ||
        !config.PATH ||
        typeof config.PATH !== 'string'
      )
        reject();
      if (!i && Array.isArray(config.node_args) && config.node_args.length) reject();
      const controls = [];
      for (const k of Object.keys(config).sort())
        if (
          /^(?:LD_|PYTHON|BASH_FUNC_)|^(?:PATH|HOME|SHELL|BASH_ENV|ENV|SHELLOPTS|BASHOPTS|DISPLAY|XAUTHORITY|TMPDIR)$/.test(
            k,
          )
        ) {
          const v = config[k];
          if (typeof v !== 'string' || v.includes('\0')) reject();
          if (
            /^(?:LD_|BASH_FUNC_)|^(?:BASH_ENV|ENV|SHELLOPTS|BASHOPTS|XAUTHORITY|TMPDIR)$/.test(k) &&
            v !== ''
          )
            reject();
          if (!i && k.startsWith('PYTHON') && v !== '') reject();
          controls.push([k, digest(v)]);
        }
      await chain(config.pm_cwd);
      if (!(await stat(await io.realpath(config.pm_cwd))).isDirectory()) reject();
      const dirs = config.PATH.split(':');
      if (dirs.length > 16 || dirs.some((p) => !absolute(p))) reject();
      for (const p of dirs) if (!(await stat(await chain(p))).isDirectory()) reject();
      const selected = [];
      if (!i)
        for (const name of ['bash', 'x11vnc', 'websockify', 'pkill', 'sleep', 'date']) {
          let found;
          for (const dir of dirs) {
            const p = posix.join(dir, name);
            try {
              const real = await chain(p);
              const s = await stat(real);
              if (!s.isFile() || !(s.mode & 0o111)) reject();
              found = real;
              break;
            } catch (e) {
              if (e.code !== 'ENOENT') throw e;
              absentPaths.push(p);
            }
          }
          // PATH must select the exact executable already measured above.
          if (found !== files.find((file) => file.path === `/usr/bin/${name}`)?.resolvedPath)
            reject();
          selected.push([name, found]);
        }
      const args = i
        ? launch.args
        : [
            material.command,
            ...(config.args ? (Array.isArray(config.args) ? config.args : [config.args]) : []),
          ];
      if (args.some((a) => typeof a !== 'string' || a.includes('\0'))) reject();
      roles.push({
        name: row.name,
        pmId: row.pmId,
        configDigest: cutoverRegistrationConfigDigest(row.config),
        selectionDigest: digest({
          material: i ? launch : material,
          command: i ? launch.command : 'bash',
          args,
          cwd: config.pm_cwd,
          uid: config.uid ?? null,
          gid: config.gid ?? null,
          controls,
          selected,
          daemon: daemonBefore,
        }),
      });
    }
    for (const [p, s] of records) if (!sameStat(s, await io.lstat(p))) reject();
    for (const [p, names] of directories)
      if (!isDeepStrictEqual(names, (await io.readdir(p)).sort())) reject();
    for (const f of files) if ((await io.realpath(f.path)) !== f.resolvedPath) reject();
    for (const p of absentPaths) await absent(p);
    if (
      !isDeepStrictEqual(daemonBefore, await daemon()) ||
      (await bounded('/proc/sys/kernel/random/boot_id', 128)).trim() !== bootId
    )
      reject();
    await checkEntryDirectory();
    clock();
    const result = {
      host: 'vultr',
      hostname: io.hostname(),
      bootId,
      observedAtMs,
      files: files.sort((a, b) => (a.path < b.path ? -1 : 1)),
      roles,
      pythonEntry: {
        metadataPath,
        name: 'websockify',
        version,
        group: 'console_scripts',
        entry: 'websockify',
        target: 'websockify.websocketproxy:websockify_init',
      },
    };
    validateFirstCutoverCloudSources(result, { scope, observed: true });
    return result;
  } catch {
    reject();
  }
}

const hash = (x) => typeof x === 'string' && /^[a-f0-9]{64}$/.test(x);

// executeApp flattens nested env after current_conf. Preserve matching and
// unrelated values, but do not let them undo the fixed recovery settings.
const unsafeCloudRecoveryEnvironment = (environment, fixed) =>
  Object.hasOwn(environment ?? {}, 'max_memory_restart') ||
  Object.entries(fixed).some(
    ([key, value]) =>
      Object.hasOwn(environment ?? {}, key) && !isDeepStrictEqual(environment[key], value),
  );

// Internal transport only. Do not construct the PM2 Client/API (it autostarts
// a missing daemon). Never queue a request or reconnect and replay a write.
async function cloudPm2Rpc(method, payload, io, beforeSend) {
  if (!['getMonitorData', 'restartProcessId'].includes(method)) fail();
  const before = await io.lstat(io.rpcSocket);
  if (before.uid !== 0 || (before.mode & 0o170000) !== 0o140000) fail();
  const require = createRequire('/usr/lib/node_modules/pm2/package.json');
  const socket = require('pm2-axon').socket('req');
  socket.set('retry timeout', 0);
  socket.set('hwm', 0);
  const client = new (require('pm2-axon-rpc').Client)(socket);
  const result = await new Promise((resolve, reject) => {
    let finished = false;
    const done = (error, value) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      socket.close();
      if (error) reject(error);
      else resolve(value);
    };
    // This bounds only the transport. It neither kills the remote process nor
    // means a write did not happen; the durable intent remains unresolved.
    const timer = setTimeout(() => done(new Error('rpc unavailable')), 5000);
    socket.once('error', (error) => done(error));
    socket.once('close', () => done(new Error('rpc closed')));
    socket.once('drop', () => done(new Error('rpc not connected')));
    socket.once('connect', async () => {
      if (finished) return;
      try {
        await beforeSend?.();
        if (!finished) client.call(method, payload, done);
      } catch (error) {
        done(error);
      }
    });
    try {
      socket.connect(io.rpcSocket);
    } catch (error) {
      done(error);
    }
  });
  const after = await io.lstat(io.rpcSocket);
  if (
    before.dev !== after.dev ||
    before.ino !== after.ino ||
    after.uid !== 0 ||
    (after.mode & 0o170000) !== 0o140000
  )
    fail();
  return result;
}

/** Private native leaf for the original observer's baseline bracket. Full raw
 * configurations stay in trusted process memory; never publish this return as
 * evidence or treat a successful read as stop/recovery permission.
 */
export async function readFirstCutoverCloudManagers(overrides = {}) {
  const io = {
    ...fs,
    platform: process.platform,
    uid: process.getuid?.(),
    rpcSocket: '/root/.pm2/rpc.sock',
    ...overrides,
  };
  const reject = () => {
    throw new Error('CUTOVER_CLOUD_MANAGERS_UNPROVEN');
  };
  // Refuse values whose JSON/RPC representation could silently lose data. Do
  // not normalise unknown fields, monitor values or environment into a proof.
  const jsonData = (value, ancestors = new Set()) => {
    if (value === null || ['string', 'boolean'].includes(typeof value)) return;
    if (typeof value === 'number') {
      if (
        !Number.isFinite(value) ||
        Object.is(value, -0) ||
        (Number.isInteger(value) && !Number.isSafeInteger(value))
      )
        reject();
      return;
    }
    if (
      typeof value !== 'object' ||
      Object.getPrototypeOf(value) !==
        (Array.isArray(value) ? Array.prototype : Object.prototype) ||
      ancestors.has(value)
    )
      reject();
    ancestors.add(value);
    for (const key of Reflect.ownKeys(value)) {
      if (Array.isArray(value) && key === 'length') continue;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (typeof key !== 'string' || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value'))
        reject();
      jsonData(descriptor.value, ancestors);
    }
    ancestors.delete(value);
  };
  try {
    if (io.platform !== 'linux' || io.uid !== 0) reject();
    const rpc = io.rpc ?? ((method, payload) => cloudPm2Rpc(method, payload, io));
    const rows = await rpc('getMonitorData', {});
    if (!Array.isArray(rows)) reject();
    const ids = new Set();
    for (const row of rows) {
      if (
        !row ||
        Object.getPrototypeOf(row) !== Object.prototype ||
        ['pm_id', 'name', 'pm2_env'].some(
          (key) => !Object.hasOwn(Object.getOwnPropertyDescriptor(row, key) ?? {}, 'value'),
        ) ||
        !Number.isSafeInteger(row.pm_id) ||
        Object.is(row.pm_id, -0) ||
        row.pm_id < 0 ||
        ids.has(row.pm_id) ||
        typeof row.name !== 'string' ||
        !row.name ||
        !row.pm2_env ||
        Object.getPrototypeOf(row.pm2_env) !== Object.prototype ||
        row.pm2_env.pm_id !== row.pm_id ||
        row.pm2_env.name !== row.name
      )
        reject();
      // PM2 may omit pid on unrelated registrations. They still participate
      // in full name/ID collision checks; a present pid must remain valid data.
      const pid = Object.getOwnPropertyDescriptor(row, 'pid');
      if (
        pid &&
        (!Object.hasOwn(pid, 'value') ||
          !Number.isSafeInteger(pid.value) ||
          Object.is(pid.value, -0) ||
          pid.value < 0)
      )
        reject();
      ids.add(row.pm_id);
    }
    return ['holaday-vnc', 'holaday-chromium-headed'].map((name) => {
      const selected = rows.filter((row) => row.name === name);
      if (selected.length !== 1) reject();
      const row = selected[0];
      // Neither selected role may lose its explicit PID or be normalised to 0.
      if (!Object.hasOwn(row, 'pid')) reject();
      jsonData(row.pm2_env);
      const pm2_env = JSON.parse(JSON.stringify(row.pm2_env));
      if (!isDeepStrictEqual(pm2_env, row.pm2_env)) reject();
      return { pm_id: row.pm_id, name, pid: row.pid, pm2_env };
    });
  } catch {
    reject();
  }
}

/** One stopped registration's fixed restore EFFECT, not recovery acceptance.
 * The original site must supply its live, exclusive scope guard: original tree
 * absent, reviewed stopped config, unchanged daemon/tools, protected policies,
 * display ownership and settled work/fences. There is deliberately no default
 * guard and no CLI entrypoint. A successful RPC is NOT a cloud-restored event;
 * the original observer must independently validate the complete new tree.
 */
export async function restoreFirstCutoverCloudBrowser(input, overrides = {}) {
  const io = {
    ...fs,
    platform: process.platform,
    uid: process.getuid?.(),
    now: Date.now,
    rpcSocket: '/root/.pm2/rpc.sock',
    ...overrides,
  };
  const reject = () => {
    throw new Error('CUTOVER_CLOUD_RECOVERY_UNPROVEN');
  };
  let dispatched = false;
  try {
    const approved = structuredClone(input);
    const { attempt, pmId, stoppedConfigDigest, maintenanceEndsAtMs } = approved;
    const launch = firstCutoverCloudBrowserRecoveryLaunch({ attempt });
    if (
      Object.keys(approved).sort().join(',') !==
        'attempt,maintenanceEndsAtMs,pmId,stoppedConfigDigest' ||
      io.platform !== 'linux' ||
      io.uid !== 0 ||
      !Number.isSafeInteger(pmId) ||
      pmId < 0 ||
      !hash(stoppedConfigDigest) ||
      !Number.isSafeInteger(maintenanceEndsAtMs) ||
      typeof io.assertRecoveryScope !== 'function'
    )
      reject();
    const launchDigest = createHash('sha256').update(JSON.stringify(launch)).digest('hex');
    let last = io.now();
    const clock = () => {
      const now = io.now();
      if (
        !Number.isSafeInteger(last) ||
        last < 0 ||
        !Number.isSafeInteger(now) ||
        now < last ||
        maintenanceEndsAtMs - now <= 0 ||
        maintenanceEndsAtMs - now > 900000
      )
        reject();
      last = now;
    };
    const binding = structuredClone(await io.journal.assertOwnership());
    if (binding.attempt !== attempt) reject();
    const state = async (count) => {
      clock();
      if (!isDeepStrictEqual(await io.journal.assertOwnership(), binding)) reject();
      const record = await io.journal.readFirstCutoverEffects();
      const scope = record.cloudMaintenanceScope;
      if (
        !Object.entries(binding).every(([k, v]) => record[k] === v) ||
        record.phase !== 'verified' ||
        record.failureObservation ||
        !hash(record.executionSiteDigest) ||
        (record.maintenanceEndsAtMs !== undefined &&
          record.maintenanceEndsAtMs !== maintenanceEndsAtMs) ||
        !Array.isArray(scope) ||
        scope.length !== 2 ||
        scope[0].name !== 'holaday-vnc' ||
        scope[1].name !== 'holaday-chromium-headed' ||
        scope[1].pmId !== pmId ||
        scope[0].pmId === pmId ||
        scope[1].recoveryDigest !== launchDigest ||
        scope.some((s) => !hash(s.scopeDigest) || !hash(s.recoveryDigest)) ||
        record.cloudMaintenanceEvents?.length !== count
      )
        reject();
      const base = (s) => ({
        ...s,
        attempt,
        inventoryDigest: binding.inventoryDigest,
        host: 'vultr',
      });
      const expected = scope.flatMap((s) =>
        ['cloud-stop-intent', 'cloud-stopped'].map((phase) => ({ ...base(s), phase })),
      );
      if (count === 5) expected.push({ ...base(scope[1]), phase: 'cloud-restore-intent' });
      if (!isDeepStrictEqual(record.cloudMaintenanceEvents, expected)) reject();
      return structuredClone(record);
    };
    const rpc = io.rpc ?? ((method, args, beforeSend) => cloudPm2Rpc(method, args, io, beforeSend));
    const stopped = async () => {
      const rows = await rpc('getMonitorData', {});
      if (!Array.isArray(rows)) reject();
      const matches = rows.filter((r) => r.pm_id === pmId || r.name === 'holaday-chromium-headed');
      const row = matches[0];
      if (
        matches.length !== 1 ||
        row.pm_id !== pmId ||
        row.name !== 'holaday-chromium-headed' ||
        row.pid !== 0 ||
        row.pm2_env?.pm_id !== pmId ||
        row.pm2_env.name !== row.name ||
        row.pm2_env.status !== 'stopped' ||
        row.pm2_env.watch !== false ||
        row.pm2_env.exec_mode !== 'fork_mode' ||
        unsafeCloudRecoveryEnvironment(row.pm2_env.env, {
          pm_exec_path: launch.command,
          args: launch.args,
          exec_interpreter: 'none',
          exec_mode: 'fork_mode',
          autorestart: false,
          watch: false,
          cron_restart: '',
        }) ||
        !Number.isSafeInteger(row.pm2_env.restart_time) ||
        row.pm2_env.restart_time < 0 ||
        cutoverRegistrationConfigDigest(row.pm2_env) !== stoppedConfigDigest
      )
        reject();
    };
    const guard = async (count) => {
      const before = await state(count);
      // Only a trusted local controller, not uploaded facts or booleans.
      if ((await io.assertRecoveryScope(structuredClone(approved))) !== undefined) reject();
      await stopped();
      if (!isDeepStrictEqual(before, await state(count))) reject();
      return before;
    };
    const before = await guard(4);
    await io.journal.recordCloudMaintenanceEvent({
      ...before.cloudMaintenanceScope[1],
      attempt,
      inventoryDigest: binding.inventoryDigest,
      host: 'vultr',
      phase: 'cloud-restore-intent',
    });
    await guard(5);
    // No delete/recreate, name-wide restart, inherited startup script, fallback,
    // retry, PM2 save or restart-counter reset. The stopped registration keeps
    // its ID and existing environment; reviewed launch fields change explicitly.
    dispatched = true;
    await rpc(
      'restartProcessId',
      {
        id: pmId,
        env: {
          DISPLAY: ':98',
          current_conf: {
            pm_exec_path: launch.command,
            args: launch.args,
            exec_interpreter: 'none',
            exec_mode: 'fork_mode',
            autorestart: false,
            watch: false,
            cron_restart: '',
            // PM2 Worker treats zero as a threshold. Utility's literal string
            // deletion marker survives JSON; executeApp must not restore it
            // from nested env, which the stopped guard refuses above.
            max_memory_restart: 'null',
            DISPLAY: ':98',
          },
        },
      },
      () => guard(5),
    );
    await state(5);
  } catch {
    if (dispatched) throw new Error('CUTOVER_CLOUD_RESTORE_UNCERTAIN');
    reject();
  }
}
/** Fixed VNC restore EFFECT, not recovery acceptance. The original site's
 * mandatory live guard must prove the approved VNC source digest, exact scope,
 * display/tools, settled work and fences (including independent headed recovery).
 * Preserves the stopped wrapper/argv/environment while applying ONLY the
 * explicitly digest-bound PM2 safety override below. Approved VNC child
 * supervision remains intact. Independent post-recovery config/tree proof is
 * still required; RPC success never creates a restored event.
 */
export async function restoreFirstCutoverCloudVnc(input, overrides = {}) {
  const io = {
    ...fs,
    platform: process.platform,
    uid: process.getuid?.(),
    now: Date.now,
    rpcSocket: '/root/.pm2/rpc.sock',
    ...overrides,
  };
  const reject = () => {
    throw new Error('CUTOVER_CLOUD_RECOVERY_UNPROVEN');
  };
  let dispatched = false;
  try {
    const approved = structuredClone(input);
    if (!approved || typeof approved !== 'object' || Array.isArray(approved)) reject();
    const { attempt, pmId, stoppedConfigDigest, maintenanceEndsAtMs } = approved;
    const headedLaunch = firstCutoverCloudBrowserRecoveryLaunch({ attempt });
    const material = firstCutoverCloudVncRecoveryMaterial({ attempt });
    if (
      Object.keys(approved).sort().join(',') !==
        'attempt,maintenanceEndsAtMs,pmId,stoppedConfigDigest' ||
      io.platform !== 'linux' ||
      io.uid !== 0 ||
      !Number.isSafeInteger(pmId) ||
      pmId < 0 ||
      !hash(stoppedConfigDigest) ||
      !Number.isSafeInteger(maintenanceEndsAtMs) ||
      typeof io.assertRecoveryScope !== 'function'
    )
      reject();
    const headedLaunchDigest = createHash('sha256')
      .update(JSON.stringify(headedLaunch))
      .digest('hex');
    const recoveryDigest = createHash('sha256').update(JSON.stringify(material)).digest('hex');
    let last = io.now();
    const clock = () => {
      const now = io.now();
      if (
        !Number.isSafeInteger(last) ||
        last < 0 ||
        !Number.isSafeInteger(now) ||
        now < last ||
        maintenanceEndsAtMs - now <= 0 ||
        maintenanceEndsAtMs - now > 900000
      )
        reject();
      last = now;
    };
    const binding = structuredClone(await io.journal.assertOwnership());
    if (binding.attempt !== attempt) reject();
    let originalRecord;
    const state = async (count) => {
      clock();
      if (!isDeepStrictEqual(await io.journal.assertOwnership(), binding)) reject();
      const record = await io.journal.readFirstCutoverEffects();
      const scope = record.cloudMaintenanceScope;
      if (
        !Object.entries(binding).every(([key, value]) => record[key] === value) ||
        record.phase !== 'verified' ||
        record.failureObservation ||
        !hash(record.executionSiteDigest) ||
        (record.maintenanceEndsAtMs !== undefined &&
          record.maintenanceEndsAtMs !== maintenanceEndsAtMs) ||
        !Array.isArray(scope) ||
        scope.length !== 2 ||
        scope.some(
          (entry, index) =>
            !entry ||
            Object.keys(entry).sort().join(',') !== 'name,pmId,recoveryDigest,scopeDigest' ||
            entry.name !== ['holaday-vnc', 'holaday-chromium-headed'][index] ||
            !Number.isSafeInteger(entry.pmId) ||
            entry.pmId < 0 ||
            !hash(entry.scopeDigest) ||
            !hash(entry.recoveryDigest),
        ) ||
        scope[0].pmId !== pmId ||
        scope[0].recoveryDigest !== recoveryDigest ||
        scope[1].pmId === pmId ||
        scope[1].recoveryDigest !== headedLaunchDigest ||
        record.cloudMaintenanceEvents?.length !== count
      )
        reject();
      const base = (entry) => ({
        ...entry,
        attempt,
        inventoryDigest: binding.inventoryDigest,
        host: 'vultr',
      });
      const expected = scope.flatMap((entry) =>
        ['cloud-stop-intent', 'cloud-stopped'].map((phase) => ({ ...base(entry), phase })),
      );
      expected.push(
        { ...base(scope[1]), phase: 'cloud-restore-intent' },
        { ...base(scope[1]), phase: 'cloud-restored' },
      );
      if (count === 7) expected.push({ ...base(scope[0]), phase: 'cloud-restore-intent' });
      if (!isDeepStrictEqual(record.cloudMaintenanceEvents, expected)) reject();
      // Only our seventh event and the resulting owned record digest may change
      // across the append. Keep the original scope/site and all other facts pinned.
      const stable = Object.fromEntries(
        Object.entries(record).filter(
          ([key]) => !['recordDigest', 'cloudMaintenanceEvents'].includes(key),
        ),
      );
      if (originalRecord && !isDeepStrictEqual(stable, originalRecord)) reject();
      originalRecord ??= structuredClone(stable);
      if (!isDeepStrictEqual(await io.journal.assertOwnership(), binding)) reject();
      clock();
      return structuredClone(record);
    };
    const rpc = io.rpc ?? ((method, args, beforeSend) => cloudPm2Rpc(method, args, io, beforeSend));
    const stopped = async () => {
      const rows = await rpc('getMonitorData', {});
      if (!Array.isArray(rows)) reject();
      const matches = rows.filter((row) => row.pm_id === pmId || row.name === 'holaday-vnc');
      const row = matches[0];
      if (
        matches.length !== 1 ||
        row.pm_id !== pmId ||
        row.name !== 'holaday-vnc' ||
        row.pid !== 0 ||
        row.pm2_env?.pm_id !== pmId ||
        row.pm2_env.name !== row.name ||
        row.pm2_env.status !== 'stopped' ||
        row.pm2_env.pm_exec_path !== material.command ||
        row.pm2_env.exec_interpreter !== material.exec_interpreter ||
        row.pm2_env.exec_mode !== 'fork_mode' ||
        row.pm2_env.watch !== false ||
        unsafeCloudRecoveryEnvironment(row.pm2_env.env, {
          ...material.current_conf,
          pm_exec_path: material.command,
          args: row.pm2_env.args,
          exec_interpreter: material.exec_interpreter,
          exec_mode: 'fork_mode',
        }) ||
        !Number.isSafeInteger(row.pm2_env.restart_time) ||
        row.pm2_env.restart_time < 0 ||
        cutoverRegistrationConfigDigest(row.pm2_env) !== stoppedConfigDigest
      )
        reject();
    };
    const guard = async (count) => {
      const before = await state(count);
      if ((await io.assertRecoveryScope(structuredClone(approved))) !== undefined) reject();
      await stopped();
      if (!isDeepStrictEqual(before, await state(count))) reject();
      return before;
    };
    const before = await guard(6);
    await io.journal.recordCloudMaintenanceEvent({
      ...before.cloudMaintenanceScope[0],
      attempt,
      inventoryDigest: binding.inventoryDigest,
      host: 'vultr',
      phase: 'cloud-restore-intent',
    });
    await guard(7);
    // No command/argv/environment-value replacement or restart-count reset.
    // This explicit, pre-bound policy is the entire approved config override.
    dispatched = true;
    await rpc(
      'restartProcessId',
      { id: pmId, env: { current_conf: structuredClone(material.current_conf) } },
      () => guard(7),
    );
    await state(7);
  } catch {
    if (dispatched) throw new Error('CUTOVER_CLOUD_RESTORE_UNCERTAIN');
    reject();
  }
}
/** Fixed VNC recovery MATERIAL, not permission or proof of recovery. Hash the
 * exact JSON serialization for the original journal's VNC recoveryDigest. The
 * original wrapper/source bytes and retained config still need independent
 * native proof. Only these four PM2 safety fields may change by this payload.
 */
export function firstCutoverCloudVncRecoveryMaterial(input) {
  if (
    !input ||
    typeof input !== 'object' ||
    Array.isArray(input) ||
    Object.keys(input).length !== 1 ||
    typeof input.attempt !== 'string' ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(input.attempt)
  )
    fail();
  return {
    attempt: input.attempt,
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
/** Fixed recovery MATERIAL, not permission to start a process. The site binds
 * its digest in the existing journal; execution still needs fresh exclusive
 * ownership, tool/policy bytes, stop and recovery facts. No caller argv, URL,
 * executable, display or profile selection, and no unsafe old startup script.
 * unshare/mount failure exits without a direct-browser fallback. */
export function firstCutoverCloudBrowserRecoveryLaunch(input) {
  if (
    !input ||
    typeof input !== 'object' ||
    Array.isArray(input) ||
    Object.keys(input).length !== 1 ||
    typeof input.attempt !== 'string' ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(input.attempt)
  )
    fail();
  return {
    command: '/usr/bin/unshare',
    args: [
      '--mount',
      '--propagation',
      'private',
      '/bin/sh',
      '-ceu',
      '/usr/bin/mount --bind "$1" /etc/brave/policies/managed; /usr/bin/mount -o remount,bind,ro /etc/brave/policies/managed; shift; exec /usr/bin/setpriv --bounding-set=-all --inh-caps=-all --ambient-caps=-all --no-new-privs "$@"',
      'holaday-private-browser-policy',
      `/var/lib/holaday-deploy/maintenance/${input.attempt}/cloud-browser-policy`,
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
    ],
    env: { DISPLAY: ':98' },
    autorestart: false,
  };
}

/** Independent, read-only observation of the fixed recovered browser. This is
 * not stop/restore authorization, display exclusivity, a tool audit, or proof
 * about all external work. Its caller must still prove those separately. Raw
 * environment, policy and PM2 configuration never leave this boundary. */
export async function readFirstCutoverCloudBrowserRecovery(input, overrides = {}) {
  const io = {
    ...fs,
    platform: process.platform,
    uid: process.getuid?.(),
    now: Date.now,
    rpcSocket: '/root/.pm2/rpc.sock',
    ...overrides,
  };
  const reject = () => {
    throw new Error('CUTOVER_CLOUD_RECOVERY_UNPROVEN');
  };
  const sha = (value) => createHash('sha256').update(value).digest('hex');
  try {
    const { attempt, pmId } = structuredClone(input);
    if (
      io.platform !== 'linux' ||
      io.uid !== 0 ||
      Object.keys(input).sort().join(',') !== 'attempt,pmId' ||
      !Number.isSafeInteger(pmId) ||
      pmId < 0
    )
      reject();
    const launch = firstCutoverCloudBrowserRecoveryLaunch({ attempt });
    const name = 'holaday-chromium-headed';
    const startTime = io.now();
    if (!Number.isSafeInteger(startTime) || startTime < 0) reject();
    const readManagers =
      io.readManagers ??
      (async () => {
        // The PM2 CLI and Client.start automatically spawn a missing daemon.
        // Connect only to the existing socket with PM2's RPC dependencies; never
        // construct its Client/API, initialize files, or invoke a launch method.
        const before = await io.lstat(io.rpcSocket);
        if (before.uid !== 0 || (before.mode & 0o170000) !== 0o140000) reject();
        const require = createRequire('/usr/lib/node_modules/pm2/package.json');
        const socket = require('pm2-axon').socket('req');
        const client = new (require('pm2-axon-rpc').Client)(socket);
        const rows = await new Promise((resolve, rejectRead) => {
          let finished = false;
          const done = (error, value) => {
            if (finished) return;
            finished = true;
            clearTimeout(timer);
            socket.close();
            if (error) rejectRead(error);
            else resolve(value);
          };
          const timer = setTimeout(() => done(new Error('timeout')), 5000);
          socket.once('error', (error) => done(error));
          socket.once('connect', () => client.call('getMonitorData', {}, done));
          try {
            socket.connect(io.rpcSocket);
          } catch (error) {
            done(error);
          }
        });
        const after = await io.lstat(io.rpcSocket);
        if (
          before.dev !== after.dev ||
          before.ino !== after.ino ||
          after.uid !== 0 ||
          (after.mode & 0o170000) !== 0o140000
        )
          reject();
        return rows;
      });
    const manager = async () => {
      const rows = await readManagers();
      if (!Array.isArray(rows)) reject();
      const matches = rows.filter((r) => r.name === name || r.pm_id === pmId);
      const row = matches[0];
      const env = row?.pm2_env;
      if (
        matches.length !== 1 ||
        row.name !== name ||
        row.pm_id !== pmId ||
        !Number.isSafeInteger(row.pid) ||
        row.pid <= 1 ||
        env?.name !== name ||
        env.status !== 'online' ||
        env.pm_exec_path !== launch.command ||
        !isDeepStrictEqual(env.args, launch.args) ||
        env.exec_interpreter !== 'none' ||
        env.exec_mode !== 'fork_mode' ||
        env.autorestart !== false ||
        env.watch !== false ||
        env.cron_restart !== '' ||
        Object.hasOwn(env, 'max_memory_restart') ||
        Object.hasOwn(env.env ?? {}, 'max_memory_restart') ||
        !Number.isSafeInteger(env.restart_time) ||
        env.restart_time < 0 ||
        env.DISPLAY !== ':98'
      )
        reject();
      // Bind every registration field (including environment/unknown options)
      // across these reads; only axm_monitor is excluded by the original digest.
      // This is current stability, NOT preservation against the stopped baseline.
      return {
        pid: row.pid,
        pmId: row.pm_id,
        name: row.name,
        configDigest: cutoverRegistrationConfigDigest(env),
        launch: Object.fromEntries(
          [
            'name',
            'status',
            'pm_exec_path',
            'args',
            'exec_interpreter',
            'autorestart',
            'watch',
            'restart_time',
            'DISPLAY',
          ].map((k) => [k, env[k]]),
        ),
      };
    };
    const selected = await manager();
    const pid = selected.pid;
    const root = '/etc/brave/policies/managed';
    const source = `/var/lib/holaday-deploy/maintenance/${attempt}/cloud-browser-policy`;
    const mounted = `/proc/${pid}/root${root}`;
    const metadata = async (path, type) => {
      const s = await io.lstat(path);
      if (s.uid !== 0 || (s.mode & 0o170000) !== type || s.mode & 0o022) reject();
      return Object.fromEntries(
        ['dev', 'ino', 'uid', 'mode', 'size', 'mtimeMs', 'ctimeMs', 'nlink'].map((k) => [k, s[k]]),
      );
    };
    const policies = async (path) => {
      const directory = await metadata(path, 0o40000);
      const names = (await io.readdir(path)).sort();
      if (names.length > 64 || names.some((n) => !/^[A-Za-z0-9_-]+\.json$/.test(n))) reject();
      const entries = [];
      for (const name of names) {
        const file = `${path}/${name}`;
        const stat = await metadata(file, 0o100000);
        if (stat.size > 1024 * 1024 || stat.nlink !== 1) reject();
        const raw = await io.readFile(file, 'utf8');
        const parsed = JSON.parse(raw);
        if (
          !parsed ||
          typeof parsed !== 'object' ||
          Array.isArray(parsed) ||
          Buffer.byteLength(raw) !== stat.size ||
          !isDeepStrictEqual(stat, await metadata(file, 0o100000))
        )
          reject();
        entries.push({ name, stat, digest: sha(raw), parsed });
      }
      if (
        !isDeepStrictEqual(names, (await io.readdir(path)).sort()) ||
        !isDeepStrictEqual(directory, await metadata(path, 0o40000))
      )
        reject();
      return entries;
    };
    const sample = async () => {
      const bootId = (await io.readFile('/proc/sys/kernel/random/boot_id', 'utf8')).trim();
      if (!/^[a-f0-9-]{36}$/.test(bootId)) reject();
      const fields = await io.readFile(`/proc/${pid}/stat`, 'utf8');
      if (!fields.startsWith(`${pid} (`)) reject();
      const stat = fields
        .slice(fields.lastIndexOf(')') + 2)
        .trim()
        .split(/\s+/);
      if (!['R', 'S', 'D', 'I'].includes(stat[0]) || !/^\d+$/.test(stat[19] ?? '')) reject();
      if ((await io.readlink(`/proc/${pid}/exe`)) !== '/opt/brave.com/brave/brave') reject();
      const argv = (await io.readFile(`/proc/${pid}/cmdline`, 'utf8')).split('\0');
      if (
        argv.pop() !== '' ||
        !isDeepStrictEqual(
          argv,
          launch.args.slice(launch.args.indexOf('/opt/brave.com/brave/brave')),
        )
      )
        reject();
      const displays = (await io.readFile(`/proc/${pid}/environ`, 'utf8'))
        .split('\0')
        .filter((value) => value.startsWith('DISPLAY='));
      if (!isDeepStrictEqual(displays, ['DISPLAY=:98'])) reject();
      const status = await io.readFile(`/proc/${pid}/status`, 'utf8');
      if (!/^Uid:\s+0\s+0\s+0\s+0$/m.test(status) || !/^NoNewPrivs:\s+1$/m.test(status)) reject();
      for (const key of ['CapInh', 'CapPrm', 'CapEff', 'CapBnd', 'CapAmb'])
        if (!new RegExp(`^${key}:\\s+0+$`, 'm').test(status)) reject();
      const namespace = await io.readlink(`/proc/${pid}/ns/mnt`);
      if (
        !/^mnt:\[\d+\]$/.test(namespace) ||
        namespace === (await io.readlink('/proc/self/ns/mnt'))
      )
        reject();
      const mounts = (await io.readFile(`/proc/${pid}/mountinfo`, 'utf8'))
        .split('\n')
        .map((line) => line.split(' '))
        .filter((row) => row[4] === root);
      if (
        mounts.length !== 1 ||
        !mounts[0][5].split(',').includes('ro') ||
        mounts[0].some((field) => /^(shared|master|propagate_from):/.test(field))
      )
        reject();
      const original = await policies(root);
      const privateFiles = await policies(source);
      const actual = await policies(mounted);
      if (
        !isDeepStrictEqual(privateFiles, actual) ||
        original.some((p) => p.name === 'recovery.json') ||
        !isDeepStrictEqual(
          privateFiles.map((p) => p.name).sort(),
          [...original.map((p) => p.name), 'recovery.json'].sort(),
        ) ||
        original.some(
          (p) =>
            !isDeepStrictEqual(p.parsed, privateFiles.find((f) => f.name === p.name)?.parsed) ||
            p.digest !== privateFiles.find((f) => f.name === p.name)?.digest ||
            Object.hasOwn(p.parsed, 'RestoreOnStartup'),
        ) ||
        !isDeepStrictEqual(privateFiles.find((p) => p.name === 'recovery.json')?.parsed, {
          RestoreOnStartup: 5,
        })
      )
        reject();
      return {
        bootId,
        start: stat[19],
        ppid: Number(stat[1]),
        namespace,
        policyDigest: sha(JSON.stringify({ original, privateFiles })),
        mount: mounts[0],
      };
    };
    const before = await sample();
    if (!isDeepStrictEqual(before, await sample()) || !isDeepStrictEqual(selected, await manager()))
      reject();
    const observedAtMs = io.now();
    if (
      !Number.isSafeInteger(observedAtMs) ||
      observedAtMs < startTime ||
      observedAtMs - startTime > 60000
    )
      reject();
    return {
      purpose: 'cloud-browser-runtime-observation',
      name,
      pmId,
      pid,
      restartCount: selected.launch.restart_time,
      configDigest: selected.configDigest,
      bootId: before.bootId,
      start: before.start,
      ppid: before.ppid,
      mountNamespace: before.namespace,
      policyDigest: before.policyDigest,
      launchDigest: sha(JSON.stringify(launch)),
      observedAtMs,
    };
  } catch {
    reject();
  }
}

/** Post-effect native identity observation for the ORIGINAL observer. Its
 * private pre-dispatch census is not an approval, and this reader is NOT a
 * source/display/work preflight. The caller must independently bind the
 * retained stopped configuration through the finite recovery comparator.
 * No production restore may dispatch without those native prerequisites.
 */
export async function readFirstCutoverCloudRecovery(input, overrides = {}) {
  if (input?.name === 'holaday-vnc' && (!input.headedRecovery || !input.sources))
    throw new Error('CUTOVER_CLOUD_VNC_NATIVE_SOURCE_UNPROVEN');
  const io = {
    ...fs,
    platform: process.platform,
    uid: process.getuid?.(),
    now: Date.now,
    ...overrides,
  };
  const reject = () => {
    throw new Error('CUTOVER_CLOUD_RECOVERY_UNPROVEN');
  };
  try {
    const copy = structuredClone(input);
    const { attempt, name, pmId, beforeCensus, restoreStartedAtMs } = copy;
    if (
      !isDeepStrictEqual(copy, JSON.parse(JSON.stringify(copy))) ||
      Object.keys(copy).sort().join(',') !==
        (name === 'holaday-vnc'
          ? 'attempt,beforeCensus,headedRecovery,name,pmId,restoreStartedAtMs,sources'
          : 'attempt,beforeCensus,name,pmId,restoreStartedAtMs') ||
      !['holaday-chromium-headed', 'holaday-vnc'].includes(name) ||
      io.platform !== 'linux' ||
      io.uid !== 0 ||
      !Number.isSafeInteger(pmId) ||
      pmId < 0 ||
      !Number.isSafeInteger(restoreStartedAtMs) ||
      restoreStartedAtMs < 0
    )
      reject();
    const launch = firstCutoverCloudBrowserRecoveryLaunch({ attempt });
    const sha = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
    const keys = (value, expected) =>
      value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      Object.keys(value).sort().join(',') === expected;
    const census = (value) => {
      if (
        !keys(value, 'bootId,hostname,observedAtMs,processes') ||
        !/^[a-zA-Z0-9.-]{1,128}$/.test(value.hostname) ||
        !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value.bootId) ||
        !Number.isSafeInteger(value.observedAtMs) ||
        value.observedAtMs < 0 ||
        !Array.isArray(value.processes) ||
        !value.processes.length ||
        value.processes.length > 16384
      )
        reject();
      let previous = 0;
      for (const p of value.processes) {
        if (
          !keys(
            p,
            'argvDigest,capabilities,cgroup,cwd,exe,mountNamespace,noNewPrivs,pid,ppid,start,state,uids',
          ) ||
          !Number.isSafeInteger(p.pid) ||
          p.pid <= previous ||
          !Number.isSafeInteger(p.ppid) ||
          p.ppid < 0 ||
          p.ppid === p.pid ||
          !/^\d+$/.test(p.start) ||
          !hash(p.argvDigest) ||
          !Array.isArray(p.uids) ||
          p.uids.length !== 4 ||
          p.uids.some((uid) => !Number.isSafeInteger(uid) || uid < 0) ||
          ![p.cwd, p.exe].every(
            (path) => typeof path === 'string' && path.startsWith('/') && path.length <= 4096,
          ) ||
          typeof p.cgroup !== 'string' ||
          !p.cgroup ||
          p.cgroup.length > 262144 ||
          !/^mnt:\[\d+\]$/.test(p.mountNamespace) ||
          !['live', 'stopped'].includes(p.state) ||
          ![0, 1].includes(p.noNewPrivs) ||
          !keys(p.capabilities, 'CapAmb,CapBnd,CapEff,CapInh,CapPrm') ||
          Object.values(p.capabilities).some(
            (cap) => typeof cap !== 'string' || !/^[0-9a-f]{1,16}$/.test(cap),
          )
        )
          reject();
        previous = p.pid;
      }
    };
    census(beforeCensus);
    const began = io.now();
    if (
      !Number.isSafeInteger(began) ||
      beforeCensus.observedAtMs > restoreStartedAtMs ||
      restoreStartedAtMs > began ||
      began - beforeCensus.observedAtMs > 60000
    )
      reject();
    const readCensus = io.readCensus ?? (() => readFirstCutoverCloudRecoveryCensus(io));
    const current = structuredClone(await readCensus());
    census(current);
    if (name === 'holaday-vnc')
      return await readCloudVncRecovery(copy, io, {
        reject,
        census,
        sha,
        keys,
        began,
        current,
        readCensus,
      });
    const runtime = await readFirstCutoverCloudBrowserRecovery({ attempt, pmId }, io);
    const displays = current.processes.filter(
      (p) => p.exe === '/usr/bin/Xvfb' && p.mountNamespace === runtime.mountNamespace,
    );
    if (displays.length !== 1) reject();
    const display = displays[0];
    if (
      display.ppid !== runtime.pid ||
      display.argvDigest !==
        sha(
          `${['/usr/bin/Xvfb', ':98', '-screen', '0', '1280x800x24', '-nolisten', 'tcp'].join('\0')}\0`,
        )
    )
      reject();
    const displayIdentity = {
      pid: display.pid,
      start: display.start,
      mountNamespace: display.mountNamespace,
    };
    const readDisplay =
      io.readDisplayListeners ??
      ((identity) => readFirstCutoverCloudDisplayListeners(identity, io));
    const listeners = structuredClone(await readDisplay(displayIdentity));
    if (
      !Array.isArray(listeners) ||
      listeners.length !== 2 ||
      listeners.some(
        (row, i) =>
          !keys(row, 'inode,path') ||
          row.path !== ['/tmp/.X11-unix/X98', '@/tmp/.X11-unix/X98'][i] ||
          !/^[1-9][0-9]{0,19}$/.test(row.inode),
      ) ||
      listeners[0].inode === listeners[1].inode
    )
      reject();
    const after = structuredClone(await readCensus());
    census(after);
    const repeated = await readFirstCutoverCloudBrowserRecovery({ attempt, pmId }, io);
    if (!isDeepStrictEqual(listeners, await readDisplay(displayIdentity))) reject();
    const stable = ({ observedAtMs: _time, ...value }) => value;
    const now = io.now();
    if (
      !Number.isSafeInteger(now) ||
      now < began ||
      now - beforeCensus.observedAtMs > 60000 ||
      current.observedAtMs < restoreStartedAtMs ||
      current.observedAtMs > runtime.observedAtMs ||
      after.observedAtMs < runtime.observedAtMs ||
      after.observedAtMs > repeated.observedAtMs ||
      repeated.observedAtMs > now ||
      !isDeepStrictEqual(stable(current), stable(after)) ||
      !isDeepStrictEqual(stable(runtime), stable(repeated)) ||
      current.bootId !== beforeCensus.bootId ||
      runtime.bootId !== current.bootId ||
      current.hostname !== beforeCensus.hostname
    )
      reject();
    const root = current.processes.find((p) => p.pid === runtime.pid);
    if (
      !root ||
      root.start !== runtime.start ||
      root.ppid !== runtime.ppid ||
      root.mountNamespace !== runtime.mountNamespace ||
      root.exe !== '/opt/brave.com/brave/brave' ||
      root.argvDigest !==
        sha(
          `${launch.args.slice(launch.args.indexOf('/opt/brave.com/brave/brave')).join('\0')}\0`,
        ) ||
      !beforeCensus.processes.some((p) => p.pid === root.ppid) ||
      beforeCensus.processes.some((p) => p.mountNamespace === root.mountNamespace)
    )
      reject();
    const ids = new Set([root.pid]);
    for (let pass = 0; pass < current.processes.length; pass++) {
      let changed = false;
      for (const p of current.processes) {
        if ((ids.has(p.ppid) || p.mountNamespace === root.mountNamespace) && !ids.has(p.pid)) {
          ids.add(p.pid);
          changed = true;
        }
      }
      if (!changed) break;
    }
    const processes = current.processes.filter((p) => ids.has(p.pid));
    for (const p of processes) {
      if (
        beforeCensus.processes.some((old) => old.pid === p.pid) ||
        p.mountNamespace !== root.mountNamespace ||
        p.cgroup !== root.cgroup ||
        ![
          '/opt/brave.com/brave/brave',
          '/opt/brave.com/brave/chrome_crashpad_handler',
          '/usr/bin/Xvfb',
        ].includes(p.exe) ||
        !isDeepStrictEqual(p.uids, [0, 0, 0, 0]) ||
        p.state !== 'live' ||
        p.noNewPrivs !== 1 ||
        Object.values(p.capabilities).some((cap) => !/^0+$/.test(cap)) ||
        (p.pid !== root.pid && p.ppid !== 1 && !ids.has(p.ppid))
      )
        reject();
    }
    if (
      !isDeepStrictEqual(
        current.processes.filter((p) => !ids.has(p.pid)),
        beforeCensus.processes,
      )
    )
      reject();
    return {
      purpose: 'cloud-recovery-native-observation',
      name,
      pmId,
      hostname: current.hostname,
      bootId: runtime.bootId,
      pid: runtime.pid,
      start: runtime.start,
      ppid: runtime.ppid,
      configDigest: runtime.configDigest,
      restartCount: runtime.restartCount,
      launchDigest: runtime.launchDigest,
      observedAtMs: now,
      beforeCensusDigest: sha(beforeCensus),
      censusDigest: sha(after),
      processes,
      display: { pid: display.pid, start: display.start, listeners },
      policyDigest: runtime.policyDigest,
      mountNamespace: runtime.mountNamespace,
    };
  } catch {
    reject();
  }
}

/** Read-only VNC facts. Sources and the retained headed observation are
 * remeasured here; neither their shape nor this result authorizes a restart. */
async function readCloudVncRecovery(copy, io, context) {
  const { reject, census, sha, keys, began, current, readCensus } = context;
  const {
    attempt,
    name,
    pmId,
    beforeCensus,
    restoreStartedAtMs,
    headedRecovery: headed,
    sources,
  } = copy;
  const stable = ({ observedAtMs: _time, ...value }) => value;
  let highWater = began;
  const started = performance.now();
  const clock = () => {
    const now = io.now();
    if (
      !Number.isSafeInteger(now) ||
      now < highWater ||
      now - beforeCensus.observedAtMs > 60000 ||
      performance.now() - started > 60000
    )
      reject();
    highWater = now;
    return now;
  };
  const fresh = (time) => {
    if (!Number.isSafeInteger(time) || time < 0 || time > clock() || highWater - time > 60000)
      reject();
  };
  if (
    !keys(
      headed,
      'beforeCensusDigest,bootId,censusDigest,configDigest,display,hostname,launchDigest,mountNamespace,name,observedAtMs,pid,pmId,policyDigest,ppid,processes,purpose,restartCount,start',
    ) ||
    headed.purpose !== 'cloud-recovery-native-observation' ||
    headed.name !== 'holaday-chromium-headed' ||
    headed.pmId === pmId ||
    headed.observedAtMs > beforeCensus.observedAtMs ||
    !hash(headed.beforeCensusDigest) ||
    !hash(headed.censusDigest)
  )
    reject();
  fresh(headed.observedAtMs);
  const scope = [
    { name, pmId },
    { name: headed.name, pmId: headed.pmId },
  ];
  validateFirstCutoverCloudSources(sources, { scope, observed: true });
  fresh(sources.observedAtMs);
  if (
    current.hostname !== beforeCensus.hostname ||
    current.bootId !== beforeCensus.bootId ||
    headed.hostname !== current.hostname ||
    headed.bootId !== current.bootId ||
    sources.hostname !== current.hostname ||
    sources.bootId !== current.bootId ||
    current.observedAtMs < restoreStartedAtMs
  )
    reject();
  fresh(current.observedAtMs);
  census({
    hostname: current.hostname,
    bootId: current.bootId,
    observedAtMs: headed.observedAtMs,
    processes: headed.processes,
  });
  const byPid = new Map(current.processes.map((p) => [p.pid, p]));
  const headedIds = new Set(headed.processes.map((p) => p.pid));
  if (
    !headedIds.has(headed.pid) ||
    !headedIds.has(headed.display?.pid) ||
    !isDeepStrictEqual(
      current.processes.filter((p) => headedIds.has(p.pid)),
      headed.processes,
    ) ||
    !isDeepStrictEqual(
      beforeCensus.processes.filter((p) => headedIds.has(p.pid)),
      headed.processes,
    )
  )
    reject();
  for (const p of headed.processes) {
    if (
      p.mountNamespace !== headed.mountNamespace ||
      p.state !== 'live' ||
      p.noNewPrivs !== 1 ||
      !isDeepStrictEqual(p.uids, [0, 0, 0, 0]) ||
      Object.values(p.capabilities).some((v) => !/^0+$/.test(v)) ||
      ![
        '/opt/brave.com/brave/brave',
        '/opt/brave.com/brave/chrome_crashpad_handler',
        '/usr/bin/Xvfb',
      ].includes(p.exe) ||
      p.cgroup !== byPid.get(headed.pid).cgroup ||
      (p.pid !== headed.pid && p.ppid !== 1 && !headedIds.has(p.ppid))
    )
      reject();
  }
  if (
    current.processes.some(
      (p) => p.mountNamespace === headed.mountNamespace && !headedIds.has(p.pid),
    )
  )
    reject();
  const material = firstCutoverCloudVncRecoveryMaterial({ attempt });
  const launch = firstCutoverCloudBrowserRecoveryLaunch({ attempt });
  const readManagers = io.readManagers ?? (() => readFirstCutoverCloudManagers(io));
  const managerSample = async () => {
    clock();
    const rows = await readManagers();
    if (!Array.isArray(rows) || rows.length > 16384) reject();
    return scope.map((role) => {
      const matches = rows.filter((r) => r.name === role.name || r.pm_id === role.pmId);
      const r = matches[0];
      if (
        matches.length !== 1 ||
        r.name !== role.name ||
        r.pm_id !== role.pmId ||
        !Number.isSafeInteger(r.pid) ||
        r.pid <= 1 ||
        r.pm2_env?.pm_id !== role.pmId ||
        r.pm2_env.name !== role.name ||
        r.pm2_env.status !== 'online' ||
        r.pm2_env.exec_mode !== 'fork_mode' ||
        r.pm2_env.autorestart !== false ||
        r.pm2_env.watch !== false ||
        r.pm2_env.cron_restart !== '' ||
        Object.hasOwn(r.pm2_env, 'max_memory_restart') ||
        Object.hasOwn(r.pm2_env.env ?? {}, 'max_memory_restart') ||
        !Number.isSafeInteger(r.pm2_env.restart_time) ||
        r.pm2_env.restart_time < 0
      )
        reject();
      return structuredClone({ name: r.name, pm_id: r.pm_id, pid: r.pid, pm2_env: r.pm2_env });
    });
  };
  const managers = await managerSample();
  const vnc = managers[0];
  if (
    vnc.pm2_env.pm_exec_path !== material.command ||
    vnc.pm2_env.exec_interpreter !== 'bash' ||
    (vnc.pm2_env.args != null && !isDeepStrictEqual(vnc.pm2_env.args, [])) ||
    managers[1].pid !== headed.pid
  )
    reject();
  const configs = managers.map((r) => ({ name: r.name, pmId: r.pm_id, config: r.pm2_env }));
  const sourceSample = async () => {
    clock();
    const measured = await readFirstCutoverCloudRecoverySources({ attempt, configs }, io);
    fresh(measured.observedAtMs);
    if (!isDeepStrictEqual(stable(measured), stable(sources))) reject();
    return measured;
  };
  await sourceSample();
  const readHeaded = async () => {
    clock();
    const measured = await readFirstCutoverCloudBrowserRecovery({ attempt, pmId: headed.pmId }, io);
    fresh(measured.observedAtMs);
    for (const k of [
      'name',
      'pmId',
      'pid',
      'start',
      'ppid',
      'bootId',
      'configDigest',
      'restartCount',
      'launchDigest',
      'mountNamespace',
      'policyDigest',
    ])
      if (measured[k] !== headed[k]) reject();
    const root = byPid.get(headed.pid);
    if (
      root.exe !== '/opt/brave.com/brave/brave' ||
      root.start !== measured.start ||
      root.ppid !== measured.ppid ||
      root.argvDigest !==
        sha(`${launch.args.slice(launch.args.indexOf('/opt/brave.com/brave/brave')).join('\0')}\0`)
    )
      reject();
  };
  await readHeaded();
  const display = byPid.get(headed.display.pid);
  if (
    !keys(headed.display, 'listeners,pid,start') ||
    display.exe !== '/usr/bin/Xvfb' ||
    display.start !== headed.display.start ||
    display.ppid !== headed.pid ||
    headed.processes.filter((p) => p.exe === '/usr/bin/Xvfb').length !== 1 ||
    display.argvDigest !==
      sha(
        `${['/usr/bin/Xvfb', ':98', '-screen', '0', '1280x800x24', '-nolisten', 'tcp'].join('\0')}\0`,
      )
  )
    reject();
  const readDisplay =
    io.readDisplayListeners ?? ((identity) => readFirstCutoverCloudDisplayListeners(identity, io));
  const displaySample = async () => {
    const listeners = await readDisplay({
      pid: display.pid,
      start: display.start,
      mountNamespace: display.mountNamespace,
    });
    if (
      !Array.isArray(listeners) ||
      listeners.length !== 2 ||
      listeners.some(
        (r, i) =>
          !keys(r, 'inode,path') ||
          r.path !== ['/tmp/.X11-unix/X98', '@/tmp/.X11-unix/X98'][i] ||
          !/^[1-9]\d{0,19}$/.test(r.inode),
      ) ||
      listeners[0].inode === listeners[1].inode ||
      !isDeepStrictEqual(listeners, headed.display.listeners)
    )
      reject();
  };
  await displaySample();
  const root = byPid.get(vnc.pid);
  const ids = new Set([vnc.pid]);
  for (let pass = 0; pass < current.processes.length; pass++) {
    let added = false;
    for (const p of current.processes)
      if (ids.has(p.ppid) && !ids.has(p.pid)) {
        ids.add(p.pid);
        added = true;
      }
    if (!added) break;
  }
  const processes = current.processes.filter((p) => ids.has(p.pid));
  if (
    !root ||
    processes.length < 4 ||
    processes.length > 512 ||
    !isDeepStrictEqual(
      current.processes.filter((p) => !ids.has(p.pid)),
      beforeCensus.processes,
    )
  )
    reject();
  const daemonPidText = (await io.readFile('/root/.pm2/pm2.pid', 'utf8')).trim();
  const daemon = byPid.get(Number(daemonPidText));
  const daemonStat = await io.readFile(`/proc/${Number(daemonPidText)}/stat`, 'utf8');
  const daemonParts = daemonStat
    .slice(daemonStat.lastIndexOf(')') + 2)
    .trim()
    .split(/\s+/);
  if (
    !/^[1-9]\d*$/.test(daemonPidText) ||
    !daemon ||
    daemon.start !== daemonParts[19] ||
    root.ppid !== daemon.pid ||
    headed.ppid !== daemon.pid ||
    root.mountNamespace === headed.mountNamespace
  )
    reject();
  for (const p of processes)
    if (
      beforeCensus.processes.some((old) => old.pid === p.pid) ||
      p.state !== 'live' ||
      !isDeepStrictEqual(p.uids, [0, 0, 0, 0]) ||
      p.cgroup !== root.cgroup ||
      p.mountNamespace !== root.mountNamespace
    )
      reject();
  const python = sources.files.find((f) => f.path === '/usr/bin/python3')?.resolvedPath;
  const one = (predicate) => {
    const rows = processes.filter(predicate);
    if (rows.length !== 1) reject();
    return rows[0];
  };
  if (root.exe !== '/usr/bin/bash') reject();
  const supervisor = one((p) => p.ppid === root.pid && p.exe === '/usr/bin/bash');
  const x11 = one((p) => p.ppid === supervisor.pid && p.exe === '/usr/bin/x11vnc');
  const web = one((p) => p.ppid === root.pid && p.exe === python);
  const handlers = processes.filter((p) => p.ppid === web.pid && p.exe === python);
  if (processes.length !== 4 + handlers.length) reject();
  // websockify 0.10.0 chdirs to its fixed --web root before serving;
  // forked handlers inherit it. Shell/x11vnc retain the registration cwd.
  for (const p of processes)
    if (p.cwd !== (p === web || handlers.includes(p) ? '/usr/share/novnc' : vnc.pm2_env.pm_cwd))
      reject();
  const args = new Map([
    [root.pid, ['bash', material.command]],
    [supervisor.pid, ['bash', material.command]],
    [
      x11.pid,
      [
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
    ],
    ...[web, ...handlers].map((p) => [
      p.pid,
      [
        '/usr/bin/python3',
        '/usr/bin/websockify',
        '--heartbeat',
        '30',
        '--web',
        '/usr/share/novnc',
        '127.0.0.1:6080',
        '127.0.0.1:5901',
      ],
    ]),
  ]);
  const processSample = async () => {
    for (const p of processes) {
      clock();
      const cmd = await io.readFile(`/proc/${p.pid}/cmdline`, 'utf8');
      if (
        cmd !== `${args.get(p.pid).join('\0')}\0` ||
        sha(cmd) !== p.argvDigest ||
        (await io.readlink(`/proc/${p.pid}/exe`)) !== p.exe
      )
        reject();
      const loaded = await io.stat(`/proc/${p.pid}/exe`);
      const disk = await io.stat(p.exe);
      if (
        !sources.files.some((f) => f.resolvedPath === p.exe) ||
        ['dev', 'ino', 'mode', 'uid', 'gid', 'size', 'mtimeMs', 'ctimeMs'].some(
          (k) => loaded[k] !== disk[k],
        ) ||
        !disk.isFile()
      )
        reject();
    }
  };
  await processSample();
  const socketSample = async () => {
    const exec = io.exec ?? execFixed;
    const read = async (argv) => {
      clock();
      const out = await exec('/usr/bin/ss', argv, {
        env: fixedEnv,
        timeout: 5000,
        maxBuffer: 1024 * 1024,
      });
      if (typeof out !== 'string' || Buffer.byteLength(out) > 1024 * 1024) reject();
      const rows = out.trim() ? out.trim().split('\n') : [];
      if (rows.length > 16384) reject();
      return rows;
    };
    const fds = new Map();
    const fdSet = async (pid) => {
      if (!fds.has(pid)) {
        const names = await io.readdir(`/proc/${pid}/fd`);
        if (names.length > 4096 || names.some((n) => !/^\d+$/.test(n))) reject();
        const map = new Map();
        for (const fd of names) {
          clock();
          const link = await io.readlink(`/proc/${pid}/fd/${fd}`);
          const m = /^socket:\[(\d+)\]$/.exec(link);
          if (m) map.set(Number(fd), m[1]);
        }
        fds.set(pid, map);
      }
      return fds.get(pid);
    };
    const owners = async (line, inode) => {
      const tuples = [...line.matchAll(/\("[^"\n]*",pid=(\d+),fd=(\d+)\)/g)];
      if (
        !tuples.length ||
        tuples.length > 512 ||
        tuples.length !== [...line.matchAll(/\bpid=/g)].length
      )
        reject();
      const result = [];
      for (const m of tuples) {
        const pid = Number(m[1]);
        const fd = Number(m[2]);
        const p = byPid.get(pid);
        if (
          !p ||
          !Number.isSafeInteger(fd) ||
          (await fdSet(pid)).get(fd) !== inode ||
          result.some((r) => r.pid === pid && r.fd === fd)
        )
          reject();
        result.push({ pid, start: p.start, fd });
      }
      return result.sort((a, b) => a.pid - b.pid || a.fd - b.fd);
    };
    const unix = (await read(['-H', '-xapn'])).map((line) => {
      const c = line.trim().split(/\s+/);
      if (c.length < 8) reject();
      return { line, kind: c[0], state: c[1], path: c[4], inode: c[5], peer: c[7] };
    });
    const addresses = ['/tmp/.X11-unix/X98', '@/tmp/.X11-unix/X98'];
    const relevant = unix.filter((r) => addresses.includes(r.path));
    const listeners = relevant.filter((r) => r.state === 'LISTEN');
    if (
      listeners.length !== 2 ||
      relevant.some((r) => r.kind !== 'u_str' || !['LISTEN', 'ESTAB'].includes(r.state))
    )
      reject();
    const peers = [];
    const allPeers = [];
    for (const r of relevant) {
      if (!/^[1-9]\d{0,19}$/.test(r.inode) || unix.filter((q) => q.inode === r.inode).length !== 1)
        reject();
      const serverOwners = await owners(r.line, r.inode);
      if (serverOwners.length !== 1 || serverOwners[0].pid !== display.pid) reject();
      if (r.state === 'LISTEN') {
        if (
          !headed.display.listeners.some((q) => q.path === r.path && q.inode === r.inode) ||
          listeners.filter((q) => q.path === r.path).length !== 1
        )
          reject();
        continue;
      }
      const matches = unix.filter((q) => q.inode === r.peer);
      const peer = matches[0];
      if (
        matches.length !== 1 ||
        peer.state !== 'ESTAB' ||
        peer.kind !== 'u_str' ||
        peer.peer !== r.inode
      )
        reject();
      const clientOwners = await owners(peer.line, peer.inode);
      if (clientOwners.some((p) => !headedIds.has(p.pid) && !ids.has(p.pid))) reject();
      const edge = {
        server: { ...serverOwners[0], inode: r.inode },
        clients: clientOwners.map((p) => ({ ...p, inode: peer.inode })),
      };
      allPeers.push(edge);
      for (const p of clientOwners)
        if (p.pid === x11.pid)
          peers.push({
            client: { ...p, inode: peer.inode },
            server: { ...serverOwners[0], inode: r.inode },
          });
    }
    if (!peers.length) reject();
    const tcp = [];
    for (const family of ['ipv4', 'ipv6'])
      for (const line of await read(['-H', family === 'ipv4' ? '-4' : '-6', '-ltnpe'])) {
        const c = line.trim().split(/\s+/);
        const endpoint = /^(?:\[([^\]]+)\]|(.+)):(\d+)$/.exec(c[3] ?? '');
        if (c[0] !== 'LISTEN' || !endpoint) reject();
        const port = Number(endpoint[3]);
        const ownerIds = [...line.matchAll(/\bpid=(\d+)/g)].map((m) => Number(m[1]));
        if (![5900, 5901, 6080].includes(port) && !ownerIds.some((pid) => ids.has(pid))) continue;
        const inode = /\bino:([1-9]\d{0,19})(?:\s|$)/.exec(line)?.[1];
        if (!inode || port > 65535 || tcp.some((r) => r.inode === inode)) reject();
        tcp.push({
          family,
          address: endpoint[1] ?? endpoint[2],
          port,
          inode,
          owners: await owners(line, inode),
        });
      }
    for (const [port, owner] of [
      [5901, x11],
      [6080, web],
    ]) {
      const rows = tcp.filter(
        (r) => r.family === 'ipv4' && r.address === '127.0.0.1' && r.port === port,
      );
      const allowed = port === 5901 ? [x11.pid] : [web.pid, ...handlers.map((p) => p.pid)];
      if (
        rows.length !== 1 ||
        !rows[0].owners.some((p) => p.pid === owner.pid) ||
        rows[0].owners.some((p) => !allowed.includes(p.pid))
      )
        reject();
    }
    const sort = (a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b));
    return {
      listeners: tcp.sort(sort),
      displayPeers: peers.sort(sort),
      allPeers: allPeers.sort(sort),
    };
  };
  const sockets = await socketSample();
  await sourceSample();
  await processSample();
  await readHeaded();
  await displaySample();
  if (
    !isDeepStrictEqual(managers, await managerSample()) ||
    !isDeepStrictEqual(sockets, await socketSample())
  )
    reject();
  const after = structuredClone(await readCensus());
  census(after);
  fresh(after.observedAtMs);
  if (
    after.observedAtMs < current.observedAtMs ||
    !isDeepStrictEqual(stable(current), stable(after))
  )
    reject();
  const identity = (p) => ({ pid: p.pid, start: p.start });
  return {
    purpose: 'cloud-recovery-native-observation',
    name,
    pmId,
    hostname: current.hostname,
    bootId: current.bootId,
    ...identity(root),
    ppid: root.ppid,
    configDigest: cutoverRegistrationConfigDigest(vnc.pm2_env),
    restartCount: vnc.pm2_env.restart_time,
    launchDigest: sha(material),
    observedAtMs: clock(),
    beforeCensusDigest: sha(beforeCensus),
    censusDigest: sha(after),
    processes,
    mountNamespace: root.mountNamespace,
    display: structuredClone(headed.display),
    vnc: {
      supervisor: identity(supervisor),
      x11vnc: identity(x11),
      websockify: identity(web),
      handlers: handlers.map(identity),
      listeners: sockets.listeners,
      displayPeers: sockets.displayPeers,
    },
  };
}

export function validateLegacyWorkBoundary(input) {
  try {
    return validateWork(input);
  } catch {
    fail();
  }
}
const producerReceipts = new WeakMap();
/** A tagged observation is usable for stopping only under the live owned first
 * journal's durable receipt. Never normalize unknown requests into zero. */
export async function validateOwnedLegacyFence(fence, io) {
  const binding = await io.assertJournalOwnership();
  const record = await io.readFirstCutoverEffects?.();
  if (record?.schemaVersion !== 2) {
    if (
      fence?.riskDigest !== undefined ||
      fence?.legacyWork !== undefined ||
      record?.riskDigest !== undefined ||
      record?.legacyInterruption !== undefined
    )
      fail();
    return false;
  }
  const riskDigest = cutoverLegacyInterruptionRisk(record);
  const receipt = record.interruptionObservation;
  const orders = fence?.stage === 'orders';
  if (
    !binding ||
    Object.keys(binding).some((key) => record[key] !== binding[key]) ||
    binding.inventoryDigest !== record.inventoryDigest ||
    fence?.inventoryDigest !== record.inventoryDigest ||
    record.riskDigest !== riskDigest ||
    fence.riskDigest !== riskDigest ||
    !hash(record.recordDigest) ||
    record.failureObservation !== undefined ||
    !(
      orders
        ? ['producers_stopped']
        : [
            'all_fenced',
            'stopped',
            'backup_verified',
            'migration_started',
            'candidate_started',
            'verified',
          ]
    ).includes(record.phase) ||
    (!orders && fence.stage !== 'all-writers') ||
    !receipt ||
    Object.keys(receipt).length !== 4 ||
    receipt.riskDigest !== riskDigest ||
    !hash(receipt.sourceDigest) ||
    !hash(receipt.fenceDigest) ||
    !Number.isSafeInteger(receipt.observedAtMs) ||
    receipt.observedAtMs < 0 ||
    receipt.observedAtMs > record.legacyInterruption.observeUntilMs ||
    receipt.observedAtMs > io.now() ||
    !fence.legacyWork ||
    Object.keys(fence.legacyWork).length !== 2 ||
    !Number.isSafeInteger(fence.observedAtMs) ||
    fence.observedAtMs < 0 ||
    fence.observedAtMs > io.now() ||
    io.now() - fence.observedAtMs > 60000
  )
    fail();
  for (const observation of [fence.legacyWork.before, fence.legacyWork.after]) {
    validateLegacyWorkBoundary({
      observation,
      approval: record,
      phase: orders ? 'before-stop' : 'after-stop',
      nowMs: io.now(),
    });
  }
  if (
    !['unsettledWork', 'unknownWriters', 'activeRequests', 'externalWork'].every((key) =>
      isDeepStrictEqual(fence[key], fence.legacyWork.before[key]),
    ) ||
    !isDeepStrictEqual(record, await io.readFirstCutoverEffects()) ||
    !isDeepStrictEqual(binding, await io.assertJournalOwnership())
  )
    fail();
  return true;
}
function producerScope(captured) {
  if (
    !captured?.targets?.length ||
    captured.targets.some((p) => !['main', 'worker'].includes(p.role))
  )
    fail();
  for (const target of captured.targets) checkTarget(target);
}
function verifyProducerFence(fence, snapshot, captured, now, interrupted = false) {
  producerScope(captured);
  checkSnapshot(snapshot, captured, now);
  if (
    fence?.inventoryDigest !== captured.inventoryDigest ||
    fence.stage !== 'orders' ||
    !Number.isSafeInteger(fence.observedAtMs) ||
    fence.observedAtMs > now ||
    now - fence.observedAtMs > 60000 ||
    fence.unsettledWork !== 0 ||
    (!interrupted && fence.externalWork !== 0) ||
    (!interrupted && fence.activeRequests !== 0) ||
    fence.unknownWriters !== 0 ||
    !Array.isArray(fence.runningProducers) ||
    fence.producersRunning !== fence.runningProducers.length ||
    fence.runningProducers.length !== snapshot.processes.length ||
    new Set(fence.runningProducers.map((p) => p.pid)).size !== fence.runningProducers.length ||
    snapshot.processes.some((p) => !captured.targets.some((t) => sameProcess(p, t))) ||
    snapshot.processes.some((p) => !fence.runningProducers.some((t) => sameProcess(p, t)))
  )
    fail();
}
export async function retireLegacyProducers(input, io) {
  producerScope(input?.captured);
  if (input.producerReceipt !== undefined) fail();
  const receipt = await retireCapturedRuntime(input, io, true);
  producerReceipts.set(receipt, {
    receipt: structuredClone(receipt),
    captured: structuredClone(input.captured),
  });
  return receipt;
}
export function createLegacyProducerEffects(observation, captured, system = {}) {
  producerScope(captured);
  return runtimeEffects(observation, system, structuredClone(captured));
}
const fail = () => {
  throw new Error('CUTOVER_RUNTIME_UNPROVEN');
};
const processKeys = [
  'host',
  'bootId',
  'pid',
  'ppid',
  'start',
  'uids',
  'exe',
  'cwd',
  'argvDigest',
  'role',
  'managerIdentity',
];
const sameProcess = (a, b) => processKeys.every((k) => isDeepStrictEqual(a?.[k], b?.[k]));
const managerKeys = [
  'kind',
  'pid',
  'start',
  'exe',
  'argvDigest',
  'pm2Home',
  'version',
  'pmId',
  'name',
  'configDigest',
  'killTimeoutMs',
  'killSignal',
  'watch',
  'cron',
  'memoryRestart',
];
const sameManager = (a, b) => managerKeys.every((k) => isDeepStrictEqual(a?.[k], b?.[k]));
function isRootGateway(p) {
  if (p.role !== 'gateway' || !isDeepStrictEqual(p.uids, [0, 0, 0, 0])) return false;
  const release =
    /^(\/opt\/holaday-cn-payment\/releases\/[a-f0-9]{12}-[0-9]{14})\/apps\/cn-payment$/.exec(
      p.cwd ?? '',
    );
  if (!release) return false;
  if (p.exe === '/usr/bin/node') return true;
  // Only the audited managed gateway wrappers, never arbitrary root executables.
  return (
    p.managerIdentity?.kind === 'pm2' &&
    (p.exe === '/usr/bin/dash' ||
      p.exe ===
        `${release[1]}/node_modules/.pnpm/@esbuild+linux-x64@0.27.7/node_modules/@esbuild/linux-x64/bin/esbuild`)
  );
}
function checkTarget(p, registration = false) {
  if (
    !p ||
    !/^[a-zA-Z0-9.-]{1,128}$/.test(p.host ?? '') ||
    !/^[a-f0-9]{32}$/.test(p.bootId ?? '') ||
    !Number.isSafeInteger(p.pid) ||
    p.pid <= 1 ||
    !Number.isSafeInteger(p.ppid) ||
    p.ppid < 1 ||
    !/^[0-9]+$/.test(p.start ?? '') ||
    !hash(p.argvDigest)
  )
    fail();
  if (
    !(isDeepStrictEqual(p.uids, [998, 998, 998, 998]) && p.exe === '/opt/node22/bin/node') &&
    !isRootGateway(p)
  )
    fail();
  if (['main', 'worker'].includes(p.role)) {
    if (p.cwd !== '/opt/holaday-monorepo/apps/orchestrator') fail();
  } else if (p.role === 'gateway') {
    if (
      !/^\/opt\/holaday-cn-payment\/releases\/[a-f0-9]{12}-[0-9]{14}(?:\/apps\/cn-payment)?$/.test(
        p.cwd ?? '',
      )
    )
      fail();
  } else fail();
  const m = p.managerIdentity;
  if (m?.kind === 'unmanaged') {
    if (Object.keys(m).length !== 1) fail();
  } else if (m?.kind === 'pm2') {
    checkManager(m, registration);
    if (
      (isRootGateway(p) && m.name !== 'holaday-cn-payment') ||
      (registration &&
        m.name !==
          {
            main: 'holaday-orchestrator',
            worker: 'holaday-account-closure-worker',
            gateway: 'holaday-cn-payment',
          }[p.role])
    )
      fail();
  } else fail();
}
function checkManager(m, registration = false) {
  if (
    m?.kind !== 'pm2' ||
    !Number.isSafeInteger(m.pid) ||
    m.pid <= 1 ||
    !/^[0-9]+$/.test(m.start ?? '') ||
    !['/opt/node22/bin/node', '/usr/bin/node'].includes(m.exe) ||
    !hash(m.argvDigest) ||
    m.pm2Home !== '/root/.pm2' ||
    !/^\d+\.\d+\.\d+$/.test(m.version ?? '') ||
    !Number.isSafeInteger(m.pmId) ||
    m.pmId < 0 ||
    !/^[a-zA-Z0-9_-]{1,80}$/.test(m.name ?? '') ||
    !hash(m.configDigest) ||
    !Number.isSafeInteger(m.killTimeoutMs) ||
    m.killTimeoutMs < 1 ||
    m.killTimeoutMs > 660000 ||
    !['SIGINT', 'SIGTERM'].includes(m.killSignal) ||
    m.watch !== false ||
    (!registration && (m.cron !== false || m.memoryRestart !== 0)) ||
    (registration &&
      (m.version !== '6.0.14' ||
        ![
          'holaday-orchestrator',
          'holaday-account-closure-worker',
          'holaday-files-cron',
          'holaday-cn-payment',
        ].includes(m.name) ||
        !Number.isSafeInteger(m.memoryRestart) ||
        m.memoryRestart < 0 ||
        m.memoryRestart > 1024 ** 4 ||
        (m.cron !== false && !(m.name === 'holaday-files-cron' && m.cron === '0 * * * *'))))
  )
    fail();
}
function checkSnapshot(s, base, now) {
  if (
    !s ||
    !hash(s.inventoryDigest) ||
    s.inventoryDigest !== base.inventoryDigest ||
    s.host !== base.host ||
    s.bootId !== base.bootId ||
    !Number.isSafeInteger(s.observedAtMs) ||
    s.observedAtMs > now ||
    now - s.observedAtMs > 60000 ||
    !Array.isArray(s.processes) ||
    !Array.isArray(s.managers) ||
    !Array.isArray(s.listeners) ||
    !Array.isArray(s.unknownLaunchers) ||
    s.unknownLaunchers.length !== 0 ||
    !Array.isArray(s.ports) ||
    !s.ports.length ||
    !s.ports.every((p) => Number.isSafeInteger(p) && p > 0 && p <= 65535) ||
    new Set(s.processes.map((p) => p.pid)).size !== s.processes.length
  )
    fail();
}

/** Inventory is a complete, classified host scope, not just PM2's selected pid.
 * Unknown launcher/process records must be retained by the live observer. */
export async function captureLegacyRuntime({ inventory, approvedTargets }, io) {
  return captureRuntime({ inventory, approvedTargets }, io, false);
}
export async function captureLegacyRegistrations(input, io) {
  return captureRuntime(input, io, true);
}
async function captureRuntime(
  { inventory, approvedTargets, approvedRegistrations },
  io,
  registration,
) {
  checkSnapshot(inventory, inventory, io.now());
  if (
    !Array.isArray(approvedTargets) ||
    (!registration && !approvedTargets.length) ||
    approvedTargets.length !== inventory.processes.length
  )
    fail();
  const targets = structuredClone(approvedTargets);
  for (const p of targets) {
    checkTarget(p, registration);
    if (
      p.host !== inventory.host ||
      p.bootId !== inventory.bootId ||
      inventory.processes.filter((actual) => sameProcess(actual, p)).length !== 1
    )
      fail();
  }
  if (new Set(targets.map((p) => p.pid)).size !== targets.length) fail();
  const groups = targets.filter((p) => p.managerIdentity.kind === 'pm2');
  if (registration) {
    if (
      !Array.isArray(approvedRegistrations) ||
      !approvedRegistrations.length ||
      !isDeepStrictEqual(approvedRegistrations, inventory.managers) ||
      new Set(inventory.managers.map((m) => m.pmId)).size !== inventory.managers.length ||
      new Set(inventory.managers.map((m) => m.name)).size !== inventory.managers.length ||
      targets.some((p) => p.managerIdentity.kind !== 'pm2')
    )
      fail();
    for (const m of inventory.managers) {
      checkManager(m, true);
      if (m.name === 'holaday-files-cron') {
        if (
          m.status !== 'stopped' ||
          m.rootPid !== 0 ||
          groups.some((p) => sameManager(p.managerIdentity, m))
        )
          fail();
      } else if (
        m.status !== 'online' ||
        !groups.some((p) => p.pid === m.rootPid && sameManager(p.managerIdentity, m))
      )
        fail();
    }
  }
  for (const p of groups) {
    const matches = inventory.managers.filter((m) => sameManager(m, p.managerIdentity));
    if (matches.length !== 1 || matches[0].status !== 'online') fail();
    let ancestor = p;
    const seen = new Set();
    while (ancestor.pid !== matches[0].rootPid) {
      if (seen.has(ancestor.pid)) fail();
      seen.add(ancestor.pid);
      ancestor = targets.find((x) => x.pid === ancestor.ppid);
      if (
        !ancestor ||
        !sameManager(ancestor.managerIdentity, p.managerIdentity) ||
        (isRootGateway(p) && (!isRootGateway(ancestor) || ancestor.cwd !== p.cwd))
      )
        fail();
    }
    if (ancestor.ppid !== p.managerIdentity.pid) fail();
    if (isRootGateway(p) !== isRootGateway(ancestor)) fail();
    if (isRootGateway(p) && ancestor.exe !== '/usr/bin/node') fail();
  }
  if (
    inventory.managers.some(
      (m) =>
        !(registration && m.name === 'holaday-files-cron' && m.rootPid === 0) &&
        !groups.some((p) => sameManager(m, p.managerIdentity)),
    )
  )
    fail();
  if (
    inventory.listeners.some(
      (l) => !inventory.ports.includes(l.port) || !targets.some((p) => p.pid === l.pid),
    )
  )
    fail();
  return structuredClone({
    ...(registration ? { retirement: 'delete-registration' } : {}),
    inventoryDigest: inventory.inventoryDigest,
    host: inventory.host,
    bootId: inventory.bootId,
    targets,
    ports: inventory.ports,
    managers: inventory.managers,
  });
}

export async function retireLegacyRuntime(input, io) {
  return retireCapturedRuntime(input, io, false);
}
async function retireCapturedRuntime({ captured, deadlineMs, producerReceipt }, io, producers) {
  if (
    captured?.retirement !== undefined ||
    !captured?.targets?.length ||
    !Number.isSafeInteger(deadlineMs) ||
    deadlineMs < 1 ||
    deadlineMs > 900000
  )
    fail();
  const start = io.now();
  const deadline = start + deadlineMs;
  const c = structuredClone(captured);
  const prior = producerReceipt && producerReceipts.get(producerReceipt);
  if (
    producerReceipt !== undefined &&
    (!prior ||
      !isDeepStrictEqual(prior.receipt, producerReceipt) ||
      !isDeepStrictEqual(prior.captured, c))
  )
    fail();
  async function guard() {
    const now = io.now();
    if (now < start || now >= deadline) throw new Error('CUTOVER_STOP_TIMEOUT');
    if ((await io.assertJournalOwnership()).inventoryDigest !== c.inventoryDigest) fail();
    const fence = await io.verifyFence();
    const interrupted = await validateOwnedLegacyFence(fence, io);
    if (producers) {
      verifyProducerFence(fence, await io.readInventory(), c, io.now(), interrupted);
      return;
    }
    if (
      fence?.inventoryDigest !== c.inventoryDigest ||
      fence.stage !== 'all-writers' ||
      fence.unsettledWork !== 0 ||
      (!interrupted && fence.externalWork !== 0) ||
      fence.producersRunning !== 0
    )
      fail();
  }
  async function read() {
    const s = await io.readInventory();
    checkSnapshot(s, c, io.now());
    if (!isDeepStrictEqual(s.ports, c.ports)) fail();
    for (const p of s.processes) if (!c.targets.some((t) => sameProcess(p, t))) fail();
    if (
      s.managers.length !== c.managers.length ||
      s.managers.some((m) => !c.managers.some((old) => sameManager(m, old)))
    )
      fail();
    return s;
  }
  await guard();
  const before = await read();
  // Revalidate the entire captured tree immediately before the first effect.
  if (prior) {
    if (
      before.processes.length ||
      before.listeners.length ||
      before.managers.some((m) => m.status !== 'stopped' || m.rootPid !== 0)
    )
      fail();
  } else await captureLegacyRuntime({ inventory: before, approvedTargets: c.targets }, io);
  const managedRoots = c.managers.map((m) => c.targets.find((p) => p.pid === m.rootPid));
  const unmanaged = c.targets.filter((p) => p.managerIdentity.kind === 'unmanaged');
  // Reserve every manager's actual stop allowance and the two physical observations
  // before making any stop. A too-short approved window must not cause partial stop.
  if (
    !prior &&
    io.now() + managedRoots.reduce((total, p) => total + p.managerIdentity.killTimeoutMs, 100) >=
      deadline
  )
    fail();
  // Children first for unmanaged trees. Cycles/orphans are rejected by the live inventory classifier.
  const depth = (p) => {
    let n = 0;
    let parent = p;
    const seen = new Set();
    while (unmanaged.some((x) => x.pid === parent.ppid)) {
      if (seen.has(parent.pid)) fail();
      seen.add(parent.pid);
      parent = unmanaged.find((x) => x.pid === parent.ppid);
      n++;
    }
    return n;
  };
  for (const p of prior
    ? []
    : [...managedRoots, ...unmanaged.sort((a, b) => depth(b) - depth(a))]) {
    await guard();
    const s = await read();
    if (!s.processes.some((actual) => sameProcess(actual, p))) fail();
    if (p.managerIdentity.kind === 'pm2') {
      if (
        io.now() + p.managerIdentity.killTimeoutMs >= deadline ||
        !s.managers.some(
          (m) => sameManager(m, p.managerIdentity) && m.status === 'online' && m.rootPid === p.pid,
        )
      )
        fail();
      await io.pm2Stop(
        p,
        c.targets.filter((t) => sameManager(t.managerIdentity, p.managerIdentity)),
      );
    } else await io.signalPinned(p);
  }
  let emptyObservations = 0;
  for (;;) {
    await guard();
    const s = await read();
    if (!s.processes.length) {
      if (s.listeners.length || s.managers.some((m) => m.status !== 'stopped' || m.rootPid !== 0))
        fail();
      if (++emptyObservations === 2)
        return {
          inventoryDigest: c.inventoryDigest,
          host: c.host,
          bootId: c.bootId,
          observedAtMs: io.now(),
          phase: producers ? 'producers-stopped' : 'stopped',
          targets: c.targets,
        };
    } else emptyObservations = 0;
    await io.sleep(100);
  }
}
/** No overwrite or cleanup on failure: a partial directory requires inspection.
 * Callbacks are owned by the host adapter holding the release journal. */
export async function initializeFirstMaintenanceState({ candidate, attempt, stoppedEvidence }, io) {
  const disk = io.fs ?? fs;
  const parent = '/var/lib/holaday';
  const directory = `${parent}/ordinary-maintenance`;
  let parentHandle;
  let directoryHandle;
  let file;
  const sameFile = (a, b) => a.ino === b.ino && a.dev === b.dev;
  try {
    if (
      (io.platform ?? process.platform) !== 'linux' ||
      (io.uid ?? process.getuid()) !== 0 ||
      !/^[a-f0-9]{40}$/.test(candidate ?? '') ||
      !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(
        attempt ?? '',
      ) ||
      !Number.isSafeInteger(io.applicationGid) ||
      io.applicationGid < 1
    )
      fail();
    const now = io.now();
    const scope = stoppedEvidence?.inventoryDigest;
    if (
      !hash(scope) ||
      stoppedEvidence.phase !== 'stopped' ||
      !Number.isSafeInteger(stoppedEvidence.observedAtMs) ||
      stoppedEvidence.observedAtMs > now ||
      now - stoppedEvidence.observedAtMs > 60000
    )
      fail();
    async function guard() {
      const binding = await io.assertJournalOwnership();
      if (
        binding.attempt !== attempt ||
        binding.candidate !== candidate ||
        binding.inventoryDigest !== scope
      )
        fail();
      const stopped = await io.assertStopped(stoppedEvidence);
      if (
        stopped?.inventoryDigest !== scope ||
        stopped.phase !== 'stopped' ||
        !Number.isSafeInteger(stopped.observedAtMs) ||
        stopped.observedAtMs > io.now() ||
        io.now() - stopped.observedAtMs > 60000 ||
        !['survivors', 'listeners', 'unknownLaunchers'].every(
          (k) => Array.isArray(stopped[k]) && stopped[k].length === 0,
        )
      )
        fail();
      const fence = await io.verifyFence();
      const interrupted = await validateOwnedLegacyFence(fence, io);
      if (
        fence?.inventoryDigest !== scope ||
        fence.stage !== 'all-writers' ||
        fence.unsettledWork !== 0 ||
        (!interrupted && fence.externalWork !== 0) ||
        fence.producersRunning !== 0
      )
        fail();
    }
    await guard();
    const root = await disk.lstat(parent);
    if (
      !root.isDirectory() ||
      root.uid !== 998 ||
      root.mode & 0o022 ||
      (await disk.realpath(parent)) !== parent
    )
      fail();
    try {
      await disk.lstat(directory);
      throw new Error('exists');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    parentHandle = await disk.open(
      parent,
      constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
    );
    if (!sameFile(root, await parentHandle.stat())) fail();
    const bootstrapSeed = randomBytes(16).toString('hex');
    await io.recordBootstrap(bootstrapSeed);
    await guard();
    if (!sameFile(root, await disk.lstat(parent)) || (await disk.realpath(parent)) !== parent)
      fail();
    await disk.mkdir(directory, { mode: 0o700 }); // exclusive; a crash leaves a visible blocker
    const created = await disk.lstat(directory);
    directoryHandle = await disk.open(
      directory,
      constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
    );
    if (
      !sameFile(created, await directoryHandle.stat()) ||
      (await disk.realpath(directory)) !== directory
    )
      fail();
    file = await disk.open(
      `${directory}/state.json`,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      0o600,
    );
    await file.writeFile(
      `${JSON.stringify({ schemaVersion: 1, candidate, bootId: bootstrapSeed, mode: 'closed', needsReconciliation: false })}\n`,
    );
    await file.chmod(0o600);
    await file.chown(998, io.applicationGid);
    await file.sync();
    await guard();
    if (
      !sameFile(created, await disk.lstat(directory)) ||
      !sameFile(root, await disk.lstat(parent))
    )
      fail();
    await disk.chown(directory, 998, io.applicationGid);
    await directoryHandle.sync();
    await parentHandle.sync();
    return { bootstrapSeed };
  } catch {
    throw new Error('CUTOVER_STATE_UNPROVEN');
  } finally {
    try {
      await file?.close();
    } finally {
      try {
        await directoryHandle?.close();
      } finally {
        await parentHandle?.close();
      }
    }
  }
}

const fixedEnv = {
  PATH: '/opt/node22/bin:/usr/local/bin:/usr/bin:/bin',
  HOME: '/root',
  PM2_HOME: '/root/.pm2',
  LC_ALL: 'C',
};
const execFixed = (command, args, options) =>
  new Promise((resolve, reject) => {
    const child = execFile(
      command,
      args,
      { ...options, encoding: 'utf8', maxBuffer: 1024 * 1024 },
      (error, stdout) => (error ? reject(new Error('CUTOVER_STOP_UNCERTAIN')) : resolve(stdout)),
    );
    child.stdin.on('error', () => {});
    child.stdin.end(options.input ?? '');
  });
export function createLegacyRuntimeEffects(observation, system = {}) {
  return runtimeEffects(observation, system);
}
function runtimeEffects(observation, system, producerCapture) {
  const exec = system.exec ?? execFixed;
  async function recheck(p, tree, managed) {
    if ((system.platform ?? process.platform) !== 'linux' || (system.uid ?? process.getuid()) !== 0)
      fail();
    checkTarget(p);
    const binding = await observation.assertJournalOwnership();
    const fence = await observation.verifyFence();
    const interrupted = await validateOwnedLegacyFence(fence, observation);
    const snapshot = await observation.readInventory();
    if (producerCapture) {
      if (
        binding.inventoryDigest !== producerCapture.inventoryDigest ||
        !producerCapture.targets.some((t) => sameProcess(t, p))
      )
        fail();
      verifyProducerFence(fence, snapshot, producerCapture, observation.now(), interrupted);
    } else if (
      !hash(binding.inventoryDigest) ||
      fence?.inventoryDigest !== binding.inventoryDigest ||
      fence.stage !== 'all-writers' ||
      fence.unsettledWork !== 0 ||
      (!interrupted && fence.externalWork !== 0) ||
      fence.producersRunning !== 0
    )
      fail();
    checkSnapshot(
      snapshot,
      { inventoryDigest: binding.inventoryDigest, host: p.host, bootId: p.bootId },
      observation.now(),
    );
    if (!snapshot.processes.some((actual) => sameProcess(actual, p))) fail();
    if (managed) {
      if (p.managerIdentity.kind !== 'pm2') fail();
      const rows = snapshot.managers.filter((m) => sameManager(m, p.managerIdentity));
      if (rows.length !== 1 || rows[0].status !== 'online' || rows[0].rootPid !== p.pid) fail();
      const observedTree = snapshot.processes.filter((s) =>
        sameManager(s.managerIdentity, p.managerIdentity),
      );
      if (
        observedTree.length !== tree.length ||
        tree.some((t) => !observedTree.some((s) => sameProcess(s, t)))
      )
        fail();
      for (const child of tree) {
        checkTarget(child);
        if (isRootGateway(p) && (!isRootGateway(child) || child.cwd !== p.cwd)) fail();
        let ancestor = child;
        const seen = new Set();
        while (ancestor.pid !== p.pid) {
          if (seen.has(ancestor.pid)) fail();
          seen.add(ancestor.pid);
          ancestor = tree.find((t) => t.pid === ancestor.ppid);
          if (!ancestor) fail();
        }
      }
      if (p.ppid !== p.managerIdentity.pid) fail();
      if (isRootGateway(p) && p.exe !== '/usr/bin/node') fail();
    } else if (p.managerIdentity.kind !== 'unmanaged') fail();
  }
  return {
    ...observation,
    pm2Stop: async (p, tree = [p]) => {
      await recheck(p, tree, true);
      try {
        // Deliberately no timeout-kill of the CLI: its daemon may still be stopping
        // the approved target. Any error is uncertain and must not be retried.
        await exec('pm2', ['stop', String(p.managerIdentity.pmId), '--watch'], {
          env: fixedEnv,
          cwd: p.cwd,
        });
      } catch {
        throw new Error('CUTOVER_STOP_UNCERTAIN');
      }
    },
    signalPinned: async (p) => {
      await recheck(p, [p], false);
      try {
        await exec(
          '/usr/bin/python3',
          [fileURLToPath(new URL('./browser-first-cutover-signal.py', import.meta.url)), '--stdin'],
          { env: fixedEnv, cwd: p.cwd, input: JSON.stringify(p) },
        );
      } catch {
        throw new Error('CUTOVER_STOP_UNCERTAIN');
      }
    },
  };
}
