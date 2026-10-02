import { ingressDiagnosticError } from './browser-first-cutover-ingress-diagnostics.mjs';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import * as fs from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import {
  cutoverLegacyInterruptionRisk,
  validateFirstCutoverCloudSources,
} from './browser-cutover-evidence.mjs';
import {
  createFirstCutoverIngressLifecycle,
  readFirstCutoverApproval,
  readFirstCutoverReconciliationApproval,
  assertFirstCutoverReconciliationRead,
} from './browser-first-cutover-host.mjs';

const error = (stage, previous) =>
  ingressDiagnosticError('CUTOVER_INGRESS_SESSION_UNPROVEN', stage, previous);
const fail = (stage, previous) => {
  throw error(stage, previous);
};
const hash = (v) => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const uuid = (v) =>
  typeof v === 'string' &&
  /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(v);
const bindingKeys = ['attempt', 'candidate', 'configDigest', 'migrationDigest', 'inventoryDigest'];
const keys = (v, names) =>
  v &&
  typeof v === 'object' &&
  !Array.isArray(v) &&
  Object.keys(v).length === names.length &&
  names.every((k) => Object.hasOwn(v, k));

// Only our own fixed receiver, never a PID supplied by a remote client. The SSH
// forced entry independently verifies the installed module closure before exec.
export async function readFirstCutoverSessionIdentity({ role, attempt }) {
  if (
    process.platform !== 'linux' ||
    process.getuid?.() !== 0 ||
    !['ingress', 'gateway'].includes(role) ||
    !uuid(attempt)
  )
    fail();
  const entry = fileURLToPath(
    new URL(`./browser-first-cutover-${role}-session.mjs`, import.meta.url),
  );
  const expected = Buffer.from(`/usr/bin/node\0${entry}\0${attempt}\0`);
  const read = async () => {
    const root = `/proc/${process.pid}`;
    const stat = await fs.readFile(`${root}/stat`, 'utf8');
    if (!stat.startsWith(`${process.pid} (`)) fail();
    const fields = stat
      .slice(stat.lastIndexOf(')') + 2)
      .trim()
      .split(/\s+/);
    const status = await fs.readFile(`${root}/status`, 'utf8');
    const uids = /^Uid:\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*$/m.exec(status)?.slice(1).map(Number);
    const cmdline = await fs.readFile(`${root}/cmdline`);
    const value = {
      role,
      bootId: (await fs.readFile('/proc/sys/kernel/random/boot_id', 'utf8')).trim(),
      process: {
        pid: process.pid,
        ppid: Number(fields[1]),
        start: fields[19],
        uids,
        cwd: await fs.readlink(`${root}/cwd`),
        exe: await fs.readlink(`${root}/exe`),
        argvDigest: createHash('sha256')
          .update(JSON.stringify(cmdline.toString('utf8')))
          .digest('hex'),
        cgroup: await fs.readFile(`${root}/cgroup`, 'utf8'),
      },
    };
    if (!expected.equals(cmdline) || fields[0] === 'Z') fail();
    assertFirstCutoverSessionIdentity(value, role);
    return value;
  };
  const before = await read();
  if (!isDeepStrictEqual(before, await read())) fail();
  return before;
}

export function assertFirstCutoverSessionIdentity(value, role) {
  const p = value?.process;
  if (
    !keys(value, ['role', 'bootId', 'process']) ||
    value.role !== role ||
    !['ingress', 'gateway', 'ingress-ssh', 'gateway-ssh'].includes(role) ||
    !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value.bootId ?? '') ||
    !keys(p, ['pid', 'ppid', 'start', 'uids', 'cwd', 'exe', 'argvDigest', 'cgroup']) ||
    !Number.isSafeInteger(p.pid) ||
    p.pid <= 1 ||
    !Number.isSafeInteger(p.ppid) ||
    p.ppid < 1 ||
    !/^[0-9]+$/.test(p.start ?? '') ||
    !isDeepStrictEqual(p.uids, [0, 0, 0, 0]) ||
    p.cwd !== '/' ||
    p.exe !== (role.endsWith('-ssh') ? '/usr/bin/ssh' : '/usr/bin/node') ||
    !hash(p.argvDigest) ||
    typeof p.cgroup !== 'string' ||
    !p.cgroup ||
    p.cgroup.length > 65536
  )
    fail();
}
function validate(input, now) {
  const b = input?.binding;
  if (
    !keys(b, bindingKeys) ||
    !uuid(b.attempt) ||
    !/^[a-f0-9]{40}$/.test(b.candidate ?? '') ||
    !['configDigest', 'migrationDigest', 'inventoryDigest'].every((k) => hash(b[k])) ||
    !hash(input.siteDigest) ||
    !Number.isSafeInteger(input.maintenanceEndsAtMs) ||
    !Number.isSafeInteger(now) ||
    now < 0 ||
    now >= input.maintenanceEndsAtMs
  )
    fail();
}

/** Fixed receiver-side scope, independently provisioned by the operator. Nothing
 * supplied through stdin can select a host, path, configuration or approval file.
 */
export async function readFirstCutoverIngressSite(options, overrides = {}) {
  return readProtectedSite(options, overrides, 'ingress');
}

export async function readFirstCutoverGatewaySite(options, overrides = {}) {
  return readProtectedSite(options, overrides, 'gateway');
}

export async function readFirstCutoverExecutionSiteScope(options, overrides = {}) {
  const value = await readProtectedSite(options, overrides, 'execution');
  return {
    ...value.site,
    binding: value.binding,
    maintenanceEndsAtMs: value.maintenanceEndsAtMs,
    ...(Object.hasOwn(value, 'reconcileByMs') ? { reconcileByMs: value.reconcileByMs } : {}),
  };
}

async function readProtectedSite(options, overrides, kind) {
  const io = {
    fs,
    platform: process.platform,
    uid: process.getuid?.(),
    now: Date.now,
    readApproval: readFirstCutoverReconciliationApproval,
    ...overrides,
  };
  const folder = '/var/lib/holaday-deploy/maintenance';
  const path = `${folder}/first-cutover-${kind}-approved.json`;
  const scopeKey = kind === 'execution' ? 'site' : kind === 'ingress' ? 'ingress' : 'startupFiles';
  let handle;
  let stage = 'SITE_SHAPE';
  try {
    if (
      io.platform !== 'linux' ||
      io.uid !== 0 ||
      !keys(options, ['attempt']) ||
      !uuid(options.attempt)
    )
      fail();
    stage = 'SITE_APPROVAL_BEFORE';
    const beforeApproval = await io.readApproval(options);
    const began = io.now();
    stage = 'SITE_FOLDER';
    const directory = await io.fs.lstat(folder);
    const privateDirectory = (s) => s.isDirectory() && s.uid === 0 && (s.mode & 0o7777) === 0o700;
    const privateFile = (s) =>
      s.isFile() &&
      s.uid === 0 &&
      (s.mode & 0o7777) === 0o600 &&
      s.nlink === 1 &&
      s.size > 0 &&
      s.size <= 1024 * 1024;
    if (!privateDirectory(directory) || (await io.fs.realpath(folder)) !== folder) fail();
    stage = 'SITE_FILE';
    handle = await io.fs.open(
      path,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    const before = await handle.stat();
    if (!privateFile(before)) fail();
    stage = 'SITE_CONTENT';
    const bytes = await handle.readFile();
    const after = await handle.stat();
    const current = await io.fs.lstat(path);
    const currentDirectory = await io.fs.lstat(folder);
    if (
      !privateFile(after) ||
      !privateFile(current) ||
      !privateDirectory(currentDirectory) ||
      ['dev', 'ino'].some((k) => directory[k] !== currentDirectory[k]) ||
      (await io.fs.realpath(folder)) !== folder ||
      ['dev', 'ino', 'size', 'mode', 'uid', 'gid', 'nlink', 'mtimeMs', 'ctimeMs'].some(
        (k) => before[k] !== after[k] || after[k] !== current[k],
      ) ||
      bytes.length !== before.size ||
      !Buffer.from(bytes.toString('utf8')).equals(bytes)
    )
      fail();
    stage = 'SITE_JSON';
    const value = JSON.parse(bytes.toString('utf8'));
    stage = 'SITE_SHAPE';
    if (
      !keys(value, [
        'schemaVersion',
        'host',
        'binding',
        'maintenanceEndsAtMs',
        scopeKey,
        ...(kind === 'gateway' && Object.hasOwn(value, 'payments') ? ['payments'] : []),
      ]) ||
      value.schemaVersion !== 1 ||
      value.host !== (kind === 'execution' ? 'vultr' : 'aliyun') ||
      !bindingKeys.every((k) => value.binding?.[k] === beforeApproval[k]) ||
      value.binding.attempt !== options.attempt ||
      value.maintenanceEndsAtMs !== beforeApproval.maintenanceEndsAtMs
    )
      fail();
    if (kind === 'execution') {
      const s = value.site;
      if (
        !keys(s, [
          'legacyDigest',
          'reviews',
          'ingress',
          'gatewaySiteDigest',
          'producerStartupFiles',
          ...(Object.hasOwn(s, 'inventory') ? ['inventory'] : []),
          ...(Object.hasOwn(s, 'backupRecoveryDigest') ? ['backupRecoveryDigest'] : []),
          ...(Object.hasOwn(s, 'cloudBrowserRecoveryDigest') ? ['cloudBrowserRecoveryDigest'] : []),
          ...(Object.hasOwn(s, 'cloudMaintenanceScope') ? ['cloudMaintenanceScope'] : []),
          ...(Object.hasOwn(s, 'cloudRecoverySources') ? ['cloudRecoverySources'] : []),
        ]) ||
        Object.hasOwn(s, 'cloudMaintenanceScope') !== Object.hasOwn(s, 'cloudRecoverySources') ||
        (Object.hasOwn(s, 'backupRecoveryDigest') && !hash(s.backupRecoveryDigest)) ||
        (Object.hasOwn(s, 'cloudBrowserRecoveryDigest') && !hash(s.cloudBrowserRecoveryDigest)) ||
        (Object.hasOwn(s, 'cloudMaintenanceScope') &&
          (!Array.isArray(s.cloudMaintenanceScope) ||
            s.cloudMaintenanceScope.length !== 2 ||
            s.cloudMaintenanceScope.some(
              (entry, index) =>
                !keys(entry, ['name', 'pmId', 'scopeDigest', 'recoveryDigest']) ||
                entry.name !== ['holaday-vnc', 'holaday-chromium-headed'][index] ||
                !Number.isSafeInteger(entry.pmId) ||
                entry.pmId < 0 ||
                !hash(entry.scopeDigest) ||
                !hash(entry.recoveryDigest),
            ) ||
            s.cloudMaintenanceScope[0].pmId === s.cloudMaintenanceScope[1].pmId ||
            s.cloudMaintenanceScope[1].recoveryDigest !== s.cloudBrowserRecoveryDigest)) ||
        (Object.hasOwn(s, 'inventory') &&
          (!s.inventory ||
            typeof s.inventory !== 'object' ||
            Array.isArray(s.inventory) ||
            createHash('sha256').update(JSON.stringify(s.inventory)).digest('hex') !==
              value.binding.inventoryDigest)) ||
        s.legacyDigest !== beforeApproval.legacyDigest ||
        !hash(s.legacyDigest) ||
        !keys(s.reviews, ['vultr', 'aliyun']) ||
        !hash(s.gatewaySiteDigest) ||
        !keys(s.ingress, ['inventoryDigest', 'unknownIngress', 'files', 'remoteSiteDigest']) ||
        s.ingress.inventoryDigest !== value.binding.inventoryDigest ||
        !hash(s.ingress.remoteSiteDigest) ||
        !Array.isArray(s.ingress.unknownIngress) ||
        s.ingress.unknownIngress.length ||
        !Array.isArray(s.ingress.files) ||
        s.ingress.files.length !== 3 ||
        ![
          ['holaday', 'vultr-20260926'],
          ['hd-app.orangebench.tech', 'aliyun-app-20260926'],
          ['hd-pay.orangebench.tech', 'aliyun-pay-20260926'],
        ].every(
          ([name, profile]) =>
            s.ingress.files.filter(
              (f) => f?.path === `/etc/nginx/sites-available/${name}` && f.profile === profile,
            ).length === 1,
        ) ||
        !Array.isArray(s.producerStartupFiles) ||
        s.producerStartupFiles.length !== 2 ||
        s.producerStartupFiles.some(
          (f, i) =>
            !keys(f, ['path', 'digest', 'remove']) ||
            f.path !== `/root/.pm2/${i ? 'dump.pm2.bak' : 'dump.pm2'}` ||
            !(f.digest === null || hash(f.digest)) ||
            !Array.isArray(f.remove) ||
            f.remove.length > 3 ||
            (f.digest === null && f.remove.length !== 0) ||
            new Set(f.remove.map((r) => r.name)).size !== f.remove.length ||
            f.remove.some(
              (r) =>
                !keys(r, ['name', 'entryDigest']) ||
                ![
                  'holaday-orchestrator',
                  'holaday-account-closure-worker',
                  'holaday-files-cron',
                ].includes(r.name) ||
                !hash(r.entryDigest),
            ),
        ) ||
        !s.producerStartupFiles.some((f) => f.remove.length)
      )
        fail();
      if (Object.hasOwn(s, 'cloudMaintenanceScope'))
        validateFirstCutoverCloudSources(s.cloudRecoverySources, {
          scope: s.cloudMaintenanceScope,
        });
    }
    if (
      kind === 'ingress' &&
      (!keys(value.ingress, ['inventoryDigest', 'unknownIngress', 'files']) ||
        value.ingress.inventoryDigest !== value.binding.inventoryDigest ||
        !Array.isArray(value.ingress.unknownIngress) ||
        value.ingress.unknownIngress.length ||
        !Array.isArray(value.ingress.files) ||
        value.ingress.files.length !== 2 ||
        ![
          ['hd-app.orangebench.tech', 'aliyun-app-20260926'],
          ['hd-pay.orangebench.tech', 'aliyun-pay-20260926'],
        ].every(
          ([name, profile]) =>
            value.ingress.files.filter(
              (f) => f?.path === `/etc/nginx/sites-available/${name}` && f.profile === profile,
            ).length === 1,
        ))
    )
      fail();
    if (
      kind === 'gateway' &&
      ((Object.hasOwn(value, 'payments') &&
        (!value.payments ||
          typeof value.payments !== 'object' ||
          Array.isArray(value.payments) ||
          createHash('sha256').update(JSON.stringify(value.payments.inventory)).digest('hex') !==
            value.binding.inventoryDigest)) ||
        !Array.isArray(value.startupFiles) ||
        value.startupFiles.length !== 2 ||
        value.startupFiles.some(
          (f, i) =>
            !keys(f, ['path', 'digest', 'remove']) ||
            f.path !== `/root/.pm2/${i ? 'dump.pm2.bak' : 'dump.pm2'}` ||
            !(f.digest === null || hash(f.digest)) ||
            !Array.isArray(f.remove) ||
            f.remove.length > 1 ||
            (f.digest === null && f.remove.length !== 0) ||
            f.remove.some(
              (r) =>
                !keys(r, ['name', 'entryDigest']) ||
                r.name !== 'holaday-cn-payment' ||
                !hash(r.entryDigest),
            ),
        ) ||
        !value.startupFiles.some((f) => f.remove.length))
    )
      fail();
    const result = {
      binding: value.binding,
      maintenanceEndsAtMs: value.maintenanceEndsAtMs,
      ...(Number.isSafeInteger(beforeApproval.reconcileByMs)
        ? { reconcileByMs: beforeApproval.reconcileByMs }
        : {}),
      [scopeKey]: value[scopeKey],
      siteDigest: createHash('sha256').update(bytes).digest('hex'),
      ...(kind === 'gateway' && Object.hasOwn(value, 'payments')
        ? { payments: value.payments }
        : {}),
    };
    stage = 'SITE_CLOCK';
    const now = io.now();
    if (now < began) fail(stage);
    stage = 'SITE_APPROVAL_AFTER';
    if (!isDeepStrictEqual(beforeApproval, await io.readApproval(options))) fail(stage);
    stage = 'SITE_VALIDATE';
    validate(
      { ...result, maintenanceEndsAtMs: result.reconcileByMs ?? result.maintenanceEndsAtMs },
      now,
    );
    return result;
  } catch (error) {
    fail(stage, error);
  } finally {
    await handle?.close();
  }
}

// One bounded ordered stream, not a general RPC dispatcher. No executable, path,
// environment, file bytes, callback function, or reconnect request crosses here.
export function createFirstCutoverSessionWire(input, output, deadline, now) {
  const limit = 256 * 1024;
  let buffer = Buffer.alloc(0);
  let failure;
  let pending;
  let last = -1;
  const queue = [];
  const clock = () => {
    const time = now();
    if (!Number.isSafeInteger(time) || time < 0 || time < last || time >= deadline)
      fail('WIRE_CLOCK');
    last = time;
    return time;
  };
  const poison = () => {
    failure = error('WIRE_READ');
    if (pending) {
      const p = pending;
      pending = undefined;
      clearTimeout(p.timer);
      p.reject(failure);
    }
  };
  input.on('error', poison);
  input.on('end', poison);
  input.on('close', poison);
  output.on('error', poison);
  output.on('close', poison);
  input.on('data', (chunk) => {
    if (failure) return;
    try {
      if (!Buffer.isBuffer(chunk)) fail();
      buffer = Buffer.concat([buffer, chunk]);
      for (;;) {
        const index = buffer.indexOf(10);
        if (index < 0) break;
        if (index > limit) fail();
        const bytes = buffer.subarray(0, index);
        if (!bytes.length || !Buffer.from(bytes.toString('utf8')).equals(bytes)) fail();
        const value = JSON.parse(bytes.toString('utf8'));
        buffer = buffer.subarray(index + 1);
        if (pending) {
          const p = pending;
          pending = undefined;
          clearTimeout(p.timer);
          p.resolve(value);
        } else {
          queue.push(value);
          if (queue.length > 2) fail();
        }
      }
      if (buffer.length > limit) fail();
    } catch {
      poison();
    }
  });
  return {
    async read() {
      const left = Math.min(2147483647, deadline - clock());
      if (failure || pending) fail('WIRE_READ', failure);
      if (queue.length) return queue.shift();
      return new Promise((resolve, reject) => {
        pending = { resolve, reject, timer: setTimeout(poison, left) };
      });
    },
    async write(value) {
      const left = Math.min(2147483647, deadline - clock());
      if (failure || output.destroyed || output.writableEnded) fail('WIRE_WRITE', failure);
      const text = `${JSON.stringify(value)}\n`;
      if (Buffer.byteLength(text) > limit) fail();
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          poison();
          reject(error());
        }, left);
        output.write(text, (e) => {
          clearTimeout(timer);
          if (e) reject(error());
          else resolve();
        });
      });
    },
    close() {
      poison();
      output.end();
    },
    assert() {
      clock();
      if (failure) fail();
    },
  };
}
const wire = createFirstCutoverSessionWire;

const operationNames = [
  'attach',
  'fenceOrders',
  'fenceAll',
  'verifyFence',
  'verifyOrders',
  'restoreIngress',
  'readFenceReceipt',
  'detach',
];
const factNames = ['ownership', 'effects', 'writers', 'opened'];
function envelope(v, type, seq) {
  if (v?.protocol !== 1 || v.type !== type || v.seq !== seq) fail();
}

/** Serves one authenticated SSH lifetime. The receiving host independently reads
 * its protected scope. Facts are obtained synchronously from the coordinator's
 * actual live journal/readers, never supplied in the operation payload. Both root
 * endpoints are trusted; this is not a defense against a compromised root host.
 */
export async function serveFirstCutoverIngressSession({ attempt }, overrides = {}) {
  const io = {
    input: process.stdin,
    output: process.stdout,
    now: Date.now,
    readSite: readFirstCutoverIngressSite,
    readIdentity: readFirstCutoverSessionIdentity,
    createLifecycle: createFirstCutoverIngressLifecycle,
    ...overrides,
  };
  let stage = 'RECEIVER_ENTRY';
  let channel;
  try {
    if (!uuid(attempt)) fail();
    const site = structuredClone(await io.readSite({ attempt }));
    validate(site, io.now());
    if (site.binding.attempt !== attempt) fail();
    const execution = await io.readIdentity({ role: 'ingress', attempt });
    assertFirstCutoverSessionIdentity(execution, 'ingress');
    channel = wire(io.input, io.output, site.reconcileByMs ?? site.maintenanceEndsAtMs, io.now);
    let lifecycle;
    let sequence = 0;
    const used = new Set();
    for (;;) {
      const message = await channel.read();
      const seq = ++sequence;
      envelope(message, 'operation', seq);
      if (
        !keys(message, ['protocol', 'type', 'seq', 'name', 'value']) ||
        !operationNames.includes(message.name) ||
        (seq === 1 ? message.name !== 'attach' : message.name === 'attach')
      )
        fail();
      const name = message.name;
      if (
        (name !== 'restoreIngress' && message.value !== null) ||
        (['attach', 'fenceOrders', 'fenceAll', 'restoreIngress'].includes(name) && used.has(name))
      )
        fail();
      used.add(name);
      stage = 'RECEIVER_SCOPE';
      if (!isDeepStrictEqual(await io.readSite({ attempt }), site)) fail(stage);
      stage = 'RECEIVER_IDENTITY';
      if (!isDeepStrictEqual(await io.readIdentity({ role: 'ingress', attempt }), execution))
        fail();
      let factSequence = 0;
      const fact = async (name, value = null) => {
        stage = 'RECEIVER_FACT';
        const factSeq = ++factSequence;
        channel.assert();
        await channel.write({ protocol: 1, type: 'fact', seq, factSeq, name, value });
        const response = await channel.read();
        envelope(response, 'fact-result', seq);
        if (
          !keys(response, ['protocol', 'type', 'seq', 'factSeq', 'value']) ||
          response.factSeq !== factSeq
        )
          fail();
        return response.value;
      };
      if (io.now() >= site.maintenanceEndsAtMs) {
        if (!['readFenceReceipt', 'detach'].includes(name)) fail();
        await assertFirstCutoverReconciliationRead(
          site,
          {
            assertOwnership: () => fact('ownership'),
            readFirstCutoverEffects: () => fact('effects'),
          },
          io.now(),
        );
      }
      // Refresh closures for the current request; no journal snapshot is cached.
      let value;
      if (name === 'attach') {
        const facts = {
          journal: {
            assertOwnership: () => facts.call('ownership'),
            readFirstCutoverEffects: () => facts.call('effects'),
          },
          observeWriters: () => facts.call('writers'),
          verifyOpenedIdentity: (identity) => facts.call('opened', identity),
          call: fact,
        };
        lifecycle = {
          facts,
          methods: await io.createLifecycle(
            {
              binding: site.binding,
              maintenanceEndsAtMs: site.maintenanceEndsAtMs,
              ...(Object.hasOwn(site, 'reconcileByMs')
                ? { reconcileByMs: site.reconcileByMs }
                : {}),
            },
            {
              ...io.lifecycleIO,
              now: io.now,
              journal: facts.journal,
              observeWriters: facts.observeWriters,
              verifyOpenedIdentity: facts.verifyOpenedIdentity,
              readApprovedIngress: async () => {
                channel.assert();
                const current = await io.readSite({ attempt });
                if (!isDeepStrictEqual(current, site)) fail();
                return structuredClone(current.ingress);
              },
            },
          ),
        };
        value = {
          host: 'aliyun',
          binding: site.binding,
          maintenanceEndsAtMs: site.maintenanceEndsAtMs,
          ...(Object.hasOwn(site, 'reconcileByMs') ? { reconcileByMs: site.reconcileByMs } : {}),
          siteDigest: site.siteDigest,
          execution,
        };
      } else if (name === 'detach') {
        await channel.write({ protocol: 1, type: 'result', seq, value: null });
        return;
      } else {
        lifecycle.facts.call = fact;
        stage = 'RECEIVER_LOCAL';
        value =
          name === 'restoreIngress'
            ? await lifecycle.methods.restoreIngress(message.value)
            : await lifecycle.methods[name]();
      }
      stage = 'RECEIVER_RESULT';
      channel.assert();
      stage = 'RECEIVER_SCOPE';
      if (!isDeepStrictEqual(await io.readSite({ attempt }), site)) fail(stage);
      await channel.write({ protocol: 1, type: 'result', seq, value: value ?? null });
    }
  } catch (error) {
    fail(stage, error);
  } finally {
    if (channel) channel.close();
    else io.output.end();
  }
}

// Internal spawn boundary shared by the two fixed clients. Identity always comes
// from this owned ChildProcess, never an uploaded PID or a process-name allowlist.
export function openFirstCutoverSsh(file, args, options) {
  if (process.platform !== 'linux' || process.getuid?.() !== 0 || file !== '/usr/bin/ssh') fail();
  const argv = [file, ...args];
  const child = spawn(file, args, { ...options, cwd: '/', stdio: ['pipe', 'pipe', 'pipe'] });
  let ended = false;
  let identity;
  // Drain diagnostics without exposing credentials/configuration to the caller.
  child.stderr.resume();
  const completion = new Promise((resolve) => {
    child.once('error', () => {
      ended = true;
      child.stdout.destroy();
      child.stdin.destroy();
      resolve({ code: 1 });
    });
    child.once('close', (code, signal) => {
      ended = true;
      resolve({ code: signal ? 1 : code });
    });
  });
  const read = async () => {
    if (ended || !child.pid || child.exitCode !== null || child.signalCode !== null) fail();
    const root = `/proc/${child.pid}`;
    const stat = await fs.readFile(`${root}/stat`, 'utf8');
    if (!stat.startsWith(`${child.pid} (`)) fail();
    const fields = stat
      .slice(stat.lastIndexOf(')') + 2)
      .trim()
      .split(/\s+/);
    const status = await fs.readFile(`${root}/status`, 'utf8');
    const cmdline = await fs.readFile(`${root}/cmdline`);
    const value = {
      bootId: (await fs.readFile('/proc/sys/kernel/random/boot_id', 'utf8')).trim(),
      process: {
        pid: child.pid,
        ppid: Number(fields[1]),
        start: fields[19],
        uids: /^Uid:\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*$/m.exec(status)?.slice(1).map(Number),
        cwd: await fs.readlink(`${root}/cwd`),
        exe: await fs.readlink(`${root}/exe`),
        argvDigest: createHash('sha256')
          .update(JSON.stringify(cmdline.toString('utf8')))
          .digest('hex'),
        cgroup: await fs.readFile(`${root}/cgroup`, 'utf8'),
      },
    };
    if (
      ended ||
      fields[0] === 'Z' ||
      value.process.ppid !== process.pid ||
      !Buffer.from(`${argv.join('\0')}\0`).equals(cmdline)
    )
      fail();
    assertFirstCutoverSessionIdentity({ ...value, role: 'ingress-ssh' }, 'ingress-ssh');
    return value;
  };
  return {
    input: child.stdout,
    output: child.stdin,
    completion,
    readIdentity: async () => {
      try {
        const actual = await read();
        if (
          !isDeepStrictEqual(actual, await read()) ||
          (identity && !isDeepStrictEqual(identity, actual))
        )
          fail();
        identity = actual;
        return structuredClone(actual);
      } catch {
        fail();
      }
    },
  };
}

export async function readFirstCutoverTransportIdentity(connection, expected, role) {
  const actual = structuredClone(await connection.readIdentity());
  if (!keys(actual, ['bootId', 'process'])) fail();
  assertFirstCutoverSessionIdentity({ ...actual, role }, role);
  return {
    host: 'vultr',
    binding: structuredClone(expected.binding),
    siteDigest: expected.siteDigest,
    role,
    ...actual,
  };
}

export async function connectFirstCutoverIngressSession(input, overrides = {}) {
  const io = {
    platform: process.platform,
    uid: process.getuid?.(),
    now: Date.now,
    open: openFirstCutoverSsh,
    ...overrides,
  };
  let channel;
  let connection;
  let busy = false;
  let failed = false;
  let sequence = 0;
  try {
    const expected = structuredClone(input);
    validate(expected, io.now());
    if (
      !keys(expected, [
        'binding',
        'maintenanceEndsAtMs',
        'siteDigest',
        ...(Object.hasOwn(expected, 'reconcileByMs') ? ['reconcileByMs'] : []),
      ]) ||
      io.platform !== 'linux' ||
      io.uid !== 0 ||
      ['assertOwnership', 'readFirstCutoverEffects'].some(
        (k) => typeof io.journal?.[k] !== 'function',
      ) ||
      ['observeWriters', 'verifyOpenedIdentity'].some((k) => typeof io[k] !== 'function')
    )
      fail();
    const journal = {
      assertOwnership: io.journal.assertOwnership.bind(io.journal),
      readFirstCutoverEffects: io.journal.readFirstCutoverEffects.bind(io.journal),
    };
    const ownership = async () => {
      let value;
      try {
        value = await journal.assertOwnership();
      } catch (error) {
        fail('REMOTE_OWNER', error);
      }
      if (!isDeepStrictEqual(value, expected.binding)) fail('REMOTE_OWNER');
      if (io.now() >= expected.maintenanceEndsAtMs) {
        try {
          await assertFirstCutoverReconciliationRead(expected, io.journal, io.now());
        } catch (error) {
          fail('REMOTE_OWNER', error);
        }
      }
      return value;
    };
    await ownership();
    connection = await io.open(
      '/usr/bin/ssh',
      [
        '-F',
        '/dev/null',
        '-T',
        '-o',
        'StrictHostKeyChecking=yes',
        '-o',
        'ForwardAgent=no',
        '-o',
        'ClearAllForwardings=yes',
        '-o',
        'ConnectTimeout=15',
        '-o',
        'ServerAliveInterval=10',
        '-o',
        'ServerAliveCountMax=2',
        '-o',
        'BatchMode=yes',
        '-o',
        'IdentitiesOnly=yes',
        '-o',
        'IdentityAgent=none',
        '-o',
        'PreferredAuthentications=publickey',
        '-o',
        'PasswordAuthentication=no',
        '-o',
        'KbdInteractiveAuthentication=no',
        '-o',
        'UserKnownHostsFile=/var/lib/holaday-deploy/channel/known_hosts',
        '-o',
        'GlobalKnownHostsFile=/dev/null',
        '-o',
        'HostKeyAlgorithms=ssh-ed25519',
        '-i',
        '/var/lib/holaday-deploy/channel/identity',
        'root@47.99.169.186',
        `holaday-cutover-v1 ingress ${expected.binding.attempt}`,
      ],
      { shell: false, env: { PATH: '/usr/sbin:/usr/bin:/sbin:/bin', LANG: 'C' } },
    );
    channel = wire(
      connection.input,
      connection.output,
      expected.reconcileByMs ?? expected.maintenanceEndsAtMs,
      io.now,
    );
    const used = new Set();
    const run = async (name, value = null) => {
      const mutation = ['fenceOrders', 'fenceAll', 'restoreIngress'].includes(name);
      if (busy || failed || (mutation && used.has(name))) fail('REMOTE_ENTRY');
      if (mutation) used.add(name);
      busy = true;
      try {
        await ownership();
        if (
          io.now() >= expected.maintenanceEndsAtMs &&
          !['readFenceReceipt', 'detach'].includes(name)
        )
          fail();
        const seq = ++sequence;
        try {
          await channel.write({ protocol: 1, type: 'operation', seq, name, value });
        } catch (error) {
          fail('REMOTE_SEND', error);
        }
        let factSequence = 0;
        for (;;) {
          let response;
          try {
            response = await channel.read();
          } catch (error) {
            fail('REMOTE_READ', error);
          }
          if (response.type === 'result') {
            envelope(response, 'result', seq);
            if (!keys(response, ['protocol', 'type', 'seq', 'value'])) fail();
            await ownership();
            const result = response.value;
            if (['fenceOrders', 'fenceAll', 'verifyFence', 'verifyOrders'].includes(name)) {
              const counts = ['existingSockets', 'internalWriters', 'producersRunning'];
              const stage = ['fenceOrders', 'verifyOrders'].includes(name)
                ? 'orders'
                : 'all-writers';
              const now = io.now();
              if (
                !keys(result, ['inventoryDigest', 'stage', 'observedAtMs', ...counts]) ||
                result.inventoryDigest !== expected.binding.inventoryDigest ||
                result.stage !== stage ||
                !Number.isSafeInteger(result.observedAtMs) ||
                result.observedAtMs < 0 ||
                result.observedAtMs > now ||
                now - result.observedAtMs > 60000 ||
                counts.some(
                  (k) =>
                    !Number.isSafeInteger(result[k]) ||
                    result[k] < 0 ||
                    (stage === 'all-writers' && result[k] !== 0),
                )
              )
                fail();
            }
            if (['restoreIngress', 'detach'].includes(name) && result !== null) fail();
            if (name === 'readFenceReceipt' && result !== null) {
              const restoring = ['restoring', 'restored'].includes(result?.phase);
              if (
                !keys(result, [
                  'schemaVersion',
                  'attempt',
                  'inventoryDigest',
                  'stage',
                  'phase',
                  'files',
                  ...(restoring ? ['identity'] : []),
                ]) ||
                result.schemaVersion !== 1 ||
                result.attempt !== expected.binding.attempt ||
                result.inventoryDigest !== expected.binding.inventoryDigest ||
                !['orders', 'all-writers'].includes(result.stage) ||
                !['installing', 'active', 'restoring', 'restored'].includes(result.phase) ||
                !Array.isArray(result.files) ||
                !result.files.length ||
                result.files.length > 3 ||
                new Set(result.files.map((f) => f.path)).size !== result.files.length ||
                result.files.some(
                  (f) =>
                    !keys(f, ['path', 'originalDigest', 'generatedDigest', 'backupDigest']) ||
                    !/^\/etc\/nginx\/sites-available\/(?:holaday|hd-app\.orangebench\.tech|hd-pay\.orangebench\.tech)$/.test(
                      f.path,
                    ) ||
                    !['originalDigest', 'generatedDigest', 'backupDigest'].every((k) =>
                      hash(f[k]),
                    ) ||
                    f.originalDigest !== f.backupDigest,
                ) ||
                (restoring &&
                  (result.stage !== 'all-writers' ||
                    !keys(result.identity, ['candidate', 'bootId']) ||
                    result.identity.candidate !== expected.binding.candidate ||
                    !/^[a-f0-9]{32}$/.test(result.identity.bootId)))
              )
                fail();
            }
            return response.value;
          }
          envelope(response, 'fact', seq);
          if (
            !keys(response, ['protocol', 'type', 'seq', 'factSeq', 'name', 'value']) ||
            response.factSeq !== ++factSequence ||
            !factNames.includes(response.name) ||
            (response.name !== 'opened' && response.value !== null) ||
            (response.name === 'opened' &&
              (name !== 'restoreIngress' || !isDeepStrictEqual(response.value, value)))
          )
            fail();
          await ownership();
          let fact;
          if (response.name === 'ownership') fact = await ownership();
          else if (response.name === 'effects') {
            fact = await journal.readFirstCutoverEffects();
            if (!bindingKeys.every((k) => fact?.[k] === expected.binding[k])) fail();
          } else if (response.name === 'writers') fact = await io.observeWriters();
          else fact = await io.verifyOpenedIdentity(structuredClone(value));
          await ownership();
          await channel.write({
            protocol: 1,
            type: 'fact-result',
            seq,
            factSeq: factSequence,
            value: fact,
          });
        }
      } catch (error) {
        failed = true;
        channel.close();
        fail('REMOTE_RESULT', error);
      } finally {
        busy = false;
      }
    };
    const attached = await run('attach');
    if (
      !keys(attached, ['host', ...Object.keys(expected), 'execution']) ||
      !isDeepStrictEqual(
        { ...attached, execution: undefined },
        { host: 'aliyun', ...expected, execution: undefined },
      )
    )
      fail();
    assertFirstCutoverSessionIdentity(attached.execution, 'ingress');
    return {
      readTransportIdentity: async () => {
        try {
          if (failed) fail();
          channel.assert();
          const value = await readFirstCutoverTransportIdentity(
            connection,
            expected,
            'ingress-ssh',
          );
          if (failed) fail();
          channel.assert();
          return value;
        } catch {
          failed = true;
          channel.close();
          fail();
        }
      },
      readExecutionIdentity: () => {
        if (failed) fail();
        channel.assert();
        return structuredClone({
          host: 'aliyun',
          binding: expected.binding,
          siteDigest: expected.siteDigest,
          ...attached.execution,
        });
      },
      fenceOrders: () => run('fenceOrders'),
      fenceAll: () => run('fenceAll'),
      verifyFence: () => run('verifyFence'),
      verifyOrders: () => run('verifyOrders'),
      restoreIngress: async (identity) => {
        if ((await run('restoreIngress', structuredClone(identity))) !== null) fail();
      },
      readFenceReceipt: async () => (await run('readFenceReceipt')) ?? undefined,
      close: async () => {
        if ((await run('detach')) !== null) fail();
        failed = true;
        channel.close();
        const left = (expected.reconcileByMs ?? expected.maintenanceEndsAtMs) - io.now();
        if (left <= 0) fail();
        let timer;
        try {
          const result = await Promise.race([
            connection.completion,
            new Promise((resolve) => {
              timer = setTimeout(() => resolve({ code: 1 }), Math.min(2147483647, left));
            }),
          ]);
          if (result?.code !== 0) fail();
        } finally {
          clearTimeout(timer);
        }
      },
    };
  } catch (error) {
    failed = true;
    channel?.close();
    // No signal, retry, new SSH connection, old-config restoration or lock clear.
    connection?.output.end();
    fail('REMOTE_ENTRY', error);
  }
}

/** Fixed site composition, not a new transport. The caller supplies a protected
 * three-site approval reader and independently observed global writer facts.
 * A writer reader must not recursively query this in-flight ingress session.
 * Business settlement is deliberately NOT inferred from network isolation.
 */
export async function createFirstCutoverIngressPair(input, overrides = {}) {
  const io = {
    platform: process.platform,
    uid: process.getuid?.(),
    now: Date.now,
    createLocal: createFirstCutoverIngressLifecycle,
    connectRemote: connectFirstCutoverIngressSession,
    ...overrides,
  };
  const reject = (stage = 'PAIR_ENTRY', previous) => {
    throw ingressDiagnosticError('CUTOVER_INGRESS_PAIR_UNPROVEN', stage, previous);
  };
  let remote;
  try {
    const args = structuredClone(input);
    if (
      !keys(args, [
        'binding',
        'maintenanceEndsAtMs',
        ...(Object.hasOwn(args, 'reconcileByMs') ? ['reconcileByMs'] : []),
      ]) ||
      io.platform !== 'linux' ||
      io.uid !== 0 ||
      ['assertOwnership', 'readFirstCutoverEffects'].some(
        (k) => typeof io.journal?.[k] !== 'function',
      ) ||
      ['readApprovedPair', 'observeWriters', 'verifyOpenedIdentity'].some(
        (k) => typeof io[k] !== 'function',
      )
    )
      reject();
    const scope = structuredClone(await io.readApprovedPair());
    validate({ ...args, siteDigest: scope?.remoteSiteDigest }, io.now());
    const paths = [
      ['vultr-20260926', '/etc/nginx/sites-available/holaday'],
      ['aliyun-app-20260926', '/etc/nginx/sites-available/hd-app.orangebench.tech'],
      ['aliyun-pay-20260926', '/etc/nginx/sites-available/hd-pay.orangebench.tech'],
    ];
    if (
      !keys(scope, ['inventoryDigest', 'unknownIngress', 'files', 'remoteSiteDigest']) ||
      scope.inventoryDigest !== args.binding.inventoryDigest ||
      !Array.isArray(scope.unknownIngress) ||
      scope.unknownIngress.length ||
      !Array.isArray(scope.files) ||
      scope.files.length !== 3 ||
      !paths.every(
        ([profile, path]) =>
          scope.files.filter((f) => f?.profile === profile && f.path === path && hash(f.digest))
            .length === 1,
      )
    )
      reject();
    let last = -1;
    let revision;
    let busy = false;
    let failed = false;
    let closed = false;
    const used = new Set();
    const journal = {
      assertOwnership: io.journal.assertOwnership.bind(io.journal),
      readFirstCutoverEffects: io.journal.readFirstCutoverEffects.bind(io.journal),
    };
    const clock = () => {
      const now = io.now();
      if (
        !Number.isSafeInteger(now) ||
        now < 0 ||
        now < last ||
        now >= (args.reconcileByMs ?? args.maintenanceEndsAtMs)
      )
        reject('PAIR_CLOCK');
      last = now;
      return now;
    };
    const guard = async (phases) => {
      clock();
      let owner;
      try {
        owner = await journal.assertOwnership();
      } catch (error) {
        reject('PAIR_OWNER', error);
      }
      if (!isDeepStrictEqual(owner, args.binding)) reject('PAIR_OWNER');
      let record;
      try {
        record = await journal.readFirstCutoverEffects();
      } catch (error) {
        reject('PAIR_EFFECTS', error);
      }
      if (
        io.now() >= args.maintenanceEndsAtMs &&
        !isDeepStrictEqual(
          record,
          await assertFirstCutoverReconciliationRead(args, journal, io.now()),
        )
      )
        reject();
      if (
        record.phase === 'legacy_interruption_accepted' &&
        (record.schemaVersion !== 2 || record.riskDigest !== cutoverLegacyInterruptionRisk(record))
      )
        reject();
      if (!bindingKeys.every((k) => record?.[k] === args.binding[k]) || !hash(record.recordDigest))
        reject('PAIR_EFFECTS');
      if (revision !== undefined && revision !== record.recordDigest) reject('PAIR_REVISION');
      if (phases && !phases.includes(record.phase)) reject('PAIR_PHASE');
      let approved;
      try {
        approved = await io.readApprovedPair();
      } catch (error) {
        reject('PAIR_SCOPE', error);
      }
      if (!isDeepStrictEqual(approved, scope)) reject('PAIR_SCOPE');
      clock();
      return record;
    };
    const initial = await guard(['preflight', 'prepared']);
    revision = initial.recordDigest;
    // During the fixed endpoint's pre-mutation identity callback its SSH wire
    // is already occupied. Pin freshly read receipts BEFORE dispatch, then let
    // the retirement observer corroborate them against actual host files. Only
    // this owned callback may read that frame; never reuse it after dispatch.
    let openedReceipts;
    let verifyingOpened = false;
    const verifyOpened = async (identity) => {
      if (!openedReceipts || verifyingOpened) reject();
      verifyingOpened = true;
      try {
        await guard(['verified']);
        const value = await io.verifyOpenedIdentity(identity);
        await guard(['verified']);
        return value;
      } finally {
        verifyingOpened = false;
      }
    };
    const shared = {
      now: io.now,
      journal: {
        assertOwnership: async () => {
          await guard();
          return structuredClone(args.binding);
        },
        readFirstCutoverEffects: () => guard(),
      },
      observeWriters: io.observeWriters,
      verifyOpenedIdentity: verifyOpened,
    };
    const local = await io.createLocal(args, {
      ...io.local,
      ...shared,
      platform: io.platform,
      uid: io.uid,
      readApprovedIngress: async () => {
        await guard();
        return {
          inventoryDigest: scope.inventoryDigest,
          unknownIngress: [],
          files: structuredClone(scope.files.filter((f) => f.profile === 'vultr-20260926')),
        };
      },
    });
    await guard(['preflight', 'prepared']);
    remote = await io.connectRemote(
      { ...args, siteDigest: scope.remoteSiteDigest },
      { ...io.remote, ...shared, platform: io.platform, uid: io.uid },
    );
    await guard(['preflight', 'prepared']);
    revision = undefined;
    const endpoints = { vultr: local, aliyun: remote };
    const receipts = async () => {
      const result = [];
      for (const host of ['vultr', 'aliyun']) {
        await guard();
        let receipt;
        try {
          receipt = await endpoints[host].readFenceReceipt();
        } catch (error) {
          reject(host === 'vultr' ? 'PAIR_LOCAL_RECEIPT' : 'PAIR_REMOTE_RECEIPT', error);
        }
        if (receipt !== undefined) {
          const files = scope.files.filter(
            (f) => (f.profile === 'vultr-20260926') === (host === 'vultr'),
          );
          const restoring = ['restoring', 'restored'].includes(receipt.phase);
          if (
            !keys(receipt, [
              'schemaVersion',
              'attempt',
              'inventoryDigest',
              'stage',
              'phase',
              'files',
              ...(restoring ? ['identity'] : []),
            ]) ||
            receipt.schemaVersion !== 1 ||
            receipt.attempt !== args.binding.attempt ||
            receipt.inventoryDigest !== scope.inventoryDigest ||
            !['installing', 'active', 'restoring', 'restored'].includes(receipt.phase) ||
            !['orders', 'all-writers'].includes(receipt.stage) ||
            !Array.isArray(receipt.files) ||
            receipt.files.length !== files.length ||
            files.some(
              (f) =>
                receipt.files.filter(
                  (r) =>
                    r.path === f.path &&
                    r.originalDigest === f.digest &&
                    r.backupDigest === f.digest &&
                    hash(r.generatedDigest),
                ).length !== 1,
            ) ||
            (restoring &&
              (receipt.stage !== 'all-writers' ||
                receipt.identity?.candidate !== args.binding.candidate ||
                !/^[a-f0-9]{32}$/.test(receipt.identity?.bootId ?? '')))
          )
            reject('PAIR_RECEIPT_SHAPE');
          result.push({ host, receipt: structuredClone(receipt) });
        }
        await guard();
      }
      return result;
    };
    const counts = ['existingSockets', 'internalWriters', 'producersRunning'];
    const prove = (results, stage) => {
      const now = clock();
      if (
        results.length !== 2 ||
        results.some(
          (r) =>
            !keys(r, ['inventoryDigest', 'stage', 'observedAtMs', ...counts]) ||
            r.inventoryDigest !== scope.inventoryDigest ||
            r.stage !== stage ||
            !Number.isSafeInteger(r.observedAtMs) ||
            r.observedAtMs < 0 ||
            r.observedAtMs > now ||
            now - r.observedAtMs > 60000 ||
            counts.some(
              (k) =>
                !Number.isSafeInteger(r[k]) ||
                r[k] < 0 ||
                r[k] !== results[0][k] ||
                (stage === 'all-writers' && r[k] !== 0),
            ),
        )
      )
        reject();
      return { ...results[0], observedAtMs: Math.min(...results.map((r) => r.observedAtMs)) };
    };
    const run = async (name, phases, operation, mutation = false) => {
      if (
        busy ||
        closed ||
        (name !== 'receipts' && io.now() >= args.maintenanceEndsAtMs) ||
        (mutation && (failed || used.has(name)))
      )
        reject('PAIR_ENTRY');
      busy = true;
      if (mutation) used.add(name);
      try {
        revision = (await guard(phases)).recordDigest;
        const result = await operation();
        await guard(phases);
        return result;
      } catch (error) {
        failed = true;
        reject('PAIR_ENTRY', error);
      } finally {
        revision = undefined;
        busy = false;
      }
    };
    const fence = async (name, stage) => {
      const results = [];
      for (const host of ['vultr', 'aliyun']) {
        await guard();
        results.push(await endpoints[host][name]());
        await guard();
      }
      const proof = prove(results, stage);
      const actual = await receipts();
      if (
        actual.length !== 2 ||
        actual.some((r) => r.receipt.phase !== 'active' || r.receipt.stage !== stage)
      )
        reject();
      // Recheck freshness after receipt reads, never freshen an old observation.
      prove(results, stage);
      return proof;
    };
    return {
      // Deliberately synchronous: writer/retirement observations can run while
      // this pair owns the ingress stream. Never send a recursive RPC for this.
      readExecutionIdentities: () => {
        try {
          if (failed || closed) reject();
          clock();
          const receipt = remote.readExecutionIdentity();
          if (
            receipt.host !== 'aliyun' ||
            receipt.role !== 'ingress' ||
            receipt.siteDigest !== scope.remoteSiteDigest ||
            !isDeepStrictEqual(receipt.binding, args.binding)
          )
            reject();
          assertFirstCutoverSessionIdentity(
            { role: receipt.role, bootId: receipt.bootId, process: receipt.process },
            'ingress',
          );
          return [structuredClone(receipt)];
        } catch {
          failed = true;
          reject();
        }
      },
      // Local /proc only: safe even while a writer callback owns the SSH wire.
      readTransportIdentity: async () => {
        try {
          if (failed || closed) reject();
          clock();
          const receipt = await remote.readTransportIdentity();
          if (
            failed ||
            closed ||
            receipt.host !== 'vultr' ||
            receipt.role !== 'ingress-ssh' ||
            receipt.siteDigest !== scope.remoteSiteDigest ||
            !isDeepStrictEqual(receipt.binding, args.binding)
          )
            reject();
          clock();
          assertFirstCutoverSessionIdentity(
            { role: receipt.role, bootId: receipt.bootId, process: receipt.process },
            'ingress-ssh',
          );
          return structuredClone(receipt);
        } catch {
          failed = true;
          reject();
        }
      },
      fenceOrders: () =>
        run('orders', ['orders_fenced'], () => fence('fenceOrders', 'orders'), true),
      fenceAll: () => run('all', ['all_fenced'], () => fence('fenceAll', 'all-writers'), true),
      verifyOrders: () =>
        run(
          'verify-orders',
          ['orders_fenced', 'legacy_settled', 'legacy_interruption_accepted', 'producers_stopped'],
          () => fence('verifyOrders', 'orders'),
        ),
      verifyFence: () =>
        run(
          'verify',
          [
            'all_fenced',
            'stopped',
            'backup_verified',
            'migration_started',
            'candidate_started',
            'verified',
          ],
          () => fence('verifyFence', 'all-writers'),
        ),
      readFenceReceipts: async () => {
        if (!busy) return run('receipts', undefined, receipts);
        if (closed || failed || !verifyingOpened || !openedReceipts) reject();
        await guard(['verified']);
        return structuredClone(openedReceipts);
      },
      restoreIngress: (identity) =>
        run(
          'restore',
          ['verified'],
          async () => {
            const target = structuredClone(identity);
            const record = await guard();
            if (
              !keys(target, ['candidate', 'bootId']) ||
              !isDeepStrictEqual(record.identity, target)
            )
              reject();
            // Restore the edge/payment host first, public origin last. A partial
            // failure never retries restoration; the owning host closes admission.
            for (const host of ['aliyun', 'vultr']) {
              openedReceipts = await receipts();
              try {
                const opened = await verifyOpened(structuredClone(target));
                if (
                  !isDeepStrictEqual(opened?.identity, target) ||
                  opened.mode !== 'serving' ||
                  opened.idle !== false ||
                  opened.needsReconciliation !== true
                )
                  reject();
                await guard(['verified']);
                await endpoints[host].restoreIngress(target);
                await guard(['verified']);
              } finally {
                openedReceipts = undefined;
              }
            }
            const actual = await receipts();
            if (
              actual.length !== 2 ||
              actual.some(
                (r) =>
                  r.receipt.phase !== 'restored' || !isDeepStrictEqual(r.receipt.identity, target),
              )
            )
              reject();
          },
          true,
        ),
      close: async () => {
        if (busy || closed) reject();
        closed = true;
        try {
          await remote.close();
        } catch {
          reject();
        }
      },
    };
  } catch (error) {
    // Detach is not a retry of an uncertain effect, and never clears the lock.
    try {
      await remote?.close();
    } catch {
      /* Preserve the original failure. */
    }
    reject('PAIR_ENTRY', error);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.platform !== 'linux' || process.getuid?.() !== 0 || process.argv.length !== 3)
      fail();
    await serveFirstCutoverIngressSession({ attempt: process.argv[2] });
  } catch {
    process.stderr.write('CUTOVER_INGRESS_SESSION_UNPROVEN\n');
    process.exitCode = 1;
  }
}
