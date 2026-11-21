import { randomBytes } from 'node:crypto';
import { Duplex } from 'node:stream';
import type { OperationLifetime } from '../execution/owned-operation.js';
import type { OriginalControlConnection, OriginalControlConnector } from './broker-client.js';
import {
  type BrokerTerminalObservedFrame,
  decodeBrokerControlFrame,
  encodeBrokerControlFrame,
} from './broker-control-protocol.js';

interface Scope {
  candidate: string;
  boot: string;
  resource: string;
  slot: number;
}
const invalid = () => new Error('POOL_BROKER_CLOSE_UNPROVEN');

/** One original authenticated observation transaction. Never a physical exit/slot permit. */
export class BrokerCloseClient {
  readonly #parent: OperationLifetime;
  readonly #lifetime: OperationLifetime;
  readonly #release: () => boolean;
  readonly #scope: Readonly<Scope>;
  readonly #capability: Buffer;
  readonly #connector: OriginalControlConnector;
  #connection?: OriginalControlConnection;
  #socket?: OriginalControlConnection['socket'];
  #result?: Promise<object>;
  #resolve?: (receipt: object) => void;
  #reject?: (error: Error) => void;
  #physical?: Promise<void>;
  #native?: Promise<void>;
  #cleanup?: Promise<void>;
  #receipt?: object;
  #observation?: BrokerTerminalObservedFrame;
  #closing = false;
  #settled = false;
  #complete = false;
  #consumed = false;
  #dispatched = false;
  #unknown = false;
  #ended = false;
  #released = false;
  #phase = 'idle';
  #requestId = '';
  #last = 0;
  #deadline = 0;
  #phaseDeadline = 0;
  #input = Buffer.alloc(0);
  #request = Buffer.alloc(0);
  #timer?: ReturnType<typeof setTimeout>;

  constructor(options: {
    lifetime: OperationLifetime;
    connector: OriginalControlConnector;
    scope: Scope;
    capability: Buffer;
  }) {
    const scope = Object.freeze({ ...options.scope });
    for (const [name, width] of [
      ['candidate', 40],
      ['boot', 32],
      ['resource', 32],
    ] as const) {
      const value = scope[name];
      if (
        typeof value !== 'string' ||
        value.length !== width ||
        !/^[a-f0-9]+$/.test(value) ||
        /^0+$/.test(value)
      )
        throw invalid();
    }
    if (
      !Number.isSafeInteger(scope.slot) ||
      scope.slot < 0 ||
      scope.slot >= 32 ||
      !Buffer.isBuffer(options.capability) ||
      options.capability.length !== 32 ||
      options.capability.every((value) => value === 0)
    )
      throw invalid();
    this.#scope = scope;
    this.#capability = Buffer.from(options.capability);
    this.#connector = options.connector;
    this.#parent = options.lifetime;
    const { drain, owner: parent } = options.lifetime;
    const owner = drain.fork(parent, 'execution');
    this.#release = drain.pin(owner);
    this.#lifetime = Object.freeze({ drain, owner });
  }

  stop(): Promise<object> {
    if (this.#result) return this.#result;
    this.#result = new Promise<object>((resolve, reject) => {
      this.#resolve = resolve;
      this.#reject = reject;
    });
    try {
      this.#requestId = randomBytes(16).toString('hex');
      this.#request = encodeBrokerControlFrame({
        version: 2,
        action: 'close',
        requestId: this.#requestId,
        boot: this.#scope.boot,
        capability: this.#capability.toString('hex'),
      });
      this.#last = performance.now();
      this.#deadline = this.#last + 60_000;
      this.#phaseDeadline = this.#last + 5_000;
      this.#arm();
      this.#check();
      this.#dispatched = true; // Includes a native acquisition that fails before returning a handle.
      const connection = this.#connector.connect();
      this.#connection = connection; // Own before supplied getters/checks or any reentrant cleanup.
      const socket = connection.socket;
      this.#socket = socket;
      if (!(socket instanceof Duplex)) throw invalid();
      this.#physical = new Promise<void>((resolve) => {
        if (socket.closed) resolve();
        else socket.once('close', resolve);
      });
      socket.on('error', () => this.#fail());
      socket.once('close', () => {
        if (this.#ended && this.#phase === 'eof' && !this.#closing) void this.#finish();
        else this.#fail();
      });
      if (
        socket.destroyed ||
        typeof connection.check !== 'function' ||
        typeof connection.close !== 'function'
      )
        throw invalid();
      this.#check();
      socket.pause();
      socket.on('data', (chunk: Buffer) => this.#receive(chunk));
      socket.on('end', () => {
        try {
          this.#check();
          if (this.#phase !== 'eof') throw invalid();
          this.#ended = true;
          socket.end();
        } catch {
          this.#fail();
        }
      });
      const connected = () => {
        try {
          this.#check();
          connection.check();
          this.#check();
          if (this.#phase !== 'idle') throw invalid();
          this.#phase = 'reply';
          this.#phaseDeadline = this.#deadline;
          this.#arm();
          socket.write(this.#request, (error) => {
            this.#request.fill(0);
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
    return this.#result;
  }

  #receive(chunk: Buffer): void {
    try {
      this.#check();
      this.#connection?.check();
      this.#check();
      if (
        this.#phase !== 'reply' ||
        !Buffer.isBuffer(chunk) ||
        !chunk.length ||
        this.#input.length + chunk.length > 4100
      )
        throw invalid();
      if (!this.#input.length) {
        this.#phaseDeadline = Math.min(this.#deadline, this.#last + 5_000);
        this.#arm();
      }
      this.#input = Buffer.concat([this.#input, chunk]);
      if (this.#input.length < 4) return;
      const length = this.#input.readUInt32BE(0);
      if (length < 1 || length > 4096 || this.#input.length > length + 4) throw invalid();
      if (this.#input.length < length + 4) return;
      const message = decodeBrokerControlFrame(this.#input);
      if (
        !('phase' in message) ||
        message.phase !== 'terminal-observed' ||
        message.requestId !== this.#requestId ||
        message.candidate !== this.#scope.candidate ||
        message.boot !== this.#scope.boot ||
        message.resource !== this.#scope.resource ||
        message.slot !== this.#scope.slot
      )
        throw invalid();
      this.#observation = message;
      this.#input.fill(0);
      this.#input = Buffer.alloc(0);
      this.#phase = 'eof';
    } catch {
      this.#fail();
    }
  }

  #check(): void {
    this.#lifetime.drain.assertDispatch(this.#lifetime.owner);
    const now = performance.now();
    if (
      this.#closing ||
      this.#released ||
      !Number.isFinite(now) ||
      now < this.#last ||
      now >= Math.min(this.#deadline, this.#phaseDeadline)
    )
      throw invalid();
    this.#last = now;
    if (this.#closing || this.#released || this.#lifetime.drain.snapshot().mode === 'blocked')
      throw invalid();
  }
  #arm(): void {
    this.#check();
    clearTimeout(this.#timer);
    this.#timer = setTimeout(
      () => this.#fail(),
      Math.max(0, Math.min(this.#deadline, this.#phaseDeadline) - this.#last),
    );
  }
  #closeNative(wait = true): Promise<void> {
    if (this.#native) return this.#native;
    const connection = this.#connection;
    this.#native = Promise.resolve().then(async () => {
      if (!connection) throw invalid();
      if (wait) {
        if (!this.#physical) throw invalid();
        await this.#physical;
      }
      const returned = connection.close();
      if (!(returned instanceof Promise) || (await returned) !== undefined) throw invalid();
    });
    return this.#native;
  }
  async #finish(): Promise<void> {
    try {
      await this.#closeNative();
      this.#check();
      this.#receipt = Object.freeze({}); // Instance-private identity; JSON or another client cannot supply it.
      this.#complete = this.#settled = true;
      this.#erase();
      this.#releaseOnce();
      this.#resolve?.(this.#receipt);
    } catch {
      this.#fail();
    }
  }
  consume(receipt: object): void {
    if (
      !this.#complete ||
      !this.#observation ||
      this.#closing ||
      this.#consumed ||
      receipt !== this.#receipt
    )
      throw invalid();
    this.#consumed = true; // Burn before any callback-capable original-parent veto.
    this.#parent.drain.assertDispatch(this.#parent.owner);
    if (this.#closing || this.#parent.drain.snapshot().mode === 'blocked') throw invalid();
    // Necessary observation consumed. No physical pin release or ambiguity reconciliation.
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
  #erase(): void {
    clearTimeout(this.#timer);
    this.#input.fill(0);
    this.#request.fill(0);
    this.#capability.fill(0);
  }
  #releaseOnce(): void {
    if (!this.#released) {
      this.#released = true;
      this.#release();
    }
  }
  #fail(): void {
    if (this.#settled) return;
    this.#settled = true;
    this.#markUnknown();
    this.#closing = true;
    this.#erase();
    this.#reject?.(invalid());
    void this.close().catch(() => {});
  }
  close(): Promise<void> {
    if (this.#cleanup) return this.#cleanup;
    this.#closing = true;
    this.#erase();
    if (this.#result && !this.#settled) {
      this.#settled = true;
      this.#markUnknown();
      this.#reject?.(invalid());
    }
    this.#cleanup = Promise.resolve().then(async () => {
      let failed = this.#dispatched && !this.#physical;
      try {
        this.#socket?.destroy();
      } catch {
        failed = true;
      }
      try {
        if (this.#dispatched) await this.#closeNative(!failed);
      } catch {
        failed = true;
      }
      if (failed) {
        this.#markUnknown();
        throw invalid();
      }
      this.#releaseOnce();
    });
    return this.#cleanup;
  }
}
