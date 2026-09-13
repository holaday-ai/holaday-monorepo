import { randomBytes } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { inspect } from 'node:util';
import type { DrainStateIdentity } from '../execution/drain-state-record.js';
import {
  type BrokerBootFrame,
  decodeBrokerBootFrame,
  encodeBrokerBootFrame,
} from './broker-boot-protocol.js';
import type { OriginalNativeControl } from './broker-native-control.js';
import { loadOriginalBrokerNative } from './broker-native-loader.js';

const invalid = () => new Error('POOL_BOOT_UNPROVEN');

/** Server-only initial IO owner. It cannot admit work, dispatch a business
 * command, open an ExecutionDrain or replace the maintenance verifier. */
export class BrokerBootSession {
  readonly ready: Promise<void>;
  readonly #deadline: number;
  readonly #nativeDeadline: bigint;
  #last: number;
  #native?: OriginalNativeControl;
  #bundle?: ReturnType<typeof loadOriginalBrokerNative>;
  #identity?: Readonly<DrainStateIdentity>;
  #cancelled = false;
  #complete = false;
  #taken = false;
  #cleanupFailed = false;
  #acquiring = false;
  #timer?: ReturnType<typeof setTimeout>;
  #wake?: () => void;
  #closing?: Promise<void>;

  private constructor() {
    // Linux Node hrtime and the pinned addon both use CLOCK_MONOTONIC.
    // Floor before adding the limit, so truncation can only shorten the scope.
    this.#nativeDeadline = process.hrtime.bigint() / 1000000n + 5000n;
    this.#last = performance.now();
    this.#deadline = this.#last + 5000;
    // The owner and promise exist before any loader/native/async acquisition.
    this.ready = Promise.resolve().then(() => this.#run());
    void this.ready.catch(() => {});
    Object.freeze(this);
  }
  static start(): BrokerBootSession {
    return new BrokerBootSession();
  }
  static assertReady(session: unknown): asserts session is BrokerBootSession {
    if (
      !(session instanceof BrokerBootSession) ||
      !session.#complete ||
      session.#cancelled ||
      session.#cleanupFailed ||
      !session.#identity ||
      !session.#bundle
    )
      throw invalid();
  }
  static identity(session: BrokerBootSession): Readonly<DrainStateIdentity> {
    BrokerBootSession.assertReady(session);
    if (!session.#identity) throw invalid();
    return session.#identity;
  }
  static takeNative(session: BrokerBootSession): ReturnType<typeof loadOriginalBrokerNative> {
    BrokerBootSession.assertReady(session);
    if (session.#taken || !session.#bundle) throw invalid();
    session.#taken = true;
    return session.#bundle;
  }
  toJSON(): object {
    return {};
  }
  [inspect.custom](): string {
    return '[OriginalBootSession]';
  }

  #guard(): void {
    const now = performance.now();
    if (
      this.#cancelled ||
      !Number.isFinite(now) ||
      !Number.isFinite(this.#last) ||
      now < this.#last ||
      now < 0 ||
      now >= this.#deadline
    )
      throw invalid();
    this.#last = now;
  }
  #check(): OriginalNativeControl {
    this.#guard();
    const native = this.#native;
    if (!native || native.check() !== undefined) throw invalid();
    this.#guard();
    return native;
  }
  async #pause(): Promise<void> {
    this.#guard();
    await new Promise<void>((resolve) => {
      this.#wake = resolve;
      this.#timer = setTimeout(
        () => {
          this.#timer = undefined;
          this.#wake = undefined;
          resolve();
        },
        Math.min(20, this.#deadline - this.#last),
      );
    });
    this.#guard();
  }
  async #send(data: BrokerBootFrame): Promise<void> {
    const bytes = encodeBrokerBootFrame(data);
    try {
      let offset = 0;
      while (offset < bytes.length) {
        const native = this.#check();
        const size = native.write(bytes.subarray(offset));
        this.#guard();
        if (!Number.isSafeInteger(size) || size < 0 || size > bytes.length - offset)
          throw invalid();
        offset += size;
        if (offset < bytes.length) await this.#pause();
      }
    } finally {
      bytes.fill(0);
    }
  }
  #read(): Buffer | null | undefined {
    const native = this.#check();
    const data = native.read();
    this.#guard();
    if (data === null || data === undefined) return data;
    if (!Buffer.isBuffer(data) || !data.length || data.length > 1028) throw invalid();
    return Buffer.from(data);
  }
  async #receive(): Promise<BrokerBootFrame> {
    let input = Buffer.alloc(0);
    try {
      for (;;) {
        const data = this.#read();
        if (data === null) throw invalid();
        if (data === undefined) {
          await this.#pause();
          continue;
        }
        const previous = input;
        input = Buffer.concat([previous, data]);
        previous.fill(0);
        data.fill(0);
        if (input.length > 1028) throw invalid();
        if (input.length >= 4) {
          const size = input.readUInt32BE(0);
          if (!size || size > 1024 || input.length > size + 4) throw invalid();
          if (input.length === size + 4) return decodeBrokerBootFrame(input);
        }
      }
    } finally {
      input.fill(0);
    }
  }
  async #run(): Promise<void> {
    let success = false;
    try {
      this.#guard();
      this.#bundle = loadOriginalBrokerNative();
      this.#guard();
      this.#acquiring = true;
      this.#native = this.#bundle.control.connectControl(this.#nativeDeadline);
      this.#acquiring = false;
      this.#guard();
      if (!this.#native || !Object.isFrozen(this.#native)) throw invalid();
      for (const name of ['ready', 'check', 'read', 'write', 'end', 'close'] as const) {
        if (typeof this.#native[name] !== 'function') throw invalid();
        this.#guard();
      }
      for (;;) {
        this.#guard();
        const connected = this.#native.ready();
        this.#guard();
        if (typeof connected !== 'boolean') throw invalid();
        if (connected) break;
        await this.#pause();
      }
      if (this.#read() !== undefined) throw invalid();
      const hello: BrokerBootFrame = {
        version: 2,
        phase: 'boot-hello',
        candidate: this.#bundle.candidate,
        boot: this.#bundle.boot,
        clientNonce: randomBytes(16).toString('hex'),
      };
      this.#guard();
      await this.#send(hello);
      const challenge = await this.#receive();
      if (
        challenge.phase !== 'boot-challenge' ||
        challenge.candidate !== hello.candidate ||
        challenge.boot !== hello.boot ||
        challenge.clientNonce !== hello.clientNonce ||
        !challenge.epoch ||
        !challenge.rootNonce
      )
        throw invalid();
      if (this.#read() !== undefined) throw invalid();
      await this.#send({ ...challenge, phase: 'boot-accepted' });
      const ack = await this.#receive();
      if (
        !encodeBrokerBootFrame(ack).equals(
          encodeBrokerBootFrame({ ...challenge, phase: 'boot-ack' }),
        )
      )
        throw invalid();
      for (;;) {
        const data = this.#read();
        if (data === null) break;
        if (data !== undefined) throw invalid();
        await this.#pause();
      }
      const native = this.#check();
      if (native.end() !== undefined) throw invalid();
      this.#guard();
      this.#identity = Object.freeze({
        candidate: hello.candidate,
        bootId: hello.boot,
        epoch: challenge.epoch,
      });
      success = true;
    } catch {
      if (this.#acquiring) this.#cleanupFailed = true;
    } finally {
      clearTimeout(this.#timer);
      this.#timer = undefined;
      this.#wake = undefined;
      const native = this.#native;
      this.#native = undefined;
      try {
        if (native && native.close() !== undefined) this.#cleanupFailed = true;
      } catch {
        this.#cleanupFailed = true;
      }
    }
    try {
      this.#guard();
      if (!success || this.#cleanupFailed) throw invalid();
      this.#complete = true;
    } catch {
      this.#identity = undefined;
      throw invalid();
    }
  }
  close(): Promise<void> {
    this.#cancelled = true;
    clearTimeout(this.#timer);
    this.#timer = undefined;
    const wake = this.#wake;
    this.#wake = undefined;
    wake?.();
    this.#closing ??= this.ready
      .catch(() => {})
      .then(() => {
        if (this.#cleanupFailed) throw new Error('POOL_BOOT_CLEANUP_UNPROVEN');
      });
    return this.#closing;
  }
}
