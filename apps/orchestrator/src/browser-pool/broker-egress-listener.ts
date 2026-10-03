import cluster from 'node:cluster';
import { type Server, type Socket, createServer } from 'node:net';
import type { OperationLifetime } from '../execution/owned-operation.js';

/** Private in-process capability, supplied only by the pinned native loader. */
export interface OriginalEgressFactory {
  createListener(): Readonly<{ take(): number; close(): void }>;
}

/** Owns the original listener, not groupExit or a replaceable pathname snapshot. */
export class BrokerEgressListener {
  private readonly server: Server;
  private readonly lifetime: OperationLifetime;
  private readonly release: () => boolean;
  private readonly connections: { accept(socket: Socket): void; close(): Promise<void> };
  private readonly factory: OriginalEgressFactory;
  private native?: ReturnType<OriginalEgressFactory['createListener']>;
  private closing = false;
  private takeStarted = false;
  private creationStarted = false;
  private adopted = false;
  private unknown = false;
  private finished = false;
  private timer?: ReturnType<typeof setTimeout>;
  private deadline = 0;
  private startPromise?: Promise<void>;
  private closePromise?: Promise<void>;
  private resolveStart?: () => void;
  private rejectStart?: (error: Error) => void;
  private readonly physicalClose: Promise<void>;

  constructor(options: {
    lifetime: OperationLifetime;
    factory: OriginalEgressFactory;
    connections: { accept(socket: Socket): void; close(): Promise<void> };
  }) {
    const { drain, owner: parent } = options.lifetime;
    const owner = drain.fork(parent, 'execution');
    this.release = drain.pin(owner);
    this.lifetime = Object.freeze({ drain, owner });
    this.factory = options.factory;
    this.connections = options.connections;
    try {
      drain.assertDispatch(owner);
      this.server = createServer({ pauseOnConnect: true, allowHalfOpen: true });
    } catch {
      this.release();
      throw new Error('POOL_EGRESS_LISTENER_INVALID');
    }
    this.physicalClose = new Promise<void>((resolve) => {
      this.server.on('close', () => {
        if (!this.closing) this.fail();
        resolve();
      });
    });
    this.server.on('error', () => this.fail());
    this.server.on('connection', (socket: Socket) => {
      try {
        this.assertLive();
        if (!this.adopted) throw new Error('POOL_EGRESS_LISTENER_INVALID');
        this.connections.accept(socket);
      } catch {
        socket.destroy();
        if (!this.closing) this.fail();
      }
    });
    this.server.on('listening', () => {
      try {
        this.assertLive();
        this.assertDeadline();
        this.adopted = true;
        clearTimeout(this.timer);
        this.resolveStart?.();
      } catch {
        this.fail();
      }
    });
  }

  start(): Promise<void> {
    if (this.startPromise) return this.startPromise;
    if (this.closing) return Promise.reject(new Error('POOL_EGRESS_LISTENER_INVALID'));
    this.startPromise = new Promise<void>((resolve, reject) => {
      this.resolveStart = resolve;
      this.rejectStart = reject;
    });
    try {
      this.assertLive();
      // Node 22's fd branch omits exclusive when invoking listenInCluster.
      if (cluster.isWorker) throw new Error('POOL_EGRESS_LISTENER_INVALID');
      this.deadline = performance.now() + 5000;
      this.creationStarted = true;
      this.native = this.factory.createListener();
      this.assertLive();
      this.assertDeadline();
      this.timer = setTimeout(() => this.fail(), this.deadline - performance.now());
      this.takeStarted = true; // Includes exceptions before the integer is returned.
      const fd = this.native.take();
      if (!Number.isSafeInteger(fd) || fd < 0 || this.closing)
        throw new Error('POOL_EGRESS_LISTENER_INVALID');
      this.assertDeadline();
      this.server.listen({ fd, exclusive: true, backlog: 64 });
    } catch {
      this.fail();
    }
    return this.startPromise;
  }

  close(): Promise<void> {
    if (this.closePromise) return this.closePromise;
    let resolveClose!: () => void;
    let rejectClose!: (error: Error) => void;
    this.closePromise = new Promise<void>((resolve, reject) => {
      resolveClose = resolve;
      rejectClose = reject;
    });
    this.closing = true;
    clearTimeout(this.timer);
    this.rejectStart?.(new Error('POOL_EGRESS_LISTENER_INVALID'));
    if (this.takeStarted && !this.adopted) this.markUnknown();
    if (!this.takeStarted) {
      try {
        this.native?.close();
      } catch {
        this.markUnknown();
      }
      this.native = undefined;
    } else {
      // Close only the Node object; never close the old transferred FD integer.
      try {
        this.server.close((error) => {
          if (error) this.markUnknown();
        });
      } catch {
        this.markUnknown();
      }
    }
    // Seal registered proxies immediately before deferring physical waiting.
    let connections: Promise<void>;
    try {
      connections = this.connections.close();
    } catch {
      connections = Promise.reject(new Error('POOL_EGRESS_CLOSE_UNPROVEN'));
    }
    void Promise.resolve().then(async () => {
      try {
        await connections;
        if (this.adopted && !this.unknown) await this.physicalClose;
        if (this.unknown) throw new Error('POOL_EGRESS_CLOSE_UNPROVEN');
        this.finished = true;
        this.release();
        resolveClose();
      } catch {
        this.markUnknown();
        rejectClose(new Error('POOL_EGRESS_CLOSE_UNPROVEN'));
      }
    });
    return this.closePromise;
  }

  private assertLive(): void {
    this.lifetime.drain.assertDispatch(this.lifetime.owner);
    if (this.closing) throw new Error('POOL_EGRESS_LISTENER_INVALID');
  }

  private assertDeadline(): void {
    const now = performance.now();
    if (!Number.isFinite(now) || now >= this.deadline)
      throw new Error('POOL_EGRESS_LISTENER_INVALID');
  }

  private markUnknown(): void {
    if (this.unknown || this.finished) return;
    this.unknown = true;
    this.lifetime.drain.markUnknown(this.lifetime.owner);
  }

  private fail(): void {
    if (this.finished) return;
    // A thrown native create may itself contain an unproven close failure.
    if (this.takeStarted || (this.creationStarted && !this.native)) this.markUnknown();
    this.rejectStart?.(new Error('POOL_EGRESS_LISTENER_INVALID'));
    void this.close().catch(() => {});
  }
}
