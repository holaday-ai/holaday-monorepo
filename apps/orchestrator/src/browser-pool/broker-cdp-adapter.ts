import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import http, { type IncomingMessage } from 'node:http';
import type { Socket } from 'node:net';
import { type Duplex, Writable } from 'node:stream';
import { inspect } from 'node:util';
import { ExecutionDrain } from '../execution/execution-drain.js';
import type { OperationLifetime } from '../execution/owned-operation.js';
import type { BrokerDataAcquisition, BrokerDataConnection } from './broker-endpoints.js';

export interface BrokerCdpAccess {
  readonly endpoint: string;
  readonly headers: Readonly<Record<string, string>>;
  close(): Promise<void>;
}
const invalid = () => new Error('POOL_CDP_ADAPTER_INVALID');
type Options = {
  lifetime: OperationLifetime;
  veto(): void;
  acquire(lifetime: OperationLifetime): BrokerDataAcquisition;
};
type Authentication = {
  deadline: number;
  established: boolean;
  timer?: ReturnType<typeof setTimeout>;
  cancel?: () => Promise<void>;
  socket?: Duplex;
};

/** Only the original group calls this server-side adapter. No public route,
 * arbitrary target, query token, or HTTP discovery endpoint is exposed. */
export class BrokerCdpAdapter {
  readonly #lifetime: OperationLifetime;
  readonly #release: () => boolean;
  readonly #acquire: Options['acquire'];
  readonly #groupVeto: () => void;
  readonly #key = randomBytes(32);
  readonly #server: http.Server;
  readonly #peers = new Map<Duplex, Promise<void>>();
  readonly #authentication = new Map<Duplex, Authentication>();
  readonly #leases = new Set<{ close(): Promise<void> }>();
  readonly #writes = new Set<Promise<void>>();
  readonly #sinks = new Set<Writable>();
  readonly #remote = new Set<BrokerDataConnection>();
  readonly #pending = new Set<Promise<void>>();
  readonly #serverClosed: Promise<void>;
  #closing = false;
  #listenStarted = false;
  #listening = false;
  #closePromise?: Promise<void>;
  #path = '';
  #host = '';

  private constructor(options: Options) {
    const { drain, owner: parent } = options.lifetime;
    const owner = drain.fork(parent, 'execution');
    this.#release = drain.pin(owner);
    this.#lifetime = Object.freeze({ drain, owner });
    this.#acquire = options.acquire;
    this.#groupVeto = options.veto;
    this.#server = http.createServer({ maxHeaderSize: 8192 }, (_request, response) => {
      response.writeHead(403, { Connection: 'close' }).end();
    });
    this.#server.headersTimeout = 5000;
    this.#server.requestTimeout = 5000;
    this.#server.maxHeadersCount = 32;
    this.#server.maxConnections = 64;
    this.#serverClosed = new Promise((resolve) => this.#server.once('close', resolve));
    this.#server.on('connection', (socket) => {
      const authentication: Authentication = {
        deadline: performance.now() + 5000,
        established: false,
        socket,
        timer: setTimeout(() => {
          void authentication.cancel?.().catch(() => {});
          socket.destroy();
        }, 5000),
      };
      this.#authentication.set(socket, authentication);
      // end(callback) may fail on close before the dispatched shutdown's
      // original _final callback returns. Own that receipt separately, on
      // this accepted socket only; never replace a shared prototype/handle.
      const originalFinal = socket._final;
      socket._final = (callback) => {
        const finish = this.#receipt(callback, () => socket.destroy());
        try {
          this.#check();
          if (socket.destroyed) throw invalid();
          originalFinal.call(socket, finish);
        } catch {
          finish(invalid());
        }
      };
      const closed = new Promise<void>((resolve) =>
        socket.once('close', () => {
          clearTimeout(this.#authentication.get(socket)?.timer);
          void authentication.cancel?.().catch(() => {});
          this.#authentication.delete(socket);
          this.#peers.delete(socket);
          resolve();
        }),
      );
      this.#peers.set(socket, closed);
      socket.on('error', () => {});
      try {
        this.#check();
      } catch {
        socket.destroy();
      }
    });
    this.#server.on('clientError', (_error, socket) => socket.destroy());
    this.#server.on('error', () => {
      void this.close().catch(() => {});
    });
    this.#server.on('upgrade', (request, socket, head) => {
      socket.pause();
      const pending = Promise.resolve().then(() => this.#upgrade(request, socket, head));
      this.#pending.add(pending);
      void pending.catch(() => socket.destroy()).finally(() => this.#pending.delete(pending));
    });
  }

  static async open(options: Options): Promise<BrokerCdpAccess> {
    const adapter = new BrokerCdpAdapter(options);
    try {
      adapter.#check();
      await adapter.#discover();
      adapter.#check();
      adapter.#listenStarted = true;
      await new Promise<void>((resolve, reject) => {
        adapter.#server.once('error', reject);
        adapter.#server.listen(0, '127.0.0.1', () => {
          adapter.#listening = true;
          adapter.#server.off('error', reject);
          resolve();
        });
      });
      adapter.#check();
      const address = adapter.#server.address();
      if (!address || typeof address === 'string' || address.address !== '127.0.0.1')
        throw invalid();
      adapter.#host = `127.0.0.1:${address.port}`;
      const access: BrokerCdpAccess = {
        endpoint: `ws://${adapter.#host}/cdp`,
        headers: Object.freeze({ 'x-holaday-cdp': adapter.#key.toString('hex') }),
        close: () => adapter.close(),
      };
      Object.defineProperty(access, 'toJSON', { value: () => ({}) });
      Object.defineProperty(access, inspect.custom, { value: () => 'BrokerCdpAccess {}' });
      return Object.freeze(access);
    } catch {
      await adapter.close().catch(() => {});
      throw invalid();
    }
  }
  #check(): void {
    this.#lifetime.drain.assertDispatch(this.#lifetime.owner);
    this.#veto();
  }
  #veto(): void {
    this.#groupVeto();
    if (this.#closing || this.#lifetime.drain.snapshot().mode === 'blocked') throw invalid();
  }
  #receipt(
    callback: (error?: Error | null) => void,
    failed: () => void,
  ): (error?: Error | null) => void {
    let resolve!: () => void;
    const receipt = new Promise<void>((done) => {
      resolve = done;
    });
    this.#writes.add(receipt);
    let settled = false;
    return (error) => {
      if (settled) return;
      settled = true;
      try {
        callback(error ? invalid() : undefined);
      } catch {
        failed();
      } finally {
        this.#writes.delete(receipt);
        resolve();
      }
    };
  }
  #sink(target: Duplex, authentication: Authentication): Writable {
    const dispatch = (chunk: Buffer | undefined, callback: (error?: Error | null) => void) => {
      const finish = this.#receipt(callback, () => authentication.socket?.destroy());
      try {
        this.#check();
        if (
          target.destroyed ||
          authentication.socket?.destroyed ||
          (!authentication.established && performance.now() >= authentication.deadline)
        )
          throw invalid();
        this.#veto();
        if (target.destroyed || authentication.socket?.destroyed) throw invalid();
        if (chunk) target.write(chunk, finish);
        else target.end(finish);
      } catch {
        finish(invalid());
      }
    };
    const sink = new Writable({
      highWaterMark: 65536,
      write: (chunk, _encoding, callback) => dispatch(chunk, callback),
      final: (callback) => dispatch(undefined, callback),
    });
    this.#sinks.add(sink);
    sink.once('close', () => this.#sinks.delete(sink));
    sink.on('error', () => {
      authentication.socket?.destroy();
      void authentication.cancel?.().catch(() => {});
    });
    authentication.socket?.once('close', () => sink.destroy());
    return sink;
  }
  async #openRemote(authentication: Authentication): Promise<BrokerDataConnection> {
    this.#check();
    let cancelled = false;
    const drain = new ExecutionDrain(4, () => {
      this.#check();
      if (
        cancelled ||
        authentication.socket?.destroyed ||
        (!authentication.established && performance.now() >= authentication.deadline)
      )
        throw invalid();
      this.#veto();
      if (cancelled || authentication.socket?.destroyed) throw invalid();
    });
    drain.open();
    const owner = drain.admit('execution');
    const release = drain.pin(owner);
    let acquisition: BrokerDataAcquisition | undefined;
    let created!: () => void;
    const creation = new Promise<void>((resolve) => {
      created = resolve;
    });
    let closing: Promise<void> | undefined;
    const lease = {
      close: () => {
        cancelled = true;
        drain.block();
        if (acquisition) void acquisition.close().catch(() => {});
        closing ??= creation.then(async () => {
          if (acquisition) await acquisition.close();
          if (drain.snapshot().unknown || drain.snapshot().active !== 1) throw invalid();
          release();
          this.#leases.delete(lease);
        });
        return closing;
      },
    };
    this.#leases.add(lease);
    authentication.cancel = lease.close;
    try {
      drain.assertDispatch(owner);
      acquisition = this.#acquire(Object.freeze({ drain, owner }));
      created();
      if (cancelled) void acquisition.close().catch(() => {});
      const stream = await acquisition.ready;
      this.#remote.add(stream);
      stream.once('close', () => {
        this.#remote.delete(stream);
        void lease.close().catch(() => {});
      });
      drain.assertDispatch(owner);
      this.#check();
      if (stream.destroyed) throw invalid();
      return stream;
    } catch {
      created();
      await lease.close();
      throw invalid();
    }
  }
  async #discover(): Promise<void> {
    const deadline = performance.now() + 5000;
    const authentication: Authentication = { deadline, established: false };
    let stream: BrokerDataConnection | undefined;
    let request: http.ClientRequest | undefined;
    const timer = setTimeout(() => {
      request?.destroy(invalid());
      void authentication.cancel?.().catch(() => {});
      stream?.destroy();
    }, 5000);
    try {
      stream = await this.#openRemote(authentication);
      this.#check();
      if (performance.now() >= deadline) throw invalid();
      const original = stream;
      const bytes = await new Promise<Buffer>((resolve, reject) => {
        request = http.request(
          {
            method: 'GET',
            hostname: '127.0.0.1',
            port: 19222,
            path: '/json/version',
            // With createConnection, OMIT agent: false: Node would otherwise
            // construct a new TCP Agent and bypass the original Unix stream.
            createConnection: () => original as unknown as Socket,
            headers: { Connection: 'close' },
          },
          (response) => {
            let body = Buffer.alloc(0);
            response.on('error', reject);
            response.on('aborted', () => reject(invalid()));
            response.on('data', (chunk: Buffer) => {
              if (body.length + chunk.length > 65536) {
                request?.destroy(invalid());
                reject(invalid());
                return;
              }
              body = Buffer.concat([body, chunk]);
            });
            response.on('end', () =>
              response.statusCode === 200 ? resolve(body) : reject(invalid()),
            );
          },
        );
        request.on('error', reject);
        request.end();
      });
      this.#check();
      const parsed = JSON.parse(bytes.toString('utf8')) as { webSocketDebuggerUrl?: unknown };
      if (
        typeof parsed?.webSocketDebuggerUrl !== 'string' ||
        parsed.webSocketDebuggerUrl.length > 256
      )
        throw invalid();
      const url = new URL(parsed.webSocketDebuggerUrl);
      if (
        url.protocol !== 'ws:' ||
        url.host !== '127.0.0.1:19222' ||
        url.username ||
        url.password ||
        url.search ||
        url.hash ||
        !/^\/devtools\/browser\/[a-zA-Z0-9_-]{1,128}$/.test(url.pathname)
      )
        throw invalid();
      this.#path = url.pathname;
    } finally {
      request?.destroy();
      if (stream) await stream.close();
      await authentication.cancel?.();
      clearTimeout(timer);
    }
    this.#check();
    if (performance.now() >= deadline) throw invalid();
  }
  async #upgrade(request: IncomingMessage, socket: Duplex, head: Buffer): Promise<void> {
    this.#check();
    const authentication = this.#authentication.get(socket);
    if (!authentication || performance.now() >= authentication.deadline) throw invalid();
    const { deadline } = authentication;
    const raw = request.rawHeaders;
    const single = (name: string): string | undefined => {
      const values: string[] = [];
      for (let index = 0; index < raw.length; index += 2)
        if (raw[index]?.toLowerCase() === name) values.push(raw[index + 1] ?? '');
      return values.length === 1 ? values[0] : undefined;
    };
    const auth = single('x-holaday-cdp');
    const key = single('sec-websocket-key');
    if (
      request.method !== 'GET' ||
      request.url !== '/cdp' ||
      single('host') !== this.#host ||
      raw.some((value, index) => index % 2 === 0 && value.toLowerCase() === 'origin') ||
      !auth ||
      !/^[a-f0-9]{64}$/.test(auth) ||
      !timingSafeEqual(Buffer.from(auth, 'hex'), this.#key) ||
      single('upgrade')?.toLowerCase() !== 'websocket' ||
      single('sec-websocket-version') !== '13' ||
      !key ||
      !/^[A-Za-z0-9+/]{22}==$/.test(key) ||
      head.length > 65536 ||
      socket.destroyed
    )
      throw invalid();
    // No backend connection occurs until the original request is authenticated.
    let remote: BrokerDataConnection | undefined;
    try {
      remote = await this.#openRemote(authentication);
      this.#check();
      if (socket.destroyed || performance.now() >= deadline) throw invalid();
      const original = remote;
      socket.once('close', () => {
        void original.close().catch(() => {});
      });
      original.once('close', () => socket.destroy());
      const handshake = new Promise<Buffer>((resolve, reject) => {
        let input = Buffer.alloc(0);
        const failed = () => {
          clean();
          reject(invalid());
        };
        const receive = (bytes: Buffer) => {
          try {
            this.#check();
            if (performance.now() >= deadline || input.length + bytes.length > 65536)
              throw invalid();
            input = Buffer.concat([input, bytes]);
            const end = input.indexOf('\r\n\r\n');
            if (end < 0) {
              if (input.length > 8192) throw invalid();
              return;
            }
            if (end > 8192) throw invalid();
            const lines = input.subarray(0, end).toString('ascii').split('\r\n');
            if (!/^HTTP\/1\.1 101(?: |$)/.test(lines.shift() ?? '')) throw invalid();
            const header = (name: string) => {
              const matches = lines.filter(
                (line) => line.slice(0, line.indexOf(':')).toLowerCase() === name,
              );
              return matches.length === 1
                ? matches[0]?.slice(matches[0].indexOf(':') + 1).trim()
                : undefined;
            };
            if (
              header('upgrade')?.toLowerCase() !== 'websocket' ||
              header('connection')?.toLowerCase() !== 'upgrade' ||
              header('sec-websocket-accept') !==
                createHash('sha1')
                  .update(key)
                  .update('258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
                  .digest('base64')
            )
              throw invalid();
            original.pause();
            clean();
            resolve(input);
          } catch {
            failed();
          }
        };
        const clean = () => {
          original.off('data', receive);
          original.off('error', failed);
          original.off('end', failed);
          original.off('close', failed);
        };
        original.on('data', receive);
        original.once('error', failed);
        original.once('end', failed);
        original.once('close', failed);
      });
      void handshake.catch(() => {});
      remote.write(
        `GET ${this.#path} HTTP/1.1\r\nHost: 127.0.0.1:19222\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: ${key}\r\n\r\n`,
      );
      if (head.length) remote.write(head);
      const response = await handshake;
      this.#check();
      if (socket.destroyed || performance.now() >= deadline) throw invalid();
      original.unshift(response);
      authentication.established = true;
      clearTimeout(authentication.timer);
      socket.pipe(this.#sink(original, authentication));
      original.pipe(this.#sink(socket, authentication));
      socket.resume();
    } catch {
      if (remote) await remote.close();
      throw invalid();
    }
  }
  close(): Promise<void> {
    if (this.#closePromise) return this.#closePromise;
    this.#closing = true;
    this.#key.fill(0);
    for (const lease of this.#leases) void lease.close().catch(() => {});
    this.#closePromise = Promise.resolve().then(async () => {
      let failed = false;
      if (this.#listenStarted) {
        if (!this.#listening) failed = true;
        this.#server.close(() => {});
      }
      for (const socket of this.#peers.keys()) socket.destroy();
      for (const sink of this.#sinks) sink.destroy();
      const results = await Promise.allSettled([...this.#leases].map((lease) => lease.close()));
      await Promise.allSettled([...this.#pending]);
      const late = await Promise.allSettled([...this.#leases].map((lease) => lease.close()));
      await Promise.all([...this.#peers.values()]);
      while (this.#writes.size) await Promise.all([...this.#writes]);
      if (this.#listening) await this.#serverClosed;
      failed ||= [...results, ...late].some((result) => result.status === 'rejected');
      if (failed) {
        this.#lifetime.drain.markUnknown(this.#lifetime.owner);
        throw invalid();
      }
      this.#release();
    });
    return this.#closePromise;
  }
}
