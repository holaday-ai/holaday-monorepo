import type { IncomingMessage } from 'node:http';
import type { Socket } from 'node:net';
import type { OperationLifetime } from '../execution/owned-operation.js';
import type { BrokerVncSessionAccess, BrokerVncSessionRequest } from './broker-vnc-session.js';

/** Internal, versioned user authentication selects an original pool instance;
 * it does not manufacture a group, endpoint or release receipt. */
export interface BrokerVncAuthorization {
  open(request: BrokerVncSessionRequest): BrokerVncSessionAccess;
  revalidate(): Promise<boolean>;
  veto(): void;
}
export interface BrokerVncIngressRequest {
  request: IncomingMessage;
  socket: Socket;
  head: Buffer;
  authorize(check: () => void): Promise<BrokerVncAuthorization>;
}
interface Peer {
  socket: Socket;
  closed: Promise<void>;
  work?: Promise<void>;
  session?: BrokerVncSessionAccess;
  authorization?: BrokerVncAuthorization;
  input: Buffer[];
  bytes: number;
  deadline: number;
  last: number;
  established: boolean;
  closing: boolean;
  closePromise?: Promise<void>;
  data(bytes: Buffer): void;
}
const invalid = () => new Error('POOL_VNC_AUTHENTICATION_INVALID');

/** Original-boot owner before the first asynchronous account lookup. It holds
 * raw sockets and providers through their real settlement, including rejection. */
export class BrokerVncIngress {
  readonly #lifetime: OperationLifetime;
  readonly #release: () => boolean;
  readonly #veto: () => void;
  readonly #peers = new Set<Peer>();
  readonly #seen = new WeakSet<Socket>();
  #closing = false;
  #closePromise?: Promise<void>;
  #timer?: ReturnType<typeof setInterval>;

  constructor(lifetime: OperationLifetime, veto: () => void) {
    const owner = lifetime.drain.fork(lifetime.owner, 'execution');
    this.#release = lifetime.drain.pin(owner);
    this.#lifetime = Object.freeze({ drain: lifetime.drain, owner });
    this.#veto = veto;
  }
  accept(options: BrokerVncIngressRequest): void {
    const { socket } = options;
    if (this.#seen.has(socket)) return;
    this.#seen.add(socket);
    if (this.#closing) {
      socket.destroy();
      return;
    }
    const overLimit = this.#peers.size >= 64;
    socket.pause();
    let finish!: () => void;
    const closed = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const now = performance.now();
    const peer: Peer = {
      socket,
      closed,
      input: [],
      bytes: 0,
      deadline: now + 5000,
      last: now,
      closing: false,
      established: false,
      data: (bytes) => {
        try {
          this.#check(peer);
          if (!Buffer.isBuffer(bytes) || peer.bytes + bytes.length > 65536) throw invalid();
          peer.input.push(Buffer.from(bytes));
          peer.bytes += bytes.length;
        } catch {
          this.#fail(peer);
        }
      },
    };
    this.#peers.add(peer);
    socket.on('error', () => this.#fail(peer));
    socket.once('end', () => this.#fail(peer));
    socket.once('close', () => {
      finish();
      this.#fail(peer);
    });
    socket.on('data', peer.data);
    if (socket.closed) finish();
    if (!this.#timer) {
      this.#timer = setInterval(() => {
        for (const item of this.#peers) {
          if (item.closing) continue;
          try {
            this.#check(item);
          } catch {
            this.#fail(item);
          }
        }
      }, 20);
      this.#timer.unref();
    }
    // Publish before calling any external account provider or pool callback.
    peer.work = Promise.resolve().then(async () => {
      try {
        this.#check(peer);
        if (overLimit || !Buffer.isBuffer(options.head) || options.head.length > 65536)
          throw invalid();
        peer.data(options.head);
        this.#check(peer);
        socket.resume();
        this.#check(peer);
        const authorization = await options.authorize(() => this.#check(peer));
        this.#check(peer);
        peer.authorization = authorization;
        this.#check(peer);
        socket.pause();
        socket.off('data', peer.data);
        const head = Buffer.concat(peer.input, peer.bytes);
        peer.input = [];
        peer.bytes = 0;
        this.#check(peer);
        peer.session = authorization.open({
          request: options.request,
          socket,
          head,
          veto: () => this.#check(peer),
          revalidate: () => authorization.revalidate(),
        });
        if (peer.closing) void peer.session.close().catch(() => {});
        await peer.session.ready;
        this.#check(peer);
        peer.established = true;
      } catch {
        this.#fail(peer);
      }
    });
  }
  #check(peer: Peer): void {
    const authorization = peer.authorization;
    this.#lifetime.drain.assertDispatch(this.#lifetime.owner);
    this.#veto();
    authorization?.veto();
    const now = performance.now();
    if (
      this.#closing ||
      peer.closing ||
      peer.socket.destroyed ||
      !Number.isFinite(now) ||
      now < peer.last ||
      (!peer.established && now >= peer.deadline)
    )
      throw invalid();
    peer.last = now;
    this.#veto();
    authorization?.veto();
    if (
      peer.authorization !== authorization ||
      this.#closing ||
      peer.closing ||
      peer.socket.destroyed
    )
      throw invalid();
  }
  #fail(peer: Peer): void {
    void this.#closePeer(peer).catch(() => {});
  }
  #closePeer(peer: Peer): Promise<void> {
    if (peer.closePromise) return peer.closePromise;
    peer.closing = true;
    peer.socket.off('data', peer.data);
    peer.input = [];
    peer.bytes = 0;
    peer.socket.destroy();
    if (peer.session) void peer.session.close().catch(() => {});
    peer.closePromise = Promise.resolve().then(async () => {
      await peer.work;
      try {
        await peer.session?.close();
        await peer.closed;
        this.#peers.delete(peer);
      } catch {
        this.#lifetime.drain.markUnknown(this.#lifetime.owner);
        throw invalid();
      }
    });
    return peer.closePromise;
  }
  close(): Promise<void> {
    if (this.#closePromise) return this.#closePromise;
    this.#closing = true;
    clearInterval(this.#timer);
    const closing = [...this.#peers].map((peer) => this.#closePeer(peer));
    this.#closePromise = Promise.resolve().then(async () => {
      const results = await Promise.allSettled(closing);
      if (results.some((result) => result.status === 'rejected') || this.#peers.size)
        throw invalid();
      this.#release();
    });
    return this.#closePromise;
  }
}
