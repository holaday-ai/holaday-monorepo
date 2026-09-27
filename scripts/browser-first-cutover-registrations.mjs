import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import * as fs from 'node:fs/promises';
import { hostname } from 'node:os';
import { isDeepStrictEqual as equal, promisify } from 'node:util';
import { captureLegacyRegistrations } from './browser-first-cutover-runtime.mjs';
import { removeSavedStartupEntries } from './browser-first-cutover-startup.mjs';
export { cutoverRegistrationConfigDigest as registrationConfigDigest } from './browser-cutover-evidence.mjs';
import { cutoverRegistrationConfigDigest as registrationConfigDigest } from './browser-cutover-evidence.mjs';

const archive = '/var/lib/holaday-deploy/maintenance';
const home = '/root/.pm2';
const pm2 = '/usr/lib/node_modules/pm2/bin/pm2';
const sha = (b) => createHash('sha256').update(b).digest('hex');
const hash = (v) => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const stableConfig = (value) =>
  Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'axm_monitor'));
const fail = () => {
  throw new Error('CUTOVER_REGISTRATION_UNPROVEN');
};
const sameFile = (a, b) => a.ino === b.ino && a.dev === b.dev;
const env = { PATH: '/usr/bin:/bin', HOME: '/root', PM2_HOME: home, LANG: 'C', NO_COLOR: '1' };

/** Fixed local producer slice for lifecycle.stopProducers. Observations and the
 * journal are the original held instances, never uploaded completion reports.
 * Startup file digests/entry hashes come from the site's protected review.
 * This does not retire Aliyun gateways or establish global stopped evidence. */
export async function retireLocalFirstCutoverProducers(input, io, system = {}) {
  const { binding, files, maintenanceEndsAtMs } = structuredClone(input ?? {});
  if (
    (system.platform ?? process.platform) !== 'linux' ||
    (system.uid ?? process.getuid?.()) !== 0 ||
    !binding ||
    Object.keys(binding).length !== 2 ||
    !Number.isSafeInteger(maintenanceEndsAtMs) ||
    ['now', 'sleep', 'verifyFence'].some((k) => typeof io?.[k] !== 'function') ||
    typeof io?.observer?.read !== 'function' ||
    typeof io.observer.readRegistrationProgress !== 'function'
  )
    fail();
  let last = -1;
  const guard = async () => {
    const now = io.now();
    if (!Number.isSafeInteger(now) || now < 0 || now < last || now >= maintenanceEndsAtMs) fail();
    last = now;
    const owner = await io.journal.assertOwnership();
    const record = await io.journal.readFirstCutoverEffects();
    if (
      !['attempt', 'inventoryDigest'].every(
        (k) => owner[k] === binding[k] && record[k] === binding[k],
      ) ||
      record.phase !== 'producers_stopped'
    )
      fail();
    return record;
  };
  const before = await guard();
  if (
    !Array.isArray(before.startupEvents) ||
    !Array.isArray(before.registrationEvents) ||
    [...before.startupEvents, ...before.registrationEvents].some((e) => e.host === 'vultr')
  )
    fail();
  const read = async () => {
    await guard();
    const result = await io.observer.readRegistrationProgress('vultr');
    if (result?.host !== 'vultr' || result.purpose !== 'registration-progress') fail();
    await guard();
    return result.inventory;
  };
  const pair = await io.observer.read();
  const inventory = pair?.hosts?.find((h) => h.host === 'vultr')?.registered;
  if (
    pair.inventoryDigest !== binding.inventoryDigest ||
    pair.unknownLaunchers?.length !== 0 ||
    inventory?.host !== (system.hostname ?? hostname)() ||
    inventory.processes.some((p) => !['main', 'worker'].includes(p.role)) ||
    inventory.managers.some(
      (m) =>
        !['holaday-orchestrator', 'holaday-account-closure-worker', 'holaday-files-cron'].includes(
          m.name,
        ),
    )
  )
    fail();
  const captured = await captureLegacyRegistrations(
    {
      inventory,
      approvedTargets: inventory.processes,
      approvedRegistrations: inventory.managers,
    },
    { now: io.now },
  );
  if (
    !Array.isArray(files) ||
    files.some(
      (f) =>
        !Array.isArray(f.remove) ||
        f.remove.some((r) => !captured.managers.some((m) => m.name === r.name)),
    )
  )
    fail();
  const fence = await io.verifyFence();
  const now = io.now();
  if (
    fence?.inventoryDigest !== binding.inventoryDigest ||
    fence.stage !== 'orders' ||
    !Number.isSafeInteger(fence.observedAtMs) ||
    fence.observedAtMs < 0 ||
    fence.observedAtMs > now ||
    now - fence.observedAtMs > 60000 ||
    ['unsettledWork', 'externalWork', 'activeRequests', 'unknownWriters'].some(
      (k) => fence[k] !== 0,
    ) ||
    fence.producersRunning !== inventory.processes.length ||
    !equal(fence.runningProducers, inventory.processes) ||
    !equal(
      await captureLegacyRegistrations(
        {
          inventory: await read(),
          approvedTargets: captured.targets,
          approvedRegistrations: captured.managers,
        },
        { now: io.now },
      ),
      captured,
    ) ||
    now + captured.managers.reduce((sum, m) => sum + m.killTimeoutMs, 100) >= maintenanceEndsAtMs
  )
    fail();
  const assertOwnership = async () => {
    await guard();
    return { ...binding };
  };
  await removeSavedStartupEntries(
    { binding, files, maintenanceEndsAtMs },
    {
      ...system,
      now: io.now,
      assertOwnership,
      persist: async (e) => {
        await guard();
        await io.journal.recordStartupEvent({ ...e, host: 'vultr' });
      },
    },
  );
  await io.observer.read();
  const result = await removeLegacyRegistrations(
    { captured, binding, maintenanceEndsAtMs },
    {
      now: io.now,
      sleep: io.sleep,
      assertOwnership,
      readInventory: read,
      verifyFence: io.verifyFence,
      persist: async (e) => {
        await guard();
        await io.journal.recordRegistrationEvent({ ...e, host: 'vultr' });
      },
    },
    system,
  );
  const after = await io.observer.read();
  const stopped = after?.hosts?.find((h) => h.host === 'vultr')?.registered;
  if (
    after.inventoryDigest !== binding.inventoryDigest ||
    after.unknownLaunchers?.length !== 0 ||
    stopped?.processes?.length !== 0 ||
    stopped.managers?.length !== 0 ||
    stopped.listeners?.length !== 0
  )
    fail();
  await guard();
  return { ...result, host: 'vultr', phase: 'producers_stopped' };
}

/** First-only removal of exact registrations, including stopped/PID0 cron.
 * Host-owned observers must classify the complete physical scope and hold the
 * release journal. No CLI, replay, global save/kill, or automatic recovery.
 * readInventory is not a PM2 status-only observation: it includes proc/listeners.
 */
export async function removeLegacyRegistrations(input, io, system = {}) {
  const disk = system.fs ?? fs;
  const exec =
    system.exec ??
    (async (file, argv, options) =>
      (
        await promisify(execFile)(file, argv, {
          ...options,
          encoding: 'utf8',
          maxBuffer: 8 * 1024 * 1024,
        })
      ).stdout);
  try {
    const { captured: c, binding, maintenanceEndsAtMs } = structuredClone(input);
    if (
      (system.platform ?? process.platform) !== 'linux' ||
      (system.uid ?? process.getuid?.()) !== 0 ||
      c?.retirement !== 'delete-registration' ||
      !Array.isArray(c.managers) ||
      !c.managers.length ||
      !Array.isArray(c.targets) ||
      !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(
        binding?.attempt ?? '',
      ) ||
      !hash(binding.inventoryDigest) ||
      binding.inventoryDigest !== c.inventoryDigest ||
      !Number.isSafeInteger(maintenanceEndsAtMs)
    )
      fail();
    const removed = new Set();
    let last = io.now();
    if (!Number.isSafeInteger(last) || last < 0) fail();
    const clock = async () => {
      const now = io.now();
      if (
        !Number.isSafeInteger(now) ||
        now < last ||
        now >= maintenanceEndsAtMs ||
        !equal(await io.assertOwnership(), binding)
      )
        fail();
      last = now;
    };
    const directory = async (path, privateOnly = false) => {
      const s = await disk.lstat(path);
      if (
        !s.isDirectory() ||
        s.uid !== 0 ||
        s.mode & 0o7022 ||
        (privateOnly && (s.mode & 0o777) !== 0o700) ||
        (await disk.realpath(path)) !== path
      )
        fail();
      return s;
    };
    const parent = await directory(archive, true);
    const pmHome = await directory(home);
    const dirGuard = async () => {
      if (
        !sameFile(parent, await directory(archive, true)) ||
        !sameFile(pmHome, await directory(home))
      )
        fail();
    };
    const readProtected = async (path, optional = false, privateOnly = false) => {
      await dirGuard();
      let h;
      try {
        let initial;
        try {
          initial = await disk.lstat(path);
        } catch (e) {
          if (optional && e.code === 'ENOENT') return null;
          throw e;
        }
        const valid = (s) =>
          s.isFile() &&
          s.uid === 0 &&
          s.nlink === 1 &&
          !(s.mode & 0o7022) &&
          (!privateOnly || (s.mode & 0o777) === 0o600);
        if (!valid(initial)) fail();
        h = await disk.open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
        const before = await h.stat();
        if (
          !valid(before) ||
          !sameFile(initial, before) ||
          before.size < 1 ||
          before.size > 8 * 1024 * 1024
        )
          fail();
        const bytes = Buffer.alloc(before.size + 1);
        let count = 0;
        while (count < bytes.length) {
          const { bytesRead } = await h.read(bytes, count, bytes.length - count, null);
          if (!bytesRead) break;
          count += bytesRead;
        }
        const after = await h.stat();
        const current = await disk.lstat(path);
        if (
          count !== before.size ||
          !valid(current) ||
          !valid(after) ||
          !sameFile(before, after) ||
          !sameFile(before, current) ||
          ['size', 'mtimeMs', 'ctimeMs', 'mode'].some(
            (k) => before[k] !== after[k] || after[k] !== current[k],
          )
        )
          fail();
        await dirGuard();
        return bytes.subarray(0, count);
      } finally {
        await h?.close();
      }
    };
    const names = c.managers.map((m) => m.name);
    const savedAbsent = async () => {
      for (const suffix of ['dump.pm2', 'dump.pm2.bak']) {
        const bytes = await readProtected(`${home}/${suffix}`, true);
        if (!bytes) continue;
        const rows = JSON.parse(bytes.toString('utf8'));
        if (
          !Array.isArray(rows) ||
          rows.some((r) => !r || typeof r.name !== 'string' || names.includes(r.name))
        )
          fail();
      }
    };
    const guard = async () => {
      await clock();
      await savedAbsent();
      const s = await io.readInventory();
      const managers = c.managers.filter((m) => !removed.has(m.pmId));
      const targets = c.targets.filter((p) => !removed.has(p.managerIdentity.pmId));
      if (!equal(s.managers, managers) || !equal(s.processes, targets) || !equal(s.ports, c.ports))
        fail();
      if (managers.length) {
        const verified = await captureLegacyRegistrations(
          { inventory: s, approvedTargets: targets, approvedRegistrations: managers },
          { now: io.now },
        );
        if (
          verified.host !== c.host ||
          verified.bootId !== c.bootId ||
          verified.inventoryDigest !== c.inventoryDigest
        )
          fail();
      } else if (
        s.inventoryDigest !== c.inventoryDigest ||
        s.host !== c.host ||
        s.bootId !== c.bootId ||
        !Number.isSafeInteger(s.observedAtMs) ||
        s.observedAtMs > io.now() ||
        io.now() - s.observedAtMs > 60000 ||
        s.listeners?.length !== 0 ||
        s.unknownLaunchers?.length !== 0
      )
        fail();
      const fence = await io.verifyFence();
      if (
        fence?.inventoryDigest !== c.inventoryDigest ||
        !Number.isSafeInteger(fence.observedAtMs) ||
        fence.observedAtMs > io.now() ||
        io.now() - fence.observedAtMs > 60000 ||
        fence.unsettledWork !== 0 ||
        fence.externalWork !== 0 ||
        fence.activeRequests !== 0 ||
        fence.unknownWriters !== 0
      )
        fail();
      if (c.targets.some((p) => p.role === 'gateway')) {
        if (
          c.targets.some((p) => p.role !== 'gateway') ||
          fence.stage !== 'all-writers' ||
          fence.producersRunning !== 0
        )
          fail();
      } else if (
        fence.stage !== 'orders' ||
        fence.producersRunning !== s.processes.length ||
        !equal(fence.runningProducers, s.processes)
      )
        fail();
      await clock();
    };
    const list = async () => {
      const raw = await exec('/usr/bin/node', [pm2, 'jlist'], { env, cwd: home });
      if (typeof raw !== 'string' || Buffer.byteLength(raw) > 8 * 1024 * 1024) fail();
      const rows = JSON.parse(raw);
      if (
        !Array.isArray(rows) ||
        rows.some(
          (r) =>
            !Number.isSafeInteger(r?.pm_id) ||
            r.pm_id < 0 ||
            typeof r.name !== 'string' ||
            !Number.isSafeInteger(r.pid) ||
            !r.pm2_env,
        ) ||
        new Set(rows.map((r) => r.pm_id)).size !== rows.length
      )
        fail();
      return rows;
    };
    const select = (rows) =>
      rows.map((r) => ({ pmId: r.pm_id, name: r.name, pid: r.pid, config: r.pm2_env }));
    await guard();
    if (io.now() + c.managers.reduce((sum, m) => sum + m.killTimeoutMs, 100) >= maintenanceEndsAtMs)
      fail();
    const initial = select(await list());
    const checkRows = (rows) => {
      const targetRows = rows.filter((r) => names.includes(r.name));
      const expected = c.managers.filter((m) => !removed.has(m.pmId));
      if (
        targetRows.length !== expected.length ||
        expected.some(
          (m) =>
            targetRows.filter(
              (r) =>
                r.pmId === m.pmId &&
                r.name === m.name &&
                r.pid === m.rootPid &&
                registrationConfigDigest(r.config) === m.configDigest,
            ).length !== 1,
        ) ||
        !equal(
          rows
            .filter((r) => !names.includes(r.name))
            .map((r) => ({ ...r, config: stableConfig(r.config) })),
          initial
            .filter((r) => !names.includes(r.name))
            .map((r) => ({ ...r, config: stableConfig(r.config) })),
        )
      )
        fail();
    };
    checkRows(initial);
    const backup = Buffer.from(
      `${JSON.stringify(initial.filter((r) => names.includes(r.name)))}\n`,
    );
    const backupDigest = sha(backup);
    const folder = `${archive}/registrations-${binding.attempt}`;
    const path = `${folder}/original.json`;
    await io.persist({ ...binding, phase: 'registration-backup-intent' });
    await guard();
    await disk.mkdir(folder, { mode: 0o700 });
    const created = await directory(folder, true);
    let file;
    let folderHandle;
    let parentHandle;
    try {
      folderHandle = await disk.open(
        folder,
        constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
      );
      parentHandle = await disk.open(
        archive,
        constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
      );
      if (
        !sameFile(created, await folderHandle.stat()) ||
        !sameFile(parent, await parentHandle.stat())
      )
        fail();
      file = await disk.open(
        path,
        constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
        0o600,
      );
      await file.writeFile(backup);
      await file.sync();
      await folderHandle.sync();
      await parentHandle.sync();
    } finally {
      await file?.close();
      await folderHandle?.close();
      await parentHandle?.close();
    }
    const backupGuard = async () => {
      if (
        !sameFile(created, await directory(folder, true)) ||
        sha(await readProtected(path, false, true)) !== backupDigest
      )
        fail();
    };
    await backupGuard();
    await io.persist({
      ...binding,
      phase: 'registration-backed-up',
      backupDigest,
      registrations: c.managers.map((m) => ({
        pmId: m.pmId,
        name: m.name,
        configDigest: m.configDigest,
      })),
    });
    for (const m of c.managers) {
      await guard();
      await backupGuard();
      checkRows(select(await list()));
      if (io.now() + m.killTimeoutMs + 100 >= maintenanceEndsAtMs) fail();
      const detail = { ...binding, pmId: m.pmId, name: m.name, configDigest: m.configDigest };
      await io.persist({ ...detail, phase: 'registration-delete-intent' });
      await guard();
      await backupGuard();
      checkRows(select(await list()));
      await clock();
      // No CLI timeout/retry: the daemon may already have stopped the target.
      try {
        await exec('/usr/bin/node', [pm2, 'delete', String(m.pmId)], { env, cwd: home });
      } catch {
        throw new Error('CUTOVER_REGISTRATION_UNCERTAIN');
      }
      removed.add(m.pmId);
      await guard();
      checkRows(select(await list()));
      await backupGuard();
      await io.sleep(100);
      await guard();
      checkRows(select(await list()));
      await io.persist({ ...detail, phase: 'registration-deleted' });
    }
    await guard();
    await backupGuard();
    return {
      ...binding,
      backupDigest,
      removed: c.managers.map((m) => ({ pmId: m.pmId, name: m.name })),
    };
  } catch (e) {
    if (e?.message === 'CUTOVER_REGISTRATION_UNCERTAIN') throw e;
    fail();
  }
}
