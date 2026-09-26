import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { constants } from 'node:fs';
import * as fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

const hash = (x) => typeof x === 'string' && /^[a-f0-9]{64}$/.test(x);
const producerReceipts = new WeakMap();
function producerScope(captured) {
  if (
    !captured?.targets?.length ||
    captured.targets.some((p) => !['main', 'worker'].includes(p.role))
  )
    fail();
  for (const target of captured.targets) checkTarget(target);
}
function verifyProducerFence(fence, snapshot, captured, now) {
  producerScope(captured);
  checkSnapshot(snapshot, captured, now);
  if (
    fence?.inventoryDigest !== captured.inventoryDigest ||
    fence.stage !== 'orders' ||
    !Number.isSafeInteger(fence.observedAtMs) ||
    fence.observedAtMs > now ||
    now - fence.observedAtMs > 60000 ||
    fence.unsettledWork !== 0 ||
    fence.externalWork !== 0 ||
    fence.activeRequests !== 0 ||
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
    !/^[a-z0-9.-]{1,128}$/.test(p.host ?? '') ||
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
    if (producers) {
      verifyProducerFence(fence, await io.readInventory(), c, io.now());
      return;
    }
    if (
      fence?.inventoryDigest !== c.inventoryDigest ||
      fence.stage !== 'all-writers' ||
      fence.unsettledWork !== 0 ||
      fence.externalWork !== 0 ||
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
      if (
        fence?.inventoryDigest !== scope ||
        fence.stage !== 'all-writers' ||
        fence.unsettledWork !== 0 ||
        fence.externalWork !== 0 ||
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
    const snapshot = await observation.readInventory();
    if (producerCapture) {
      if (
        binding.inventoryDigest !== producerCapture.inventoryDigest ||
        !producerCapture.targets.some((t) => sameProcess(t, p))
      )
        fail();
      verifyProducerFence(fence, snapshot, producerCapture, observation.now());
    } else if (
      !hash(binding.inventoryDigest) ||
      fence?.inventoryDigest !== binding.inventoryDigest ||
      fence.stage !== 'all-writers' ||
      fence.unsettledWork !== 0 ||
      fence.externalWork !== 0 ||
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
