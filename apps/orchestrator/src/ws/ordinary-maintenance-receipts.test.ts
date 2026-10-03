import { WS_SUBPROTOCOL } from '@holaday/shared-types';
import { afterEach, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';
import { type MaintenanceRecord, OrdinaryMaintenance } from '../execution/ordinary-maintenance.js';
import { createWsServer, getExtensionLoginState, sendExtensionToolCall } from './server.js';

const cleanup: (() => Promise<void>)[] = [];
async function fixture() {
  const identity = { candidate: 'a'.repeat(40), bootId: 'b'.repeat(32) };
  let record: MaintenanceRecord = { identity, mode: 'closed', needsReconciliation: false };
  const m = new OrdinaryMaintenance({
    identity,
    journal: {
      read: () => structuredClone(record),
      persist: (next) => {
        record = { identity, ...next };
      },
    },
    checks: {
      verifyReady: async () => {},
      stopProducers: async () => {},
      verifyRetainedQueue: async () => {},
    },
  });
  await m.resumeServing();
  const server = createWsServer(0, {
    executionDrain: m,
    ordinaryMaintenance: m,
    authenticateToken: async (token) => token,
  });
  await server.ready;
  const address = server.wss.address();
  if (!address || typeof address === 'string') throw new Error('test listener');
  const port = address.port;
  const sockets: WebSocket[] = [];
  cleanup.push(async () => {
    for (const socket of sockets) socket.terminate();
    await server.close();
  });
  async function connect(userId: string) {
    const socket = new WebSocket(`ws://127.0.0.1:${port}`, WS_SUBPROTOCOL);
    sockets.push(socket);
    const messages: Array<{
      type: string;
      code?: string;
      clientId?: string;
      taskId?: string;
      requestId?: string;
    }> = [];
    socket.on('error', () => {});
    socket.on('message', (bytes) => messages.push(JSON.parse(bytes.toString())));
    await new Promise<void>((resolve) => socket.once('open', resolve));
    socket.send(
      JSON.stringify({ type: 'client.hello', token: userId, extensionVersion: 'maintenance-qa' }),
    );
    await vi.waitFor(() => expect(messages.some((v) => v.type === 'server.welcome')).toBe(true));
    return {
      socket,
      messages,
      clientId: messages.find((v) => v.type === 'server.welcome')?.clientId,
    };
  }
  return { m, connect };
}
afterEach(async () => {
  for (const close of cleanup.splice(0)) await close();
});

it('preserves only the original pinned receipt while maintenance rejects new manual work', async () => {
  const { m, connect } = await fixture();
  const original = await connect('maintenance-owner');
  const foreign = await connect('maintenance-other');
  const call = m.runRoot(async () =>
    sendExtensionToolCall('maintenance-owner', {
      taskId: 'maintenance-task',
      kind: 'tabs',
      extensionClientId: original.clientId,
    }),
  );
  let completed = false;
  void call.result.then(() => {
    completed = true;
  });
  await vi.waitFor(() =>
    expect(original.messages.some((v) => v.type === 'server.extension.tool_call')).toBe(true),
  );
  const sent = original.messages.find((v) => v.type === 'server.extension.tool_call');
  if (!sent) throw new Error('missing command');
  await m.beginMaintenance();
  const receipt = {
    type: 'client.extension.tool_result',
    taskId: sent.taskId,
    requestId: sent.requestId,
    ok: true,
    result: { tabs: [] },
    at: Date.now(),
  };
  foreign.socket.send(JSON.stringify(receipt));
  original.socket.send(
    JSON.stringify({ ...receipt, requestId: '00000000-0000-4000-8000-000000000000' }),
  );
  original.socket.send(
    JSON.stringify({
      type: 'client.vision.user_input',
      taskId: 'maintenance-task',
      kind: 'click',
      x: 1,
      y: 1,
    }),
  );
  await vi.waitFor(() =>
    expect(original.messages.some((v) => v.code === 'SERVICE_UNAVAILABLE')).toBe(true),
  );
  expect(completed).toBe(false);
  expect(m.snapshot().counts.active).toBeGreaterThan(0);
  original.socket.send(JSON.stringify(receipt));
  await expect(call.result).resolves.toMatchObject({ ok: true });
  await m.waitForIdle(1000);
  expect(m.snapshot().mode).toBe('closed');
});
it('does not treat login-state updates as receipts during maintenance', async () => {
  const { m, connect } = await fixture();
  const browser = await connect('maintenance-login-owner');
  await m.beginMaintenance();
  browser.socket.send(
    JSON.stringify({
      type: 'client.extension.login_states',
      states: { 'example.com': true },
      at: Date.now(),
    }),
  );
  await vi.waitFor(() =>
    expect(browser.messages.some((v) => v.code === 'SERVICE_UNAVAILABLE')).toBe(true),
  );
  expect(getExtensionLoginState('maintenance-login-owner', 'example.com')).toBeNull();
});
