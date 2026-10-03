import { once } from 'node:events';
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { type Socket, createConnection } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { startDrainControlServer } from './drain-control-server.js';
import { DrainController, type DrainOpenVerifier } from './drain-controller.js';

const roots: string[] = [];
const controllers: DrainController[] = [];
const servers: Array<{ close(): Promise<unknown> }> = [];
const clients: Socket[] = [];
const identity = { epoch: 'a'.repeat(16), candidate: 'b'.repeat(40), bootId: 'c'.repeat(32) };
function fixture(verifier?: DrainOpenVerifier, now?: { wall: number; mono: number }) {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'hd-sock-')));
  roots.push(directory);
  writeFileSync(
    join(directory, 'state.json'),
    `${JSON.stringify({ schemaVersion: 1, ...identity, bootId: 'd'.repeat(32), sequence: 1, mode: 'closed', dirty: false })}\n`,
    { mode: 0o600 },
  );
  const controller = new DrainController(
    directory,
    identity,
    verifier,
    now ? { wall: () => now.wall, mono: () => now.mono } : undefined,
  );
  controllers.push(controller);
  return { directory, controller, path: join(directory, 'control.sock') };
}
async function start(f: ReturnType<typeof fixture>) {
  const server = await startDrainControlServer(f.directory, f.controller);
  servers.push(server);
  return server;
}
async function connect(path: string) {
  const client = createConnection(path);
  clients.push(client);
  client.on('error', () => {});
  await once(client, 'connect');
  return client;
}
function command(op = 'status', version = 2, serial = 1) {
  return `${JSON.stringify({ protocol: 1, op, ...identity, version, serial, expiresAt: Date.now() + 30_000 })}\n`;
}
async function request(client: Socket, bytes: string) {
  const reply = once(client, 'data');
  client.write(bytes);
  return JSON.parse((await reply)[0].toString());
}
afterEach(async () => {
  for (const client of clients.splice(0)) client.destroy();
  for (const server of servers.splice(0)) await server.close();
  for (const controller of controllers.splice(0)) controller.state.abandon();
  for (const directory of roots.splice(0)) rmSync(directory, { recursive: true });
});

it('assembles a fragmented command before parsing instead of closing a valid request', async () => {
  const f = fixture();
  await start(f);
  const client = await connect(f.path);
  const frame = command();
  const reply = once(client, 'data');
  client.write(frame.slice(0, 15));
  await new Promise((resolve) => setTimeout(resolve, 20));
  client.write(frame.slice(15));
  expect(JSON.parse((await reply)[0].toString())).toMatchObject({
    ok: true,
    counts: { mode: 'closed' },
  });
});

it('rejects a second peer without disturbing the active control connection', async () => {
  const f = fixture(async () => {});
  await start(f);
  const first = await connect(f.path);
  await request(first, command('open'));
  const second = await connect(f.path);
  await new Promise((resolve) => setTimeout(resolve, 30));
  expect(second.destroyed).toBe(true);
  expect(f.controller.drain.snapshot().mode).toBe('open');
});

it.each(['oversize', 'pipeline', 'bad-command'])(
  'drops %s input and closes an open gate',
  async (kind) => {
    const f = fixture(async () => {});
    await start(f);
    const client = await connect(f.path);
    await request(client, command('open'));
    if (kind === 'oversize') client.write('x'.repeat(1537));
    if (kind === 'pipeline') client.write(command('status', 3, 2) + command('status', 4, 3));
    if (kind === 'bad-command') client.write('{"unexpected":true}\n');
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(client.destroyed).toBe(true);
    expect(f.controller.drain.snapshot().mode).toBe('closed');
  },
);

it('does not accumulate pipelined commands while authorization is unresolved', async () => {
  let done!: () => void;
  const pending = new Promise<void>((resolve) => {
    done = resolve;
  });
  const f = fixture(() => pending);
  await start(f);
  const client = await connect(f.path);
  client.write(command('open'));
  await new Promise((resolve) => setTimeout(resolve, 20));
  client.write(command('status', 2, 2));
  await new Promise((resolve) => setTimeout(resolve, 30));
  expect(client.destroyed).toBe(true);
  done();
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(f.controller.drain.snapshot().mode).toBe('closed');
});

it('its watchdog closes silent peers without needing another command', async () => {
  const now = { wall: Date.now(), mono: 1000 };
  const f = fixture(async () => {}, now);
  await start(f);
  const client = await connect(f.path);
  await request(client, command('open'));
  now.wall += 10_001;
  now.mono += 10_001;
  await new Promise((resolve) => setTimeout(resolve, 400));
  expect(f.controller.drain.snapshot().mode).toBe('closed');
  expect(client.destroyed).toBe(true);
});

it.each(['file', 'symlink'])(
  'does not overwrite an existing socket path represented by a %s',
  async (kind) => {
    const f = fixture();
    const marker = join(f.directory, 'marker');
    writeFileSync(marker, 'synthetic marker');
    if (kind === 'file') writeFileSync(f.path, 'synthetic prior file');
    else symlinkSync(marker, f.path);
    await expect(start(f)).rejects.toThrow('CONTROL_SOCKET_UNAVAILABLE');
    expect(readFileSync(marker, 'utf8')).toBe('synthetic marker');
    if (kind === 'file') expect(readFileSync(f.path, 'utf8')).toBe('synthetic prior file');
    else expect(lstatSync(f.path).isSymbolicLink()).toBe(true);
  },
);

it('rejects an unsafe directory before creating a listener', async () => {
  const f = fixture();
  chmodSync(f.directory, 0o777);
  await expect(start(f)).rejects.toThrow('CONTROL_SOCKET_UNAVAILABLE');
  expect(existsSync(f.path)).toBe(false);
});

it('shutdown retires admission and removes only its own unchanged socket', async () => {
  const f = fixture(async () => {});
  const server = await start(f);
  const client = await connect(f.path);
  await request(client, command('open'));
  const peerClosed = once(client, 'close');
  expect(await server.close()).toMatchObject({ released: true, retainedListener: false });
  await peerClosed;
  expect(existsSync(f.path)).toBe(false);
  expect(client.destroyed).toBe(true);
  expect(() => f.controller.drain.open()).toThrow('EXECUTION_DRAIN_BLOCKED');
});

it('preserves a replacement socket path rather than letting Node unlink it during close', async () => {
  const f = fixture();
  const server = await start(f);
  renameSync(f.path, join(f.directory, 'retired.sock'));
  writeFileSync(f.path, 'synthetic replacement', { mode: 0o600 });
  expect(await server.close()).toMatchObject({ retainedListener: true });
  expect(readFileSync(f.path, 'utf8')).toBe('synthetic replacement');
});

it('detects changed socket permissions and closes admission via its watchdog', async () => {
  const f = fixture(async () => {});
  await start(f);
  const client = await connect(f.path);
  await request(client, command('open'));
  chmodSync(f.path, 0o666);
  await new Promise((resolve) => setTimeout(resolve, 400));
  expect(f.controller.drain.snapshot().mode).not.toBe('open');
  expect(client.destroyed).toBe(true);
});

it('returns a fixed denial frame before closing an unauthorized opening request', async () => {
  const f = fixture();
  await start(f);
  const client = await connect(f.path);
  const chunks: Buffer[] = [];
  client.on('data', (data) => chunks.push(Buffer.from(data)));
  const ended = once(client, 'close');
  client.write(command('open'));
  await ended;
  const text = Buffer.concat(chunks).toString();
  expect(text ? JSON.parse(text) : null).toEqual({ protocol: 1, ok: false, code: 'OPEN_DENIED' });
});

it('shutdown during a real pending request cannot admit work after its verifier resolves', async () => {
  let finish!: () => void;
  const pending = new Promise<void>((done) => {
    finish = done;
  });
  const f = fixture(() => pending);
  const server = await start(f);
  const client = await connect(f.path);
  client.write(command('open'));
  await new Promise((resolve) => setTimeout(resolve, 20));
  const ended = once(client, 'close');
  await server.close();
  await ended;
  finish();
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(() => f.controller.drain.open()).toThrow('EXECUTION_DRAIN_BLOCKED');
});

it('preserves a replaced parent directory without unlinking anything in it', async () => {
  const f = fixture();
  const server = await start(f);
  const moved = `${f.directory}-moved`;
  roots.push(moved);
  renameSync(f.directory, moved);
  mkdirSync(f.directory, { mode: 0o700 });
  writeFileSync(f.path, 'synthetic new parent marker');
  expect(await server.close()).toMatchObject({ released: false, retainedListener: true });
  expect(readFileSync(f.path, 'utf8')).toBe('synthetic new parent marker');
  expect(f.controller.drain.snapshot().mode).toBe('blocked');
});
it('a disconnected never-settling verifier does not block a replacement status connection', async () => {
  const f = fixture(() => new Promise<void>(() => {}));
  await start(f);
  const first = await connect(f.path);
  first.write(command('open'));
  await new Promise((resolve) => setTimeout(resolve, 20));
  const ended = once(first, 'close');
  first.destroy();
  await ended;
  await new Promise((resolve) => setTimeout(resolve, 30));
  const second = await connect(f.path);
  expect(
    await request(second, command('status', f.controller.state.read().sequence, 2)),
  ).toMatchObject({ ok: true, counts: { mode: 'closed' } });
});

it('serves real bounded commands on a private socket and closes admission on peer loss', async () => {
  const f = fixture(async () => {});
  await start(f);
  expect(lstatSync(f.path).mode & 0o777).toBe(0o600);
  const client = await connect(f.path);
  expect(await request(client, command('open'))).toMatchObject({
    ok: true,
    counts: { mode: 'open' },
  });
  const gone = once(client, 'close');
  client.destroy();
  await gone;
  await new Promise((resolve) => setTimeout(resolve, 30));
  expect(f.controller.drain.snapshot().mode).toBe('closed');
  expect(f.controller.state.read().mode).toBe('closed');
});
