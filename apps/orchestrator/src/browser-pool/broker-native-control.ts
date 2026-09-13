import { Duplex } from 'node:stream';
import { inspect } from 'node:util';
import type { OperationLifetime } from '../execution/owned-operation.js';
import type { OriginalControlConnection, OriginalControlConnector } from './broker-client.js';

/** Only the fixed, hash-pinned in-process addon may supply this capability. */
export interface OriginalNativeControl {
  /** Advances only the original nonblocking, five-second connection attempt. */
  ready(): boolean;
  check(): void;
  read(): Buffer | null | undefined;
  write(bytes: Buffer): number;
  end(): void;
  close(): void;
}
export interface OriginalNativeControlFactory {
  /** Optional earlier Linux CLOCK_MONOTONIC absolute milliseconds, never a duration. */
  connectControl(deadline?: bigint): OriginalNativeControl;
}
const invalid = () => new Error('POOL_CONTROL_NATIVE_INVALID');

/** The remote FD stays native-owned. Duplex buffers contain checked bytes only. */
class NativeControlStream extends Duplex implements OriginalControlConnection {
  readonly #lifetime: OperationLifetime;
  readonly #release: () => boolean;
  readonly #closed: Promise<void>;
  #native?: OriginalNativeControl;
  #busy = 0;
  #reading = false;
  #retired = false;
  #cleanupFailed = false;
  #unknown = false;
  #acquiring = false;
  #creationStarted = false;
  #connecting = true;
  #timer?: ReturnType<typeof setTimeout>;
  #destroyReceipt?: (error: Error | null) => void;
  #write?: { bytes: Buffer; offset: number; complete: (error?: Error | null) => void };

  private constructor(lifetime: OperationLifetime) {
    super({ allowHalfOpen: true, autoDestroy: true, emitClose: true, highWaterMark: 4100 });
    const { drain, owner: parent } = lifetime;
    const owner = drain.fork(parent, 'execution');
    this.#release = drain.pin(owner);
    this.#lifetime = Object.freeze({ drain, owner });
    this.on('error', () => {}); // Failures before the factory returns are still owned.
    this.#closed = new Promise<void>((resolve, reject) => {
      this.once('close', () => {
        if (this.#cleanupFailed) reject(new Error('POOL_CONTROL_CLOSE_UNPROVEN'));
        else resolve();
      });
    });
    void this.#closed.catch(() => {});
  }

  static open(
    factory: OriginalNativeControlFactory,
    lifetime: OperationLifetime,
  ): NativeControlStream {
    const item = new NativeControlStream(lifetime);
    item.#busy++;
    try {
      item.#guard();
      item.#creationStarted = true;
      item.#acquiring = true;
      item.#native = factory.connectControl(); // Own before getters or post-IO veto.
      item.#acquiring = false;
      item.#guard();
      for (const name of ['ready', 'check', 'read', 'write', 'end', 'close'] as const) {
        if (typeof item.#native[name] !== 'function') throw invalid();
      }
      item.check();
      item.#schedule(0);
      return item;
    } catch {
      if (item.#creationStarted && (item.#acquiring || !item.#native)) {
        item.#cleanupFailed = true;
        item.#markUnknown();
      }
      item.destroy(invalid());
      throw invalid();
    } finally {
      item.#busy--;
      if (item.#retired) item.#cleanup();
    }
  }

  get socket(): NativeControlStream {
    return this;
  }
  get connecting(): boolean {
    return this.#connecting;
  }
  toJSON(): object {
    return {};
  }
  [inspect.custom](): string {
    return '[OriginalControlStream]';
  }

  #guard(): void {
    this.#lifetime.drain.assertDispatch(this.#lifetime.owner);
    if (this.#retired || this.destroyed) throw invalid();
  }
  check(): void {
    this.#busy++;
    try {
      this.#guard();
      if (!this.#native) throw invalid();
      this.#native.check();
      this.#guard();
    } finally {
      this.#busy--;
      if (this.#retired) this.#cleanup();
    }
  }
  close(): Promise<void> {
    this.destroy();
    return this.#closed;
  }
  override _read(): void {
    this.#reading = true;
    this.#schedule(0);
  }
  override _write(
    chunk: Buffer,
    _encoding: BufferEncoding,
    complete: (error?: Error | null) => void,
  ): void {
    if (
      !Buffer.isBuffer(chunk) ||
      chunk.length === 0 ||
      chunk.length > 4100 ||
      this.#write ||
      this.#retired
    ) {
      complete(invalid());
      return;
    }
    this.#write = { bytes: Buffer.from(chunk), offset: 0, complete };
    this.#schedule(0);
  }
  override _final(complete: (error?: Error | null) => void): void {
    this.#busy++;
    try {
      this.#guard();
      if (!this.#native || this.#write) throw invalid();
      if (this.#connecting) throw invalid();
      this.#native.end();
      this.#guard();
      complete();
    } catch {
      complete(invalid());
    } finally {
      this.#busy--;
      if (this.#retired) this.#cleanup();
    }
  }
  override _destroy(_error: Error | null, complete: (error: Error | null) => void): void {
    this.#retired = true;
    this.#reading = false;
    clearTimeout(this.#timer);
    this.#timer = undefined;
    this.#destroyReceipt = complete;
    if (!this.#busy) this.#cleanup();
  }
  #schedule(delay: number): void {
    if (this.#timer || this.#retired) return;
    this.#timer = setTimeout(() => {
      this.#timer = undefined;
      this.#pump();
    }, delay);
  }
  #pump(): void {
    if (this.#retired || this.#busy) return;
    this.#busy++;
    try {
      this.#guard();
      const native = this.#native;
      if (!native) throw invalid();
      if (this.#connecting) {
        const ready = native.ready();
        this.#guard();
        if (typeof ready !== 'boolean') throw invalid();
        if (!ready) return;
        native.check();
        this.#guard();
        this.#connecting = false;
        this.emit('connect');
        this.#guard();
      }
      const pending = this.#write;
      if (pending) {
        this.#guard();
        const sent = native.write(pending.bytes.subarray(pending.offset));
        this.#guard();
        if (!Number.isSafeInteger(sent) || sent < 0 || sent > pending.bytes.length - pending.offset)
          throw invalid();
        pending.offset += sent;
        if (pending.offset === pending.bytes.length) {
          this.#write = undefined;
          pending.bytes.fill(0);
          pending.complete();
        }
      }
      if (this.#reading) {
        this.#guard();
        const bytes = native.read();
        this.#guard();
        if (bytes === null) {
          this.#reading = false;
          this.push(null);
        } else if (bytes !== undefined) {
          if (!Buffer.isBuffer(bytes) || bytes.length === 0 || bytes.length > 4100) throw invalid();
          this.#reading = this.push(bytes);
        }
      }
    } catch {
      this.destroy(invalid());
    } finally {
      this.#busy--;
      if (this.#retired) this.#cleanup();
      else if (this.#connecting || this.#reading || this.#write) this.#schedule(20);
    }
  }
  #markUnknown(): void {
    if (this.#unknown) return;
    this.#unknown = true;
    try {
      this.#lifetime.drain.markUnknown(this.#lifetime.owner);
    } catch {
      this.#lifetime.drain.block();
    }
  }
  #cleanup(): void {
    const complete = this.#destroyReceipt;
    if (!complete || this.#busy) return;
    this.#destroyReceipt = undefined; // Original cleanup runs once, including reentry.
    const pending = this.#write;
    this.#write = undefined;
    let callbackFailed = false;
    if (pending) {
      pending.bytes.fill(0);
      try {
        pending.complete(invalid());
      } catch {
        callbackFailed = true;
      }
    }
    const native = this.#native;
    this.#native = undefined;
    try {
      if (native && native.close() !== undefined) throw invalid();
    } catch {
      this.#cleanupFailed = true;
    }
    if (this.#cleanupFailed) this.#markUnknown();
    else this.#release();
    complete(
      this.#cleanupFailed
        ? new Error('POOL_CONTROL_CLOSE_UNPROVEN')
        : callbackFailed
          ? invalid()
          : null,
    );
  }
}

export class BrokerNativeControlConnector implements OriginalControlConnector {
  readonly #factory: OriginalNativeControlFactory;
  readonly #lifetime: OperationLifetime;
  constructor(options: { factory: OriginalNativeControlFactory; lifetime: OperationLifetime }) {
    this.#factory = options.factory;
    this.#lifetime = options.lifetime;
  }
  connect(): OriginalControlConnection {
    return NativeControlStream.open(this.#factory, this.#lifetime);
  }
}
