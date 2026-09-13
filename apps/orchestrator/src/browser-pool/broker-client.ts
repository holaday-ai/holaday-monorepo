import { randomBytes } from 'node:crypto';
import { Duplex } from 'node:stream';
import type { OperationLifetime } from '../execution/owned-operation.js';
import {
  type BrokerPreparedFrame,
  decodeBrokerControlFrame,
  encodeBrokerControlFrame,
  preparedBrokerControlDigest,
} from './broker-control-protocol.js';

/** Server-only capability supplied by the pinned native connector, never API input. */
export interface OriginalControlConnection {
  readonly socket: Duplex & { readonly connecting?: boolean };
  check(): void;
  close(): Promise<void>;
}
export interface OriginalControlConnector {
  connect(): OriginalControlConnection;
}
export interface OriginalGroupReservation {
  /** Pure terminal veto over the original registration, no I/O or clocks. */
  assertLive(): void;
  ready(): void;
  close(): Promise<void>;
}
const invalid = () => new Error('POOL_BROKER_CREATE_INVALID');

/** One original create transaction. Its local close never proves physical group exit. */
export class BrokerCreateClient {
  readonly #lifetime: OperationLifetime;
  readonly #release: () => boolean;
  readonly #candidate: string;
  readonly #boot: string;
  readonly #connector: OriginalControlConnector;
  #connection?: OriginalControlConnection;
  #reservation?: OriginalGroupReservation;
  #attempted = false;
  #dispatched = false;
  #closing = false;
  #settled = false;
  #unknown = false;
  #released = false;
  #ended = false;
  #phase = 'idle';
  #deadline = 0;
  #phaseDeadline = 0;
  #last = 0;
  #received = 0;
  #timer?: ReturnType<typeof setTimeout>;
  #resolve?: () => void;
  #reject?: (error: Error) => void;
  #closePromise?: Promise<void>;
  #physicalClose?: Promise<void>;
  #nativeClose?: Promise<void>;
  #socket?: Duplex;
  readonly #acquiring = new Set<Promise<void>>();
  #input: Buffer = Buffer.alloc(0);
  #expectedReady: Buffer = Buffer.alloc(0);

  constructor(options: {
    candidate: string;
    boot: string;
    lifetime: OperationLifetime;
    connector: OriginalControlConnector;
  }) {
    if (
      !/^[a-f0-9]{40}$/.test(options.candidate) ||
      /^0+$/.test(options.candidate) ||
      !/^[a-f0-9]{32}$/.test(options.boot) ||
      /^0+$/.test(options.boot)
    )
      throw invalid();
    this.#candidate = options.candidate;
    this.#boot = options.boot;
    this.#connector = options.connector;
    const { drain, owner: parent } = options.lifetime;
    const owner = drain.fork(parent, 'execution');
    this.#release = drain.pin(owner);
    this.#lifetime = Object.freeze({ drain, owner });
    try {
      drain.assertDispatch(owner);
    } catch {
      this.#releaseOnce();
      throw invalid();
    }
  }

  start(
    slot: number,
    reserve: (prepared: BrokerPreparedFrame) => OriginalGroupReservation,
  ): Promise<void> {
    if (this.#attempted || this.#closing) return Promise.reject(invalid());
    this.#attempted = true;
    const result = new Promise<void>((resolve, reject) => {
      this.#resolve = resolve;
      this.#reject = reject;
    });
    try {
      const requestId = randomBytes(16).toString('hex');
      const request = encodeBrokerControlFrame({
        version: 2,
        action: 'create',
        requestId,
        boot: this.#boot,
        slot,
      });
      this.#last = performance.now();
      this.#deadline = this.#last + 60_000;
      this.#arm(5_000);
      this.#check();
      this.#dispatched = true; // Includes unknown native creation before a handle is returned.
      const acquired = this.#beginAcquisition();
      let connection!: OriginalControlConnection;
      let socket!: OriginalControlConnection['socket'];
      try {
        connection = this.#connector.connect();
        this.#connection = connection; // Own before reading any supplied property.
        socket = connection.socket;
        this.#socket = socket;
        if (!(socket instanceof Duplex)) throw invalid();
        this.#physicalClose = new Promise<void>((resolveClose) => {
          if (socket.closed) resolveClose();
          else socket.once('close', resolveClose);
        });
        socket.on('error', () => this.#fail());
        if (
          socket.destroyed ||
          typeof connection.check !== 'function' ||
          typeof connection.close !== 'function'
        )
          throw invalid();
      } finally {
        acquired();
      }
      this.#check();
      socket.pause();
      socket.on('data', (chunk: Buffer) => this.#receive(chunk, requestId, slot, reserve));
      socket.on('end', () => {
        try {
          this.#check();
          if (this.#phase !== 'await-eof') throw invalid();
          this.#ended = true;
          socket.end();
        } catch {
          this.#fail();
        }
      });
      socket.once('close', () => {
        if (!this.#closing && this.#ended && this.#phase === 'await-eof') void this.#finish();
        else this.#fail();
      });
      const connected = () => {
        try {
          this.#check();
          connection.check();
          this.#check();
          if (this.#phase !== 'idle') throw invalid();
          this.#phase = 'prepared';
          this.#arm(5_000);
          socket.write(request, (error) => {
            if (error) this.#fail();
          });
          socket.resume();
        } catch {
          this.#fail();
        }
      };
      if (socket.connecting) socket.once('connect', connected);
      else connected();
    } catch {
      this.#fail();
    }
    return result;
  }

  #receive(
    chunk: Buffer,
    requestId: string,
    slot: number,
    reserve: (prepared: BrokerPreparedFrame) => OriginalGroupReservation,
  ): void {
    try {
      this.#check();
      this.#connection?.check();
      this.#check();
      if (
        !Buffer.isBuffer(chunk) ||
        chunk.length === 0 ||
        !['prepared', 'ready'].includes(this.#phase)
      )
        throw invalid();
      if (this.#phase === 'ready' && this.#input.length === 0) this.#arm(5_000);
      this.#received += chunk.length;
      if (this.#received > 8200 || this.#input.length + chunk.length > 4100) throw invalid();
      this.#input = Buffer.concat([this.#input, chunk]);
      if (this.#input.length < 4) return;
      const length = this.#input.readUInt32BE(0);
      if (length < 1 || length > 4096 || this.#input.length > length + 4) throw invalid();
      if (this.#input.length < length + 4) return;
      const frame = this.#input;
      this.#input = Buffer.alloc(0);
      try {
        const message = decodeBrokerControlFrame(frame);
        if (!('phase' in message)) throw invalid();
        if (this.#phase === 'prepared') {
          if (
            message.phase !== 'prepared' ||
            message.candidate !== this.#candidate ||
            message.boot !== this.#boot ||
            message.requestId !== requestId ||
            message.slot !== slot
          )
            throw invalid();
          const scope = {
            version: 2,
            requestId,
            candidate: this.#candidate,
            boot: this.#boot,
            slot,
            resource: message.resource,
            preparedDigest: preparedBrokerControlDigest(frame),
          };
          const acquired = this.#beginAcquisition();
          let reserved!: OriginalGroupReservation;
          try {
            const returned = reserve(message);
            if (returned instanceof Promise) {
              // Async factories are invalid, but a late acquired handle is still ours.
              const late = this.#beginAcquisition();
              void returned
                .then(
                  (value: OriginalGroupReservation) => {
                    this.#reservation = value;
                  },
                  () => {},
                )
                .finally(late);
              throw invalid();
            }
            this.#reservation = returned;
            reserved = returned;
            if (
              !reserved ||
              typeof reserved.assertLive !== 'function' ||
              typeof reserved.ready !== 'function' ||
              typeof reserved.close !== 'function' ||
              'then' in reserved
            )
              throw invalid();
          } finally {
            acquired();
          }
          reserved.assertLive();
          this.#check();
          this.#connection?.check();
          this.#check();
          this.#expectedReady = encodeBrokerControlFrame({ ...scope, phase: 'ready' });
          this.#phase = 'writing-accepted';
          this.#arm(5_000);
          const accepted = encodeBrokerControlFrame({ ...scope, phase: 'accepted' });
          const socket = this.#socket;
          if (!socket) throw invalid();
          this.#check();
          reserved.assertLive();
          this.#veto();
          socket.write(accepted, (error) => {
            try {
              if (error) throw error;
              this.#check();
              if (this.#phase !== 'writing-accepted') throw invalid();
              this.#phase = 'ready';
              this.#arm(this.#deadline - performance.now()); // Waiting for fixed root startup, not a new total budget.
            } catch {
              this.#fail();
            }
          });
        } else {
          if (message.phase !== 'ready' || !frame.equals(this.#expectedReady)) throw invalid();
          this.#reservation?.assertLive();
          this.#check();
          this.#phase = 'await-eof';
        }
      } finally {
        frame.fill(0);
      }
    } catch {
      this.#fail();
    }
  }

  #check(): void {
    this.#lifetime.drain.assertDispatch(this.#lifetime.owner);
    const now = performance.now();
    if (
      this.#closing ||
      !Number.isFinite(now) ||
      now < this.#last ||
      now >= Math.min(this.#deadline, this.#phaseDeadline)
    )
      throw invalid();
    this.#last = now;
    this.#veto();
  }
  #veto(): void {
    if (this.#closing || this.#released || this.#lifetime.drain.snapshot().mode === 'blocked')
      throw invalid();
  }
  #beginAcquisition(): () => void {
    let complete!: () => void;
    const pending = new Promise<void>((resolve) => {
      complete = resolve;
    });
    this.#acquiring.add(pending);
    return () => {
      this.#acquiring.delete(pending);
      complete();
    };
  }
  #arm(milliseconds: number): void {
    const now = performance.now();
    if (
      !Number.isFinite(now) ||
      now < this.#last ||
      now >= this.#deadline ||
      (this.#phaseDeadline !== 0 && now >= this.#phaseDeadline) ||
      !Number.isFinite(milliseconds) ||
      milliseconds <= 0
    )
      throw invalid();
    this.#last = now;
    this.#phaseDeadline = Math.min(this.#deadline, now + milliseconds);
    this.#veto();
    clearTimeout(this.#timer);
    this.#timer = setTimeout(() => this.#fail(), Math.max(0, this.#phaseDeadline - now));
  }
  #markUnknown(): void {
    if (!this.#dispatched || this.#unknown) return;
    this.#unknown = true;
    try {
      this.#lifetime.drain.markUnknown(this.#lifetime.owner);
    } catch {
      this.#lifetime.drain.block();
    }
  }
  #releaseOnce(): void {
    if (this.#released) return;
    this.#released = true;
    this.#release();
  }
  #erase(): void {
    clearTimeout(this.#timer);
    this.#input.fill(0);
    this.#input = Buffer.alloc(0);
    this.#expectedReady.fill(0);
    this.#expectedReady = Buffer.alloc(0);
  }
  #closeNative(waitForSocket = true): Promise<void> {
    if (this.#nativeClose) return this.#nativeClose;
    const connection = this.#connection;
    this.#nativeClose = Promise.resolve().then(async () => {
      if (!connection) throw invalid();
      if (waitForSocket) {
        if (!this.#physicalClose) throw invalid();
        await this.#physicalClose;
      }
      const receipt = connection.close();
      if (!(receipt instanceof Promise) || (await receipt) !== undefined) throw invalid();
    });
    return this.#nativeClose;
  }
  async #finish(): Promise<void> {
    try {
      await this.#closeNative();
      this.#check();
      this.#reservation?.assertLive();
      this.#check();
      this.#reservation?.assertLive();
      this.#veto();
      this.#reservation?.ready();
      this.#check();
      this.#settled = true;
      this.#phase = 'closed';
      this.#erase();
      this.#releaseOnce();
      this.#closePromise = Promise.resolve();
      this.#resolve?.();
    } catch {
      this.#fail();
    }
  }
  #fail(): void {
    if (this.#settled) return;
    this.#markUnknown();
    this.#closing = true;
    this.#erase();
    this.#reject?.(invalid());
    void this.close().catch(() => {});
  }
  close(): Promise<void> {
    if (this.#closePromise) return this.#closePromise;
    let resolve!: () => void;
    let reject!: (error: Error) => void;
    this.#closePromise = new Promise<void>((yes, no) => {
      resolve = yes;
      reject = no;
    });
    this.#closing = true;
    this.#erase();
    if (this.#attempted && !this.#settled) {
      this.#markUnknown();
      this.#reject?.(invalid());
    }
    const cleanup = async () => {
      while (this.#acquiring.size) await Promise.all([...this.#acquiring]);
      let failed = this.#dispatched && !this.#physicalClose;
      try {
        this.#socket?.destroy();
      } catch {
        failed = true;
      }
      const closed = await Promise.allSettled([
        this.#dispatched ? this.#closeNative(!failed) : Promise.resolve(),
        Promise.resolve().then(async () => {
          if (!this.#reservation) return;
          const receipt = this.#reservation.close();
          if (!(receipt instanceof Promise) || (await receipt) !== undefined) throw invalid();
        }),
      ]);
      if (failed || closed.some((receipt) => receipt.status === 'rejected')) throw invalid();
      this.#releaseOnce();
    };
    void cleanup().then(resolve, () => {
      this.#markUnknown();
      reject(invalid());
    });
    return this.#closePromise;
  }
}
