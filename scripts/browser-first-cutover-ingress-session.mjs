import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import * as fs from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import {
  createFirstCutoverIngressLifecycle,
  readFirstCutoverApproval,
} from './browser-first-cutover-host.mjs';

const error = () => new Error('CUTOVER_INGRESS_SESSION_UNPROVEN');
const fail = () => {
  throw error();
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
  const io = {
    fs,
    platform: process.platform,
    uid: process.getuid?.(),
    now: Date.now,
    readApproval: readFirstCutoverApproval,
    ...overrides,
  };
  const folder = '/var/lib/holaday-deploy/maintenance';
  const path = `${folder}/first-cutover-ingress-approved.json`;
  let handle;
  try {
    if (
      io.platform !== 'linux' ||
      io.uid !== 0 ||
      !keys(options, ['attempt']) ||
      !uuid(options.attempt)
    )
      fail();
    const beforeApproval = await io.readApproval(options);
    const began = io.now();
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
    handle = await io.fs.open(
      path,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    const before = await handle.stat();
    if (!privateFile(before)) fail();
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
    const value = JSON.parse(bytes.toString('utf8'));
    if (
      !keys(value, ['schemaVersion', 'host', 'binding', 'maintenanceEndsAtMs', 'ingress']) ||
      value.schemaVersion !== 1 ||
      value.host !== 'aliyun' ||
      !bindingKeys.every((k) => value.binding?.[k] === beforeApproval[k]) ||
      value.binding.attempt !== options.attempt ||
      value.maintenanceEndsAtMs !== beforeApproval.maintenanceEndsAtMs ||
      !keys(value.ingress, ['inventoryDigest', 'unknownIngress', 'files']) ||
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
      )
    )
      fail();
    const result = {
      binding: value.binding,
      maintenanceEndsAtMs: value.maintenanceEndsAtMs,
      ingress: value.ingress,
      siteDigest: createHash('sha256').update(bytes).digest('hex'),
    };
    const now = io.now();
    if (now < began || !isDeepStrictEqual(beforeApproval, await io.readApproval(options))) fail();
    validate(result, now);
    return result;
  } catch {
    fail();
  } finally {
    await handle?.close();
  }
}

// One bounded ordered stream, not a general RPC dispatcher. No executable, path,
// environment, file bytes, callback function, or reconnect request crosses here.
function wire(input, output, deadline, now) {
  const limit = 256 * 1024;
  let buffer = Buffer.alloc(0);
  let failure;
  let pending;
  let last = -1;
  const queue = [];
  const clock = () => {
    const time = now();
    if (!Number.isSafeInteger(time) || time < 0 || time < last || time >= deadline) fail();
    last = time;
    return time;
  };
  const poison = () => {
    failure = error();
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
      if (failure || pending) fail();
      if (queue.length) return queue.shift();
      return new Promise((resolve, reject) => {
        pending = { resolve, reject, timer: setTimeout(poison, left) };
      });
    },
    async write(value) {
      const left = Math.min(2147483647, deadline - clock());
      if (failure || output.destroyed || output.writableEnded) fail();
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

const operationNames = [
  'attach',
  'fenceOrders',
  'fenceAll',
  'verifyFence',
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
    createLifecycle: createFirstCutoverIngressLifecycle,
    ...overrides,
  };
  let channel;
  try {
    if (!uuid(attempt)) fail();
    const site = structuredClone(await io.readSite({ attempt }));
    validate(site, io.now());
    if (site.binding.attempt !== attempt) fail();
    channel = wire(io.input, io.output, site.maintenanceEndsAtMs, io.now);
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
      if (!isDeepStrictEqual(await io.readSite({ attempt }), site)) fail();
      let factSequence = 0;
      const fact = async (name, value = null) => {
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
            { binding: site.binding, maintenanceEndsAtMs: site.maintenanceEndsAtMs },
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
          siteDigest: site.siteDigest,
        };
      } else if (name === 'detach') {
        await channel.write({ protocol: 1, type: 'result', seq, value: null });
        return;
      } else {
        lifecycle.facts.call = fact;
        value =
          name === 'restoreIngress'
            ? await lifecycle.methods.restoreIngress(message.value)
            : await lifecycle.methods[name]();
      }
      channel.assert();
      if (!isDeepStrictEqual(await io.readSite({ attempt }), site)) fail();
      await channel.write({ protocol: 1, type: 'result', seq, value: value ?? null });
    }
  } catch {
    fail();
  } finally {
    if (channel) channel.close();
    else io.output.end();
  }
}

function openSsh(file, args, options) {
  const child = spawn(file, args, { ...options, stdio: ['pipe', 'pipe', 'pipe'] });
  // Drain diagnostics without exposing credentials/configuration to the caller.
  child.stderr.resume();
  const completion = new Promise((resolve) => {
    child.once('error', () => {
      child.stdout.destroy();
      child.stdin.destroy();
      resolve({ code: 1 });
    });
    child.once('close', (code, signal) => resolve({ code: signal ? 1 : code }));
  });
  return { input: child.stdout, output: child.stdin, completion };
}

export async function connectFirstCutoverIngressSession(input, overrides = {}) {
  const io = {
    platform: process.platform,
    uid: process.getuid?.(),
    now: Date.now,
    open: openSsh,
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
      !keys(expected, ['binding', 'maintenanceEndsAtMs', 'siteDigest']) ||
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
      const value = await journal.assertOwnership();
      if (!isDeepStrictEqual(value, expected.binding)) fail();
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
    channel = wire(connection.input, connection.output, expected.maintenanceEndsAtMs, io.now);
    const used = new Set();
    const run = async (name, value = null) => {
      const mutation = ['fenceOrders', 'fenceAll', 'restoreIngress'].includes(name);
      if (busy || failed || (mutation && used.has(name))) fail();
      if (mutation) used.add(name);
      busy = true;
      try {
        await ownership();
        const seq = ++sequence;
        await channel.write({ protocol: 1, type: 'operation', seq, name, value });
        let factSequence = 0;
        for (;;) {
          const response = await channel.read();
          if (response.type === 'result') {
            envelope(response, 'result', seq);
            if (!keys(response, ['protocol', 'type', 'seq', 'value'])) fail();
            await ownership();
            const result = response.value;
            if (['fenceOrders', 'fenceAll', 'verifyFence'].includes(name)) {
              const counts = ['existingSockets', 'internalWriters', 'producersRunning'];
              const stage = name === 'fenceOrders' ? 'orders' : 'all-writers';
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
      } catch {
        failed = true;
        channel.close();
        fail();
      } finally {
        busy = false;
      }
    };
    const attached = await run('attach');
    if (!isDeepStrictEqual(attached, { host: 'aliyun', ...expected })) fail();
    return {
      fenceOrders: () => run('fenceOrders'),
      fenceAll: () => run('fenceAll'),
      verifyFence: () => run('verifyFence'),
      restoreIngress: async (identity) => {
        if ((await run('restoreIngress', structuredClone(identity))) !== null) fail();
      },
      readFenceReceipt: async () => (await run('readFenceReceipt')) ?? undefined,
      close: async () => {
        if ((await run('detach')) !== null) fail();
        failed = true;
        channel.close();
        const left = expected.maintenanceEndsAtMs - io.now();
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
  } catch {
    failed = true;
    channel?.close();
    // No signal, retry, new SSH connection, old-config restoration or lock clear.
    connection?.output.end();
    fail();
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
  const reject = () => {
    throw new Error('CUTOVER_INGRESS_PAIR_UNPROVEN');
  };
  let remote;
  try {
    const args = structuredClone(input);
    if (
      !keys(args, ['binding', 'maintenanceEndsAtMs']) ||
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
      if (!Number.isSafeInteger(now) || now < 0 || now < last || now >= args.maintenanceEndsAtMs)
        reject();
      last = now;
      return now;
    };
    const guard = async (phases) => {
      clock();
      if (!isDeepStrictEqual(await journal.assertOwnership(), args.binding)) reject();
      const record = await journal.readFirstCutoverEffects();
      if (
        !bindingKeys.every((k) => record?.[k] === args.binding[k]) ||
        !hash(record.recordDigest) ||
        (revision !== undefined && revision !== record.recordDigest) ||
        (phases && !phases.includes(record.phase)) ||
        !isDeepStrictEqual(await io.readApprovedPair(), scope)
      )
        reject();
      clock();
      return record;
    };
    const initial = await guard(['preflight', 'prepared']);
    revision = initial.recordDigest;
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
      verifyOpenedIdentity: io.verifyOpenedIdentity,
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
        const receipt = await endpoints[host].readFenceReceipt();
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
            reject();
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
      if (busy || closed || (mutation && (failed || used.has(name)))) reject();
      busy = true;
      if (mutation) used.add(name);
      try {
        revision = (await guard(phases)).recordDigest;
        const result = await operation();
        await guard(phases);
        return result;
      } catch {
        failed = true;
        reject();
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
      fenceOrders: () =>
        run('orders', ['orders_fenced'], () => fence('fenceOrders', 'orders'), true),
      fenceAll: () => run('all', ['all_fenced'], () => fence('fenceAll', 'all-writers'), true),
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
      readFenceReceipts: () => run('receipts', undefined, receipts),
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
              const opened = await io.verifyOpenedIdentity(structuredClone(target));
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
  } catch {
    // Detach is not a retry of an uncertain effect, and never clears the lock.
    try {
      await remote?.close();
    } catch {
      /* Preserve the original failure. */
    }
    reject();
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
