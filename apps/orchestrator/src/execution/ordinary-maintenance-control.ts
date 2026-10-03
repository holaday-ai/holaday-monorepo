import fs, { type Stats } from 'node:fs';
import net, { type Socket } from 'node:net';
import { join, resolve } from 'node:path';
import type { OrdinaryMaintenance } from './ordinary-maintenance.js';

type Command = {
  protocol: 1;
  candidate: string;
  bootId: string;
  op: 'status' | 'close' | 'wait' | 'open';
  timeoutMs?: number;
};
const sameFile = (a: Stats, b: Stats) => a.dev === b.dev && a.ino === b.ino;
function parse(bytes: Buffer): Command {
  const text = bytes.toString('utf8');
  if (!Buffer.from(text).equals(bytes)) throw new Error('INVALID_COMMAND');
  const value = JSON.parse(text);
  if (
    !value ||
    value.protocol !== 1 ||
    !/^[a-f0-9]{40}$/.test(value.candidate) ||
    !/^[a-f0-9]{32}$/.test(value.bootId) ||
    !['status', 'close', 'wait', 'open'].includes(value.op)
  )
    throw new Error('INVALID_COMMAND');
  const expected = {
    protocol: 1,
    candidate: value.candidate,
    bootId: value.bootId,
    op: value.op,
    ...(value.op === 'wait' ? { timeoutMs: value.timeoutMs } : {}),
  };
  if (
    value.op === 'wait' &&
    (!Number.isSafeInteger(value.timeoutMs) || value.timeoutMs < 1 || value.timeoutMs > 600000)
  )
    throw new Error('INVALID_COMMAND');
  // Canonical framing also rejects duplicate keys and extra client-supplied proofs.
  if (`${JSON.stringify(expected)}\n` !== text) throw new Error('INVALID_COMMAND');
  return value;
}

/** Local-only control. No stale-socket removal and no business-provided paths. */
export async function startOrdinaryMaintenanceControl({
  directory,
  coordinator,
}: {
  directory: string;
  coordinator: OrdinaryMaintenance;
}): Promise<{ close(): Promise<void> }> {
  const path = join(directory, 'control.sock');
  const uid = process.getuid?.();
  const unavailable = () => new Error('MAINTENANCE_CONTROL_UNAVAILABLE');
  const checkRoot = () => {
    if (
      uid === undefined ||
      directory === '/' ||
      resolve(directory) !== directory ||
      fs.realpathSync(directory) !== directory ||
      Buffer.byteLength(path) > 100
    )
      throw unavailable();
    const stat = fs.lstatSync(directory);
    if (!stat.isDirectory() || stat.uid !== uid || (stat.mode & 0o7777) !== 0o700)
      throw unavailable();
    return stat;
  };
  const root = checkRoot();
  try {
    fs.lstatSync(path);
    throw unavailable();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw unavailable();
  }
  const identity = coordinator.snapshot().identity;
  let owned: Stats | undefined;
  let ready = false;
  let closing = false;
  let generation = 0;
  let queue = Promise.resolve();
  let closed: Promise<void> | undefined;
  let watchdog: ReturnType<typeof setInterval> | undefined;
  const sockets = new Set<Socket>();
  const ownsPath = () => {
    try {
      return (
        owned !== undefined &&
        sameFile(fs.lstatSync(directory), root) &&
        sameFile(fs.lstatSync(path), owned)
      );
    } catch {
      return false;
    }
  };
  const check = () => {
    if (!sameFile(checkRoot(), root) || !ownsPath()) throw unavailable();
    const stat = fs.lstatSync(path);
    if (!stat.isSocket() || stat.uid !== uid || stat.nlink !== 1 || (stat.mode & 0o7777) !== 0o600)
      throw unavailable();
  };
  const barrier = () => {
    generation++;
    return coordinator.beginMaintenance();
  };
  const server = net.createServer({ allowHalfOpen: true }, (socket) => {
    socket.on('error', () => {});
    if (!ready || closing || sockets.size >= 64) {
      socket.destroy();
      return;
    }
    sockets.add(socket);
    let buffer = Buffer.alloc(0);
    let received = false;
    let pendingOpen = false;
    const reply = (value: unknown) => {
      if (!socket.destroyed) {
        socket.end(`${JSON.stringify(value)}\n`);
        socket.destroySoon();
      }
    };
    const fail = (code: string) => {
      received = true;
      clearTimeout(timer);
      reply({ ok: false, code });
    };
    const timer = setTimeout(() => fail('READ_TIMEOUT'), 5000);
    socket.on('close', () => {
      clearTimeout(timer);
      sockets.delete(socket);
      if (pendingOpen) void barrier().catch(() => {});
    });
    socket.on('end', () => {
      if (!received) fail('INVALID_COMMAND');
      else if (pendingOpen) {
        void barrier().catch(() => {});
        socket.destroy();
      }
    });
    socket.on('data', (bytes) => {
      if (received) {
        socket.destroy();
        return;
      }
      if (buffer.length + bytes.length > 4096) {
        fail('INVALID_COMMAND');
        return;
      }
      buffer = Buffer.concat([buffer, bytes]);
      const end = buffer.indexOf(10);
      if (end < 0) return;
      let command: Command;
      try {
        if (end !== buffer.length - 1) throw unavailable();
        command = parse(buffer);
      } catch {
        fail('INVALID_COMMAND');
        return;
      }
      received = true;
      clearTimeout(timer);
      if (command.candidate !== identity.candidate || command.bootId !== identity.bootId) {
        fail('IDENTITY_MISMATCH');
        return;
      }
      const acceptedGeneration = generation;
      pendingOpen = command.op === 'open';
      const execute = async () => {
        if (closing || socket.destroyed) throw unavailable();
        check();
        if (command.op === 'open') {
          if (acceptedGeneration !== generation) throw unavailable();
          await coordinator.resumeServing();
        } else if (command.op === 'wait') {
          if (command.timeoutMs === undefined) throw unavailable();
          await coordinator.waitForIdle(command.timeoutMs);
        }
        check();
        return coordinator.snapshot();
      };
      let operation: Promise<unknown>;
      try {
        check();
        if (command.op === 'close')
          operation = barrier().then(() => {
            check();
            return coordinator.snapshot();
          });
        else if (command.op === 'status') operation = execute();
        else {
          operation = queue.then(execute);
          queue = operation.then(
            () => {},
            () => {},
          );
        }
      } catch {
        operation = Promise.reject(unavailable());
      }
      void operation.then(
        (snapshot) => {
          pendingOpen = false;
          reply({ ok: true, snapshot });
        },
        () => {
          pendingOpen = false;
          fail('COMMAND_REJECTED');
        },
      );
    });
  });
  const close = (): Promise<void> => {
    if (closed) return closed;
    closing = true;
    ready = false;
    clearInterval(watchdog);
    const stopped = barrier();
    for (const socket of sockets) socket.destroy();
    // Node's server.close unlinks the original path without checking its inode.
    // A replaced path must survive; retain only an unref'd reject-only listener.
    if (owned && !ownsPath()) {
      server.unref();
      closed = stopped.then(() => {
        throw unavailable();
      });
    } else {
      closed = Promise.all([stopped, new Promise<void>((done) => server.close(() => done()))]).then(
        () => {},
      );
    }
    return closed;
  };
  server.on('error', () => {
    if (ready) void close().catch(() => {});
  });
  try {
    await new Promise<void>((done, reject) => {
      server.once('error', reject);
      server.listen(path, () => {
        server.off('error', reject);
        done();
      });
    });
    owned = fs.lstatSync(path);
    if (!owned.isSocket() || owned.uid !== uid || owned.nlink !== 1) throw unavailable();
    fs.chmodSync(path, 0o600);
    check();
    ready = true;
    watchdog = setInterval(() => {
      try {
        check();
      } catch {
        void close().catch(() => {});
      }
    }, 250);
    watchdog.unref();
    return { close };
  } catch {
    await close().catch(() => {});
    throw unavailable();
  }
}
