import type { Socket } from 'node:net';
import { inspect } from 'node:util';
import { WebSocket } from 'ws';
import { ExecutionDrain } from '../execution/execution-drain.js';
import type { OperationLifetime } from '../execution/owned-operation.js';
import type { BrokerDataAcquisition } from './broker-endpoints.js';

export interface BrokerVncAccess {
  /** Paused at open: attach all consumers, then resume to receive the RFB greeting. */
  readonly ready: Promise<WebSocket>;
  /** Owns this upstream only; neither a public-user session nor groupExit proof. */
  close(): Promise<void>;
}
type Options = {
  lifetime: OperationLifetime;
  veto(): void;
  acquire(lifetime: OperationLifetime): BrokerDataAcquisition;
  /** A session with its own bounded control-frame queue disables automatic pong. */
  autoPong?: boolean;
};
const invalid = () => new Error('POOL_VNC_CONNECTION_INVALID');

/** Private upstream transport. User/instance authorization remains with the
 * original pool opener before this is called. Never put this handle in a DTO. */
export class BrokerVncConnection {
  readonly #options: Options;
  readonly #owner: OperationLifetime;
  readonly #release: () => boolean;
  readonly #peer: OperationLifetime;
  readonly #releasePeer: () => boolean;
  readonly #deadline: number;
  #last: number;
  #established = false;
  #closing = false;
  #acquisition?: BrokerDataAcquisition;
  #socket?: WebSocket;
  #socketClosed?: Promise<void>;
  #closePromise?: Promise<void>;
  #work?: Promise<WebSocket>;
  #timer?: ReturnType<typeof setTimeout>;

  private constructor(options: Options) {
    this.#options = options;
    const { drain, owner: parent } = options.lifetime;
    const owner = drain.fork(parent, 'execution');
    this.#release = drain.pin(owner);
    this.#owner = Object.freeze({ drain, owner });
    const peerDrain = new ExecutionDrain(4, () => this.#check());
    peerDrain.open();
    const peerOwner = peerDrain.admit('execution');
    this.#releasePeer = peerDrain.pin(peerOwner);
    this.#peer = Object.freeze({ drain: peerDrain, owner: peerOwner });
    this.#last = performance.now();
    this.#deadline = this.#last + 5000;
  }
  static open(options: Options): BrokerVncAccess {
    const item = new BrokerVncConnection(options);
    const work = Promise.resolve().then(() => item.#connect());
    item.#work = work;
    void work.catch(() => {
      void item.close().catch(() => {});
    });
    const result = {
      ready: work,
      close: () => item.close(),
    };
    Object.defineProperty(result, 'toJSON', { value: () => ({}) });
    Object.defineProperty(result, inspect.custom, { value: () => 'BrokerVncAccess {}' });
    return Object.freeze(result);
  }
  #veto(): void {
    this.#options.veto();
    if (
      this.#closing ||
      this.#peer.drain.snapshot().mode === 'blocked' ||
      this.#owner.drain.snapshot().mode === 'blocked'
    )
      throw invalid();
  }
  #check(): void {
    this.#owner.drain.assertDispatch(this.#owner.owner);
    this.#veto();
    const now = performance.now();
    if (!Number.isFinite(now) || now < this.#last || (!this.#established && now >= this.#deadline))
      throw invalid();
    this.#last = now;
    this.#veto();
  }
  async #connect(): Promise<WebSocket> {
    try {
      this.#check();
      this.#timer = setInterval(() => {
        try {
          this.#check();
        } catch {
          void this.close().catch(() => {});
        }
      }, 20);
      this.#timer.unref();
      this.#acquisition = this.#options.acquire(this.#peer);
      if (this.#closing) void this.#acquisition.close().catch(() => {});
      const transport = await this.#acquisition.ready;
      this.#check();
      let consumed = false;
      // Installed ws 8.18 supports autoPong; the pinned older declarations do
      // not include that field. Narrowly describe it, without weakening types.
      const socketOptions: import('ws').ClientOptions & {
        autoPong: boolean;
        createConnection: () => Socket;
      } = {
        followRedirects: false,
        perMessageDeflate: false,
        autoPong: this.#options.autoPong ?? true,
        maxPayload: 8 * 1024 * 1024,
        handshakeTimeout: Math.max(1, this.#deadline - performance.now()),
        createConnection: () => {
          this.#check();
          if (consumed || transport.destroyed) throw invalid();
          consumed = true;
          return transport as unknown as Socket;
        },
      };
      const socket = new WebSocket('ws://127.0.0.1:16080/', ['binary'], socketOptions);
      this.#socket = socket;
      this.#socketClosed = new Promise((resolve) =>
        socket.once('close', () => {
          resolve();
          void this.close().catch(() => {});
        }),
      );
      socket.on('error', () => {
        void this.close().catch(() => {});
      });
      const opened = new Promise<void>((resolve, reject) => {
        socket.once('open', () => {
          // The server can send its RFB greeting with the 101 response. Do not
          // allow it to flow before the ready consumer installs its handlers.
          socket.pause();
          resolve();
        });
        socket.once('error', () => reject(invalid()));
        socket.once('close', () => reject(invalid()));
      });
      if (this.#closing) socket.terminate();
      await opened;
      this.#check();
      if (!consumed || socket.protocol !== 'binary' || socket.readyState !== WebSocket.OPEN)
        throw invalid();
      this.#established = true;
      return socket;
    } catch {
      throw invalid();
    }
  }
  close(): Promise<void> {
    if (this.#closePromise) return this.#closePromise;
    this.#closing = true;
    this.#peer.drain.block();
    clearInterval(this.#timer);
    this.#socket?.terminate();
    if (this.#acquisition) void this.#acquisition.close().catch(() => {});
    this.#closePromise = Promise.resolve().then(async () => {
      await this.#work?.catch(() => {});
      this.#socket?.terminate();
      try {
        await this.#acquisition?.close();
        await this.#socketClosed;
        if (this.#peer.drain.snapshot().unknown || this.#peer.drain.snapshot().active > 1)
          throw invalid();
        this.#releasePeer();
        this.#peer.drain.finish(this.#peer.owner);
        this.#release();
        this.#owner.drain.finish(this.#owner.owner);
      } catch {
        this.#owner.drain.markUnknown(this.#owner.owner);
        throw invalid();
      }
    });
    return this.#closePromise;
  }
}
