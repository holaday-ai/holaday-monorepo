import { execFileSync } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { once } from 'node:events';
import { access, mkdtemp, rm } from 'node:fs/promises';
import http from 'node:http';
import { createRequire } from 'node:module';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pino } from 'pino';
import { afterEach, expect, it, vi } from 'vitest';
import { WebSocket, WebSocketServer } from 'ws';
import * as accountAuthentication from '../auth/middleware.js';
import { ExecutionDrain } from '../execution/execution-drain.js';
import { startOwnedOperation, withOperationDispatchScope } from '../execution/owned-operation.js';
import { decodeBrokerBootFrame, encodeBrokerBootFrame } from './broker-boot-protocol.js';
import { BrokerBootSession } from './broker-boot-session.js';
import { BrokerCreateClient } from './broker-client.js';
import {
  decodeBrokerControlFrame,
  encodeBrokerControlFrame,
  preparedBrokerControlDigest,
} from './broker-control-protocol.js';
import { BrokerEgressListener } from './broker-egress-listener.js';
import { BrokerDataConnection } from './broker-endpoints.js';
import type { loadOriginalBrokerNative } from './broker-native-loader.js';
import { BrokerPoolRuntime, type OriginalBrokerGroup } from './broker-pool-runtime.js';
import { BrowserPool } from './browser-pool.js';
import { type VncProxyOptions, createVncProxy } from './vnc-proxy.js';

const seam = vi.hoisted(() => ({ native: undefined as unknown, loads: 0 }));
vi.mock('./broker-native-loader.js', () => ({
  loadOriginalBrokerNative: () => {
    seam.loads++;
    return seam.native;
  },
}));
const candidate = 'a'.repeat(40);
const boot = 'b'.repeat(32);
const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

it('runtime refuses an unproven boot session before any native or business initialization', async () => {
  const drain = new ExecutionDrain();
  drain.open();
  const owner = drain.admit('execution');
  let loads = 0;
  seam.native = {
    get candidate() {
      loads++;
      return candidate;
    },
  };
  await expect(
    BrokerPoolRuntime.open({ drain, owner }, undefined, Object.freeze({}) as BrokerBootSession),
  ).rejects.toThrow();
  expect(loads).toBe(0);
});

// Real NAPI / Unix transport; only the fixed Linux identity/syscall boundary
// uses the existing Darwin fixture. This does not certify production Linux.
async function fixture(mode = 'ok', poolMode = false, dormant = false, deferredControl = false) {
  const directory = await mkdtemp(join(tmpdir(), 'pool-runtime-'));
  const controlPath = join(directory, 'control.sock');
  const egressPath = join(directory, 'egress.sock');
  const peers = new Set<net.Socket>();
  const servers: net.Server[] = [];
  const counts = {
    boots: 0,
    creates: 0,
    controls: 0,
    probes: 0,
    accepted: 0,
    data: 0,
    closedData: 0,
    messages: 0,
    upgrades: 0,
    versions: [] as number[],
  };
  const hooks = {
    beforeDispatch: () => {},
    dataMode: mode,
    controlMode: mode,
    onLog: (_message: string) => {},
  };
  let acceptedResolve!: () => void;
  const accepted = new Promise<void>((resolve) => {
    acceptedResolve = resolve;
  });
  const hold = (socket: net.Socket) => {
    peers.add(socket);
    socket.on('error', () => {});
    socket.on('close', () => peers.delete(socket));
    socket.on('end', () => socket.end());
  };
  const listen = async (path: string, serve: (socket: net.Socket) => void) => {
    const server = net.createServer({ allowHalfOpen: true }, (socket) => {
      hold(socket);
      serve(socket);
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(path, resolve));
  };
  const dataPaths = new Map<string, string>();
  const dataClients: net.Socket[] = [];
  const browserPeers: WebSocket[] = [];
  for (const slot of [0, 1]) {
    const resource = (slot ? '2' : '1').repeat(32);
    const management = Buffer.alloc(32, slot + 3);
    const browser = http.createServer((request, response) => {
      if (request.url !== '/json/version') {
        response.writeHead(404).end();
        return;
      }
      response.setHeader('Connection', 'close');
      response.setHeader('Content-Type', 'application/json');
      response.end(
        JSON.stringify({
          Browser: 'Chrome/130.0.0.0',
          webSocketDebuggerUrl:
            mode === 'wrong-cdp-target'
              ? 'ws://example.invalid/devtools/browser/synthetic'
              : `ws://127.0.0.1:19222/devtools/browser/synthetic-${slot}`,
        }),
      );
    });
    const websocket = new WebSocketServer({ noServer: true });
    browser.on('upgrade', (request, socket, head) => {
      counts.upgrades++;
      if (mode === 'cdp-silent-upgrade' || mode === 'vnc-silent-upgrade') return;
      if (
        (request.url !== (mode.startsWith('vnc') ? '/' : `/devtools/browser/synthetic-${slot}`) &&
          !(mode === 'cdp-pool' && request.url === '/')) ||
        request.headers['x-holaday-cdp']
      ) {
        socket.destroy();
        return;
      }
      websocket.handleUpgrade(request, socket, head, (peer) => {
        browserPeers.push(peer);
        if (mode === 'vnc-greeting') peer.send(Buffer.from('RFB 003.008\n'));
        peer.on('message', (bytes) => {
          counts.messages++;
          if (mode === 'cdp-pool' && request.url !== '/') {
            const message = JSON.parse(bytes.toString());
            let result: object;
            if (message.method === 'Browser.getVersion') {
              counts.versions.push(slot);
              result = {
                protocolVersion: '1.3',
                product: 'Chrome/130.0.0.0',
                revision: 'synthetic',
                userAgent: 'HeadlessChrome/130.0.0.0',
                jsVersion: '12',
              };
            } else if (
              message.method === 'Target.setAutoAttach' ||
              message.method === 'Browser.setDownloadBehavior'
            )
              result = {};
            else if (message.method === 'Target.getTargetInfo')
              result = {
                targetInfo: {
                  targetId: `synthetic-${slot}`,
                  type: 'browser',
                  title: '',
                  url: '',
                  attached: false,
                },
              };
            else {
              peer.send(
                JSON.stringify({
                  id: message.id,
                  error: { code: -32601, message: 'Unsupported synthetic method' },
                }),
              );
              return;
            }
            peer.send(JSON.stringify({ id: message.id, result }));
            return;
          }
          peer.send(
            mode.startsWith('vnc') || request.url === '/'
              ? Buffer.concat([Buffer.from([slot]), Buffer.from(bytes as Buffer)])
              : bytes,
          );
        });
      });
    });
    // Independent RFC5869 Expand fixture: the random management key is the
    // PRK, as specified by the root producer (no additional Extract step).
    const dataKey = createHmac('sha256', management)
      .update('HoladayPool/CDP-VNC/data-key/v1\0')
      .update(Buffer.from(candidate, 'hex'))
      .update(Buffer.from(boot, 'hex'))
      .update(Buffer.from(resource, 'hex'))
      .update(Buffer.from([1]))
      .digest();
    for (const kind of [1, 2]) {
      const path = join(directory, `${slot}-${kind}.sock`);
      dataPaths.set(`/run/holaday-pool-data/${resource}/${kind === 1 ? 'cdp' : 'vnc'}.sock`, path);
      await listen(path, (socket) => {
        counts.data++;
        socket.on('close', () => {
          counts.closedData++;
        });
        if (hooks.dataMode === 'reject-data') {
          socket.end();
          return;
        }
        const frame = (type: number, client = Buffer.alloc(32), tag = Buffer.alloc(0)) => {
          const header = Buffer.concat([
            Buffer.from('HPD1'),
            Buffer.from([type, kind]),
            Buffer.from(candidate, 'hex'),
            Buffer.from(resource, 'hex'),
            Buffer.from(boot, 'hex'),
            Buffer.alloc(32, 7),
            client,
          ]);
          return Buffer.concat([
            header,
            createHmac('sha256', dataKey)
              .update('HoladayPool/data-auth/v1\0')
              .update(header)
              .update(tag)
              .digest(),
          ]);
        };
        if (hooks.dataMode === 'silent-data') return;
        socket.write(frame(1));
        let input = Buffer.alloc(0);
        let authenticated = false;
        const data = (chunk: Buffer) => {
          if (authenticated) {
            socket.write(chunk);
            return;
          }
          input = Buffer.concat([input, chunk]);
          if (input.length < 154) return;
          if (!input.equals(frame(2, input.subarray(90, 122)))) {
            socket.destroy();
            return;
          }
          authenticated = true;
          if (mode.startsWith('cdp') || mode === 'wrong-cdp-target' || mode.startsWith('vnc')) {
            if (mode.startsWith('vnc') && kind !== 2) {
              socket.destroy();
              return;
            }
            socket.write(frame(3, input.subarray(90, 122), input.subarray(122)));
            socket.off('data', data);
            browser.emit('connection', socket);
            return;
          }
          socket.write(
            Buffer.concat([
              frame(3, input.subarray(90, 122), input.subarray(122)),
              Buffer.from(`group-${slot}-kind-${kind}`),
            ]),
          );
        };
        socket.on('data', data);
      });
    }
  }
  const startControl = () =>
    listen(controlPath, (socket) => {
      counts.controls++;
      let input = Buffer.alloc(0);
      let prepared: Buffer;
      let bootTranscript: ReturnType<typeof decodeBrokerBootFrame> | undefined;
      socket.on('data', async (chunk: Buffer) => {
        input = Buffer.concat([input, chunk]);
        if (input.length < 4 || input.length < input.readUInt32BE(0) + 4) return;
        try {
          const phase = JSON.parse(input.subarray(4).toString()).phase;
          if (typeof phase === 'string' && phase.startsWith('boot-')) {
            const message = decodeBrokerBootFrame(input);
            input = Buffer.alloc(0);
            if (message.phase === 'boot-hello' && counts.boots === 0) {
              counts.controls--;
              counts.boots++;
              bootTranscript = {
                ...message,
                phase: 'boot-challenge',
                epoch: 'c'.repeat(32),
                rootNonce: 'e'.repeat(32),
              };
              socket.write(encodeBrokerBootFrame(bootTranscript));
              return;
            }
            if (
              !bootTranscript ||
              !encodeBrokerBootFrame(message).equals(
                encodeBrokerBootFrame({ ...bootTranscript, phase: 'boot-accepted' }),
              )
            )
              throw new Error();
            socket.end(encodeBrokerBootFrame({ ...bootTranscript, phase: 'boot-ack' }));
            return;
          }
          const message = decodeBrokerControlFrame(input);
          input = Buffer.alloc(0);
          if ('action' in message) {
            if (message.action !== 'create') throw new Error();
            counts.creates++;
            const slot = message.slot;
            prepared = encodeBrokerControlFrame({
              version: 2,
              phase: 'prepared',
              candidate,
              boot,
              requestId: message.requestId,
              slot,
              resource: (slot ? '2' : '1').repeat(32),
              capability: Buffer.alloc(32, slot + 3).toString('hex'),
              egressCapability: Buffer.alloc(32, slot + 8).toString('hex'),
              nonce: 'f'.repeat(64),
            });
            socket.write(prepared);
            return;
          }
          if (
            message.phase !== 'accepted' ||
            message.preparedDigest !== preparedBrokerControlDigest(prepared)
          )
            throw new Error();
          counts.accepted++;
          acceptedResolve();
          // Actual HPE1 observation must work before ready. Omitting synchronous
          // runtime egress registration prevents the root from completing create.
          const probe = net.connect(egressPath);
          hold(probe);
          const request = Buffer.concat([
            Buffer.from('HPE1'),
            Buffer.from([1]),
            Buffer.from(candidate, 'hex'),
            Buffer.from(message.resource, 'hex'),
            Buffer.from(boot, 'hex'),
            Buffer.alloc(32, 9),
          ]);
          probe.write(request);
          const [reply] = await once(probe, 'data');
          const expected = Buffer.from(request);
          expected[4] = 2;
          if (!reply.equals(expected)) throw new Error();
          counts.probes++;
          probe.end();
          if (hooks.controlMode === 'hold-ready') return;
          if (mode === 'drop-ready') {
            socket.destroy();
            return;
          }
          socket.end(encodeBrokerControlFrame({ ...message, phase: 'ready' }));
        } catch {
          socket.destroy();
        }
      });
    });
  if (!deferredControl) await startControl();
  const base = join(process.cwd(), '../../scripts/pool-broker');
  const build = (name: 'egress' | 'control', path: string) => {
    const output = join(directory, `${name}.node`);
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
        `-D${name === 'egress' ? 'HE' : 'HC'}_TEST_PATH=${JSON.stringify(path)}`,
        join(base, `${name}_native_core.c`),
        join(base, `${name}_native_napi.c`),
        join(base, `tests-fixtures/${name}_native_socket.c`),
        '-o',
        output,
      ],
      { timeout: 20_000, maxBuffer: 65536 },
    );
    return createRequire(import.meta.url)(output);
  };
  seam.native = {
    candidate,
    boot,
    egress: build('egress', egressPath),
    control: build('control', controlPath),
  } satisfies ReturnType<typeof loadOriginalBrokerNative>;
  const loadsBefore = seam.loads;
  const bootSession = BrokerBootSession.start();
  if (deferredControl) {
    await new Promise((resolve) => setTimeout(resolve, 45));
    expect(counts).toMatchObject({ boots: 0, creates: 0 });
    await startControl();
  }
  await bootSession.ready;
  expect(seam.loads - loadsBefore).toBe(1);
  cleanup.push(async () => {
    await bootSession.close();
  });
  const originalConnect = net.Socket.prototype.connect;
  vi.spyOn(net.Socket.prototype, 'connect').mockImplementation(function (
    this: net.Socket,
    ...args: unknown[]
  ) {
    const first = args[0] as { path?: string };
    const replacement = typeof first === 'object' && first.path && dataPaths.get(first.path);
    if (replacement) dataClients.push(this);
    return Reflect.apply(
      originalConnect,
      this,
      replacement ? [{ ...first, path: replacement }] : args,
    );
  } as typeof net.Socket.prototype.connect);
  const drain = new ExecutionDrain(1024, () => hooks.beforeDispatch());
  drain.open();
  const owner = drain.admit('execution');
  const release = drain.pin(owner);
  cleanup.push(async () => {
    for (const socket of peers) socket.destroy();
    for (const server of servers)
      await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
    release();
  });
  const baseDir = join(directory, 'legacy-must-not-exist');
  if (poolMode) vi.stubEnv('STEALTH_ENABLED', 'false');
  const runtime = poolMode
    ? undefined
    : await BrokerPoolRuntime.open({ drain, owner }, undefined, bootSession);
  const pool = poolMode
    ? await (dormant ? BrowserPool.dormantStrict : BrowserPool.openStrict)(
        {
          maxInstances: 2,
          idleTimeoutMs: 300000,
          baseDir,
          cdpPortStart: 9300,
          vncPortStart: 5910,
          wsPortStart: 6090,
          displayStart: 100,
          screenSize: '1280x800x24',
          vncEnabled: true,
        },
        pino(
          {
            level: 'info',
            hooks: {
              logMethod(args, method) {
                if (typeof args[1] === 'string') hooks.onLog(args[1]);
                method.apply(this, args);
              },
            },
          },
          { write() {} },
        ),
        { drain, owner },
        bootSession,
      )
    : undefined;
  cleanup.push(async () => {
    await runtime?.close().catch(() => {});
    await pool?.shutdown().catch(() => {});
  });
  const flushControl = async () => {
    const marker = net.connect(controlPath);
    hold(marker);
    const closed = once(marker, 'close');
    await once(marker, 'connect');
    marker.end();
    await closed;
  };
  const flushData = async () => {
    const marker = net.connect(join(directory, '0-1.sock'));
    hold(marker);
    marker.resume();
    const closed = once(marker, 'close');
    await once(marker, 'connect');
    marker.end();
    await closed;
  };
  return {
    get runtime() {
      if (!runtime) throw new Error('Expected the original runtime fixture');
      return runtime;
    },
    get pool() {
      if (!pool) throw new Error('Expected the original strict pool fixture');
      return pool;
    },
    baseDir,
    bootSession,
    owner,
    drain,
    counts,
    accepted,
    hooks,
    flushControl,
    flushData,
    dataClients,
    browserPeers,
    startControl,
  };
}

it('dormant strict pool initializes once inside the original admitted allocation scope', async () => {
  const opening = vi.spyOn(BrokerPoolRuntime, 'open');
  const f = await fixture('cdp-pool', true, true);
  expect(opening).not.toHaveBeenCalled();
  await expect(access(f.baseDir)).rejects.toThrow();
  await expect(f.pool.allocate('outside', 'synthetic-user')).rejects.toThrow();
  expect(opening).not.toHaveBeenCalled();
  const operation = startOwnedOperation(
    f.drain,
    'request',
    async () =>
      Promise.all([
        f.pool.allocate('dormant-a', 'synthetic-user'),
        f.pool.allocate('dormant-b', 'synthetic-user'),
      ]),
    { parent: f.owner, errorOutcome: 'unknown' },
  );
  const [first, second] = await operation.result;
  expect(first).not.toBe(second);
  expect(opening).toHaveBeenCalledTimes(1);
  expect(f.pool.peek('dormant-a')).toBe(first);
  expect(f.pool.peek('dormant-b')).toBe(second);
  await expect(access(f.baseDir)).rejects.toThrow();
});

it('dormant strict pool shutdown waits for the original initializer and denies its late IO', async () => {
  const f = await fixture('cdp-pool', true, true);
  const original = BrokerPoolRuntime.open;
  let entered!: () => void;
  const waiting = new Promise<void>((resolve) => {
    entered = resolve;
  });
  let finish!: () => void;
  const gate = new Promise<void>((resolve) => {
    finish = resolve;
  });
  vi.spyOn(BrokerPoolRuntime, 'open').mockImplementation(async (...args) => {
    entered();
    await gate;
    return original(...args);
  });
  const operation = startOwnedOperation(
    f.drain,
    'request',
    async () => f.pool.allocate('late-start', 'synthetic-user'),
    { parent: f.owner, errorOutcome: 'unknown' },
  );
  const rejected = expect(operation.result).rejects.toThrow();
  await waiting;
  let stopped = false;
  const closing = f.pool.shutdown().then(() => {
    stopped = true;
  });
  await Promise.resolve();
  expect(stopped).toBe(false);
  finish();
  await rejected;
  await closing;
  expect(f.counts.creates).toBe(0);
  expect(f.pool.canAllocate()).toBe(false);
});

it('dormant strict pool does not retry a failed initializer when egress support later returns', async () => {
  const f = await fixture('cdp-pool', true, true);
  const opening = vi.spyOn(BrokerPoolRuntime, 'open');
  const starting = vi
    .spyOn(BrokerEgressListener.prototype, 'start')
    .mockRejectedValue(new Error('synthetic egress failure'));
  const allocate = () =>
    startOwnedOperation(
      f.drain,
      'request',
      async () => f.pool.allocate('failed-start', 'synthetic-user'),
      { parent: f.owner, errorOutcome: 'unknown' },
    ).result;
  try {
    await expect(allocate()).rejects.toThrow();
  } finally {
    starting.mockRestore();
  }
  await expect(allocate()).rejects.toThrow();
  expect(opening).toHaveBeenCalledTimes(1);
  expect(f.counts.creates).toBe(0);
});

it('dormant strict pool retains the initiating scope veto through asynchronous startup', async () => {
  const f = await fixture('cdp-pool', true, true);
  const original = BrokerPoolRuntime.open;
  let entered!: () => void;
  const waiting = new Promise<void>((resolve) => {
    entered = resolve;
  });
  let finish!: () => void;
  const gate = new Promise<void>((resolve) => {
    finish = resolve;
  });
  vi.spyOn(BrokerPoolRuntime, 'open').mockImplementation(async (...args) => {
    entered();
    await gate;
    return original(...args);
  });
  let revoke!: () => void;
  const operation = startOwnedOperation(
    f.drain,
    'request',
    async () =>
      withOperationDispatchScope((seal) => {
        revoke = seal;
        return f.pool.allocate('revoked-start', 'synthetic-user');
      }),
    { parent: f.owner, errorOutcome: 'unknown' },
  );
  const rejected = expect(operation.result).rejects.toThrow();
  await waiting;
  revoke();
  finish();
  await rejected;
  expect(f.counts.creates).toBe(0);
  expect(f.pool.canAllocate()).toBe(false);
});

it('dormant strict pool release owns the task before initialization can finish', async () => {
  const f = await fixture('cdp-pool', true, true);
  const original = BrokerPoolRuntime.open;
  let entered!: () => void;
  const waiting = new Promise<void>((resolve) => {
    entered = resolve;
  });
  let finish!: () => void;
  const gate = new Promise<void>((resolve) => {
    finish = resolve;
  });
  vi.spyOn(BrokerPoolRuntime, 'open').mockImplementation(async (...args) => {
    entered();
    await gate;
    return original(...args);
  });
  const operation = startOwnedOperation(
    f.drain,
    'request',
    async () => f.pool.allocate('released-start', 'synthetic-user'),
    { parent: f.owner, errorOutcome: 'unknown' },
  );
  await waiting;
  let released = false;
  const closing = f.pool.release('released-start').then((value) => {
    released = true;
    return value;
  });
  await Promise.resolve();
  const returnedEarly = released;
  finish();
  const [allocation, release] = await Promise.allSettled([operation.result, closing]);
  expect(returnedEarly).toBe(false);
  expect(allocation.status).toBe('rejected');
  expect(release).toEqual({ status: 'fulfilled', value: true });
  expect(f.counts.creates).toBe(0);
});

it('dormant strict pool cannot reuse initialization revoked by its final dispatch callback', async () => {
  const f = await fixture('cdp-pool', true, true);
  const original = BrokerPoolRuntime.open;
  let revoke!: () => void;
  let revoked = false;
  vi.spyOn(BrokerPoolRuntime, 'open').mockImplementation(async (...args) => {
    const runtime = await original(...args);
    f.hooks.beforeDispatch = () => {
      f.hooks.beforeDispatch = () => {};
      revoked = true;
      revoke();
    };
    return runtime;
  });
  const first = startOwnedOperation(
    f.drain,
    'request',
    async () =>
      withOperationDispatchScope((seal) => {
        revoke = seal;
        return f.pool.allocate('first-revoked', 'synthetic-user');
      }),
    { parent: f.owner, errorOutcome: 'unknown' },
  );
  await expect(first.result).rejects.toThrow();
  expect(revoked).toBe(true);
  const second = startOwnedOperation(
    f.drain,
    'request',
    async () => f.pool.allocate('second-after-revocation', 'synthetic-user'),
    { parent: f.owner, errorOutcome: 'unknown' },
  );
  await expect(second.result).rejects.toThrow();
  expect(f.counts.creates).toBe(0);
});

it('dormant strict pool cancellation of a waiting second task does not cancel the first', async () => {
  const f = await fixture('cdp-pool', true, true);
  const shutdown = vi.spyOn(f.pool, 'shutdown');
  const original = BrokerPoolRuntime.open;
  let entered!: () => void;
  const waiting = new Promise<void>((resolve) => {
    entered = resolve;
  });
  let finish!: () => void;
  const gate = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const opening = vi.spyOn(BrokerPoolRuntime, 'open').mockImplementation(async (...args) => {
    entered();
    await gate;
    return original(...args);
  });
  const allocate = (task: string, errorOutcome: 'known' | 'unknown' = 'unknown') =>
    startOwnedOperation(f.drain, 'request', async () => f.pool.allocate(task, 'synthetic-user'), {
      parent: f.owner,
      errorOutcome,
    }).result;
  const first = allocate('first-valid');
  await waiting;
  // This synthetic root has no prior DB/remote work and is cancelled before
  // create. Isolate cancellation from the intentional global unknown veto.
  const second = allocate('second-cancelled', 'known');
  await Promise.resolve();
  const closing = f.pool.release('second-cancelled');
  finish();
  const outcomes = await Promise.allSettled([first, second, closing]);
  expect(outcomes.map((item) => item.status)).toEqual(['fulfilled', 'rejected', 'fulfilled']);
  expect(shutdown).not.toHaveBeenCalled();
  expect(f.counts.creates).toBe(1);
  expect(opening).toHaveBeenCalledTimes(1);
  expect(f.pool.canAllocate()).toBe(true);
});

it('dormant strict pool remains usable by a new task after its completed initiating scope is sealed', async () => {
  const f = await fixture('cdp-pool', true, true);
  const opening = vi.spyOn(BrokerPoolRuntime, 'open');
  const first = startOwnedOperation(
    f.drain,
    'request',
    async () =>
      withOperationDispatchScope(async (seal) => {
        const instance = await f.pool.allocate('completed-initiator', 'synthetic-user');
        seal();
        return instance;
      }),
    { parent: f.owner, errorOutcome: 'unknown' },
  );
  await first.result;
  const second = startOwnedOperation(
    f.drain,
    'request',
    async () => f.pool.allocate('new-original-task', 'synthetic-user'),
    { parent: f.owner, errorOutcome: 'unknown' },
  );
  await second.result;
  expect(f.counts.creates).toBe(2);
  expect(opening).toHaveBeenCalledTimes(1);
});

async function formalVnc(pool: BrowserPool, options: Partial<VncProxyOptions> = {}) {
  const server = http.createServer();
  const sockets = new Set<net.Socket>();
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('error', () => {});
    socket.once('close', () => sockets.delete(socket));
  });
  const proxy = createVncProxy({
    pool,
    logger: pino({ level: 'silent' }),
    authenticateToken: async () => 'synthetic-user',
    revalidateSession: async () => true,
    ...options,
  });
  server.on('upgrade', proxy.handleUpgrade);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as net.AddressInfo).port;
  const clients: WebSocket[] = [];
  cleanup.push(async () => {
    for (const client of clients) client.terminate();
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  const connect = (target = 'tsk_synthetic_vnc') => {
    const client = new WebSocket(`ws://127.0.0.1:${port}/vnc-ws/${target}?token=synthetic`, [
      'binary',
    ]);
    clients.push(client);
    client.on('error', () => {});
    return client;
  };
  return { connect, port, sockets };
}

it('formal strict VNC ingress closes raw IO but keeps shutdown pending for initial authentication', async () => {
  const f = await fixture('cdp-pool', true);
  let entered!: () => void;
  const authenticating = new Promise<void>((resolve) => {
    entered = resolve;
  });
  let complete!: (value: string | null) => void;
  const auth = new Promise<string | null>((resolve) => {
    complete = resolve;
  });
  const front = await formalVnc(f.pool, {
    authenticateToken: () => {
      entered();
      return auth;
    },
  });
  const client = front.connect();
  const closed = new Promise<void>((resolve) => client.once('close', () => resolve()));
  await authenticating;
  let stopped = false;
  const shutdown = f.pool.shutdown().then(() => {
    stopped = true;
  });
  try {
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(stopped).toBe(false);
    expect(client.readyState).toBe(WebSocket.CLOSED);
    expect(f.counts.data).toBe(0);
  } finally {
    complete(null);
    await shutdown;
    client.terminate();
    await closed;
  }
});

it('formal strict VNC ingress carries authenticated binary frames through the private group', async () => {
  const f = await fixture('cdp-pool', true);
  await startOwnedOperation(
    f.drain,
    'request',
    () => f.pool.allocate('tsk_synthetic_vnc', 'synthetic-user'),
    {
      parent: f.owner,
      errorOutcome: 'known',
    },
  ).result;
  const front = await formalVnc(f.pool);
  const client = front.connect();
  await once(client, 'open');
  const reply = once(client, 'message');
  client.send(Buffer.from([7, 8, 9]));
  expect(Buffer.from((await reply)[0])).toEqual(Buffer.from([0, 7, 8, 9]));
});

it('formal strict VNC ingress denies a late successful authentication after original deadline', async () => {
  const f = await fixture('cdp-pool', true);
  let entered!: () => void;
  const authenticating = new Promise<void>((resolve) => {
    entered = resolve;
  });
  let complete!: (value: string | null) => void;
  const auth = new Promise<string | null>((resolve) => {
    complete = resolve;
  });
  const front = await formalVnc(f.pool, {
    authenticateToken: () => {
      entered();
      return auth;
    },
  });
  const client = front.connect();
  await authenticating;
  const originalNow = performance.now.bind(performance);
  const clock = vi.spyOn(performance, 'now').mockImplementation(() => originalNow() + 6000);
  try {
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(client.readyState).toBe(WebSocket.CLOSED);
    expect(f.counts.data).toBe(0);
  } finally {
    complete('synthetic-user');
    clock.mockRestore();
    await f.pool.shutdown();
  }
});

it('formal strict VNC ingress bounds raw early bytes while initial authentication is pending', async () => {
  const f = await fixture('cdp-pool', true);
  let entered!: () => void;
  const authenticating = new Promise<void>((resolve) => {
    entered = resolve;
  });
  let complete!: (value: string | null) => void;
  const auth = new Promise<string | null>((resolve) => {
    complete = resolve;
  });
  const front = await formalVnc(f.pool, {
    authenticateToken: () => {
      entered();
      return auth;
    },
  });
  const client = net.connect(front.port, '127.0.0.1');
  client.on('error', () => {});
  client.resume();
  await once(client, 'connect');
  client.write(
    'GET /vnc-ws/tsk_synthetic_vnc?token=synthetic HTTP/1.1\r\nHost: localhost\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: c3ludGhldGljLW5vbmNlIQ==\r\nSec-WebSocket-Protocol: binary\r\n\r\n',
  );
  await authenticating;
  try {
    client.write(Buffer.alloc(65537, 1));
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(client.destroyed).toBe(true);
    expect(f.counts.data).toBe(0);
  } finally {
    complete(null);
    client.destroy();
    await f.pool.shutdown();
  }
});

it('formal strict VNC ingress caps pending authentication before the 65th provider dispatch', async () => {
  const f = await fixture('cdp-pool', true);
  let calls = 0;
  let complete!: (value: string | null) => void;
  const auth = new Promise<string | null>((resolve) => {
    complete = resolve;
  });
  const front = await formalVnc(f.pool, {
    authenticateToken: () => {
      calls++;
      return auth;
    },
  });
  const clients = Array.from({ length: 64 }, () => front.connect());
  try {
    await vi.waitFor(() => expect(calls).toBe(64));
    const excess = front.connect();
    await vi.waitFor(() => expect(excess.readyState).toBe(WebSocket.CLOSED));
    expect(calls).toBe(64);
    expect(clients.every((client) => client.readyState === WebSocket.CONNECTING)).toBe(true);
    expect(f.counts.data).toBe(0);
  } finally {
    complete(null);
    await f.pool.shutdown();
  }
});

it('formal strict VNC ingress never dispatches a late authentication after frontend disconnect', async () => {
  const f = await fixture('cdp-pool', true);
  let entered = false;
  let complete!: (value: string | null) => void;
  const auth = new Promise<string | null>((resolve) => {
    complete = resolve;
  });
  const front = await formalVnc(f.pool, {
    authenticateToken: () => {
      entered = true;
      return auth;
    },
  });
  const client = front.connect();
  await vi.waitFor(() => expect(entered).toBe(true));
  client.terminate();
  await vi.waitFor(() => expect(client.readyState).toBe(WebSocket.CLOSED));
  let stopped = false;
  const closing = f.pool.shutdown().then(() => {
    stopped = true;
  });
  try {
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(stopped).toBe(false);
  } finally {
    complete('synthetic-user');
    await closing;
  }
  expect(f.counts.data).toBe(0);
});

for (const denied of [
  'no-session',
  'other-user',
  'outside-canary',
  'account-revoked',
  'bad-encoding',
]) {
  it(`formal strict VNC ingress rejects ${denied} without dispatching a private upstream`, async () => {
    const f = await fixture('cdp-pool', true);
    await startOwnedOperation(
      f.drain,
      'request',
      () => f.pool.allocate('tsk_synthetic_vnc', 'synthetic-user'),
      {
        parent: f.owner,
        errorOutcome: 'known',
      },
    ).result;
    const before = f.counts.data;
    const front = await formalVnc(f.pool, {
      authenticateToken: async () =>
        denied === 'no-session'
          ? null
          : denied === 'other-user'
            ? 'synthetic-other'
            : 'synthetic-user',
      allowedUserIds: new Set(
        denied === 'outside-canary' ? [] : ['synthetic-user', 'synthetic-other'],
      ),
      revalidateSession: async () => denied !== 'account-revoked',
    });
    const client = front.connect(denied === 'bad-encoding' ? '%ZZ' : 'tsk_synthetic_vnc');
    await vi.waitFor(() => expect(client.readyState).toBe(WebSocket.CLOSED));
    expect(f.counts.data).toBe(before);
  });
}

it('formal strict VNC ingress revokes an established session when its live canary membership is removed', async () => {
  const f = await fixture('cdp-pool', true);
  await startOwnedOperation(
    f.drain,
    'request',
    () => f.pool.allocate('tsk_synthetic_vnc', 'synthetic-user'),
    {
      parent: f.owner,
      errorOutcome: 'known',
    },
  ).result;
  const allowedUserIds = new Set(['synthetic-user']);
  const front = await formalVnc(f.pool, { allowedUserIds });
  const client = front.connect();
  await once(client, 'open');
  allowedUserIds.clear();
  await vi.waitFor(() => expect(client.readyState).toBe(WebSocket.CLOSED));
});

it('formal strict VNC ingress hands early masked frames to the original session once', async () => {
  const f = await fixture('cdp-pool', true);
  await startOwnedOperation(
    f.drain,
    'request',
    () => f.pool.allocate('tsk_synthetic_vnc', 'synthetic-user'),
    {
      parent: f.owner,
      errorOutcome: 'known',
    },
  ).result;
  let entered = false;
  let complete!: (value: string | null) => void;
  const auth = new Promise<string | null>((resolve) => {
    complete = resolve;
  });
  const front = await formalVnc(f.pool, {
    authenticateToken: () => {
      entered = true;
      return auth;
    },
  });
  const client = net.connect(front.port, '127.0.0.1');
  client.on('error', () => {});
  let input = Buffer.alloc(0);
  client.on('data', (bytes) => {
    input = Buffer.concat([input, bytes]);
  });
  await once(client, 'connect');
  const request = Buffer.from(
    'GET /vnc-ws/tsk_synthetic_vnc?token=synthetic HTTP/1.1\r\nHost: localhost\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: c3ludGhldGljLW5vbmNlIQ==\r\nSec-WebSocket-Protocol: binary\r\n\r\n',
  );
  // Independently encoded RFC6455 masked binary [7,8,9], mask [1,2,3,4].
  const frame = Buffer.from([0x82, 0x83, 1, 2, 3, 4, 6, 10, 10]);
  client.write(Buffer.concat([request, frame]));
  try {
    await vi.waitFor(() => expect(entered).toBe(true));
    complete('synthetic-user');
    const expected = Buffer.from([0x82, 4, 0, 7, 8, 9]);
    await vi.waitFor(() => expect(input.includes(expected)).toBe(true));
    expect(input.toString('latin1').startsWith('HTTP/1.1 101')).toBe(true);
    expect(input.indexOf(expected, input.indexOf(expected) + 1)).toBe(-1);
  } finally {
    complete(null);
    client.destroy();
  }
});

it('formal strict VNC ingress keeps the first deadline through the session authorization handoff', async () => {
  const f = await fixture('cdp-pool', true);
  await startOwnedOperation(
    f.drain,
    'request',
    () => f.pool.allocate('tsk_synthetic_vnc', 'synthetic-user'),
    {
      parent: f.owner,
      errorOutcome: 'known',
    },
  ).result;
  let entered = false;
  let complete!: (value: string | null) => void;
  const auth = new Promise<string | null>((resolve) => {
    complete = resolve;
  });
  let revalidating = false;
  let finish!: (value: boolean) => void;
  const revalidation = new Promise<boolean>((resolve) => {
    finish = resolve;
  });
  const front = await formalVnc(f.pool, {
    authenticateToken: () => {
      entered = true;
      return auth;
    },
    revalidateSession: () => {
      revalidating = true;
      return revalidation;
    },
  });
  const client = front.connect();
  await vi.waitFor(() => expect(entered).toBe(true));
  const before = f.counts.data;
  const originalNow = performance.now.bind(performance);
  let offset = 4500;
  const clock = vi.spyOn(performance, 'now').mockImplementation(() => originalNow() + offset);
  try {
    complete('synthetic-user');
    await vi.waitFor(() => expect(revalidating).toBe(true));
    offset = 5500;
    await vi.waitFor(() => expect(client.readyState).toBe(WebSocket.CLOSED));
    expect(f.counts.data).toBe(before);
  } finally {
    complete(null);
    finish(true);
    clock.mockRestore();
  }
});

it('formal strict VNC ingress uses the versioned account provider without replaying a short-lived token', async () => {
  const f = await fixture('cdp-pool', true);
  await startOwnedOperation(
    f.drain,
    'request',
    () => f.pool.allocate('tsk_synthetic_vnc', 'synthetic-user'),
    {
      parent: f.owner,
      errorOutcome: 'known',
    },
  ).result;
  // Only the external account/JWT database boundary is synthetic. The formal
  // proxy, pool, original session, native data transport and WS are real.
  const authenticate = vi
    .spyOn(accountAuthentication, 'authenticateStreamOrAccessSession')
    .mockResolvedValueOnce({ userId: 'synthetic-user', authVersion: 17 })
    .mockResolvedValue(null);
  let revoked = false;
  vi.spyOn(accountAuthentication, 'revalidateAuthenticatedSession').mockImplementation(
    async (_db, session) =>
      !revoked && session.userId === 'synthetic-user' && session.authVersion === 17,
  );
  const front = await formalVnc(f.pool, {
    authenticateToken: undefined,
    revalidateSession: undefined,
  });
  const client = front.connect();
  await once(client, 'open');
  revoked = true;
  const originalNow = performance.now.bind(performance);
  const clock = vi.spyOn(performance, 'now').mockImplementation(() => originalNow() + 21000);
  try {
    await vi.waitFor(() => expect(client.readyState).toBe(WebSocket.CLOSED));
    expect(authenticate).toHaveBeenCalledTimes(1);
  } finally {
    clock.mockRestore();
  }
});

for (const roundTrip of [false, true]) {
  it(`formal strict VNC ingress refuses adoption during authorization handoff (roundTrip=${roundTrip})`, async () => {
    const f = await fixture('cdp-pool', true);
    const instance = await startOwnedOperation(
      f.drain,
      'request',
      () => f.pool.allocate('tsk_synthetic_vnc', 'synthetic-user'),
      {
        parent: f.owner,
        errorOutcome: 'known',
      },
    ).result;
    const originalPeek = f.pool.peek.bind(f.pool);
    let changed = false;
    vi.spyOn(f.pool, 'peek').mockImplementation((task) => {
      const found = originalPeek(task);
      if (task === 'tsk_synthetic_vnc' && !changed) {
        changed = true;
        queueMicrotask(() => {
          f.pool.retain('tsk_synthetic_vnc', 60000);
          f.pool.adoptRetained('tsk_synthetic_vnc', 'tsk_synthetic_next', 'synthetic-user');
          if (roundTrip) {
            f.pool.retain('tsk_synthetic_next', 60000);
            f.pool.adoptRetained('tsk_synthetic_next', 'tsk_synthetic_vnc', 'synthetic-user');
          }
        });
      }
      return found;
    });
    const before = f.counts.data;
    const front = await formalVnc(f.pool);
    const client = front.connect();
    await vi.waitFor(() => expect(changed).toBe(true));
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(instance.taskId).toBe(roundTrip ? 'tsk_synthetic_vnc' : 'tsk_synthetic_next');
    expect(f.counts.data).toBe(before);
    expect(client.readyState).toBe(WebSocket.CLOSED);
  });
}

for (const direction of ['client', 'framebuffer']) {
  it(`formal strict VNC ingress renews only its original retained task on ${direction} activity`, async () => {
    const f = await fixture('cdp-pool', true);
    const instance = await startOwnedOperation(
      f.drain,
      'request',
      () => f.pool.allocate('tsk_synthetic_vnc', 'synthetic-user'),
      {
        parent: f.owner,
        errorOutcome: 'known',
      },
    ).result;
    const front = await formalVnc(f.pool);
    const client = front.connect();
    await once(client, 'open');
    const base = Date.now();
    f.pool.retain(instance.taskId, 10000);
    const previous = instance.retainedUntil ?? 0;
    const clock = vi.spyOn(Date, 'now').mockReturnValue(base + 2000);
    try {
      const message = once(client, 'message');
      if (direction === 'client') client.send(Buffer.from([42]));
      else f.browserPeers.at(-1)?.send(Buffer.from([42]));
      await message;
      expect(instance.retainedUntil).toBeGreaterThan(previous);
      clock.mockReturnValue(base + 11000);
      await new Promise((resolve) => setTimeout(resolve, 60));
      expect(f.pool.peek(instance.taskId) === instance).toBe(true);
      expect(client.readyState).toBe(WebSocket.OPEN);
    } finally {
      clock.mockRestore();
    }
  });
}

it('formal strict VNC ingress vetoes a frame when canary is revoked at the final transport clock', async () => {
  const f = await fixture('cdp-pool', true);
  await startOwnedOperation(
    f.drain,
    'request',
    () => f.pool.allocate('tsk_synthetic_vnc', 'synthetic-user'),
    {
      parent: f.owner,
      errorOutcome: 'known',
    },
  ).result;
  const allowedUserIds = new Set(['synthetic-user']);
  const front = await formalVnc(f.pool, { allowedUserIds });
  const client = front.connect();
  await once(client, 'open');
  const raw = [...front.sockets][0];
  if (!raw) throw new Error('missing synthetic original socket');
  let clocks = 0;
  let revoked = false;
  let dispatched = 0;
  let frames = 0;
  const previousStackLimit = Error.stackTraceLimit;
  Error.stackTraceLimit = 50;
  client.on('message', () => {
    frames++;
  });
  const originalWrite = raw.write;
  vi.spyOn(raw, 'write').mockImplementation(function (this: net.Socket, ...args: unknown[]) {
    if (revoked) dispatched++;
    return Reflect.apply(originalWrite, this, args);
  } as typeof raw.write);
  const originalNow = performance.now.bind(performance);
  const clock = vi.spyOn(performance, 'now').mockImplementation(() => {
    const now = originalNow();
    const stack = new Error().stack ?? '';
    // FrontSocket's one guard checks ingress both before and after its own
    // clock. Revoke in the latter ingress clock, immediately before raw write.
    if (
      !revoked &&
      stack.includes('FrontSocket._write') &&
      stack.includes('broker-vnc-ingress.ts') &&
      ++clocks === 2
    ) {
      revoked = true;
      allowedUserIds.clear();
    }
    return now;
  });
  try {
    f.browserPeers.at(-1)?.send(Buffer.from([42]));
    await vi.waitFor(() => expect(revoked).toBe(true));
    await vi.waitFor(() => expect(client.readyState).toBe(WebSocket.CLOSED));
    expect(dispatched).toBe(0);
    expect(frames).toBe(0);
  } finally {
    clock.mockRestore();
    Error.stackTraceLimit = previousStackLimit;
  }
});

it('formal strict VNC ingress does not renew retained leases from polling or ping frames', async () => {
  const f = await fixture('cdp-pool', true);
  const instance = await startOwnedOperation(
    f.drain,
    'request',
    () => f.pool.allocate('tsk_synthetic_vnc', 'synthetic-user'),
    {
      parent: f.owner,
      errorOutcome: 'known',
    },
  ).result;
  const front = await formalVnc(f.pool);
  const client = front.connect();
  await once(client, 'open');
  f.pool.retain(instance.taskId, 10000);
  const before = instance.retainedUntil;
  const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 2000);
  try {
    const pong = once(client, 'pong');
    client.ping(Buffer.from([1]));
    await pong;
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(instance.retainedUntil).toBe(before);
  } finally {
    clock.mockRestore();
  }
});

it('strict Pool binds two real groups to actual SDK consumers without legacy paths or port DTOs', async () => {
  const f = await fixture('cdp-pool', true);
  const allocate = (id: string) =>
    startOwnedOperation(f.drain, 'request', () => f.pool.allocate(id, 'synthetic-user'), {
      parent: f.owner,
      errorOutcome: 'known',
    }).result;
  const first = await allocate('tsk_synthetic_first');
  const second = await allocate('tsk_synthetic_second');
  expect(f.counts.versions).toEqual([0, 1]);
  expect(first.executor === second.executor).toBe(false);
  expect(first.cdpPort).toBeUndefined();
  expect(first.wsPort).toBeUndefined();
  expect(first.bravePid).toBeUndefined();
  expect(f.pool.canAllocate()).toBe(false);
  await expect(access(f.baseDir)).rejects.toThrow();
  await expect(f.pool.release(first.taskId)).rejects.toThrow('POOL_GROUP_EXIT_UNPROVEN');
  expect(f.pool.stats().idle).toBe(0);
  expect(f.pool.peek(second.taskId) === second).toBe(true);
});

it('strict Pool refuses allocation without an original operation and never falls back to spawn', async () => {
  const f = await fixture('cdp-pool', true);
  await expect(f.pool.allocate('tsk_synthetic', 'synthetic-user')).rejects.toThrow();
  await f.flushControl();
  expect(f.counts.creates).toBe(0);
  expect(f.pool.stats().idle).toBe(2);
  await expect(access(f.baseDir)).rejects.toThrow();
});

it('strict Pool VNC uses only the original private instance and revokes an old task session on adoption', async () => {
  const f = await fixture('cdp-pool', true);
  const instance = await startOwnedOperation(
    f.drain,
    'request',
    () => f.pool.allocate('tsk_synthetic', 'synthetic-user'),
    { parent: f.owner, errorOutcome: 'known' },
  ).result;
  const frontend = await userVnc({
    vncSession: (request) => f.pool.openBrokerVnc(instance, 'synthetic-user', request),
  });
  await frontend.opened;
  await (await frontend.accepted).ready;
  const reply = once(frontend.client, 'message');
  frontend.client.send(Buffer.from('synthetic input'));
  expect((await reply)[0]).toEqual(
    Buffer.concat([Buffer.from([0]), Buffer.from('synthetic input')]),
  );
  expect(f.pool.retain(instance.taskId, 60000)).toBe(true);
  expect(f.pool.adoptRetained(instance.taskId, 'tsk_followup', 'synthetic-user') === instance).toBe(
    true,
  );
  await vi.waitFor(() => expect(frontend.client.readyState).toBe(WebSocket.CLOSED));
  expect(f.pool.peek('tsk_followup') === instance).toBe(true);
  expect(f.counts.creates).toBe(1);
});

it('strict Pool rejects a copied VNC instance and a different caller before upstream IO', async () => {
  const f = await fixture('cdp-pool', true);
  const instance = await startOwnedOperation(
    f.drain,
    'request',
    () => f.pool.allocate('tsk_synthetic', 'synthetic-user'),
    { parent: f.owner, errorOutcome: 'known' },
  ).result;
  for (const [candidateInstance, caller] of [
    [{ ...instance }, 'synthetic-user'],
    [instance, 'synthetic-other'],
  ] as const) {
    const before = f.counts.data;
    const frontend = await userVnc({
      vncSession: (request) => f.pool.openBrokerVnc(candidateInstance, caller, request),
    });
    await expect(frontend.opened).rejects.toThrow();
    expect(f.counts.data).toBe(before);
  }
});

it('strict Pool shutdown cancels a pending original group without releasing its slot', async () => {
  const f = await fixture('hold-ready', true);
  const allocation = startOwnedOperation(
    f.drain,
    'request',
    () => f.pool.allocate('tsk_synthetic', 'synthetic-user'),
    { parent: f.owner, errorOutcome: 'known' },
  ).result;
  void allocation.catch(() => {});
  await f.accepted;
  const closing = f.pool.shutdown();
  await expect(allocation).rejects.toThrow();
  await expect(closing).rejects.toThrow('POOL_GROUP_EXIT_UNPROVEN');
  expect(f.pool.peek('tsk_synthetic')).toBeNull();
  expect(f.pool.stats().idle).toBe(1);
  expect(f.counts.creates).toBe(1);
  expect(f.drain.snapshot().unknown).toBeGreaterThan(0);
});

it('strict Pool carries the sealed original allocation scope into asynchronous native IO', async () => {
  const f = await fixture('hold-ready', true);
  await startOwnedOperation(
    f.drain,
    'request',
    () =>
      withOperationDispatchScope(async (seal) => {
        const allocation = f.pool.allocate('tsk_synthetic', 'synthetic-user');
        void allocation.catch(() => {});
        await f.accepted;
        seal();
        await expect(allocation).rejects.toThrow();
      }),
    { parent: f.owner, errorOutcome: 'known' },
  ).result;
  expect(f.pool.stats().idle).toBe(1);
  expect(f.pool.peek('tsk_synthetic')).toBeNull();
  expect(f.counts.data).toBe(0);
});

async function failPoolAllocation(f: Awaited<ReturnType<typeof fixture>>, taskId: string) {
  const previous = f.counts.accepted;
  f.hooks.controlMode = 'hold-ready';
  await startOwnedOperation(
    f.drain,
    'request',
    () =>
      withOperationDispatchScope(async (seal) => {
        const allocation = f.pool.allocate(taskId, 'synthetic-user');
        void allocation.catch(() => {});
        await vi.waitFor(() => expect(f.counts.accepted).toBe(previous + 1));
        seal();
        await expect(allocation).rejects.toThrow();
      }),
    { parent: f.owner, errorOutcome: 'known' },
  ).result;
  f.hooks.controlMode = 'ok';
}

it('strict Pool failed-task tombstone prevents a second physical dispatch', async () => {
  const f = await fixture('cdp-pool', true);
  await failPoolAllocation(f, 'tsk_failed');
  const retry = startOwnedOperation(
    f.drain,
    'request',
    () => f.pool.allocate('tsk_failed', 'synthetic-user'),
    { parent: f.owner, errorOutcome: 'known' },
  ).result;
  await expect(retry).rejects.toThrow();
  await f.flushControl();
  expect(f.counts.creates).toBe(1);
  expect(f.pool.stats().idle).toBe(1);
});

it('strict Pool failed-task tombstone rejects retained adoption into its key', async () => {
  const f = await fixture('cdp-pool', true);
  const instance = await startOwnedOperation(
    f.drain,
    'request',
    () => f.pool.allocate('tsk_source', 'synthetic-user'),
    { parent: f.owner, errorOutcome: 'known' },
  ).result;
  expect(f.pool.retain(instance.taskId, 60000)).toBe(true);
  await failPoolAllocation(f, 'tsk_failed');
  expect(f.pool.adoptRetained('tsk_source', 'tsk_failed', 'synthetic-user') === null).toBe(true);
  expect(f.pool.peek('tsk_source') === instance).toBe(true);
});

it('strict Pool failed-task release reports unproven exit instead of missing resources', async () => {
  const f = await fixture('cdp-pool', true);
  await failPoolAllocation(f, 'tsk_failed');
  await expect(f.pool.release('tsk_failed')).rejects.toThrow('POOL_GROUP_EXIT_UNPROVEN');
  expect(f.pool.stats().idle).toBe(1);
});

it('strict Pool release owns a pending allocation before an instance exists', async () => {
  const f = await fixture('hold-ready', true);
  const allocation = startOwnedOperation(
    f.drain,
    'request',
    () => f.pool.allocate('tsk_synthetic', 'synthetic-user'),
    { parent: f.owner, errorOutcome: 'known' },
  ).result;
  void allocation.catch(() => {});
  await f.accepted;
  const closing = f.pool.release('tsk_synthetic');
  void closing.catch(() => {});
  await expect(allocation).rejects.toThrow();
  await expect(closing).rejects.toThrow('POOL_GROUP_EXIT_UNPROVEN');
  expect(f.pool.peek('tsk_synthetic') === null).toBe(true);
  expect(f.counts.creates).toBe(1);
  expect(f.pool.stats().idle).toBe(1);
});

it('strict Pool release ignores a forged draining DTO and closes its original SDK transport', async () => {
  const f = await fixture('cdp-pool', true);
  const instance = await startOwnedOperation(
    f.drain,
    'request',
    () => f.pool.allocate('tsk_synthetic', 'synthetic-user'),
    { parent: f.owner, errorOutcome: 'known' },
  ).result;
  const originalPeer = f.browserPeers[0];
  if (!originalPeer) throw new Error('Expected original synthetic SDK peer');
  expect(originalPeer.readyState).toBe(WebSocket.OPEN);
  instance.status = 'draining';
  await expect(f.pool.release('tsk_synthetic')).rejects.toThrow('POOL_GROUP_EXIT_UNPROVEN');
  await vi.waitFor(() => expect(originalPeer.readyState).toBe(WebSocket.CLOSED));
  expect(f.pool.stats().idle).toBe(1);
});

it('strict Pool does not grant ownership or retention from mutable instance fields', async () => {
  const f = await fixture('cdp-pool', true);
  const instance = await startOwnedOperation(
    f.drain,
    'request',
    () => f.pool.allocate('tsk_synthetic', 'synthetic-user'),
    { parent: f.owner, errorOutcome: 'known' },
  ).result;
  instance.retainedUntil = Date.now() + 60000;
  expect(f.pool.adoptRetained(instance.taskId, 'tsk_followup', 'synthetic-user')).toBeNull();
  instance.userId = 'synthetic-other';
  expect(f.pool.peekActiveForUser('synthetic-other') === null).toBe(true);
  expect(f.pool.peek('tsk_synthetic') === null).toBe(true);
});

it('strict Pool retention expiry cannot be renewed by changing the instance DTO', async () => {
  const f = await fixture('cdp-pool', true);
  const instance = await startOwnedOperation(
    f.drain,
    'request',
    () => f.pool.allocate('tsk_synthetic', 'synthetic-user'),
    { parent: f.owner, errorOutcome: 'known' },
  ).result;
  expect(f.pool.retain(instance.taskId, 10000)).toBe(true);
  const now = Date.now();
  instance.retainedUntil = now + 600000;
  vi.spyOn(Date, 'now').mockReturnValue(now + 10001);
  expect(f.pool.adoptRetained(instance.taskId, 'tsk_followup', 'synthetic-user') === null).toBe(
    true,
  );
});

it('strict Pool expired private lease refuses a new VNC upstream before its timer runs', async () => {
  const f = await fixture('cdp-pool', true);
  const instance = await startOwnedOperation(
    f.drain,
    'request',
    () => f.pool.allocate('tsk_synthetic', 'synthetic-user'),
    { parent: f.owner, errorOutcome: 'known' },
  ).result;
  expect(f.pool.retain(instance.taskId, 10000)).toBe(true);
  const before = f.counts.data;
  const now = Date.now();
  vi.spyOn(Date, 'now').mockReturnValue(now + 10001);
  const frontend = await userVnc({
    vncSession: (request) => f.pool.openBrokerVnc(instance, 'synthetic-user', request),
  });
  await expect(frontend.opened).rejects.toThrow();
  expect(f.counts.data).toBe(before);
});

it('strict Pool expired private lease cannot be revived by touch before its timer runs', async () => {
  const f = await fixture('cdp-pool', true);
  const instance = await startOwnedOperation(
    f.drain,
    'request',
    () => f.pool.allocate('tsk_synthetic', 'synthetic-user'),
    { parent: f.owner, errorOutcome: 'known' },
  ).result;
  expect(f.pool.retain(instance.taskId, 10000)).toBe(true);
  const deadline = instance.retainedUntil;
  const now = Date.now();
  vi.spyOn(Date, 'now').mockReturnValue(now + 10001);
  f.pool.touch(instance.taskId);
  expect(instance.retainedUntil).toBe(deadline);
  expect(f.pool.peek(instance.taskId) === null).toBe(true);
});

it('strict Pool expired private lease revokes an existing VNC session before its timer runs', async () => {
  const f = await fixture('cdp-pool', true);
  const instance = await startOwnedOperation(
    f.drain,
    'request',
    () => f.pool.allocate('tsk_synthetic', 'synthetic-user'),
    { parent: f.owner, errorOutcome: 'known' },
  ).result;
  const frontend = await userVnc({
    vncSession: (request) => f.pool.openBrokerVnc(instance, 'synthetic-user', request),
  });
  await frontend.opened;
  await (await frontend.accepted).ready;
  expect(f.pool.retain(instance.taskId, 10000)).toBe(true);
  const now = Date.now();
  vi.spyOn(Date, 'now').mockReturnValue(now + 10001);
  await vi.waitFor(() => expect(frontend.client.readyState).toBe(WebSocket.CLOSED));
});

it('strict Pool adoption rechecks private binding after the final logger revokes it', async () => {
  const f = await fixture('cdp-pool', true);
  const instance = await startOwnedOperation(
    f.drain,
    'request',
    () => f.pool.allocate('tsk_synthetic', 'synthetic-user'),
    { parent: f.owner, errorOutcome: 'known' },
  ).result;
  expect(f.pool.retain(instance.taskId, 60000)).toBe(true);
  let closing: Promise<void> | undefined;
  f.hooks.onLog = (message) => {
    if (message === 'pool: adopted terminal browser for follow-up task') {
      closing = f.pool.shutdown();
      void closing.catch(() => {});
    }
  };
  const adopted = f.pool.adoptRetained(instance.taskId, 'tsk_followup', 'synthetic-user');
  expect(adopted === null).toBe(true);
  await expect(closing).rejects.toThrow('POOL_GROUP_EXIT_UNPROVEN');
});

it('rejects a revoked original allocation before native create dispatch', async () => {
  const f = await fixture();
  const guard = {
    check: () => {
      throw new Error('synthetic revoked allocation');
    },
    veto: () => {},
  };
  await expect(f.runtime.create(0, guard)).rejects.toThrow();
  await f.flushControl();
  expect(f.counts.creates).toBe(0);
  expect(f.drain.snapshot().unknown).toBe(0);
});

it('carries original allocation revocation into a later native create guard', async () => {
  const f = await fixture();
  let checks = 0;
  let revoked = false;
  const guard = {
    check: () => {
      if (++checks === 4) revoked = true;
    },
    veto: () => {
      if (revoked) throw new Error('synthetic revoked allocation');
    },
  };
  await expect(f.runtime.create(0, guard)).rejects.toThrow();
  await f.flushControl();
  expect(checks).toBeGreaterThanOrEqual(4);
  expect(f.counts.creates).toBe(0);
});

it('rejects a group revoked during the final original control cleanup receipt', async () => {
  const f = await fixture();
  let revoked = false;
  const original = BrokerCreateClient.prototype.close;
  vi.spyOn(BrokerCreateClient.prototype, 'close').mockImplementation(function (
    this: BrokerCreateClient,
  ) {
    return original.call(this).then(() => {
      revoked = true;
    });
  });
  await expect(
    f.runtime.create(0, {
      check: () => {},
      veto: () => {
        if (revoked) throw new Error('synthetic revoked allocation');
      },
    }),
  ).rejects.toThrow();
  expect(f.drain.snapshot().unknown).toBeGreaterThan(0);
});

it('retains the original setup veto through CDP acquisition but not another group', async () => {
  const f = await fixture('cdp');
  let revoked = false;
  const guard = {
    check: () => {},
    veto: () => {
      if (revoked) throw new Error('synthetic revoked allocation');
    },
  };
  const first = await f.runtime.create(0, guard);
  const second = await f.runtime.create(1);
  revoked = true;
  const before = f.counts.data;
  await expect(first.cdp()).rejects.toThrow();
  expect(f.counts.data).toBe(before);
  const cdp = await second.cdp();
  expect(cdp.endpoint.startsWith('ws://127.0.0.1:')).toBe(true);
  await first.close();
  await cdp.close();
});

async function userVnc(
  group: Pick<OriginalBrokerGroup, 'vncSession'>,
  revalidate: () => Promise<boolean> = async () => true,
  veto: () => void = () => {},
) {
  const server = http.createServer();
  let raw: net.Socket | undefined;
  let resolve!: (session: ReturnType<OriginalBrokerGroup['vncSession']>) => void;
  let reject!: (error: unknown) => void;
  const accepted = new Promise<ReturnType<OriginalBrokerGroup['vncSession']>>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  void accepted.catch(() => {});
  server.on('upgrade', (request, socket, head) => {
    raw = socket as net.Socket;
    raw.on('error', () => {});
    try {
      const session = group.vncSession({ request, socket: raw, head, revalidate, veto });
      void session.ready.catch(() => {});
      resolve(session);
    } catch (error) {
      socket.destroy();
      reject(error);
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as net.AddressInfo;
  const client = new WebSocket(`ws://127.0.0.1:${address.port}/`, ['binary']);
  client.on('error', () => {});
  const opened = once(client, 'open').then(() => {});
  void opened.catch(() => {});
  cleanup.push(async () => {
    client.terminate();
    const session = await accepted.catch(() => undefined);
    if (session) await session.close();
    raw?.destroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  return { client, accepted, opened, raw: () => raw };
}

it('relays the first VNC greeting and binary user input through the original owned session', async () => {
  const f = await fixture('vnc-greeting');
  const group = await f.runtime.create(0);
  const frontend = await userVnc(group);
  const greeting = once(frontend.client, 'message');
  void greeting.catch(() => {});
  const session = await frontend.accepted;
  await session.ready;
  expect((await greeting)[0].toString()).toBe('RFB 003.008\n');
  const result = once(frontend.client, 'message');
  const payload = Buffer.alloc(128 * 1024, 42);
  frontend.client.send(payload);
  const [bytes, binary] = await result;
  expect(bytes[0]).toBe(0);
  expect(bytes.subarray(1).equals(payload)).toBe(true);
  expect(binary).toBe(true);
  expect(JSON.stringify(session)).toBe('{}');
  await session.close();
  await vi.waitFor(() => expect(frontend.client.readyState).toBe(WebSocket.CLOSED));
  expect(frontend.raw()?.destroyed).toBe(true);
  await vi.waitFor(() => expect(f.counts.closedData).toBe(1));
});

it('rejects a revoked VNC user session before any upstream acquisition or client upgrade', async () => {
  const f = await fixture('vnc');
  const group = await f.runtime.create(0);
  const frontend = await userVnc(group, async () => false);
  const session = await frontend.accepted;
  await expect(session.ready).rejects.toThrow('POOL_VNC_SESSION_INVALID');
  await session.close();
  await expect(frontend.opened).rejects.toThrow();
  expect(f.counts.data).toBe(0);
  expect(frontend.raw()?.destroyed).toBe(true);
});

it('closes the original frontend immediately but owns pending session authorization until it settles', async () => {
  const f = await fixture('vnc');
  const group = await f.runtime.create(0);
  let authorize!: (value: boolean) => void;
  let entered = false;
  const check = new Promise<boolean>((resolve) => {
    authorize = resolve;
  });
  const frontend = await userVnc(group, () => {
    entered = true;
    return check;
  });
  const session = await frontend.accepted;
  await vi.waitFor(() => expect(entered).toBe(true));
  let settled = false;
  const closing = session.close().then(() => {
    settled = true;
  });
  try {
    await vi.waitFor(() => expect(frontend.client.readyState).toBe(WebSocket.CLOSED));
    expect(settled).toBe(false);
  } finally {
    authorize(true);
    await closing;
  }
  await expect(session.ready).rejects.toThrow('POOL_VNC_SESSION_INVALID');
  expect(f.counts.data).toBe(0);
});

it('vetoes VNC user frames after the original instance binding is revoked', async () => {
  const f = await fixture('vnc');
  const group = await f.runtime.create(0);
  let revoked = false;
  const frontend = await userVnc(
    group,
    async () => true,
    () => {
      if (revoked) throw new Error('synthetic-revocation');
    },
  );
  const session = await frontend.accepted;
  await session.ready;
  await frontend.opened;
  revoked = true;
  frontend.client.send(Buffer.from('not-authorized'));
  await vi.waitFor(() => expect(frontend.client.readyState).toBe(WebSocket.CLOSED));
  await session.close();
  expect(f.counts.messages).toBe(0);
});

it('cancels a pending user VNC upstream when its original frontend disconnects', async () => {
  const f = await fixture('vnc-silent-upgrade');
  const group = await f.runtime.create(0);
  const frontend = await userVnc(group);
  const session = await frontend.accepted;
  await vi.waitFor(() => expect(f.counts.upgrades).toBe(1));
  frontend.client.terminate();
  // Cancellation must react to the original EOF, not the five-second deadline.
  await vi.waitFor(() => expect(f.counts.closedData).toBe(1), { timeout: 1000 });
  await expect(session.ready).rejects.toThrow('POOL_VNC_SESSION_INVALID');
  await session.close();
  await vi.waitFor(() => expect(f.counts.closedData).toBe(1));
});

it('rejects text from a VNC client instead of forwarding a non-binary protocol message', async () => {
  const f = await fixture('vnc');
  const group = await f.runtime.create(0);
  const frontend = await userVnc(group);
  const session = await frontend.accepted;
  await frontend.opened;
  frontend.client.send('not-a-binary-vnc-frame');
  await vi.waitFor(() => expect(frontend.client.readyState).toBe(WebSocket.CLOSED));
  await session.close();
  expect(f.counts.messages).toBe(0);
});

it('bounds a VNC client message before forwarding an oversized frame', async () => {
  const f = await fixture('vnc');
  const group = await f.runtime.create(0);
  const frontend = await userVnc(group);
  const session = await frontend.accepted;
  await frontend.opened;
  frontend.client.send(Buffer.alloc(8 * 1024 * 1024 + 1), () => {});
  await vi.waitFor(() => expect(frontend.client.readyState).toBe(WebSocket.CLOSED));
  await session.close();
  expect(f.counts.messages).toBe(0);
});

it('vetoes automatic VNC pong when original group revocation reenters incoming IO', async () => {
  const f = await fixture('vnc');
  const group = await f.runtime.create(0);
  const frontend = await userVnc(group);
  const session = await frontend.accepted;
  await frontend.opened;
  const raw = frontend.raw();
  if (!raw) throw new Error('missing raw frontend');
  let pongs = 0;
  frontend.client.on('pong', () => {
    pongs++;
  });
  let closing: Promise<void> | undefined;
  raw.prependOnceListener('data', () => {
    f.hooks.beforeDispatch = () => {
      closing ??= group.close();
    };
  });
  frontend.client.ping('synthetic-ping');
  await vi.waitFor(() => expect(closing).toBeDefined());
  await closing;
  await session.close();
  await vi.waitFor(() => expect(frontend.client.readyState).toBe(WebSocket.CLOSED));
  expect(pongs).toBe(0);
});

it('revokes an established VNC session when its next account revalidation fails', async () => {
  const f = await fixture('vnc');
  const group = await f.runtime.create(0);
  let checks = 0;
  const frontend = await userVnc(group, async () => ++checks === 1);
  const session = await frontend.accepted;
  await frontend.opened;
  const originalClock = performance.now.bind(performance);
  vi.spyOn(performance, 'now').mockImplementation(() => originalClock() + 21_000);
  await vi.waitFor(() => expect(frontend.client.readyState).toBe(WebSocket.CLOSED));
  await session.close();
  expect(checks).toBe(2);
  expect(f.counts.messages).toBe(0);
});

it('does not renew VNC authorization when its final revalidation clock crosses the original deadline', async () => {
  const f = await fixture('vnc');
  const group = await f.runtime.create(0);
  let checks = 0;
  let afterCheck = false;
  const frontend = await userVnc(group, async () => {
    checks++;
    if (checks === 2) afterCheck = true;
    return true;
  });
  const session = await frontend.accepted;
  await frontend.opened;
  const originalClock = performance.now.bind(performance);
  let tailReads = 0;
  let offset = 21_000;
  vi.spyOn(performance, 'now').mockImplementation(() => {
    if (afterCheck && ++tailReads === 2) offset += 6000;
    return originalClock() + offset;
  });
  await vi.waitFor(() => expect(tailReads).toBeGreaterThanOrEqual(2));
  frontend.client.send(Buffer.from('must-not-dispatch'), () => {});
  await vi.waitFor(() => expect(frontend.client.readyState).toBe(WebSocket.CLOSED));
  await session.close();
  expect(f.counts.messages).toBe(0);
});

it.each(['frontend', 'upstream'] as const)(
  'bounds queued VNC %s pong replies while an original write callback is held',
  async (side) => {
    const f = await fixture('vnc');
    const group = await f.runtime.create(0);
    const frontend = await userVnc(group);
    const session = await frontend.accepted;
    await frontend.opened;
    const raw = side === 'frontend' ? frontend.raw() : f.dataClients[0];
    const sender = side === 'frontend' ? frontend.client : f.browserPeers[0];
    if (!raw || !sender) throw new Error('missing original pong path');
    let receipt: (() => void) | undefined;
    const original = raw._write;
    raw._write = function (bytes, encoding, done) {
      if (receipt) return original.call(this, bytes, encoding, done);
      original.call(this, bytes, encoding, (error) => {
        receipt = () => done(error);
      });
    };
    // Coalesce a single small real wire burst so pausing future reads cannot
    // hide the receiver's same-chunk ping events from the queue limit.
    const wire = (sender as unknown as { _socket: net.Socket })._socket;
    wire.cork();
    for (let i = 0; i < 200; i++) sender.ping(Buffer.from('x'));
    wire.uncork();
    try {
      await vi.waitFor(() => expect(receipt).toBeDefined());
      await vi.waitFor(() => expect(frontend.client.readyState).toBe(WebSocket.CLOSED));
    } finally {
      const closing = session.close();
      receipt?.();
      await closing;
    }
    expect(f.counts.messages).toBe(0);
  },
);

it('answers normal VNC ping on both authenticated sides without relaying it as data', async () => {
  const f = await fixture('vnc');
  const group = await f.runtime.create(0);
  const frontend = await userVnc(group);
  const session = await frontend.accepted;
  await frontend.opened;
  const backend = f.browserPeers[0];
  if (!backend) throw new Error('missing backend');
  for (const peer of [frontend.client, backend]) {
    const pong = once(peer, 'pong');
    peer.ping(Buffer.from('synthetic-probe'));
    expect((await pong)[0].toString()).toBe('synthetic-probe');
  }
  expect(f.counts.messages).toBe(0);
  await session.close();
});

it('expires a queued VNC pong at its original backlog deadline but retains its write receipt', async () => {
  const f = await fixture('vnc');
  const group = await f.runtime.create(0);
  const frontend = await userVnc(group);
  const session = await frontend.accepted;
  await frontend.opened;
  const raw = frontend.raw();
  if (!raw) throw new Error('missing frontend');
  let receipt: (() => void) | undefined;
  const original = raw._write;
  raw._write = function (bytes, encoding, done) {
    original.call(this, bytes, encoding, (error) => {
      receipt = () => done(error);
    });
  };
  frontend.client.ping(Buffer.from('blocked-pong'));
  await vi.waitFor(() => expect(receipt).toBeDefined());
  const originalClock = performance.now.bind(performance);
  vi.spyOn(performance, 'now').mockImplementation(() => originalClock() + 31_000);
  await vi.waitFor(() => expect(frontend.client.readyState).toBe(WebSocket.CLOSED));
  let settled = false;
  const closing = session.close().then(() => {
    settled = true;
  });
  try {
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(settled).toBe(false);
  } finally {
    receipt?.();
    await closing;
  }
});

it('keeps user VNC sessions on their original groups when one group is released', async () => {
  const f = await fixture('vnc');
  const first = await f.runtime.create(0);
  const second = await f.runtime.create(1);
  const one = await userVnc(first);
  const two = await userVnc(second);
  await one.opened;
  await two.opened;
  for (const [front, slot] of [
    [one, 0],
    [two, 1],
  ] as const) {
    const reply = once(front.client, 'message');
    front.client.send(Buffer.from('same-input'));
    expect((await reply)[0][0]).toBe(slot);
  }
  await first.close();
  await vi.waitFor(() => expect(one.client.readyState).toBe(WebSocket.CLOSED));
  const reply = once(two.client, 'message');
  two.client.send(Buffer.from('still-live'));
  expect((await reply)[0][0]).toBe(1);
  await second.close();
  await vi.waitFor(() => expect(two.client.readyState).toBe(WebSocket.CLOSED));
});

it('waits for an in-flight established-session revalidation even after group close', async () => {
  const f = await fixture('vnc');
  const group = await f.runtime.create(0);
  let checks = 0;
  let resolve!: (value: boolean) => void;
  const pending = new Promise<boolean>((done) => {
    resolve = done;
  });
  const frontend = await userVnc(group, () => (++checks === 1 ? Promise.resolve(true) : pending));
  await frontend.opened;
  const originalClock = performance.now.bind(performance);
  vi.spyOn(performance, 'now').mockImplementation(() => originalClock() + 21_000);
  await vi.waitFor(() => expect(checks).toBe(2));
  let settled = false;
  const closing = group.close().then(() => {
    settled = true;
  });
  try {
    await vi.waitFor(() => expect(frontend.client.readyState).toBe(WebSocket.CLOSED));
    expect(settled).toBe(false);
  } finally {
    resolve(false);
    await closing;
  }
  expect(f.counts.messages).toBe(0);
});

it.each(['write', 'end'] as const)(
  'waits for the original VNC frontend %s callback after raw socket close',
  async (kind) => {
    const f = await fixture('vnc');
    const group = await f.runtime.create(0);
    let raw: net.Socket | undefined;
    let receipt: (() => void) | undefined;
    if (kind === 'end') {
      const original = net.Socket.prototype._final;
      vi.spyOn(net.Socket.prototype, '_final').mockImplementation(function (
        this: net.Socket,
        done,
      ) {
        if (this !== raw) return original.call(this, done);
        return original.call(this, (error) => {
          receipt = () => done(error);
        });
      });
    }
    const frontend = await userVnc(group);
    const session = await frontend.accepted;
    await frontend.opened;
    raw = frontend.raw();
    if (!raw) throw new Error('missing original frontend');
    if (kind === 'write') {
      const original = raw._write;
      raw._write = function (bytes, encoding, done) {
        original.call(this, bytes, encoding, (error) => {
          receipt = () => done(error);
        });
      };
      frontend.client.send(Buffer.from('reply-held-by-real-raw-write'));
    } else {
      frontend.client.close();
    }
    await vi.waitFor(() => expect(receipt).toBeDefined());
    const rawClosed = raw.closed ? Promise.resolve() : once(raw, 'close');
    let settled = false;
    const closing = session.close().then(() => {
      settled = true;
    });
    try {
      await rawClosed;
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(settled).toBe(false);
    } finally {
      receipt?.();
      await closing;
    }
  },
);

it('connects the actual VNC WebSocket through original kind-2 HPD and carries a binary message larger than 64 KiB', async () => {
  const f = await fixture('vnc');
  const group = await f.runtime.create(0);
  const connection = group.vnc();
  const peer = await connection.ready;
  const result = once(peer, 'message');
  const payload = Buffer.alloc(128 * 1024, 37);
  peer.resume();
  peer.send(payload, { binary: true });
  const [bytes, binary] = await result;
  expect(bytes[0]).toBe(0);
  expect(bytes.subarray(1).equals(payload)).toBe(true);
  expect(binary).toBe(true);
  expect(f.counts.messages).toBe(1);
  await connection.close();
  expect(peer.readyState).toBe(WebSocket.CLOSED);
  await vi.waitFor(() => expect(f.counts.closedData).toBe(1));
});

it('cancels pending VNC HPD at group close without a late WebSocket dispatch', async () => {
  const f = await fixture('vnc');
  const group = await f.runtime.create(0);
  f.hooks.dataMode = 'silent-data';
  const connection = group.vnc();
  const ready = connection.ready.catch(() => undefined);
  await vi.waitFor(() => expect(f.counts.data).toBe(1));
  await group.close();
  expect(await ready).toBeUndefined();
  await vi.waitFor(() => expect(f.counts.closedData).toBe(1));
  expect(f.counts.messages).toBe(0);
  expect(f.drain.snapshot().idle).toBe(false); // physical group still has no exit proof
});

it('preserves the initial server-initiated VNC greeting until its consumer attaches', async () => {
  const f = await fixture('vnc-greeting');
  const group = await f.runtime.create(0);
  const connection = group.vnc();
  const peer = await connection.ready;
  // Real consumers can await session authorization/initialization after ready.
  await new Promise<void>((resolve) => setTimeout(resolve, 30));
  const greeting = once(peer, 'message');
  peer.resume();
  const received = await Promise.race([
    greeting.then(([bytes]) => bytes.toString()),
    new Promise<string>((resolve) => setTimeout(() => resolve('missing'), 300)),
  ]);
  expect(received).toBe('RFB 003.008\n');
  await connection.close();
});

it('keeps two VNC upstreams bound to their original group while closing one independently', async () => {
  const f = await fixture('vnc');
  const first = await f.runtime.create(0);
  const second = await f.runtime.create(1);
  const a = first.vnc();
  const b = second.vnc();
  const one = await a.ready;
  const two = await b.ready;
  for (const [peer, slot] of [
    [one, 0],
    [two, 1],
  ] as const) {
    const result = once(peer, 'message');
    peer.resume();
    peer.send(Buffer.from('same-synthetic-input'));
    const [bytes] = await result;
    expect(bytes[0]).toBe(slot);
  }
  await first.close();
  expect(one.readyState).toBe(WebSocket.CLOSED);
  const result = once(two, 'message');
  two.send(Buffer.from('still-live'));
  expect((await result)[0][0]).toBe(1);
  await second.close();
  expect(two.readyState).toBe(WebSocket.CLOSED);
});

it('cancels an in-flight VNC 101 handshake when its group closes', async () => {
  const f = await fixture('vnc-silent-upgrade');
  const group = await f.runtime.create(0);
  const connection = group.vnc();
  const ready = connection.ready.catch(() => undefined);
  await vi.waitFor(() => expect(f.counts.upgrades).toBe(1));
  await group.close();
  expect(await ready).toBeUndefined();
  await vi.waitFor(() => expect(f.counts.closedData).toBe(1));
});

it('bounds a silent VNC WebSocket handshake and releases its original data connection', async () => {
  const f = await fixture('vnc-silent-upgrade');
  const group = await f.runtime.create(0);
  const started = performance.now();
  const connection = group.vnc();
  await expect(connection.ready).rejects.toThrow('POOL_VNC_CONNECTION_INVALID');
  expect(performance.now() - started).toBeLessThan(6000);
  await connection.close();
  await vi.waitFor(() => expect(f.counts.closedData).toBe(1));
}, 12_000);

it('does not send a VNC business frame when group close reenters its raw dispatch guard', async () => {
  const f = await fixture('vnc');
  const group = await f.runtime.create(0);
  const connection = group.vnc();
  const peer = await connection.ready;
  let closing: Promise<void> | undefined;
  f.hooks.beforeDispatch = () => {
    closing ??= group.close();
  };
  peer.send(Buffer.from('synthetic-vnc'), { binary: true }, () => {});
  await vi.waitFor(() => expect(closing).toBeDefined());
  await closing;
  expect(f.counts.messages).toBe(0);
  expect(peer.readyState).toBe(WebSocket.CLOSED);
});

it.each(['write', 'end'] as const)(
  'keeps VNC close pending for the original upstream %s receipt',
  async (kind) => {
    const f = await fixture('vnc');
    const group = await f.runtime.create(0);
    let raw: net.Socket | undefined;
    let receipt: (() => void) | undefined;
    if (kind === 'end') {
      const original = net.Socket.prototype._final;
      vi.spyOn(net.Socket.prototype, '_final').mockImplementation(function (
        this: net.Socket,
        complete,
      ) {
        if (this !== raw) return original.call(this, complete);
        return original.call(this, (error) => {
          receipt = () => complete(error);
        });
      });
    }
    const connection = group.vnc();
    const peer = await connection.ready;
    peer.resume();
    raw = f.dataClients[0];
    expect(raw).toBeDefined();
    if (!raw) throw new Error('missing original data socket');
    if (kind === 'write') {
      const original = raw._write;
      raw._write = function (chunk, encoding, complete) {
        original.call(this, chunk, encoding, (error) => {
          receipt = () => complete(error);
        });
      };
      peer.send(Buffer.from('synthetic-vnc'), { binary: true }, () => {});
    } else {
      peer.close();
    }
    await vi.waitFor(() => expect(receipt).toBeDefined());
    let settled = false;
    const rawClosed = once(raw, 'close');
    const closing = connection.close().then(() => {
      settled = true;
    });
    try {
      await rawClosed;
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(settled).toBe(false);
    } finally {
      receipt?.();
      await closing;
    }
  },
);

it('rendezvous waits for a delayed actual Unix listener then sends exactly one create', async () => {
  const f = await fixture('ok', false, false, true);
  expect(f.counts.boots).toBe(1);
  expect(f.counts.creates).toBe(0);
  const group = await f.runtime.create(0);
  expect(f.counts).toMatchObject({ controls: 1, creates: 1, accepted: 1, probes: 1 });
  const data = await group.connect(1);
  expect((await once(data, 'data'))[0].toString()).toBe('group-0-kind-1');
  await data.close();
});

it('revoking the original boot prevents runtime control or business reacquisition', async () => {
  const f = await fixture();
  await f.bootSession.close();
  await expect(f.runtime.create(0)).rejects.toThrow();
  await f.runtime.close();
  expect(f.counts).toMatchObject({ controls: 0, creates: 0 });
  await expect(f.runtime.create(0)).rejects.toThrow();
});

it('revoking the original boot rejects immediate reuse of an already ready pool instance', async () => {
  const f = await fixture('cdp-pool', true);
  await startOwnedOperation(
    f.drain,
    'request',
    async () => {
      const instance = await f.pool.allocate('boot-reuse', 'synthetic-user');
      expect(instance.status).toBe('ready');
      const closing = f.bootSession.close();
      await expect(f.pool.allocate('boot-reuse', 'synthetic-user')).rejects.toThrow();
      await closing;
    },
    { parent: f.owner, errorOutcome: 'unknown' },
  ).result;
  expect(f.counts.creates).toBe(1);
});

it('a final reuse clock cannot revoke boot and still hand off a ready instance', async () => {
  const f = await fixture('cdp-pool', true);
  await startOwnedOperation(
    f.drain,
    'request',
    async () => {
      await f.pool.allocate('boot-last-clock', 'synthetic-user');
      const realNow = Date.now.bind(Date);
      const clock = vi.spyOn(Date, 'now').mockImplementation(() => {
        void f.bootSession.close();
        return realNow();
      });
      try {
        await expect(f.pool.allocate('boot-last-clock', 'synthetic-user')).rejects.toThrow();
      } finally {
        clock.mockRestore();
      }
    },
    { parent: f.owner, errorOutcome: 'unknown' },
  ).result;
});

it('the retained binding veto rechecks boot after its lease clock', async () => {
  const f = await fixture('cdp-pool', true);
  const instance = await startOwnedOperation(
    f.drain,
    'request',
    async () => f.pool.allocate('boot-retained-clock', 'synthetic-user'),
    { parent: f.owner, errorOutcome: 'unknown' },
  ).result;
  expect(f.pool.retain('boot-retained-clock', 60000)).toBe(true);
  const veto = f.pool.captureBrokerVncBindingVeto(
    instance,
    'synthetic-user',
    'boot-retained-clock',
  );
  const realNow = Date.now.bind(Date);
  const clock = vi.spyOn(Date, 'now').mockImplementation(() => {
    void f.bootSession.close();
    return realNow();
  });
  try {
    expect(veto).toThrow();
  } finally {
    clock.mockRestore();
  }
});

it('creates two original groups through native control, registers egress before ready, authenticates both data kinds', async () => {
  const f = await fixture();
  const first = await f.runtime.create(0);
  const second = await f.runtime.create(1);
  expect(f.counts).toMatchObject({ creates: 2, accepted: 2, probes: 2 });
  expect(JSON.stringify(first)).toBe('{}');
  for (const [group, slot] of [
    [first, 0],
    [second, 1],
  ] as const) {
    for (const kind of [1, 2] as const) {
      const data = await group.connect(kind);
      expect((await once(data, 'data'))[0].toString()).toBe(`group-${slot}-kind-${kind}`);
      const echo = once(data, 'data');
      data.write('synthetic');
      expect((await echo)[0].toString()).toBe('synthetic');
      await data.close();
    }
  }
  await first.close();
  await expect(first.connect(1)).rejects.toThrow();
  await expect(f.runtime.create(0)).rejects.toThrow();
  expect(f.counts.creates).toBe(2);
  expect(f.drain.snapshot().unknown).toBeGreaterThan(0);
  const live = await second.connect(1);
  await live.close();
});

it('retains slot and unknown physical ownership when root drops ready', async () => {
  const f = await fixture('drop-ready');
  await expect(f.runtime.create(0)).rejects.toThrow();
  await expect(f.runtime.create(0)).rejects.toThrow();
  expect(f.counts.creates).toBe(1);
  expect(f.drain.snapshot()).toMatchObject({ idle: false });
  expect(f.drain.snapshot().unknown).toBeGreaterThan(0);
});

it('revokes in-flight create on close and never hands off a late group', async () => {
  const f = await fixture('hold-ready');
  const opening = f.runtime.create(0);
  const rejected = expect(opening).rejects.toThrow();
  await f.accepted;
  await f.runtime.close();
  await rejected;
  expect(f.drain.snapshot().unknown).toBeGreaterThan(0);
  await expect(f.runtime.create(1)).rejects.toThrow();
});

it('closes pending data authentication before completing group cleanup', async () => {
  const f = await fixture('silent-data');
  const group = await f.runtime.create(0);
  const opening = group.connect(1);
  const rejected = expect(opening).rejects.toThrow();
  await vi.waitFor(() => expect(f.counts.data).toBe(1));
  await group.close();
  await rejected;
  await vi.waitFor(() => expect(f.counts.closedData).toBe(1));
  expect(f.drain.snapshot().unknown).toBeGreaterThan(0);
  await expect(group.connect(2)).rejects.toThrow();
});

it('reserves a slot before concurrent create can dispatch it twice', async () => {
  const f = await fixture();
  const first = f.runtime.create(0);
  await expect(f.runtime.create(0)).rejects.toThrow();
  const group = await first;
  expect(f.counts.creates).toBe(1);
  await group.close();
});

it('rejects invalid slots without creating or occupying a physical group', async () => {
  const f = await fixture();
  const before = f.drain.snapshot();
  for (const slot of [-1, 32, 0.5, Number.NaN])
    await expect(f.runtime.create(slot)).rejects.toThrow();
  expect(f.counts.creates).toBe(0);
  expect(f.drain.snapshot()).toEqual(before);
});

it('bounds concurrent data acquisitions before any excess transport opens', async () => {
  const f = await fixture('silent-data');
  const group = await f.runtime.create(0);
  const openings = Array.from({ length: 64 }, () => group.connect(1));
  const settled = Promise.allSettled(openings);
  await vi.waitFor(() => expect(f.counts.data).toBe(64));
  await expect(group.connect(2)).rejects.toThrow('POOL_RUNTIME_INVALID');
  expect(f.counts.data).toBe(64);
  await group.close();
  await settled;
}, 15_000);

it.each([3, 4, 5])(
  'revocation during transport guard %s prevents the native connection itself',
  async (target) => {
    const f = await fixture();
    let guards = 0;
    let closing: Promise<void> | undefined;
    f.hooks.beforeDispatch = () => {
      if (++guards === target) closing = f.runtime.close();
    };
    await expect(f.runtime.create(0)).rejects.toThrow();
    // Client may conservatively keep unknown when its connector never returns
    // an acquired handle. That does not permit starting a new native connection.
    await closing?.catch(() => {});
    // Drain the Unix accept queue using a real marker connection, not a single
    // setImmediate that can run before the native connection's accept event.
    await f.flushControl();
    expect(f.counts.controls).toBe(1);
  },
);

it('restores capacity after failed data authentication actually closes', async () => {
  const f = await fixture('reject-data');
  const group = await f.runtime.create(0);
  for (let index = 0; index < 64; index++) await expect(group.connect(1)).rejects.toThrow();
  await vi.waitFor(() => expect(f.counts.closedData).toBe(64));
  f.hooks.dataMode = 'ok';
  const stream = await group.connect(1);
  expect((await once(stream, 'data'))[0].toString()).toBe('group-0-kind-1');
  await stream.close();
  expect(f.counts.data).toBe(65);
});

it('serves authenticated CDP WebSocket through the original group without forwarding its private header', async () => {
  const f = await fixture('cdp');
  const group = await f.runtime.create(0);
  const adapter = await group.cdp();
  expect(adapter.endpoint).toMatch(/^ws:\/\/127\.0\.0\.1:\d+\/cdp$/);
  expect(JSON.stringify(adapter)).toBe('{}');
  const before = f.counts.data;
  const denied = new WebSocket(adapter.endpoint);
  const denial = once(denied, 'error');
  await denial;
  expect(f.counts.data).toBe(before);
  const socket = new WebSocket(adapter.endpoint, { headers: adapter.headers });
  cleanup.push(async () => {
    socket.terminate();
  });
  await once(socket, 'open');
  const reply = once(socket, 'message');
  socket.send('synthetic-cdp');
  expect((await reply)[0].toString()).toBe('synthetic-cdp');
  const closed = once(socket, 'close');
  await group.close();
  await closed;
});

it('rejects an off-group CDP discovery URL without opening a loopback adapter', async () => {
  const f = await fixture('wrong-cdp-target');
  const group = await f.runtime.create(0);
  await expect(group.cdp()).rejects.toThrow();
  expect(f.counts.data).toBe(1);
  await group.close();
});

it.each([0, 26, 27, 130])(
  'enforces the raw CDP 32-header boundary with %i benign extra headers',
  async (padding) => {
    const f = await fixture('cdp');
    const group = await f.runtime.create(0);
    const adapter = await group.cdp();
    const url = new URL(adapter.endpoint);
    const observations: Array<{
      path: string | undefined;
      pairs: number;
      auth: number;
      key: number;
    }> = [];
    const parserErrors: string[] = [];
    const emit = http.Server.prototype.emit;
    vi.spyOn(http.Server.prototype, 'emit').mockImplementation(function (
      this: http.Server,
      event: string | symbol,
      ...args: unknown[]
    ) {
      if (event === 'clientError' && (this.address() as net.AddressInfo)?.port === Number(url.port))
        parserErrors.push((args[0] as NodeJS.ErrnoException).code ?? 'unknown');
      if (event === 'upgrade' && (this.address() as net.AddressInfo)?.port === Number(url.port)) {
        const request = args[0] as http.IncomingMessage;
        const names = request.rawHeaders
          .filter((_, index) => index % 2 === 0)
          .map((name) => name.toLowerCase());
        observations.push({
          path: request.url,
          pairs: names.length,
          auth: names.filter((name) => name === 'x-holaday-cdp').length,
          key: names.filter((name) => name === 'sec-websocket-key').length,
        });
      }
      return Reflect.apply(emit, this, [event, ...args]);
    });
    const socket = net.connect(Number(url.port), '127.0.0.1');
    socket.on('error', () => {});
    const reply: Buffer[] = [];
    socket.on('data', (bytes) => {
      reply.push(bytes);
      socket.destroy();
    });
    const closed = once(socket, 'close');
    await once(socket, 'connect');
    socket.write(
      `GET /cdp HTTP/1.1\r\nHost: ${url.host}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: MDEyMzQ1Njc4OWFiY2RlZg==\r\nx-holaday-cdp: ${adapter.headers['x-holaday-cdp']}\r\n${Array.from({ length: padding }, (_, i) => `X-${i}: a\r\n`).join('')}\r\n`,
    );
    await closed;
    if (padding <= 26) {
      expect({ observations, parserErrors }).toEqual({
        observations: [{ path: '/cdp', pairs: padding + 6, auth: 1, key: 1 }],
        parserErrors: [],
      });
      expect(Buffer.concat(reply).toString('ascii')).toMatch(/^HTTP\/1.1 101/);
      expect(f.counts.data).toBe(2);
    } else {
      // The patched parser rejects, rather than silently truncating rawHeaders.
      // Native loader separately refuses the affected Node 22 patch versions.
      expect({ observations, parserErrors }).toEqual({
        observations: [],
        parserErrors: ['HPE_HEADER_OVERFLOW'],
      });
      expect(reply).toEqual([]);
      expect(f.counts.data).toBe(1);
    }
  },
);

it.each([
  'origin',
  'duplicate',
  'host',
  'query',
  'overflow-origin',
  'overflow-duplicate',
  'overflow-benign',
  'overflow-fragmented-origin',
  'overflow-fragmented-duplicate',
])('rejects CDP %s before any new group data connection', async (mode) => {
  const f = await fixture('cdp');
  const group = await f.runtime.create(0);
  const adapter = await group.cdp();
  const url = new URL(adapter.endpoint);
  const before = f.counts.data;
  const socket = net.connect(Number(url.port), '127.0.0.1');
  const closed = once(socket, 'close');
  socket.on('error', () => {});
  socket.on('data', () => socket.destroy());
  await once(socket, 'connect');
  const prefix = `GET /cdp${mode === 'query' ? '?token=synthetic' : ''} HTTP/1.1\r\nHost: ${mode === 'host' ? 'example.invalid' : url.host}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: MDEyMzQ1Njc4OWFiY2RlZg==\r\nx-holaday-cdp: ${adapter.headers['x-holaday-cdp']}\r\n${mode.startsWith('overflow') ? Array.from({ length: 130 }, (_, i) => `X-${i}: a\r\n`).join('') : ''}`;
  const suffix = `${mode.endsWith('duplicate') ? 'x-holaday-cdp: duplicate\r\n' : ''}${mode.endsWith('origin') ? 'Origin: https://example.invalid\r\n' : ''}\r\n`;
  if (mode.includes('fragmented')) {
    socket.write(prefix);
    await new Promise<void>((resolve) => setTimeout(resolve, 30));
    socket.write(suffix);
  } else socket.write(prefix + suffix);
  socket.resume();
  await closed;
  expect(f.counts.data).toBe(before);
});

it('bounds a silent upstream CDP WebSocket handshake to five seconds', async () => {
  const f = await fixture('cdp-silent-upgrade');
  const group = await f.runtime.create(0);
  const adapter = await group.cdp();
  const socket = new WebSocket(adapter.endpoint, { headers: adapter.headers });
  socket.on('error', () => {});
  const closed = once(socket, 'close').catch(() => {});
  const timer = setTimeout(() => socket.terminate(), 6500);
  const started = performance.now();
  await closed;
  clearTimeout(timer);
  expect(performance.now() - started).toBeLessThan(6000);
  await group.close();
}, 12_000);

it('cancels original HPD acquisition at the peer accept deadline, not a fresh five seconds', async () => {
  const f = await fixture('cdp');
  const group = await f.runtime.create(0);
  const adapter = await group.cdp();
  f.hooks.dataMode = 'silent-data';
  const url = new URL(adapter.endpoint);
  const socket = net.connect(Number(url.port), '127.0.0.1');
  const closed = once(socket, 'close');
  socket.on('error', () => {});
  socket.resume();
  await once(socket, 'connect');
  await new Promise<void>((resolve) => setTimeout(resolve, 4000));
  socket.write(
    `GET /cdp HTTP/1.1\r\nHost: ${url.host}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: MDEyMzQ1Njc4OWFiY2RlZg==\r\nx-holaday-cdp: ${adapter.headers['x-holaday-cdp']}\r\n\r\n`,
  );
  await closed;
  expect(f.counts.data).toBe(2);
  await vi.waitFor(() => expect(f.counts.closedData).toBe(2), { timeout: 400 });
}, 12_000);

it('vetoes actual backend writes when adapter close reenters the endpoint guard', async () => {
  const f = await fixture('cdp');
  const group = await f.runtime.create(0);
  const adapter = await group.cdp();
  const socket = new WebSocket(adapter.endpoint, { headers: adapter.headers });
  socket.on('error', () => {});
  await once(socket, 'open');
  let closing: Promise<void> | undefined;
  const originalWrite = BrokerDataConnection.prototype._write;
  vi.spyOn(BrokerDataConnection.prototype, '_write').mockImplementation(function (
    this: BrokerDataConnection,
    chunk,
    encoding,
    complete,
  ) {
    if (Buffer.isBuffer(chunk) && chunk[0] === 0x81) {
      f.hooks.beforeDispatch = () => {
        closing ??= adapter.close();
      };
      try {
        return originalWrite.call(this, chunk, encoding, complete);
      } finally {
        f.hooks.beforeDispatch = () => {};
      }
    }
    return originalWrite.call(this, chunk, encoding, complete);
  });
  const closed = once(socket, 'close').catch(() => {});
  socket.send('synthetic-cdp');
  await closed;
  expect(closing).toBeDefined();
  await closing;
  await vi.waitFor(() => expect(f.counts.closedData).toBe(2));
  expect(f.counts.messages).toBe(0);
});

it('expires an incomplete CDP authentication request from original accept time', async () => {
  const f = await fixture('cdp');
  const group = await f.runtime.create(0);
  const adapter = await group.cdp();
  const port = Number(new URL(adapter.endpoint).port);
  const socket = net.connect(port, '127.0.0.1');
  const closed = once(socket, 'close');
  socket.on('error', () => {});
  socket.resume();
  await once(socket, 'connect');
  const started = performance.now();
  socket.write('G');
  const fallback = setTimeout(() => socket.destroy(), 6500);
  await closed;
  clearTimeout(fallback);
  expect(performance.now() - started).toBeLessThan(6000);
  expect(f.counts.data).toBe(1);
}, 12_000);

it.each(['write', 'end'])(
  'keeps CDP cleanup pending until the original client %s receipt returns',
  async (mode) => {
    const f = await fixture('cdp');
    const group = await f.runtime.create(0);
    const adapter = await group.cdp();
    const port = Number(new URL(adapter.endpoint).port);
    let armed = false;
    let receipt: (() => void) | undefined;
    let heldSocket: net.Socket | undefined;
    let physicalClose: Promise<unknown> | undefined;
    const originalWrite = net.Socket.prototype._write;
    if (mode === 'write')
      vi.spyOn(net.Socket.prototype, '_write').mockImplementation(function (
        this: net.Socket,
        chunk,
        encoding,
        complete,
      ) {
        if (armed && this.localPort === port) {
          heldSocket = this;
          physicalClose = once(this, 'close');
          return originalWrite.call(this, chunk, encoding, (error) => {
            receipt = () => complete(error);
          });
        }
        return originalWrite.call(this, chunk, encoding, complete);
      });
    const originalFinal = net.Socket.prototype._final;
    if (mode === 'end')
      vi.spyOn(net.Socket.prototype, '_final').mockImplementation(function (
        this: net.Socket,
        complete,
      ) {
        if (this.localPort === port) {
          heldSocket = this;
          physicalClose = once(this, 'close');
          return originalFinal.call(this, (error) => {
            receipt = () => complete(error);
          });
        }
        return originalFinal.call(this, complete);
      });
    const socket = new WebSocket(adapter.endpoint, { headers: adapter.headers });
    socket.on('error', () => {});
    await once(socket, 'open');
    armed = true;
    if (mode === 'write') socket.send('synthetic-cdp');
    else socket.close();
    await vi.waitFor(() => expect(receipt).toBeDefined());
    expect(heldSocket).toBeDefined();
    const rawClosed = physicalClose;
    let settled = false;
    const closing = adapter.close().then(() => {
      settled = true;
    });
    try {
      await rawClosed;
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(settled).toBe(false);
    } finally {
      receipt?.();
      await closing;
      socket.terminate();
    }
  },
);

it('does not open original HPD after group closes in the final peer clock check', async () => {
  const f = await fixture('cdp');
  const group = await f.runtime.create(0);
  const adapter = await group.cdp();
  const originalAcquire = BrokerDataConnection.acquire;
  const now = performance.now.bind(performance);
  let entered = false;
  let calls = 0;
  let closing: Promise<void> | undefined;
  vi.spyOn(performance, 'now').mockImplementation(() => {
    const value = now();
    // Original acquire reads its start clock, then two complete guards before
    // connect. Read 8 is the second guard's final peer scope clock.
    if (entered && ++calls === 8) closing = group.close();
    return value;
  });
  vi.spyOn(BrokerDataConnection, 'acquire').mockImplementation((options) => {
    entered = true;
    try {
      return originalAcquire(options);
    } finally {
      entered = false;
    }
  });
  const socket = new WebSocket(adapter.endpoint, { headers: adapter.headers });
  socket.on('error', () => {});
  await once(socket, 'close').catch(() => {});
  expect(closing).toBeDefined();
  await closing;
  // Flush the actual data listener with a marker, not an event-loop guess.
  await f.flushData();
  expect(f.counts.data).toBe(2);
});
