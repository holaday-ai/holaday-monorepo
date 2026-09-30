import { execFile } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { constants } from 'node:fs';
import * as fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import {
  cutoverLegacyInterruptionRisk,
  cutoverRegistrationConfigDigest,
  readFirstCutoverCloudRecoveryCensus,
  validateLegacyWorkBoundary as validateWork,
} from './browser-cutover-evidence.mjs';
export { readFirstCutoverCloudRecoveryCensus };

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
  const require = createRequire('/opt/node22/lib/node_modules/pm2/package.json');
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
        ['pm_id', 'name', 'pid', 'pm2_env'].some(
          (key) => !Object.hasOwn(Object.getOwnPropertyDescriptor(row, key) ?? {}, 'value'),
        ) ||
        !Number.isSafeInteger(row.pm_id) ||
        Object.is(row.pm_id, -0) ||
        row.pm_id < 0 ||
        ids.has(row.pm_id) ||
        typeof row.name !== 'string' ||
        !row.name ||
        !Number.isSafeInteger(row.pid) ||
        Object.is(row.pid, -0) ||
        row.pid < 0 ||
        !row.pm2_env ||
        Object.getPrototypeOf(row.pm2_env) !== Object.prototype ||
        row.pm2_env.pm_id !== row.pm_id ||
        row.pm2_env.name !== row.name
      )
        reject();
      ids.add(row.pm_id);
    }
    return ['holaday-vnc', 'holaday-chromium-headed'].map((name) => {
      const selected = rows.filter((row) => row.name === name);
      if (selected.length !== 1) reject();
      const row = selected[0];
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
        const require = createRequire('/opt/node22/lib/node_modules/pm2/package.json');
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
  // Current-disk Python differs from the historical deleted executable. Public
  // package/module metadata alone does not verify its loaded dependency closure,
  // actual display ownership or VNC service capability. Never accept a boolean
  // callback, substitute process shape, or old-running==current-disk assumption.
  if (input?.name === 'holaday-vnc') throw new Error('CUTOVER_CLOUD_VNC_NATIVE_SOURCE_UNPROVEN');
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
      Object.keys(copy).sort().join(',') !== 'attempt,beforeCensus,name,pmId,restoreStartedAtMs' ||
      name !== 'holaday-chromium-headed' ||
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
    const runtime = await readFirstCutoverCloudBrowserRecovery({ attempt, pmId }, io);
    const after = structuredClone(await readCensus());
    census(after);
    const repeated = await readFirstCutoverCloudBrowserRecovery({ attempt, pmId }, io);
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
        !['/opt/brave.com/brave/brave', '/opt/brave.com/brave/chrome_crashpad_handler'].includes(
          p.exe,
        ) ||
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
      policyDigest: runtime.policyDigest,
      mountNamespace: runtime.mountNamespace,
    };
  } catch {
    reject();
  }
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
