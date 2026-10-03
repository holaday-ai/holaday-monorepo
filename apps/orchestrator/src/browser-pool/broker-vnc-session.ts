import type { IncomingMessage } from 'node:http';
import type { Socket } from 'node:net';
import { Duplex } from 'node:stream';
import { inspect } from 'node:util';
import { type WebSocket, WebSocketServer } from 'ws';
import { ExecutionDrain } from '../execution/execution-drain.js';
import type { OperationLifetime } from '../execution/owned-operation.js';
import type { BrokerDataAcquisition } from './broker-endpoints.js';
import { type BrokerVncAccess, BrokerVncConnection } from './broker-vnc-connection.js';

const invalid = () => new Error('POOL_VNC_SESSION_INVALID');
const MAX_BYTES = 8 * 1024 * 1024;

/** Server-only original request, supplied after initial authentication by the
 * pool's private instance binding. Neither an identity DTO nor a public grant. */
export interface BrokerVncSessionRequest {
  request: IncomingMessage;
  socket: Socket;
  head: Buffer;
  veto(): void;
  revalidate(): Promise<boolean>;
  /** Real authenticated binary activity only; never heartbeat/authorization polling. */
  onActivity?(): void;
}
export interface BrokerVncSessionAccess {
  readonly ready: Promise<void>;
  close(): Promise<void>;
}
type Options = BrokerVncSessionRequest & {
  lifetime: OperationLifetime;
  acquire(lifetime: OperationLifetime): BrokerDataAcquisition;
};

/** Own the accepted raw socket and its original callbacks. ws automatic pong
 * and close frames also pass through this guarded transport, not a bare pipe. */
class FrontSocket extends Duplex {
  readonly #raw: Socket;
  readonly #check: () => void;
  readonly #fail: () => void;
  #pending = 0;
  #rawClosed = false;
  #destroyReceipt?: (error: Error | null) => void;
  #resolve!: () => void;
  readonly #closed: Promise<void>;

  constructor(raw: Socket, check: () => void, fail: () => void) {
    super({ allowHalfOpen: true, highWaterMark: 65536 });
    this.#raw = raw;
    this.#check = check;
    this.#fail = fail;
    this.#closed = new Promise((resolve) => {
      this.#resolve = resolve;
    });
    this.on('error', fail);
    raw.pause();
    raw.on('error', fail);
    raw.once('close', () => {
      this.#rawClosed = true;
      this.destroy();
      fail();
      this.#settle();
    });
    raw.on('data', (bytes: Buffer) => {
      try {
        this.#guard();
        if (!this.push(bytes)) raw.pause();
      } catch {
        fail();
      }
    });
    // A VNC session has no useful half-open state. In particular, EOF before
    // the 101 must cancel authentication/upstream work immediately.
    raw.once('end', fail);
    const originalFinal = raw._final;
    raw._final = (callback) => {
      const finish = this.#receipt(callback);
      try {
        this.#guard();
        originalFinal.call(raw, finish);
      } catch {
        finish(invalid());
      }
    };
    // Keep observing EOF during asynchronous authorization. Any early bytes
    // stay in this bounded readable buffer, never in an unbounded backlog.
    raw.resume();
  }
  #guard(): void {
    this.#check();
    if (this.destroyed || this.#raw.destroyed) throw invalid();
  }
  #receipt(callback: (error?: Error | null) => void): (error?: Error | null) => void {
    this.#pending++;
    let finished = false;
    return (error) => {
      if (finished) return;
      finished = true;
      try {
        callback(error ? invalid() : undefined);
      } finally {
        this.#pending--;
        this.#settle();
      }
    };
  }
  #settle(): void {
    if (!this.#rawClosed || this.#pending !== 0) return;
    const receipt = this.#destroyReceipt;
    this.#destroyReceipt = undefined;
    receipt?.(null);
    this.#resolve();
  }
  override _read(): void {
    try {
      this.#guard();
      this.#raw.resume();
    } catch {
      this.#fail();
    }
  }
  override _write(
    bytes: Buffer,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ): void {
    const finish = this.#receipt(callback);
    try {
      this.#guard();
      this.#raw.write(bytes, finish);
    } catch {
      finish(invalid());
      this.#fail();
    }
  }
  override _final(callback: (error?: Error | null) => void): void {
    const finish = this.#receipt(callback);
    try {
      this.#guard();
      this.#raw.end(finish);
    } catch {
      finish(invalid());
      this.#fail();
    }
  }
  override _destroy(_error: Error | null, callback: (error: Error | null) => void): void {
    this.#destroyReceipt = callback;
    this.#raw.destroy();
    this.#settle();
  }
  close(): Promise<void> {
    this.destroy();
    return this.#closed;
  }
}

type Relay = {
  source: WebSocket;
  target: WebSocket;
  queue: Array<{ bytes: Buffer; pong: boolean }>;
  bytes: number;
  since: number;
  sending: boolean;
};

/** Group-owned user session. Closing it never waits on the owning group. */
export class BrokerVncSession {
  readonly #options: Options;
  readonly #owner: OperationLifetime;
  readonly #release: () => boolean;
  readonly #local: OperationLifetime;
  readonly #releaseLocal: () => boolean;
  readonly #front: FrontSocket;
  readonly #wss: WebSocketServer;
  readonly #relays: Relay[] = [];
  readonly #writes = new Set<Promise<void>>();
  #upstream?: BrokerVncAccess;
  #client?: WebSocket;
  #clientClosed?: Promise<void>;
  #work?: Promise<void>;
  #validation?: Promise<void>;
  #validationDeadline = 0;
  #nextValidation = 0;
  #last = performance.now();
  readonly #deadline = this.#last + 5000;
  #established = false;
  #closing = false;
  #closePromise?: Promise<void>;
  #timer?: ReturnType<typeof setInterval>;

  private constructor(options: Options) {
    this.#options = options;
    const owner = options.lifetime.drain.fork(options.lifetime.owner, 'execution');
    this.#owner = Object.freeze({ drain: options.lifetime.drain, owner });
    this.#release = this.#owner.drain.pin(owner);
    const drain = new ExecutionDrain(8, () => this.#check());
    drain.open();
    const localOwner = drain.admit('execution');
    this.#local = Object.freeze({ drain, owner: localOwner });
    this.#releaseLocal = drain.pin(localOwner);
    this.#front = new FrontSocket(
      options.socket,
      () => this.#check(),
      () => this.#fail(),
    );
    const serverOptions: import('ws').ServerOptions & { autoPong: boolean } = {
      noServer: true,
      perMessageDeflate: false,
      autoPong: false,
      maxPayload: MAX_BYTES,
      handleProtocols: (protocols) => (protocols.has('binary') ? 'binary' : false),
    };
    this.#wss = new WebSocketServer(serverOptions);
  }
  static open(options: Options): BrokerVncSessionAccess {
    const item = new BrokerVncSession(options);
    const ready = Promise.resolve().then(() => item.#start());
    item.#work = ready;
    void ready.catch(() => item.#fail());
    const result = { ready, close: () => item.close() };
    Object.defineProperty(result, 'toJSON', { value: () => ({}) });
    Object.defineProperty(result, inspect.custom, { value: () => 'BrokerVncSession {}' });
    return Object.freeze(result);
  }
  #fail(): void {
    void this.close().catch(() => {});
  }
  #veto(): void {
    this.#options.veto();
    if (
      this.#closing ||
      this.#options.socket.destroyed ||
      this.#local.drain.snapshot().mode === 'blocked'
    )
      throw invalid();
  }
  #check(): void {
    this.#owner.drain.assertDispatch(this.#owner.owner);
    this.#veto();
    const now = performance.now();
    if (
      !Number.isFinite(now) ||
      now < this.#last ||
      (!this.#established && now >= this.#deadline) ||
      (this.#validationDeadline && now >= this.#validationDeadline)
    )
      throw invalid();
    this.#last = now;
    for (const relay of this.#relays)
      if (relay.queue.length && now - relay.since >= 30_000) throw invalid();
    this.#veto();
  }
  #validate(): Promise<void> {
    if (this.#validation) return this.#validation;
    this.#validationDeadline = performance.now() + 5000;
    // Publish before calling the asynchronous authorization provider. Its late
    // result remains owned even after the raw sockets have been destroyed.
    const work = Promise.resolve()
      .then(async () => {
        this.#check();
        if ((await this.#options.revalidate()) !== true) throw invalid();
        this.#check();
      })
      .catch(() => {
        this.#fail();
        throw invalid();
      })
      .finally(() => {
        try {
          // Keep the original deadline through the final cleanup microtask.
          // A completed provider Promise alone cannot renew authorization.
          this.#check();
          this.#nextValidation = this.#last + 20_000;
        } catch {
          this.#fail();
          throw invalid();
        } finally {
          this.#validation = undefined;
          this.#validationDeadline = 0;
        }
      });
    this.#validation = work;
    void work.catch(() => this.#fail());
    return work;
  }
  async #start(): Promise<void> {
    try {
      this.#check();
      if (
        this.#options.head.length > 65536 ||
        !String(this.#options.request.headers['sec-websocket-protocol'] ?? '')
          .split(',')
          .some((p) => p.trim() === 'binary')
      )
        throw invalid();
      this.#timer = setInterval(() => {
        try {
          this.#check();
          if (this.#established && this.#last >= this.#nextValidation)
            void this.#validate().catch(() => {});
        } catch {
          this.#fail();
        }
      }, 20);
      this.#timer.unref();
      await this.#validate();
      this.#check();
      this.#upstream = BrokerVncConnection.open({
        lifetime: this.#local,
        veto: () => this.#veto(),
        acquire: this.#options.acquire,
        autoPong: false,
      });
      if (this.#closing) void this.#upstream.close().catch(() => {});
      const upstream = await this.#upstream.ready;
      this.#check();
      this.#wss.handleUpgrade(this.#options.request, this.#front, this.#options.head, (client) => {
        this.#client = client;
        client.pause();
        client.on('error', () => this.#fail());
        this.#clientClosed = new Promise((resolve) =>
          client.once('close', () => {
            resolve();
            this.#fail();
          }),
        );
        upstream.once('close', () => this.#fail());
        upstream.on('error', () => this.#fail());
        this.#relay(client, upstream);
        this.#relay(upstream, client);
      });
      this.#check();
      if (!this.#client || this.#client.protocol !== 'binary') throw invalid();
      this.#established = true;
      this.#client.resume();
      this.#check();
      upstream.resume();
    } catch {
      throw invalid();
    }
  }
  #relay(source: WebSocket, target: WebSocket): void {
    const relay: Relay = { source, target, queue: [], bytes: 0, since: 0, sending: false };
    this.#relays.push(relay);
    source.on('message', (bytes, binary) => {
      try {
        if (!binary || !Buffer.isBuffer(bytes)) throw invalid();
        this.#enqueue(relay, bytes, false);
      } catch {
        this.#fail();
      }
    });
    // Automatic pong bypasses application backpressure in ws. Account for it
    // in the same target queue before calling any sender or Writable method.
    target.on('ping', (bytes: Buffer) => {
      try {
        this.#enqueue(relay, bytes, true);
      } catch {
        this.#fail();
      }
    });
  }
  #enqueue(relay: Relay, bytes: Buffer, pong: boolean): void {
    this.#check();
    if (
      !Buffer.isBuffer(bytes) ||
      (pong && bytes.length > 125) ||
      relay.bytes + bytes.length > MAX_BYTES ||
      relay.queue.length >= 128
    )
      throw invalid();
    if (!pong) {
      this.#options.onActivity?.();
      this.#check();
    }
    for (const peer of this.#relays) peer.source.pause();
    if (!relay.queue.length) relay.since = this.#last;
    relay.queue.push({ bytes, pong });
    relay.bytes += bytes.length;
    this.#send(relay);
  }
  #send(relay: Relay): void {
    if (relay.sending || !relay.queue.length || this.#closing) return;
    relay.sending = true;
    let finish!: () => void;
    const receipt = new Promise<void>((resolve) => {
      finish = resolve;
    });
    this.#writes.add(receipt);
    const frame = relay.queue[0] as { bytes: Buffer; pong: boolean };
    const { bytes, pong } = frame;
    const complete = (error?: Error) => {
      if (!this.#writes.delete(receipt)) return;
      finish();
      relay.sending = false;
      relay.queue.shift();
      relay.bytes -= bytes.length;
      if (error) {
        this.#fail();
        return;
      }
      if (this.#closing) return;
      try {
        this.#check();
        if (relay.queue.length) this.#send(relay);
        else if (this.#relays.every((peer) => !peer.queue.length)) {
          for (const peer of this.#relays) {
            this.#check();
            peer.source.resume();
          }
        }
      } catch {
        this.#fail();
      }
    };
    try {
      this.#check();
      if (pong) relay.target.pong(bytes, undefined, complete);
      else relay.target.send(bytes, { binary: true }, complete);
    } catch {
      complete(invalid());
    }
  }
  close(): Promise<void> {
    if (this.#closePromise) return this.#closePromise;
    this.#closing = true;
    this.#local.drain.block();
    clearInterval(this.#timer);
    this.#client?.terminate();
    const frontClosed = this.#front.close();
    if (this.#upstream) void this.#upstream.close().catch(() => {});
    this.#closePromise = Promise.resolve().then(async () => {
      await this.#work?.catch(() => {});
      await this.#validation?.catch(() => {});
      this.#client?.terminate();
      try {
        const results = await Promise.allSettled([
          frontClosed,
          this.#upstream?.close(),
          this.#clientClosed,
          ...this.#writes,
        ]);
        if (results.some((r) => r.status === 'rejected')) throw invalid();
        await new Promise<void>((resolve) => this.#wss.close(() => resolve()));
        if (this.#local.drain.snapshot().unknown || this.#local.drain.snapshot().active > 1)
          throw invalid();
        for (const relay of this.#relays) {
          relay.queue.length = 0;
          relay.bytes = 0;
        }
        this.#releaseLocal();
        this.#release();
      } catch {
        this.#owner.drain.markUnknown(this.#owner.owner);
        throw invalid();
      }
    });
    return this.#closePromise;
  }
}
