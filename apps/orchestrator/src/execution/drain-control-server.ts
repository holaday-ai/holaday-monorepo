import { type Stats, chmodSync, lstatSync, realpathSync } from 'node:fs';
import { type Socket, createServer } from 'node:net';
import { join, resolve } from 'node:path';
import type { DrainController } from './drain-controller.js';

export interface DrainControlServer {
  close(): Promise<{ released: boolean; retainedListener: boolean }>;
}
const sameFile = (a: Stats, b: Stats) => a.dev === b.dev && a.ino === b.ino;

/** The private directory owner/root is trusted. No TCP or stale-path unlink. */
export async function startDrainControlServer(
  directory: string,
  controller: DrainController,
): Promise<DrainControlServer> {
  const path = join(directory, 'control.sock');
  const uid = process.getuid?.();
  const unavailable = () => new Error('CONTROL_SOCKET_UNAVAILABLE');
  const checkRoot = () => {
    if (
      uid === undefined ||
      directory === '/' ||
      resolve(directory) !== directory ||
      realpathSync(directory) !== directory ||
      Buffer.byteLength(path) > 100
    )
      throw unavailable();
    const stat = lstatSync(directory);
    if (!stat.isDirectory() || stat.uid !== uid || (stat.mode & 0o7777) !== 0o700)
      throw unavailable();
    return stat;
  };
  let root: Stats;
  try {
    root = checkRoot();
    try {
      lstatSync(path);
      throw unavailable();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    if (!controller.drain.snapshot().idle) throw unavailable();
    controller.state.read();
  } catch {
    controller.shutdown();
    throw unavailable();
  }

  let owned: Stats | null = null;
  let ready = false;
  let closing = false;
  let listened = false;
  let retained = false;
  let timer: ReturnType<typeof setInterval> | undefined;
  let closed: Promise<void> | undefined;
  const sockets = new Map<Socket, object>();
  const ownsPath = () => {
    try {
      return (
        owned !== null && sameFile(lstatSync(directory), root) && sameFile(lstatSync(path), owned)
      );
    } catch {
      return false;
    }
  };
  const check = () => {
    if (!sameFile(checkRoot(), root) || !ownsPath()) throw unavailable();
    const stat = lstatSync(path);
    if (!stat.isSocket() || stat.uid !== uid || stat.nlink !== 1 || (stat.mode & 0o7777) !== 0o600)
      throw unavailable();
  };
  const drop = (socket: Socket, session: object) => {
    controller.disconnect(session);
    sockets.delete(socket);
    socket.destroy();
  };
  const server = createServer((socket) => {
    socket.on('error', () => {});
    let session: object;
    try {
      if (!ready || closing) throw unavailable();
      check();
      session = controller.connect();
    } catch {
      socket.destroy();
      return;
    }
    sockets.set(socket, session);
    let buffer = Buffer.alloc(0);
    let busy = false;
    socket.setTimeout(10_000, () => drop(socket, session));
    socket.on('end', () => drop(socket, session));
    socket.on('error', () => drop(socket, session));
    socket.on('close', () => {
      sockets.delete(socket);
      controller.disconnect(session);
    });
    socket.on('data', (bytes) => {
      if (closing || busy || !controller.owns(session) || buffer.length + bytes.length > 1536) {
        drop(socket, session);
        return;
      }
      try {
        check();
      } catch {
        void close();
        return;
      }
      buffer = Buffer.concat([buffer, Buffer.from(bytes)]);
      const end = buffer.indexOf(10);
      if (end === -1) return;
      if (end !== buffer.length - 1) {
        drop(socket, session);
        return;
      }
      const frame = buffer;
      buffer = Buffer.alloc(0);
      busy = true;
      void controller
        .execute(session, frame)
        .then((reply) => {
          if (closing || socket.destroyed) return;
          if (!reply.ok) {
            socket.end(`${JSON.stringify(reply)}\n`);
            socket.destroySoon();
            return;
          }
          try {
            check();
          } catch {
            void close();
            return;
          }
          // Keep a single outstanding response as well as a single command.
          socket.write(`${JSON.stringify(reply)}\n`, (error) => {
            busy = false;
            if (error) drop(socket, session);
          });
        })
        .catch(() => drop(socket, session));
    });
  });

  async function close() {
    closing = true;
    ready = false;
    if (timer) clearInterval(timer);
    const released = controller.shutdown();
    for (const [socket, session] of sockets) drop(socket, session);
    if (!closed) {
      if (listened && !ownsPath()) {
        // Node's close unlinks its original path without inode comparison.
        // Preserve replacements: park this bounded reject-only listener until
        // process recovery, rather than deleting a path we no longer own.
        retained = true;
        server.unref();
        closed = Promise.resolve();
      } else closed = new Promise<void>((done) => server.close(() => done()));
    }
    await closed;
    return { released, retainedListener: retained };
  }
  server.on('error', () => {
    if (ready) void close();
  });
  try {
    await new Promise<void>((done, reject) => {
      const failed = (error: Error) => reject(error);
      server.once('error', failed);
      server.listen(path, () => {
        listened = true;
        server.off('error', failed);
        done();
      });
    });
    owned = lstatSync(path);
    if (!owned.isSocket() || owned.uid !== uid || owned.nlink !== 1) throw unavailable();
    chmodSync(path, 0o600);
    check();
    ready = true;
    timer = setInterval(() => {
      if (closing) return;
      try {
        check();
        controller.tick();
      } catch {
        void close();
        return;
      }
      for (const [socket, session] of sockets) if (!controller.owns(session)) drop(socket, session);
    }, 250);
    timer.unref();
    return { close };
  } catch {
    await close();
    throw unavailable();
  }
}
