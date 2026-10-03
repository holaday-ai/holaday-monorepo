import net from 'node:net';
import { Duplex } from 'node:stream';
import { inspect } from 'node:util';
import type { OperationLifetime } from '../execution/owned-operation.js';
import { type BrokerDataScope, createBrokerDataHandshake } from './broker-data-protocol.js';

const invalid = () => new Error('POOL_DATA_CONNECTION_INVALID');
type Options = { scope: BrokerDataScope; key: Buffer; kind: 1 | 2; lifetime: OperationLifetime };
export interface BrokerDataAcquisition {
  readonly ready: Promise<BrokerDataConnection>;
  /** Original physical cleanup receipt, including a rejected authentication. */
  close(): Promise<void>;
}

/** Server-only data connection, created by the original group's private runtime.
 * HPD1 authenticates the group, not physical group liveness/exit. The anchor
 * checks the original application pidfd/SCM; this Node stream does not claim
 * ancillary-message inspection. Never used for the native root control lane.
 */
export class BrokerDataConnection extends Duplex {
  readonly #scope: BrokerDataScope;
  readonly #key: Buffer;
  readonly #kind: 1 | 2;
  readonly #lifetime: OperationLifetime;
  readonly #release: () => boolean;
  #socket?: net.Socket;
  #handshake?: ReturnType<typeof createBrokerDataHandshake>;
  #input: Buffer = Buffer.alloc(0);
  #last = 0;
  #deadline = 0;
  #ready = false;
  #retired = false;
  #released = false;
  #unknown = false;
  #socketCloseSeen = false;
  #pending = 0;
  #timer?: ReturnType<typeof setTimeout>;
  #destroyReceipt?: (error: Error | null) => void;
  #resolve!: (value: BrokerDataConnection) => void;
  #reject!: (error: Error) => void;
  #resolveClose!: () => void;
  #rejectClose!: (error: Error) => void;
  readonly #closed: Promise<void>;
  readonly #opening: Promise<BrokerDataConnection>;

  private constructor(options: Options) {
    super({ allowHalfOpen: true, autoDestroy: true, highWaterMark: 65536 });
    const { scope, key, kind, lifetime } = options;
    const { candidate, boot, resource } = scope;
    if (
      Object.keys(scope).sort().join(',') !== 'boot,candidate,resource' ||
      [
        [candidate, 40],
        [boot, 32],
        [resource, 32],
      ].some(
        ([value, length]) =>
          typeof value !== 'string' ||
          value.length !== length ||
          !/^[0-9a-f]+$/.test(value) ||
          /^0+$/.test(value),
      ) ||
      (kind !== 1 && kind !== 2) ||
      !Buffer.isBuffer(key) ||
      key.length !== 32 ||
      key.every((value) => value === 0)
    )
      throw invalid();
    this.#scope = Object.freeze({ candidate, boot, resource });
    this.#key = Buffer.from(key);
    this.#kind = kind;
    const { drain, owner: parent } = lifetime;
    const owner = drain.fork(parent, 'execution');
    this.#release = drain.pin(owner);
    this.#lifetime = Object.freeze({ drain, owner });
    this.on('error', () => {});
    this.#closed = new Promise((resolve, reject) => {
      this.#resolveClose = resolve;
      this.#rejectClose = reject;
    });
    this.#opening = new Promise((resolve, reject) => {
      this.#resolve = resolve;
      this.#reject = reject;
    });
    void this.#closed.catch(() => {});
    void this.#opening.catch(() => {});
  }

  static async open(options: Options): Promise<BrokerDataConnection> {
    return BrokerDataConnection.acquire(options).ready;
  }
  static acquire(options: Options): BrokerDataAcquisition {
    let item: BrokerDataConnection;
    try {
      item = new BrokerDataConnection(options);
    } catch {
      throw invalid();
    }
    item.#start();
    return Object.freeze({ ready: item.#opening, close: () => item.close() });
  }
  toJSON(): Record<string, never> {
    return {};
  }
  [inspect.custom](): string {
    return 'BrokerDataConnection {}';
  }

  #guard(): void {
    if (this.#retired) throw invalid();
    const { drain, owner } = this.#lifetime;
    drain.assertDispatch(owner);
    const now = performance.now();
    if (!Number.isFinite(now) || now < this.#last || (!this.#ready && now >= this.#deadline))
      throw invalid();
    this.#last = now;
    drain.assertDispatch(owner);
    const tail = performance.now();
    if (!Number.isFinite(tail) || tail < this.#last || (!this.#ready && tail >= this.#deadline))
      throw invalid();
    this.#last = tail;
    if (this.#retired || drain.snapshot().mode === 'blocked') throw invalid();
  }
  #start(): void {
    try {
      this.#last = performance.now();
      this.#deadline = this.#last + 5000;
      this.#guard();
      // Construct without connecting so the original socket is owned before any
      // transport can dispatch or invoke a callback.
      this.#socket = new net.Socket({ allowHalfOpen: true });
      const socket = this.#socket;
      const originalFinal = socket._final;
      // A public end callback can reject on destroy before the originally
      // dispatched net shutdown callback returns. Retain that original receipt
      // independently, on this socket only (no shared prototype mutation).
      socket._final = (callback) => {
        const finish = this.#ownedCallback(callback);
        try {
          this.#guard();
          if (socket.destroyed) throw invalid();
          originalFinal.call(socket, finish);
        } catch {
          finish(invalid());
        }
      };
      this.#socket.on('error', () => this.destroy(invalid()));
      this.#socket.once('close', () => {
        this.#socketCloseSeen = true;
        this.#physicalClose();
      });
      this.#socket.on('data', (bytes: Buffer) => this.#receive(bytes));
      this.#socket.once('end', () => {
        if (!this.#ready) this.destroy(invalid());
        else this.push(null);
      });
      this.#guard();
      this.#socket.connect({
        path: `/run/holaday-pool-data/${this.#scope.resource}/${this.#kind === 1 ? 'cdp' : 'vnc'}.sock`,
      });
      this.#guard();
      this.#tick();
    } catch {
      this.destroy(invalid());
    }
  }
  #tick(): void {
    if (this.#retired) return;
    this.#timer = setTimeout(() => {
      try {
        this.#guard();
        this.#tick();
      } catch {
        this.destroy(invalid());
      }
    }, 20);
    this.#timer.unref();
  }
  #receive(bytes: Buffer): void {
    try {
      this.#guard();
      if (!Buffer.isBuffer(bytes) || bytes.length > 65536) throw invalid();
      if (this.#ready) {
        if (!this.push(bytes)) this.#socket?.pause();
        return;
      }
      if (this.#input.length + bytes.length > 65536 + 154) throw invalid();
      this.#input = Buffer.concat([this.#input, bytes]);
      if (this.#input.length < 154) return;
      if (!this.#handshake) {
        if (this.#input.length !== 154) throw invalid();
        this.#handshake = createBrokerDataHandshake(
          this.#scope,
          this.#key,
          this.#kind,
          this.#input,
        );
        this.#input.fill(0);
        this.#input = Buffer.alloc(0);
        this.#guard();
        if (!this.#socket) throw invalid();
        const finish = this.#ownedCallback((error) => {
          if (error) this.destroy(invalid());
        });
        try {
          this.#socket.write(Buffer.from(this.#handshake.response), finish);
        } catch {
          finish(invalid());
          throw invalid();
        }
        this.#guard();
        return;
      }
      this.#handshake.acceptAcknowledgement(this.#input.subarray(0, 154));
      this.#guard();
      const trailing = Buffer.from(this.#input.subarray(154));
      this.#input.fill(0);
      this.#input = Buffer.alloc(0);
      this.#key.fill(0);
      if (trailing.length && !this.push(trailing)) this.#socket?.pause();
      this.#guard();
      this.#ready = true;
      this.#resolve(this);
    } catch {
      this.destroy(invalid());
    }
  }
  override _read(): void {
    if (!this.#ready || this.#retired) return;
    try {
      this.#guard();
      this.#socket?.resume();
    } catch {
      this.destroy(invalid());
    }
  }
  override _write(
    chunk: Buffer,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ): void {
    const finish = this.#ownedCallback((error) => {
      callback(error ? invalid() : undefined);
      if (error) this.destroy(invalid());
    });
    let offset = 0;
    const send = () => {
      try {
        this.#guard();
        if (!this.#ready || !this.#socket || !Buffer.isBuffer(chunk)) throw invalid();
        if (offset === chunk.length) {
          finish();
          return;
        }
        const end = Math.min(chunk.length, offset + 65536);
        const part = Buffer.from(chunk.subarray(offset, end));
        offset = end;
        this.#socket.write(part, (error) => {
          if (error) finish(invalid());
          else send();
        });
      } catch {
        finish(invalid());
      }
    };
    send();
  }
  override _final(callback: (error?: Error | null) => void): void {
    const finish = this.#ownedCallback((error) => {
      callback(error ? invalid() : undefined);
      if (error) this.destroy(invalid());
    });
    try {
      this.#guard();
      if (!this.#ready || !this.#socket) throw invalid();
      this.#socket.end(finish);
    } catch {
      finish(invalid());
    }
  }
  #ownedCallback(callback: (error?: Error | null) => void): (error?: Error | null) => void {
    this.#pending++;
    let completed = false;
    return (error) => {
      if (completed) return;
      completed = true;
      try {
        callback(error);
      } catch {
        this.destroy(invalid());
      } finally {
        this.#pending--;
        this.#settleClose();
      }
    };
  }
  override _destroy(_error: Error | null, callback: (error: Error | null) => void): void {
    this.#retired = true;
    clearTimeout(this.#timer);
    this.#key.fill(0);
    this.#input.fill(0);
    this.#input = Buffer.alloc(0);
    this.#handshake?.close();
    this.#destroyReceipt = callback;
    if (!this.#socket) {
      this.#physicalClose();
      return;
    }
    if (this.#socketCloseSeen) {
      this.#physicalClose();
      return;
    }
    try {
      this.#socket.destroy();
    } catch {
      this.#unknown = true;
      try {
        this.#lifetime.drain.markUnknown(this.#lifetime.owner);
      } catch {
        this.#lifetime.drain.block();
      }
      this.#reject(invalid());
      this.#rejectClose(invalid());
      callback(invalid());
      this.#destroyReceipt = undefined;
    }
  }
  #physicalClose(): void {
    if (!this.#retired) {
      this.destroy(invalid());
      return;
    }
    this.#settleClose();
  }
  #settleClose(): void {
    if (!this.#retired || (this.#socket && !this.#socketCloseSeen) || this.#pending) return;
    if (!this.#released && !this.#unknown) {
      this.#released = true;
      this.#release();
    }
    this.#reject(invalid());
    if (!this.#unknown) this.#resolveClose();
    const callback = this.#destroyReceipt;
    this.#destroyReceipt = undefined;
    callback?.(null);
  }
  close(): Promise<void> {
    this.destroy();
    return this.#closed;
  }
}
