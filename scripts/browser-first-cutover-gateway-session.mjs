import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual as equal } from 'node:util';
import {
  createFirstCutoverSessionWire,
  readFirstCutoverGatewaySite,
} from './browser-first-cutover-ingress-session.mjs';
import {
  prepareLocalFirstCutoverGateway,
  retireLocalFirstCutoverGateways,
} from './browser-first-cutover-registrations.mjs';
export { readFirstCutoverGatewaySite };
const fail = () => {
  throw new Error('CUTOVER_GATEWAY_SESSION_UNPROVEN');
};
const keys = (v, k) =>
  v &&
  typeof v === 'object' &&
  !Array.isArray(v) &&
  Object.keys(v).length === k.length &&
  k.every((x) => Object.hasOwn(v, x));
const hash = (v) => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const uuid = (v) =>
  typeof v === 'string' &&
  /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(v);
const bindingKeys = ['attempt', 'candidate', 'configDigest', 'migrationDigest', 'inventoryDigest'];
function validate(v, now) {
  if (
    !keys(v.binding, bindingKeys) ||
    !uuid(v.binding.attempt) ||
    !/^[a-f0-9]{40}$/.test(v.binding.candidate) ||
    !['configDigest', 'migrationDigest', 'inventoryDigest'].every((k) => hash(v.binding[k])) ||
    !hash(v.siteDigest) ||
    !Number.isSafeInteger(now) ||
    now < 0 ||
    !Number.isSafeInteger(v.maintenanceEndsAtMs) ||
    now >= v.maintenanceEndsAtMs
  )
    fail();
}
const factNames = [
  'ownership',
  'effects',
  'read',
  'registered',
  'unmanaged',
  'fence',
  'startupEvent',
  'registrationEvent',
  'retireUnmanaged',
];
const envelope = (v, type, seq) => {
  if (v?.protocol !== 1 || v.type !== type || v.seq !== seq) fail();
};

/** Separate from ingress: the original observer can safely read ingress receipts
 * while a gateway operation is in flight. Only the original coordinator writes
 * its journal. Nested signal requests are permitted solely inside retireUnmanaged. */
export async function serveFirstCutoverGatewaySession({ attempt }, overrides = {}) {
  const io = {
    input: process.stdin,
    output: process.stdout,
    now: Date.now,
    sleep,
    readSite: readFirstCutoverGatewaySite,
    prepare: prepareLocalFirstCutoverGateway,
    retire: retireLocalFirstCutoverGateways,
    ...overrides,
  };
  let channel;
  try {
    if (!uuid(attempt)) fail();
    const site = structuredClone(await io.readSite({ attempt }));
    validate(site, io.now());
    if (site.binding.attempt !== attempt) fail();
    channel = createFirstCutoverSessionWire(io.input, io.output, site.maintenanceEndsAtMs, io.now);
    const used = new Set();
    let sequence = 0;
    for (;;) {
      const request = await channel.read();
      const seq = ++sequence;
      envelope(request, 'operation', seq);
      if (
        !keys(request, ['protocol', 'type', 'seq', 'name', 'value']) ||
        request.value !== null ||
        !['attach', 'prepare', 'retire', 'detach'].includes(request.name) ||
        (seq === 1 ? request.name !== 'attach' : request.name === 'attach') ||
        used.has(request.name)
      )
        fail();
      used.add(request.name);
      if (!equal(await io.readSite({ attempt }), site)) fail();
      let factSequence = 0;
      let signalSequence = 0;
      const fact = async (name, value = null, signal = undefined) => {
        channel.assert();
        if (!equal(await io.readSite({ attempt }), site)) fail();
        const factSeq = ++factSequence;
        await channel.write({ protocol: 1, type: 'fact', seq, factSeq, name, value });
        for (;;) {
          const reply = await channel.read();
          if (reply.type === 'signal') {
            envelope(reply, 'signal', seq);
            if (
              name !== 'retireUnmanaged' ||
              !signal ||
              !keys(reply, ['protocol', 'type', 'seq', 'signalSeq', 'value']) ||
              reply.signalSeq !== ++signalSequence ||
              !reply.value ||
              typeof reply.value !== 'object'
            )
              fail();
            if (!equal(await io.readSite({ attempt }), site)) fail();
            await signal(structuredClone(reply.value));
            await channel.write({
              protocol: 1,
              type: 'signal-result',
              seq,
              signalSeq: reply.signalSeq,
              value: null,
            });
            continue;
          }
          envelope(reply, 'fact-result', seq);
          if (
            !keys(reply, ['protocol', 'type', 'seq', 'factSeq', 'value']) ||
            reply.factSeq !== factSeq
          )
            fail();
          return reply.value;
        }
      };
      let value;
      if (request.name === 'attach') {
        const owner = await fact('ownership');
        if (!equal(owner, site.binding)) fail();
        value = {
          host: 'aliyun',
          binding: site.binding,
          maintenanceEndsAtMs: site.maintenanceEndsAtMs,
          siteDigest: site.siteDigest,
        };
      } else if (request.name === 'detach') {
        await channel.write({ protocol: 1, type: 'result', seq, value: null });
        return;
      } else {
        const hostIO = {
          now: io.now,
          sleep: io.sleep,
          journal: {
            assertOwnership: () => fact('ownership'),
            readFirstCutoverEffects: () => fact('effects'),
            recordStartupEvent: (e) => fact('startupEvent', e),
            recordRegistrationEvent: (e) => fact('registrationEvent', e),
          },
          observer: {
            read: () => fact('read'),
            readRegistrationProgress: (host) => {
              if (host !== 'aliyun') fail();
              return fact('registered');
            },
            readUnmanagedProgress: (host) => {
              if (host !== 'aliyun') fail();
              return fact('unmanaged');
            },
            retireUnmanaged: (args, ops) => {
              if (
                !equal(args, { maintenanceEndsAtMs: site.maintenanceEndsAtMs }) ||
                typeof ops?.signalPinned !== 'function'
              )
                fail();
              return fact('retireUnmanaged', null, ops.signalPinned);
            },
          },
          verifyFence: () => fact('fence'),
        };
        const args = {
          binding: { attempt, inventoryDigest: site.binding.inventoryDigest },
          maintenanceEndsAtMs: site.maintenanceEndsAtMs,
        };
        value =
          request.name === 'prepare'
            ? await io.prepare({ ...args, files: site.startupFiles }, hostIO)
            : await io.retire(args, hostIO);
      }
      channel.assert();
      if (!equal(await io.readSite({ attempt }), site)) fail();
      await channel.write({ protocol: 1, type: 'result', seq, value });
    }
  } catch {
    fail();
  } finally {
    if (channel) channel.close();
    else io.output.end();
  }
}

function open(file, argv, options) {
  const child = spawn(file, argv, { ...options, stdio: ['pipe', 'pipe', 'pipe'] });
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

export async function connectFirstCutoverGatewaySession(input, overrides = {}) {
  const io = {
    platform: process.platform,
    uid: process.getuid?.(),
    now: Date.now,
    sleep,
    open,
    ...overrides,
  };
  let channel;
  let connection;
  let failed = false;
  let busy = false;
  try {
    const expected = structuredClone(input);
    validate(expected, io.now());
    if (
      !keys(expected, ['binding', 'maintenanceEndsAtMs', 'siteDigest']) ||
      io.platform !== 'linux' ||
      io.uid !== 0 ||
      [
        'assertOwnership',
        'readFirstCutoverEffects',
        'recordStartupEvent',
        'recordRegistrationEvent',
      ].some((k) => typeof io.journal?.[k] !== 'function') ||
      ['read', 'readRegistrationProgress', 'readUnmanagedProgress', 'retireUnmanaged'].some(
        (k) => typeof io.observer?.[k] !== 'function',
      ) ||
      typeof io.verifyFence !== 'function'
    )
      fail();
    const ownership = async () => {
      const b = await io.journal.assertOwnership();
      if (!equal(b, expected.binding)) fail();
      return b;
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
        `holaday-cutover-v1 gateway ${expected.binding.attempt}`,
      ],
      { shell: false, env: { PATH: '/usr/sbin:/usr/bin:/sbin:/bin', LANG: 'C' } },
    );
    channel = createFirstCutoverSessionWire(
      connection.input,
      connection.output,
      expected.maintenanceEndsAtMs,
      io.now,
    );
    let sequence = 0;
    const used = new Set();
    const run = async (name) => {
      if (failed || busy || used.has(name)) fail();
      used.add(name);
      busy = true;
      try {
        await ownership();
        const seq = ++sequence;
        let factSequence = 0;
        let signalSequence = 0;
        let unmanagedStarted = false;
        await channel.write({ protocol: 1, type: 'operation', seq, name, value: null });
        const service = async (request, nested = false) => {
          envelope(request, 'fact', seq);
          if (
            !keys(request, ['protocol', 'type', 'seq', 'factSeq', 'name', 'value']) ||
            request.factSeq !== ++factSequence ||
            !factNames.includes(request.name) ||
            (nested && !['ownership', 'effects', 'unmanaged', 'fence'].includes(request.name)) ||
            (!['startupEvent', 'registrationEvent'].includes(request.name) &&
              request.value !== null) ||
            (request.name === 'startupEvent' && name !== 'prepare') ||
            (['registrationEvent', 'retireUnmanaged'].includes(request.name) && name !== 'retire')
          )
            fail();
          await ownership();
          let value;
          switch (request.name) {
            case 'ownership':
              value = await ownership();
              break;
            case 'effects':
              value = await io.journal.readFirstCutoverEffects();
              if (!bindingKeys.every((k) => value?.[k] === expected.binding[k])) fail();
              break;
            case 'read':
              value = await io.observer.read();
              break;
            case 'registered':
              value = await io.observer.readRegistrationProgress('aliyun');
              break;
            case 'unmanaged':
              value = await io.observer.readUnmanagedProgress('aliyun');
              break;
            case 'fence':
              value = await io.verifyFence();
              break;
            case 'startupEvent':
            case 'registrationEvent': {
              const event = request.value;
              if (
                event?.host !== 'aliyun' ||
                event.attempt !== expected.binding.attempt ||
                event.inventoryDigest !== expected.binding.inventoryDigest
              )
                fail();
              await io.journal[
                request.name === 'startupEvent' ? 'recordStartupEvent' : 'recordRegistrationEvent'
              ](event);
              value = null;
              break;
            }
            case 'retireUnmanaged':
              if (unmanagedStarted) fail();
              unmanagedStarted = true;
              value = await io.observer.retireUnmanaged(
                { maintenanceEndsAtMs: expected.maintenanceEndsAtMs },
                {
                  sleep: io.sleep,
                  verifyFence: io.verifyFence,
                  signalPinned: async (target) => {
                    const signalSeq = ++signalSequence;
                    await ownership();
                    await channel.write({
                      protocol: 1,
                      type: 'signal',
                      seq,
                      signalSeq,
                      value: target,
                    });
                    for (;;) {
                      const answer = await channel.read();
                      if (answer.type === 'fact') {
                        await service(answer, true);
                        continue;
                      }
                      envelope(answer, 'signal-result', seq);
                      if (
                        !keys(answer, ['protocol', 'type', 'seq', 'signalSeq', 'value']) ||
                        answer.signalSeq !== signalSeq ||
                        answer.value !== null
                      )
                        fail();
                      await ownership();
                      return;
                    }
                  },
                },
              );
              break;
          }
          await ownership();
          await channel.write({
            protocol: 1,
            type: 'fact-result',
            seq,
            factSeq: request.factSeq,
            value: value ?? null,
          });
        };
        for (;;) {
          const response = await channel.read();
          if (response.type === 'fact') {
            await service(response);
            continue;
          }
          envelope(response, 'result', seq);
          if (!keys(response, ['protocol', 'type', 'seq', 'value'])) fail();
          await ownership();
          const r = response.value;
          if (name === 'attach' && !equal(r, { host: 'aliyun', ...expected })) fail();
          if (name === 'detach' && r !== null) fail();
          if (
            name === 'prepare' &&
            (!keys(r, ['attempt', 'inventoryDigest', 'host', 'phase', 'files']) ||
              !Array.isArray(r.files) ||
              r.files.length !== 2 ||
              r.files.some(
                (f, i) =>
                  !keys(f, ['path', 'beforeDigest', 'afterDigest']) ||
                  f.path !== `/root/.pm2/${i ? 'dump.pm2.bak' : 'dump.pm2'}` ||
                  !(
                    (f.beforeDigest === null && f.afterDigest === null) ||
                    (hash(f.beforeDigest) && hash(f.afterDigest))
                  ),
              ) ||
              !r.files.some((f) => f.beforeDigest !== f.afterDigest))
          )
            fail();
          if (
            name === 'retire' &&
            (!keys(r, [
              'attempt',
              'inventoryDigest',
              'host',
              'phase',
              'observedAtMs',
              'survivors',
              'listeners',
              'unknownLaunchers',
            ]) ||
              !Number.isSafeInteger(r.observedAtMs) ||
              r.observedAtMs < 0 ||
              r.observedAtMs > io.now() ||
              io.now() - r.observedAtMs > 60000 ||
              ['survivors', 'listeners', 'unknownLaunchers'].some(
                (k) => !Array.isArray(r[k]) || r[k].length,
              ))
          )
            fail();
          if (
            ['prepare', 'retire'].includes(name) &&
            (r.attempt !== expected.binding.attempt ||
              r.inventoryDigest !== expected.binding.inventoryDigest ||
              r.host !== 'aliyun' ||
              r.phase !== (name === 'prepare' ? 'startup_prepared' : 'stopped'))
          )
            fail();
          return r;
        }
      } catch {
        failed = true;
        channel.close();
        fail();
      } finally {
        busy = false;
      }
    };
    await run('attach');
    return {
      prepare: () => run('prepare'),
      retire: () => run('retire'),
      close: async () => {
        await run('detach');
        failed = true;
        channel.close();
        const left = expected.maintenanceEndsAtMs - io.now();
        if (left <= 0) fail();
        let timer;
        try {
          const result = await Promise.race([
            connection.completion,
            new Promise((resolve) => {
              timer = setTimeout(() => resolve({ code: 1 }), Math.min(left, 2147483647));
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
    connection?.output.end();
    fail();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.platform !== 'linux' || process.getuid?.() !== 0 || process.argv.length !== 3)
      fail();
    await serveFirstCutoverGatewaySession({ attempt: process.argv[2] });
  } catch {
    process.stderr.write('CUTOVER_GATEWAY_SESSION_UNPROVEN\n');
    process.exitCode = 1;
  }
}
