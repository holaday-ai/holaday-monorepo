import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { once } from 'node:events';
import { afterEach, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { WS_SUBPROTOCOL } from '@holaday/shared-types';
import { createOrdinaryMaintenanceStore } from './ordinary-maintenance-store.js';
// Release client itself is exercised over a real Unix socket.
// @ts-expect-error JS deployment CLI has no declaration file.
import { requestMaintenance } from '../../../../scripts/browser-maintenance-client.mjs';

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});
async function fixture(scenario = 'normal') {
  const directory = await fs.realpath(await fs.mkdtemp(join(tmpdir(), 'hm-int-')));
  await fs.chmod(directory, 0o700);
  const identity = { candidate: 'a'.repeat(40), bootId: 'b'.repeat(32) };
  await fs.writeFile(
    join(directory, 'state.json'),
    JSON.stringify({
      schemaVersion: 1,
      ...identity,
      bootId: '0'.repeat(32),
      mode: 'closed',
      needsReconciliation: false,
    }) + '\n',
    { mode: 0o600 },
  );
  const require = createRequire(import.meta.url);
  const child = spawn(
    process.execPath,
    [
      '--import',
      require.resolve('tsx'),
      fileURLToPath(new URL('../../scripts/ordinary-maintenance-qa-child.ts', import.meta.url)),
      directory,
      scenario,
    ],
    {
      cwd: directory,
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      env: {
        PATH: process.env.PATH,
        NODE_ENV: 'test',
        LOG_LEVEL: 'fatal',
        HOLADAY_MAINTENANCE_SYNTHETIC_CHILD: '1',
        DATABASE_URL: 'mysql://synthetic:unused@127.0.0.1:1/synthetic',
        REDIS_URL: 'redis://127.0.0.1:1',
        JWT_SECRET: 'synthetic-maintenance-secret-32-characters',
      },
    },
  );
  let stderr = '';
  child.stderr?.on('data', (bytes) => {
    stderr += bytes.toString();
  });
  const messages: any[] = [];
  child.on('message', (message) => messages.push(message));
  child.stdout?.resume();
  cleanup.push(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      const exit = once(child, 'exit');
      child.kill('SIGTERM'); // Only this test's own, still-live ChildProcess.
      await exit;
    }
    await fs.rm(directory, { recursive: true, force: true });
  });
  async function wait(predicate: (message: any) => boolean) {
    const existing = messages.find(predicate);
    if (existing) return existing;
    return await new Promise<any>((resolve, reject) => {
      const timer = setTimeout(() => done(new Error('synthetic child timeout: ' + stderr)), 15000);
      const onMessage = (value: any) => {
        if (predicate(value)) done(null, value);
      };
      const onExit = () => done(new Error('synthetic child exited: ' + stderr));
      function done(error: Error | null, value?: any) {
        clearTimeout(timer);
        child.off('message', onMessage);
        child.off('exit', onExit);
        error ? reject(error) : resolve(value);
      }
      child.on('message', onMessage);
      child.once('exit', onExit);
      if (child.exitCode !== null || child.signalCode !== null) onExit();
    });
  }
  const ready = await wait((m) => m.event === 'ready');
  let sequence = 0;
  const command = async (op: string) => {
    const id = ++sequence;
    child.send({ id, op });
    const answer = await wait((m) => m.id === id);
    if (answer.error) throw new Error(answer.error);
    return answer;
  };
  const control = (op: string, override = identity, timeoutMs = 2000) =>
    requestMaintenance({
      socketPath: join(directory, 'control.sock'),
      identity: override,
      op,
      timeoutMs,
    });
  const url = 'http://127.0.0.1:' + ready.httpPort;
  return { directory, identity, child, ready, wait, command, control, url, messages };
}

it('real child retains original browser work after HTTP return, rejects new work, then retires actual listeners', async () => {
  const f = await fixture();
  const socket = new WebSocket('ws://127.0.0.1:' + f.ready.wsPort, WS_SUBPROTOCOL);
  cleanup.push(async () => {
    socket.terminate();
  });
  const messages: any[] = [];
  socket.on('message', (bytes) => messages.push(JSON.parse(bytes.toString())));
  await once(socket, 'open');
  socket.send(
    JSON.stringify({
      type: 'client.hello',
      token: 'synthetic-owner',
      extensionVersion: 'maintenance-qa',
    }),
  );
  await expect.poll(() => messages.find((m) => m.type === 'server.welcome')).toBeTruthy();
  const clientId = messages.find((m) => m.type === 'server.welcome').clientId;
  const response = await fetch(f.url + '/task', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ clientId }),
  });
  expect(response.status).toBe(202);
  await response.arrayBuffer();
  await f.wait((m) => m.event === 'accepted');
  const events = ['accepted', 'http-finished'];
  expect((await f.command('snapshot')).snapshot.counts.active).toBeGreaterThan(0);
  await expect
    .poll(() => messages.find((m) => m.type === 'server.extension.tool_call'))
    .toBeTruthy();
  const sent = messages.find((m) => m.type === 'server.extension.tool_call');
  await f.control('close');
  events.push('maintenance-closed');
  expect((await fetch(f.url + '/task', { method: 'POST' })).status).toBe(503);
  expect((await fetch(f.url + '/payment/callback', { method: 'POST' })).status).toBe(503);
  expect((await fetch(f.url + '/healthz')).status).toBe(200);
  const before = await f.command('snapshot');
  expect(before.writes).toBe(1);
  expect(before.records).toEqual([
    { status: 'paused', result: { text: 'keep paused' } },
    { status: 'awaiting_user', result: { text: 'keep awaiting' } },
  ]);
  events.push('new-work-rejected');
  const receipt = {
    type: 'client.extension.tool_result',
    taskId: sent.taskId,
    requestId: sent.requestId,
    ok: true,
    result: { tabs: [] },
    at: Date.now(),
  };
  socket.send(JSON.stringify({ ...receipt, requestId: '00000000-0000-4000-8000-000000000000' }));
  socket.send(
    JSON.stringify({
      type: 'client.vision.user_input',
      taskId: sent.taskId,
      kind: 'click',
      x: 1,
      y: 1,
    }),
  );
  await expect.poll(() => messages.some((m) => m.code === 'SERVICE_UNAVAILABLE')).toBe(true);
  expect((await f.command('snapshot')).events).not.toContain('original-receipt');
  socket.send(JSON.stringify(receipt));
  await f.wait((m) => m.event === 'original-receipt');
  events.push('original-receipt');
  const held = await f.command('snapshot');
  expect(held.snapshot.counts.active).toBeGreaterThan(0);
  socket.send(JSON.stringify(receipt)); // A replay must not settle the still-held child.
  await f.command('release');
  await f.wait((m) => m.event === 'child-finished');
  events.push('child-finished');
  const idle = await f.control('wait');
  expect(idle).toMatchObject({
    mode: 'closed',
    needsReconciliation: false,
    counts: { idle: true },
  });
  events.push('idle-proven');
  socket.close();
  await once(socket, 'close');
  const exit = once(f.child, 'exit');
  await f.command('shutdown');
  await exit;
  expect(f.child.exitCode).toBe(0);
  expect(f.messages.some((m) => m.event === 'listeners-closed')).toBe(true);
  events.push('listeners-closed');
  expect(events).toEqual([
    'accepted',
    'http-finished',
    'maintenance-closed',
    'new-work-rejected',
    'original-receipt',
    'child-finished',
    'idle-proven',
    'listeners-closed',
  ]);
  await expect(fetch(f.url + '/healthz')).rejects.toThrow();
  await expect(fs.stat(join(f.directory, 'writer.lock'))).rejects.toMatchObject({ code: 'ENOENT' });
});

it.each(['replace-boot', 'rename-fail', 'queue'])(
  '%s never manufactures a clean idle proof',
  async (scenario) => {
    const f = await fixture(scenario);
    if (scenario !== 'queue') await f.command(scenario);
    try {
      await f.control('close');
    } catch {
      /* original failure remains */
    }
    await expect(f.control('wait', f.identity, 100)).rejects.toThrow();
    expect(
      JSON.parse(await fs.readFile(join(f.directory, 'state.json'), 'utf8')).needsReconciliation,
    ).toBe(true);
    expect(f.messages.some((m) => m.event === 'listeners-closed')).toBe(false);
  },
);
it('foreign control identity cannot close the running instance', async () => {
  const f = await fixture();
  await expect(f.control('close', { ...f.identity, bootId: 'c'.repeat(32) })).rejects.toThrow();
  expect((await f.control('status')).mode).toBe('serving');
});
it('abrupt exit preserves dirty state and does not silently acquire the crashed writer lock', async () => {
  const f = await fixture();
  const exit = once(f.child, 'exit');
  f.child.kill('SIGKILL'); // Exact child created by this fixture, never a discovered PID.
  await exit;
  const bytes = await fs.readFile(join(f.directory, 'state.json'), 'utf8');
  expect(JSON.parse(bytes).needsReconciliation).toBe(true);
  expect(() =>
    createOrdinaryMaintenanceStore(f.directory, { ...f.identity, bootId: 'd'.repeat(32) }),
  ).toThrow('MAINTENANCE_STATE_LOCKED');
  expect(await fs.readFile(join(f.directory, 'state.json'), 'utf8')).toBe(bytes);
});
it('worker page remains physically pending after main closes and exits only after its original page settles', async () => {
  const f = await fixture('worker');
  await f.wait((m) => m.event === 'worker-page');
  await f.control('close');
  expect((await f.command('snapshot')).workerExited).toBe(false);
  await f.command('release');
  await f.wait((m) => m.event === 'worker-exited');
  expect(f.messages.filter((m) => m.event === 'worker-page')).toHaveLength(1);
});
