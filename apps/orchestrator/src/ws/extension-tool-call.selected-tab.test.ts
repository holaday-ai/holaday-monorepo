import { WS_SUBPROTOCOL, parseServerMessage } from '@holaday/shared-types';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';
import { BrowserControl } from '../agent/supercar/browser-control.js';
import { SelectedChromeClient } from '../agent/supercar/selected-chrome-client.js';
import { createWsServer, sendExtensionToolCall } from './server.js';

type Server = ReturnType<typeof createWsServer>;
const servers: Server[] = [];
const sockets: WebSocket[] = [];
const target = {
  tabId: 42,
  expectedUrl: 'https://work.example/projects',
  selectionId: 'e2215e8d-7b6c-4711-ab15-460f51e558a4',
};

async function setup() {
  const server = createWsServer(0, { authenticateToken: async (token) => token });
  servers.push(server);
  await server.ready;
  const address = server.wss.address();
  if (!address || typeof address === 'string') throw new Error('no test listener');
  const port = address.port;
  async function connect(userId = 'selected-user') {
    const socket = new WebSocket(`ws://127.0.0.1:${port}`, WS_SUBPROTOCOL);
    sockets.push(socket);
    const calls: unknown[] = [];
    const welcome = new Promise<string>((resolve, reject) => {
      socket.once('error', reject);
      socket.on('message', (raw) => {
        const parsed = parseServerMessage(raw.toString());
        if (!parsed.success) return;
        const message = parsed.data;
        if (message.type === 'server.welcome') resolve(message.clientId);
        if (message.type === 'server.extension.tool_call') {
          calls.push(message);
          const command = message.args?.session;
          const result =
            message.kind === 'session' && command
              ? command.op === 'close'
                ? { ok: true, closed: true }
                : {
                    ok: true,
                    sessionId: target.selectionId,
                    observation: {
                      tabId: 42,
                      origin: 'https://work.example',
                      title: 'Projects',
                      bodyText: command.op === 'act' ? 'Saved' : 'Draft',
                      ariaSnapshot: '- button "Save"',
                      truncated: false,
                    },
                    ...(command.op === 'act' ? { actionOutcome: 'applied' } : {}),
                  }
              : { tabId: 42, from: userId, extensionClientId: 'untrusted-page-value' };
          socket.send(
            JSON.stringify({
              type: 'client.extension.tool_result',
              taskId: message.taskId,
              requestId: message.requestId,
              ok: true,
              result,
              at: Date.now(),
            }),
          );
        }
      });
    });
    socket.once('open', () =>
      socket.send(
        JSON.stringify({
          type: 'client.hello',
          token: userId,
          extensionVersion: 'selected-tab-test',
        }),
      ),
    );
    return { socket, clientId: await welcome, calls };
  }
  return { server, connect };
}

afterEach(async () => {
  vi.restoreAllMocks();
  for (const socket of sockets.splice(0)) socket.terminate();
  for (const server of servers.splice(0)) await server.close();
});

describe('local Chrome connection pinning', () => {
  it('runs the controlled client through the real pinned WebSocket transport', async () => {
    const { connect } = await setup();
    const browser = await connect();
    const unrelated = await connect();
    const client = new SelectedChromeClient({
      userId: 'selected-user',
      taskId: 'controlled-ws-task',
      extensionClientId: browser.clientId,
      control: new BrowserControl(),
      send: sendExtensionToolCall,
    });
    expect(await client.open(target)).toMatchObject({
      ok: true,
      observation: { bodyText: 'Draft' },
    });
    expect(
      await client.execute({ kind: 'key', payload: { key: 'Enter' } }, client.revision),
    ).toMatchObject({ ok: true, actionOutcome: 'applied', observation: { bodyText: 'Saved' } });
    expect(await client.close()).toMatchObject({ ok: true, closed: true });
    expect(browser.calls).toHaveLength(3);
    expect(unrelated.calls).toHaveLength(0);
  });
  it('rejects all selected-session commands without a pinned connection', async () => {
    const { connect } = await setup();
    const browser = await connect();
    expect(
      await sendExtensionToolCall('selected-user', {
        taskId: 'session-task',
        kind: 'session',
        timeoutMs: 1000,
        args: { session: { op: 'open', target } },
      }),
    ).toMatchObject({ ok: false, error: { code: 'target_required' } });
    expect(browser.calls).toHaveLength(0);
  });

  it('pins session actions to the selected connection', async () => {
    const { connect } = await setup();
    const first = await connect();
    const second = await connect();
    const command = {
      op: 'act' as const,
      sessionId: 'e2215e8d-7b6c-4711-ab15-460f51e558a4',
      action: { kind: 'key' as const, payload: { key: 'Enter' } },
    };
    expect(
      await sendExtensionToolCall('selected-user', {
        taskId: 'session-task',
        kind: 'session',
        extensionClientId: first.clientId,
        args: { session: command },
      }),
    ).toMatchObject({ ok: true, extensionClientId: first.clientId });
    expect(first.calls).toEqual([
      expect.objectContaining({ kind: 'session', args: { session: command } }),
    ]);
    expect(second.calls).toHaveLength(0);
  });
  it('returns the actual extension connection identity with tab discovery', async () => {
    const { connect } = await setup();
    const browser = await connect();
    expect(
      await sendExtensionToolCall('selected-user', { taskId: 'tabs-task', kind: 'tabs' }),
    ).toMatchObject({ ok: true, extensionClientId: browser.clientId });
  });

  it('sends the read to the selected profile even when another profile shares its tab ID', async () => {
    const { connect } = await setup();
    const first = await connect();
    const second = await connect();
    // Select the second profile explicitly. The old picker keeps the first on
    // equal timestamps, or may prefer the second when clocks differ; test both.
    for (const browser of [second, first]) {
      expect(
        await sendExtensionToolCall('selected-user', {
          taskId: 'read-task',
          kind: 'read',
          args: { target },
          extensionClientId: browser.clientId,
        }),
      ).toMatchObject({ ok: true, extensionClientId: browser.clientId });
    }
    expect(first.calls).toHaveLength(1);
    expect(second.calls).toHaveLength(1);
    expect(first.calls[0]).toMatchObject({ kind: 'read', args: { target } });
  });

  it('rejects a read without connection identity before dispatch', async () => {
    const { connect } = await setup();
    const browser = await connect();
    expect(
      await sendExtensionToolCall('selected-user', {
        taskId: 'read-task',
        kind: 'read',
        args: { target },
      }),
    ).toMatchObject({ ok: false, error: { code: 'target_required' } });
    expect(browser.calls).toHaveLength(0);
  });

  it('never substitutes another user or a disconnected profile', async () => {
    const { connect } = await setup();
    const own = await connect();
    const other = await connect('other-user');
    for (const extensionClientId of [other.clientId, 'disconnected-profile']) {
      expect(
        await sendExtensionToolCall('selected-user', {
          taskId: 'read-task',
          kind: 'read',
          args: { target },
          extensionClientId,
        }),
      ).toMatchObject({ ok: false, error: { code: 'target_extension_unavailable' } });
    }
    expect(own.calls).toHaveLength(0);
    expect(other.calls).toHaveLength(0);
  });

  it('does not fail over after a selected connection send fails', async () => {
    const { server, connect } = await setup();
    const selected = await connect();
    const serverSocket = [...server.wss.clients][0];
    if (!serverSocket) throw new Error('no selected server socket');
    const other = await connect();
    vi.spyOn(serverSocket, 'send').mockImplementation(() => {
      throw new Error('closed during send');
    });
    expect(
      await sendExtensionToolCall('selected-user', {
        taskId: 'read-task',
        kind: 'read',
        args: { target },
        extensionClientId: selected.clientId,
      }),
    ).toMatchObject({ ok: false, error: { code: 'socket_closed' } });
    expect(other.calls).toHaveLength(0);
  });
});
