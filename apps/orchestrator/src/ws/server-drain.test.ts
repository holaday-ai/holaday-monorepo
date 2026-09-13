import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WS_SUBPROTOCOL } from '@holaday/shared-types';
import { afterEach, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';
import { TaskController } from '../agent/task-controller.js';
import { TaskRepository } from '../agent/task-repository.js';
import { DrainController } from '../execution/drain-controller.js';
import {
  currentOperationLifetime,
  withOperationDispatchScope,
} from '../execution/owned-operation.js';
import { createWsWork } from './server-work.js';
import {
  type WsServerOpts,
  createWsServer,
  loadRehydratedTasks,
  sendExtensionToolCall,
} from './server.js';

vi.mock('../config/logger.js', async () => ({
  logger: (await import('pino')).pino({ level: 'silent' }),
}));
const roots: string[] = [];
const controllers: DrainController[] = [];
const servers: ReturnType<typeof createWsServer>[] = [];
const failedServers = new WeakSet<ReturnType<typeof createWsServer>>();
const clients: WebSocket[] = [];
const releases: Array<() => void> = [];
it.each([false, true])(
  'immediate WS close retains the original bind receipt (occupied=%s)',
  async (busy) => {
    const occupied = createServer();
    await new Promise<void>((resolve) => occupied.listen(0, resolve));
    try {
      const address = occupied.address();
      if (!address || typeof address === 'string') throw new Error('missing test port');
      const server = createWsServer(busy ? address.port : 0);
      // Only the fixture observes raw errors in RED to prevent a process crash;
      // ready must still be settled by the real server's original event listener.
      const raw = Reflect.get(server.wss, '_server');
      raw.on('error', () => {});
      let receipt = 'pending';
      void server.ready.then(
        () => {
          receipt = 'listening';
        },
        () => {
          receipt = 'failed';
        },
      );
      const stopped = server.close();
      expect(server.close()).toBe(stopped);
      await stopped;
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(receipt).toBe(busy ? 'failed' : 'listening');
      expect(raw.listening).toBe(false);
    } finally {
      await new Promise<void>((resolve) => occupied.close(() => resolve()));
    }
  },
);
it('rejects readiness on a real occupied WS port and retains an awaitable close', async () => {
  const occupied = createServer();
  await new Promise<void>((resolve) => occupied.listen(0, resolve));
  try {
    const address = occupied.address();
    if (!address || typeof address === 'string') throw new Error('missing test port');
    const server = createWsServer(address.port);
    // Observe the real error even in RED; do not let the fixture crash Vitest.
    const error = new Promise<void>((resolve) => server.wss.once('error', () => resolve()));
    await error;
    try {
      expect(server.ready).toBeInstanceOf(Promise);
      await expect(server.ready).rejects.toThrow('WS_LISTEN_UNPROVEN');
    } finally {
      await server.close();
    }
    expect(occupied.listening).toBe(true);
  } finally {
    await new Promise<void>((resolve) => occupied.close(() => resolve()));
  }
});
function hold() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  releases.push(release);
  return { promise, release };
}
async function control(open = true) {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'hd-ws-drain-')));
  roots.push(directory);
  const identity = { epoch: 'a'.repeat(32), candidate: 'b'.repeat(40), bootId: 'c'.repeat(32) };
  writeFileSync(
    join(directory, 'state.json'),
    `${JSON.stringify({
      schemaVersion: 1,
      ...identity,
      bootId: 'd'.repeat(32),
      sequence: 1,
      mode: 'closed',
      dirty: false,
    })}\n`,
    { mode: 0o600 },
  );
  const controller = new DrainController(directory, identity, async () => {}, {
    wall: () => 100000,
    mono: () => 1000,
  });
  controllers.push(controller);
  const session = controller.connect();
  if (open)
    expect(
      (
        await controller.execute(
          session,
          Buffer.from(
            `${JSON.stringify({
              protocol: 1,
              op: 'open',
              ...identity,
              version: 2,
              serial: 1,
              expiresAt: 110000,
            })}\n`,
          ),
        )
      ).ok,
    ).toBe(true);
  return { controller, close: () => controller.disconnect(session) };
}
async function connect(
  controller: DrainController | undefined,
  auth: WsServerOpts['authenticateToken'],
  jwt = true,
) {
  const opts: WsServerOpts = {
    executionDrain: controller,
    authenticateToken: auth,
    sessionRevalidationIntervalMs: 60000,
  };
  const server = createWsServer(0, opts);
  servers.push(server);
  await new Promise<void>((resolve) => server.wss.once('listening', resolve));
  const address = server.wss.address();
  if (!address || typeof address === 'string') throw new Error('missing local port');
  const client = new WebSocket(
    `ws://127.0.0.1:${address.port}`,
    jwt ? [WS_SUBPROTOCOL, 'jwt.synthetic-drain-token'] : [WS_SUBPROTOCOL],
  );
  clients.push(client);
  const messages: Array<{ type: string; code?: string }> = [];
  client.on('message', (raw) => messages.push(JSON.parse(raw.toString())));
  client.on('error', () => {});
  await new Promise<void>((resolve) => client.once('open', resolve));
  return { client, server, messages };
}
afterEach(async () => {
  for (const release of releases.splice(0)) release();
  for (const client of clients.splice(0)) client.terminate();
  for (const server of servers.splice(0)) {
    for (const client of server.wss.clients) client.terminate();
    if (failedServers.has(server)) await expect(server.close()).rejects.toThrow('WS_STOP_FAILED');
    else await server.close();
  }
  await new Promise<void>((resolve) => setImmediate(resolve));
  for (const controller of controllers.splice(0)) controller.state.abandon();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true });
  vi.restoreAllMocks();
});

it('rejects a closed connection before invoking its authenticator', async () => {
  const f = await control(false);
  let calls = 0;
  const c = await connect(f.controller, async () => {
    calls++;
    return 'synthetic-ws';
  });
  await vi.waitFor(() => expect(c.client.readyState).toBe(WebSocket.CLOSED));
  expect(calls).toBe(0);
  expect(f.controller.state.read().dirty).toBe(false);
});

it('server-work stop during root reservation cannot finish before the original root', async () => {
  const f = await control();
  const work = createWsWork(f.controller);
  let activeAtStop: number | undefined;
  let stopping: Promise<void> | undefined;
  const original = f.controller.drain.assertDispatch.bind(f.controller.drain);
  vi.spyOn(f.controller.drain, 'assertDispatch').mockImplementation((owner) => {
    original(owner);
    if (!stopping)
      stopping = work.stop().then(() => {
        activeAtStop = f.controller.drain.snapshot().active;
      });
  });
  const pending = work.run(async () => {});
  await pending;
  await stopping;
  expect(activeAtStop).toBe(0);
});

it.each(['root', 'child'])(
  'does not invoke a %s action if the last original guard stops the server',
  async (kind) => {
    const f = await control();
    const work = createWsWork(f.controller);
    let calls = 0;
    let armed = false;
    let stopping: Promise<void> | undefined;
    const original = f.controller.drain.assertDispatch.bind(f.controller.drain);
    vi.spyOn(f.controller.drain, 'assertDispatch').mockImplementation((owner) => {
      original(owner);
      if (armed && (kind === 'child' || currentOperationLifetime()?.owner === owner)) {
        armed = false;
        stopping = work.stop();
        void stopping.catch(() => {});
      }
    });
    const action = async () => {
      calls++;
    };
    const pending =
      kind === 'root'
        ? (() => {
            armed = true;
            return work.run(action);
          })()
        : f.controller.runRoot(async (parent) => {
            const result = work.child(currentOperationLifetime() ?? parent, action);
            armed = true;
            return result;
          }).result;
    await pending?.catch(() => undefined);
    await stopping?.catch(() => undefined);
    expect(stopping).toBeDefined();
    expect(calls).toBe(0);
  },
);

it('owns the original subprotocol authentication after the client disconnects', async () => {
  const f = await control();
  const auth = hold();
  let started = false;
  let owned = false;
  const c = await connect(f.controller, async () => {
    started = true;
    owned =
      f.controller.state.read().dirty && currentOperationLifetime()?.drain === f.controller.drain;
    await auth.promise;
    return 'synthetic-ws';
  });
  await vi.waitFor(() => expect(started).toBe(true));
  const originalSocket = [...c.server.wss.clients][0];
  f.close();
  c.client.terminate();
  await vi.waitFor(() => expect(c.server.wss.clients.size).toBe(0));
  expect(owned).toBe(true);
  expect(f.controller.drain.snapshot().idle).toBe(false);
  auth.release();
  await vi.waitFor(() => expect(f.controller.drain.snapshot().idle).toBe(true));
  expect(originalSocket?.listenerCount('message')).toBe(0);
});

it('server close waits for original authentication even after its listener and sockets close', async () => {
  const f = await control();
  const auth = hold();
  let entered = false;
  const c = await connect(f.controller, async () => {
    entered = true;
    await auth.promise;
    return null;
  });
  await vi.waitFor(() => expect(entered).toBe(true));
  c.client.terminate();
  await vi.waitFor(() => expect(c.server.wss.clients.size).toBe(0));
  let stopped = false;
  const stopping = c.server.close().then(() => {
    stopped = true;
  });
  await new Promise<void>((resolve) => setTimeout(resolve, 30));
  expect(stopped).toBe(false);
  auth.release();
  await stopping;
  expect(stopped).toBe(true);
});

it('server shutdown closes idle clients itself after original work settles', async () => {
  const f = await control();
  const c = await connect(f.controller, async () => 'synthetic-idle');
  await vi.waitFor(() => expect(f.controller.drain.snapshot().active).toBe(0));
  const stopping = c.server.close();
  // No client.close/terminate assist: the actual server owns orderly shutdown.
  await vi.waitFor(() => expect(c.client.readyState).toBe(WebSocket.CLOSED), { timeout: 300 });
  await stopping;
  expect(c.server.wss.clients.size).toBe(0);
});

it('shutdown preserves a client channel while its original authenticator is pending', async () => {
  const f = await control();
  const auth = hold();
  let entered = false;
  const c = await connect(f.controller, async () => {
    entered = true;
    await auth.promise;
    return null;
  });
  await vi.waitFor(() => expect(entered).toBe(true));
  const stopping = c.server.close();
  await new Promise<void>((resolve) => setImmediate(resolve));
  expect(c.client.readyState).toBe(WebSocket.OPEN);
  auth.release();
  await stopping;
});

it('refuses a new hello after admission closes without closing the existing result channel', async () => {
  const f = await control();
  let calls = 0;
  const c = await connect(f.controller, async () => {
    calls++;
    return 'synthetic-ws';
  });
  await vi.waitFor(() => expect(c.messages.some((m) => m.type === 'server.welcome')).toBe(true));
  expect(calls).toBe(1);
  f.close();
  c.client.send(JSON.stringify({ type: 'client.hello', token: 'synthetic-new-token' }));
  await vi.waitFor(() =>
    expect(c.messages.some((m) => m.code === 'SERVICE_UNAVAILABLE')).toBe(true),
  );
  expect(calls).toBe(1);
  expect(c.client.readyState).toBe(WebSocket.OPEN);
});

it('retains an in-flight hello authentication when the socket closes', async () => {
  const f = await control();
  const auth = hold();
  let calls = 0;
  const c = await connect(
    f.controller,
    async () => {
      calls++;
      await auth.promise;
      return null;
    },
    false,
  );
  c.client.send(JSON.stringify({ type: 'client.hello', token: 'synthetic-first-token' }));
  await vi.waitFor(() => expect(calls).toBe(1));
  f.close();
  c.client.terminate();
  await vi.waitFor(() => expect(c.server.wss.clients.size).toBe(0));
  expect(f.controller.drain.snapshot().idle).toBe(false);
  auth.release();
  await vi.waitFor(() => expect(f.controller.drain.snapshot().idle).toBe(true));
});

async function extension(controller: DrainController) {
  const c = await connect(controller, async () => 'synthetic-ws-extension', false);
  c.client.send(
    JSON.stringify({
      type: 'client.hello',
      token: 'synthetic-extension',
      extensionVersion: 'test',
    }),
  );
  await vi.waitFor(() => expect(c.messages.some((m) => m.type === 'server.welcome')).toBe(true));
  return c;
}

it.each([true, false])(
  'recovery cannot recreate strict execution authority (strict=%s)',
  async (strict) => {
    const f = await control();
    const { state } = new TaskController().start({
      state: null,
      taskId: 'synthetic-recovery-task',
      plan: [
        {
          id: 'synthetic-recovery-step',
          kind: 'goto',
          risk: 'low',
          payload: { url: 'https://example.com/' },
        },
      ],
    });
    expect(state.status).toBe('executing');
    const storage = vi.spyOn(TaskRepository.prototype, 'rehydrateInFlight').mockResolvedValue([
      {
        state,
        userExternalId: 'synthetic-recovery-user',
        pendingConfirm: null,
        pauseReason: null,
        pauseMessage: null,
        awaitingQuestion: null,
        awaitingKind: null,
      },
    ]);
    await expect(loadRehydratedTasks()).resolves.toEqual({ userCount: 1, taskCount: 1 });
    const c = await connect(
      strict ? f.controller : undefined,
      async () => 'synthetic-recovery-user',
      false,
    );
    c.client.send(JSON.stringify({ type: 'client.hello', token: 'synthetic-recovery-token' }));
    await vi.waitFor(() => expect(c.messages.some((m) => m.type === 'server.welcome')).toBe(true));
    [...c.server.wss.clients][0]?.send(JSON.stringify({ type: 'synthetic.marker' }));
    await vi.waitFor(() =>
      expect(c.messages.some((m) => m.type === 'synthetic.marker')).toBe(true),
    );
    storage.mockResolvedValue([]);
    await loadRehydratedTasks();
    expect(c.messages.filter((m) => m.type === 'server.task.dispatch')).toHaveLength(
      strict ? 0 : 1,
    );
  },
);

it.each(['before deferred action', 'during serialization'])(
  'retains the original caller veto %s',
  async (when) => {
    const f = await control();
    const c = await extension(f.controller);
    c.client.on('message', (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.type === 'server.extension.tool_call')
        c.client.send(
          JSON.stringify({
            type: 'client.extension.tool_result',
            requestId: msg.requestId,
            taskId: msg.taskId,
            ok: true,
            at: 1,
          }),
        );
    });
    const root = f.controller.runRoot(async () =>
      withOperationDispatchScope((seal) => {
        const args = {
          url: 'https://example.com/',
          toJSON() {
            if (when === 'during serialization') seal();
            return {};
          },
        };
        const pending = sendExtensionToolCall('synthetic-ws-extension', {
          taskId: 'synthetic-task',
          kind: 'screenshot',
          args,
        });
        if (when === 'before deferred action') seal();
        return pending;
      }),
    );
    await root.result.catch(() => {
      failedServers.add(c.server);
    });
    [...c.server.wss.clients][0]?.send(JSON.stringify({ type: 'synthetic.marker' }));
    await vi.waitFor(() =>
      expect(c.messages.some((m) => m.type === 'synthetic.marker')).toBe(true),
    );
    expect(c.messages.filter((m) => m.type === 'server.extension.tool_call')).toHaveLength(0);
  },
);

it('does not mint execution ownership from an unsolicited strict step-result message', async () => {
  const f = await control();
  const c = await extension(f.controller);
  c.client.send(
    JSON.stringify({
      type: 'client.step.result',
      taskId: 'synthetic-task',
      stepId: 'synthetic-step',
      status: 'ok',
    }),
  );
  await vi.waitFor(() => expect(c.messages.some((m) => m.code === 'UNEXPECTED_RESULT')).toBe(true));
});

it('requires the original caller lifetime before sending on a strict extension channel', async () => {
  const f = await control();
  const c = await extension(f.controller);
  let calls = 0;
  c.client.on('message', (raw) => {
    const msg = JSON.parse(raw.toString());
    if (msg.type === 'server.extension.tool_call') {
      calls++;
      c.client.send(
        JSON.stringify({
          type: 'client.extension.tool_result',
          taskId: msg.taskId,
          requestId: msg.requestId,
          ok: true,
          at: 1,
        }),
      );
    }
  });
  const result = await sendExtensionToolCall('synthetic-ws-extension', {
    taskId: 'synthetic-task',
    kind: 'screenshot',
  });
  expect(result).toMatchObject({ ok: false, error: { code: 'service_unavailable' } });
  expect(calls).toBe(0);
});

it('accepts an original pending tool result after admission closes', async () => {
  const f = await control();
  const c = await extension(f.controller);
  let command: { taskId: string; requestId: string } | undefined;
  c.client.on('message', (raw) => {
    const msg = JSON.parse(raw.toString());
    if (msg.type === 'server.extension.tool_call')
      command = { taskId: msg.taskId, requestId: msg.requestId };
  });
  const root = f.controller.runRoot(async () =>
    sendExtensionToolCall('synthetic-ws-extension', {
      taskId: 'synthetic-task',
      kind: 'screenshot',
    }),
  );
  await vi.waitFor(() => expect(command).toBeDefined());
  f.close();
  expect(f.controller.drain.snapshot().idle).toBe(false);
  c.client.send(
    JSON.stringify({ type: 'client.extension.tool_result', ...command, ok: true, at: 1 }),
  );
  await expect(root.result).resolves.toMatchObject({ ok: true });
  await vi.waitFor(() =>
    expect(f.controller.drain.snapshot()).toMatchObject({ idle: true, unknown: 0 }),
  );
});

it('does not mistake a disconnected extension for a completed remote action', async () => {
  const f = await control();
  const c = await extension(f.controller);
  let sent = false;
  c.client.on('message', (raw) => {
    if (JSON.parse(raw.toString()).type === 'server.extension.tool_call') {
      sent = true;
      c.client.terminate();
    }
  });
  const root = f.controller.runRoot(async () =>
    sendExtensionToolCall('synthetic-ws-extension', {
      taskId: 'synthetic-task',
      kind: 'navigate',
      args: { url: 'https://example.com/' },
    }),
  );
  await expect(root.result).resolves.toMatchObject({ ok: false, error: { code: 'socket_closed' } });
  expect(sent).toBe(true);
  f.close();
  expect(f.controller.drain.snapshot()).toMatchObject({ active: 0, unknown: 1, idle: false });
});

it('a strict extension timeout retains an unknown remote action rather than declaring idle', async () => {
  const f = await control();
  await extension(f.controller);
  const root = f.controller.runRoot(async () =>
    sendExtensionToolCall('synthetic-ws-extension', {
      taskId: 'synthetic-task',
      kind: 'screenshot',
      timeoutMs: 1000,
    }),
  );
  await expect(root.result).resolves.toMatchObject({ ok: false, error: { code: 'timeout' } });
  f.close();
  expect(f.controller.drain.snapshot()).toMatchObject({ active: 0, unknown: 1, idle: false });
});

it('retains the original send callback even when the remote result arrived first', async () => {
  const f = await control();
  const c = await extension(f.controller);
  const socket = [...c.server.wss.clients][0];
  if (!socket) throw new Error('missing original socket');
  const originalSend = socket.send;
  let finishSend: (() => void) | undefined;
  releases.push(() => finishSend?.());
  vi.spyOn(socket, 'send').mockImplementation((data, options, callback) => {
    const done = typeof options === 'function' ? options : callback;
    originalSend.call(socket, data, {}, (error?: Error) => {
      finishSend = () => done?.(error);
    });
  });
  let gotResult = false;
  c.client.on('message', (raw) => {
    const msg = JSON.parse(raw.toString());
    if (msg.type === 'server.extension.tool_call') {
      c.client.send(
        JSON.stringify({
          type: 'client.extension.tool_result',
          taskId: msg.taskId,
          requestId: msg.requestId,
          ok: true,
          at: 1,
        }),
      );
      gotResult = true;
    }
  });
  let finished = false;
  const root = f.controller.runRoot(async () =>
    sendExtensionToolCall('synthetic-ws-extension', {
      taskId: 'synthetic-task',
      kind: 'screenshot',
    }),
  );
  void root.result.then(() => {
    finished = true;
  });
  await vi.waitFor(() => expect(gotResult && finishSend !== undefined).toBe(true));
  f.close();
  await new Promise<void>((resolve) => setTimeout(resolve, 30));
  expect(finished).toBe(false);
  expect(f.controller.drain.snapshot().idle).toBe(false);
  finishSend?.();
  await expect(root.result).resolves.toMatchObject({ ok: true });
  await vi.waitFor(() => expect(f.controller.drain.snapshot().idle).toBe(true));
});

it('a controller revoked by payload serialization vetoes the actual socket send', async () => {
  const f = await control();
  const c = await extension(f.controller);
  let sent = 0;
  c.client.on('message', (raw) => {
    if (JSON.parse(raw.toString()).type === 'server.extension.tool_call') sent++;
  });
  const args = {
    url: 'https://example.com/',
    toJSON() {
      f.controller.drain.block();
      return { url: 'https://example.com/' };
    },
  };
  const root = f.controller.runRoot(async () =>
    sendExtensionToolCall('synthetic-ws-extension', {
      taskId: 'synthetic-task',
      kind: 'navigate',
      args,
    }),
  );
  await expect(root.result).resolves.toMatchObject({ ok: false });
  await new Promise<void>((resolve) => setTimeout(resolve, 30));
  expect(sent).toBe(0);
  expect(f.controller.drain.snapshot().idle).toBe(false);
});

it('a strict extension cannot borrow another controllers live caller', async () => {
  const f = await control();
  const other = await control();
  const c = await extension(f.controller);
  let sent = 0;
  c.client.on('message', (raw) => {
    if (JSON.parse(raw.toString()).type === 'server.extension.tool_call') sent++;
  });
  const root = other.controller.runRoot(async () =>
    sendExtensionToolCall('synthetic-ws-extension', {
      taskId: 'synthetic-task',
      kind: 'screenshot',
    }),
  );
  await expect(root.result).resolves.toMatchObject({
    ok: false,
    error: { code: 'service_unavailable' },
  });
  expect(sent).toBe(0);
});
