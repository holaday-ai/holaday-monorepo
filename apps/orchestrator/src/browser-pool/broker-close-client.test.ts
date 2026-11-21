import { mkdtemp, rm } from 'node:fs/promises';
import { type Socket, connect, createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { ExecutionDrain } from '../execution/execution-drain.js';
import type { OperationLifetime } from '../execution/owned-operation.js';
import * as clients from './broker-client.js';
import type { OriginalControlConnector } from './broker-client.js';
import { decodeBrokerControlFrame } from './broker-control-protocol.js';

interface CloseClient {
  stop(): Promise<object>;
  consume(receipt: object): void;
  close(): Promise<void>;
}
type CloseConstructor = new (options: {
  lifetime: OperationLifetime;
  connector: OriginalControlConnector;
  scope: { candidate: string; boot: string; resource: string; slot: number };
  capability: Buffer;
}) => CloseClient;
const candidate = 'a'.repeat(40);
const boot = 'b'.repeat(32);
const resource = 'c'.repeat(32);
const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});

// Independent canonical framing: this reply is byte input, never a capability injection.
function frame(value: object): Buffer {
  const raw = Buffer.from(JSON.stringify(Object.fromEntries(Object.entries(value).sort())));
  const prefix = Buffer.alloc(4);
  prefix.writeUInt32BE(raw.length);
  return Buffer.concat([prefix, raw]);
}

async function fixture(mode = 'ok') {
  const implementation = clients as unknown as { BrokerCloseClient?: CloseConstructor };
  expect(
    typeof implementation.BrokerCloseClient,
    'authenticated original-close client missing',
  ).toBe('function');
  const Constructor = implementation.BrokerCloseClient as CloseConstructor;
  const directory = await mkdtemp(join(tmpdir(), 'pool-close-'));
  const path = join(directory, 'control.sock');
  const peers = new Set<Socket>();
  const requests: string[] = [];
  let revoked = false;
  const drain = new ExecutionDrain(64, () => {
    if (revoked) throw new Error();
  });
  drain.open();
  const owner = drain.admit('execution');
  drain.pin(owner);
  let nativeCloses = 0;
  let nativeComplete!: () => void;
  const nativePending = new Promise<void>((resolve) => {
    nativeComplete = resolve;
  });
  let observedNative!: () => void;
  const nativeCalled = new Promise<void>((resolve) => {
    observedNative = resolve;
  });
  const server = createServer({ allowHalfOpen: true }, (socket) => {
    peers.add(socket);
    socket.on('error', () => {});
    socket.on('end', () => socket.end());
    let input = Buffer.alloc(0);
    socket.on('data', (chunk: Buffer) => {
      try {
        input = Buffer.concat([input, chunk]);
        if (input.length < 4 || input.length < input.readUInt32BE(0) + 4) return;
        const request = decodeBrokerControlFrame(input);
        if (
          !('action' in request) ||
          request.action !== 'close' ||
          request.boot !== boot ||
          request.capability !== 'd'.repeat(64)
        )
          throw new Error();
        requests.push(request.requestId);
        const reply = frame({
          version: 2,
          phase: 'terminal-observed',
          candidate,
          boot,
          resource: mode === 'scope' ? 'f'.repeat(32) : resource,
          slot: 0,
          requestId: request.requestId,
          closeId: 'e'.repeat(32),
          evidenceDigest: 'f'.repeat(64),
        });
        if (mode === 'short') socket.end(reply.subarray(0, -1));
        else if (mode === 'extra') socket.end(Buffer.concat([reply, reply]));
        else {
          socket.write(reply.subarray(0, 3));
          socket.end(reply.subarray(3));
        }
      } catch {
        socket.destroy();
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(path, resolve));
  const client = new Constructor({
    lifetime: { drain, owner },
    scope: { candidate, boot, resource, slot: 0 },
    capability: Buffer.from('d'.repeat(64), 'hex'),
    connector: {
      connect() {
        const socket = connect({ path, allowHalfOpen: true });
        peers.add(socket);
        return {
          socket,
          check() {
            if (revoked || socket.destroyed) throw new Error();
          },
          async close() {
            nativeCloses++;
            observedNative();
            if (mode === 'native-delay') await nativePending;
            if (mode === 'native-fail') throw new Error();
          },
        };
      },
    },
  });
  cleanup.push(async () => {
    nativeComplete();
    await client.close().catch(() => {});
    for (const peer of peers) peer.destroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  });
  return {
    client,
    drain,
    requests,
    nativeCalled,
    nativeComplete,
    get nativeCloses() {
      return nativeCloses;
    },
    revoke() {
      revoked = true;
    },
  };
}

it('binds one original close transaction through EOF/native close and consumes its own receipt once', async () => {
  const s = await fixture();
  const pending = s.client.stop();
  expect(s.client.stop()).toBe(pending);
  const receipt = await pending;
  expect(s.requests).toHaveLength(1);
  expect(s.nativeCloses).toBe(1);
  expect(() => s.client.consume(Object.freeze({}))).toThrow();
  s.client.consume(receipt);
  expect(() => s.client.consume(receipt)).toThrow();
  expect(s.drain.snapshot()).toMatchObject({ active: 1, unknown: 0 });
  expect('groupExitProven' in receipt).toBe(false);
});

it('does not publish a consumable receipt before the original native close completes', async () => {
  const s = await fixture('native-delay');
  let settled = false;
  const pending = s.client.stop();
  void pending.then(() => {
    settled = true;
  });
  await s.nativeCalled;
  expect(settled).toBe(false);
  expect(() => s.client.consume({})).toThrow();
  s.nativeComplete();
  s.client.consume(await pending);
});

it('rejects wrong scope, truncated or extra frames and native cleanup failure without retry', async () => {
  for (const mode of ['scope', 'short', 'extra', 'native-fail']) {
    const s = await fixture(mode);
    const pending = s.client.stop();
    await expect(pending).rejects.toThrow();
    expect(s.client.stop()).toBe(pending);
    expect(s.requests).toHaveLength(1);
    expect(s.drain.snapshot().unknown).toBeGreaterThan(0);
  }
});

it('an original-owner veto after transport completion prevents consumption and cannot be retried', async () => {
  const s = await fixture();
  const receipt = await s.client.stop();
  s.revoke();
  expect(() => s.client.consume(receipt)).toThrow();
  expect(() => s.client.consume(receipt)).toThrow();
});
