import { ExecutionDrain } from '../execution/execution-drain.js';
import type { OperationLifetime } from '../execution/owned-operation.js';
import { BrokerBootSession } from './broker-boot-session.js';
import { type BrokerCdpAccess, BrokerCdpAdapter } from './broker-cdp-adapter.js';
import { BrokerCreateClient, type OriginalGroupReservation } from './broker-client.js';
import type { BrokerPreparedFrame } from './broker-control-protocol.js';
import { type BrokerDataScope, deriveBrokerDataKey } from './broker-data-protocol.js';
import { BrokerEgressConnections } from './broker-egress-connections.js';
import { BrokerEgressListener } from './broker-egress-listener.js';
import { type BrokerDataAcquisition, BrokerDataConnection } from './broker-endpoints.js';
import { BrokerNativeControlConnector } from './broker-native-control.js';
import type { loadOriginalBrokerNative } from './broker-native-loader.js';
import { type BrokerVncAccess, BrokerVncConnection } from './broker-vnc-connection.js';
import {
  BrokerVncSession,
  type BrokerVncSessionAccess,
  type BrokerVncSessionRequest,
} from './broker-vnc-session.js';

const invalid = () => new Error('POOL_RUNTIME_INVALID');

/** Server-only veto over the original allocation / instance. Never a grant.
 * The pool keeps this source for the group's whole lifetime; after setup its
 * original allocation check retires, but the original instance veto remains. */
export interface BrokerGroupGuard {
  check(): void;
  /** Pure state check, including reentrant revocation after native work. */
  veto(): void;
}

/** Server-only handle. close is LOCAL cleanup, NEVER a groupExit receipt. */
export interface OriginalBrokerGroup {
  connect(kind: 1 | 2): Promise<BrokerDataConnection>;
  cdp(): Promise<BrokerCdpAccess>;
  vnc(): BrokerVncAccess;
  vncSession(request: BrokerVncSessionRequest): BrokerVncSessionAccess;
  close(): Promise<void>;
}

class Group implements OriginalGroupReservation {
  readonly #global: OperationLifetime;
  readonly #local: OperationLifetime;
  readonly #releaseLocal: () => boolean;
  readonly #runtimeCheck: () => void;
  readonly #runtimeVeto: () => void;
  readonly #slot: number;
  #closing = false;
  #ready = false;
  #prepared = false;
  #dataSlots = 0;
  #scope?: BrokerDataScope;
  #key?: Buffer;
  #registration?: Readonly<{ close(): Promise<void> }>;
  #closePromise?: Promise<void>;
  #cdp?: Promise<BrokerCdpAccess>;
  readonly #vnc = new Set<BrokerVncAccess>();
  readonly #sessions = new Set<BrokerVncSessionAccess>();
  readonly #acquisitions = new Set<BrokerDataAcquisition>();
  readonly #opening = new Set<Promise<BrokerDataConnection>>();
  readonly #handle: OriginalBrokerGroup;

  constructor(parent: OperationLifetime, slot: number, check: () => void, veto: () => void) {
    this.#slot = slot;
    this.#runtimeCheck = check;
    this.#runtimeVeto = veto;
    const owner = parent.drain.fork(parent.owner, 'execution');
    // Intentionally no release capability is exposed or invoked here. The
    // physical five-unit group remains pinned until the separate exit gate.
    parent.drain.pin(owner);
    this.#global = Object.freeze({ drain: parent.drain, owner });
    const drain = new ExecutionDrain(1024, () => {
      this.#runtimeCheck();
      this.#global.drain.assertDispatch(this.#global.owner);
      this.assertLive();
    });
    drain.open();
    const localOwner = drain.admit('execution');
    this.#releaseLocal = drain.pin(localOwner);
    this.#local = Object.freeze({ drain, owner: localOwner });
    this.#handle = Object.freeze({
      connect: (kind: 1 | 2) => this.connect(kind),
      cdp: () => this.cdp(),
      vnc: () => this.vnc(),
      vncSession: (request: BrokerVncSessionRequest) => this.vncSession(request),
      close: () => this.close(),
    });
  }

  prepare(frame: BrokerPreparedFrame, egress: BrokerEgressConnections): OriginalGroupReservation {
    this.assertLive();
    if (this.#prepared || frame.slot !== this.#slot) throw invalid();
    this.#prepared = true;
    this.#scope = Object.freeze({
      candidate: frame.candidate,
      boot: frame.boot,
      resource: frame.resource,
    });
    const management = Buffer.from(frame.capability, 'hex');
    const egressKey = Buffer.from(frame.egressCapability, 'hex');
    try {
      this.#key = deriveBrokerDataKey(management, this.#scope);
      this.#registration = egress.register(this.#scope, egressKey, this.#local);
      this.assertLive();
      return this;
    } finally {
      management.fill(0);
      egressKey.fill(0);
    }
  }
  assertLive(): void {
    this.#runtimeVeto();
    if (this.#closing || this.#local.drain.snapshot().mode === 'blocked') throw invalid();
  }
  ready(): void {
    this.assertLive();
    if (!this.#prepared || !this.#registration || this.#ready) throw invalid();
    this.#ready = true;
  }
  handle(): OriginalBrokerGroup {
    this.#local.drain.assertDispatch(this.#local.owner);
    this.assertLive();
    if (!this.#ready) throw invalid();
    return this.#handle;
  }
  connect(kind: 1 | 2): Promise<BrokerDataConnection> {
    return this.#acquire(kind, this.#local).ready;
  }
  #acquire(kind: 1 | 2, lifetime: OperationLifetime): BrokerDataAcquisition {
    if (this.#closing || (kind !== 1 && kind !== 2) || this.#dataSlots >= 64)
      return Object.freeze({ ready: Promise.reject(invalid()), close: async () => {} });
    this.#dataSlots++;
    let cancelled = false;
    let acquisition: BrokerDataAcquisition | undefined;
    let created!: () => void;
    const creation = new Promise<void>((resolve) => {
      created = resolve;
    });
    // Publish the pending acquisition before any guard/native operation can
    // reenter cleanup. Its late value is ours before checking revocation.
    const pending = Promise.resolve().then(async () => {
      try {
        if (cancelled) throw invalid();
        this.handle();
        if (cancelled || !this.#scope || !this.#key) throw invalid();
        acquisition = BrokerDataConnection.acquire({
          scope: this.#scope,
          key: this.#key,
          kind,
          lifetime,
        });
        this.#acquisitions.add(acquisition);
        const original = acquisition;
        created();
        if (cancelled) void original.close().catch(() => {});
        const stream = await original.ready;
        stream.once('close', () => {
          void this.#finishData(original).catch(() => {});
        });
        this.handle();
        if (cancelled || stream.destroyed) throw invalid();
        return stream;
      } catch {
        created();
        if (acquisition) await this.#finishData(acquisition);
        else this.#dataSlots--;
        throw invalid();
      }
    });
    this.#opening.add(pending);
    void pending.then(
      () => this.#opening.delete(pending),
      () => this.#opening.delete(pending),
    );
    let closing: Promise<void> | undefined;
    return Object.freeze({
      ready: pending,
      close: () => {
        cancelled = true;
        if (acquisition) void acquisition.close().catch(() => {});
        closing ??= creation.then(async () => {
          if (acquisition) await this.#finishData(acquisition);
        });
        return closing;
      },
    });
  }
  async #finishData(acquisition: BrokerDataAcquisition): Promise<void> {
    await acquisition.close();
    if (this.#acquisitions.delete(acquisition)) this.#dataSlots--;
  }
  cdp(): Promise<BrokerCdpAccess> {
    if (this.#closing) return Promise.reject(invalid());
    if (!this.#cdp)
      this.#cdp = Promise.resolve().then(() => {
        this.handle();
        return BrokerCdpAdapter.open({
          lifetime: this.#local,
          veto: () => this.assertLive(),
          acquire: (lifetime) => this.#acquire(1, lifetime),
        });
      });
    return this.#cdp;
  }
  close(): Promise<void> {
    if (this.#closePromise) return this.#closePromise;
    this.#closing = true;
    this.#local.drain.block();
    this.#global.drain.markUnknown(this.#global.owner);
    this.#key?.fill(0);
    // Create transport deliberately lives outside this internal drain:
    // BrokerCreateClient.close awaits this reservation, never vice versa.
    this.#closePromise = Promise.resolve().then(async () => {
      const results = await Promise.allSettled([
        ...[...this.#sessions].map((session) => session.close()),
        ...[...this.#vnc].map((connection) => connection.close()),
        Promise.resolve().then(() => this.#registration?.close()),
        this.#cdp?.then(
          (adapter) => adapter.close(),
          () => {},
        ),
        ...[...this.#acquisitions].map((acquisition) => this.#finishData(acquisition)),
      ]);
      await Promise.allSettled([...this.#opening]);
      const late = await Promise.allSettled(
        [...this.#acquisitions].map((acquisition) => this.#finishData(acquisition)),
      );
      if ([...results, ...late].some((result) => result.status === 'rejected')) throw invalid();
      // Rejected open() can precede the original socket close. Only the local
      // raw child owners, not Promise settlement, prove those IOs have ended.
      while (this.#local.drain.snapshot().active > 1) {
        if (this.#local.drain.snapshot().unknown) throw invalid();
        await new Promise<void>((resolve) => setTimeout(resolve, 20));
      }
      if (this.#local.drain.snapshot().unknown) throw invalid();
      this.#releaseLocal();
    });
    return this.#closePromise;
  }

  vnc(): BrokerVncAccess {
    this.handle();
    if (this.#vnc.size >= 64) throw invalid();
    const original = BrokerVncConnection.open({
      lifetime: this.#local,
      veto: () => this.assertLive(),
      acquire: (lifetime) => this.#acquire(2, lifetime),
    });
    const access: BrokerVncAccess = Object.freeze({
      ready: original.ready,
      close: async () => {
        await original.close();
        this.#vnc.delete(access);
      },
    });
    this.#vnc.add(access);
    void access.ready.then(
      (socket) =>
        socket.once('close', () => {
          void access.close().catch(() => {});
        }),
      () => {
        void access.close().catch(() => {});
      },
    );
    return access;
  }

  vncSession(request: BrokerVncSessionRequest): BrokerVncSessionAccess {
    this.handle();
    if (this.#sessions.size >= 64 || request.socket.destroyed) throw invalid();
    const original = BrokerVncSession.open({
      ...request,
      lifetime: this.#local,
      veto: () => {
        request.veto();
        this.assertLive();
      },
      acquire: (lifetime) => this.#acquire(2, lifetime),
    });
    const access = Object.freeze({
      ready: original.ready,
      close: async () => {
        await original.close();
        this.#sessions.delete(access);
      },
      toJSON: () => ({}),
    });
    this.#sessions.add(access);
    const finish = () => {
      void access.close().catch(() => {});
    };
    request.socket.once('close', finish);
    void access.ready.catch(finish);
    return access;
  }
}

/** Original controlled-boot runtime; no caller-selected factories or endpoints.
 * No singleton fallback, persisted-handle restoration, or slot recycling.
 */
export class BrokerPoolRuntime {
  readonly #boot: BrokerBootSession;
  readonly #lifetime: OperationLifetime;
  readonly #release: () => boolean;
  readonly #transport: OperationLifetime;
  readonly #releaseTransport: () => boolean;
  #native?: ReturnType<typeof loadOriginalBrokerNative>;
  #egress?: BrokerEgressConnections;
  #listener?: BrokerEgressListener;
  #closing = false;
  #started = false;
  #initializationVeto?: () => void;
  #closePromise?: Promise<void>;
  readonly #groups = new Map<number, Group>();
  readonly #clients = new Set<BrokerCreateClient>();
  readonly #creating = new Set<Promise<OriginalBrokerGroup>>();

  private constructor(parent: OperationLifetime, boot: BrokerBootSession) {
    this.#boot = boot;
    const owner = parent.drain.fork(parent.owner, 'execution');
    this.#release = parent.drain.pin(owner);
    this.#lifetime = Object.freeze({ drain: parent.drain, owner });
    // Original transport dispatch is revocable independently of global group
    // pins. Global fork does not inherit a parent's logical close.
    const drain = new ExecutionDrain(2048, () => this.#check());
    drain.open();
    const transportOwner = drain.admit('execution');
    this.#releaseTransport = drain.pin(transportOwner);
    this.#transport = Object.freeze({ drain, owner: transportOwner });
  }
  static async open(
    lifetime: OperationLifetime,
    initializationVeto?: () => void,
    boot?: BrokerBootSession,
  ): Promise<BrokerPoolRuntime> {
    BrokerBootSession.assertReady(boot);
    const runtime = new BrokerPoolRuntime(lifetime, boot);
    runtime.#initializationVeto = initializationVeto;
    try {
      runtime.#check();
      runtime.#native = BrokerBootSession.takeNative(boot);
      runtime.#check();
      runtime.#egress = new BrokerEgressConnections({
        ...runtime.#native,
        lifetime: runtime.#transport,
      });
      runtime.#listener = new BrokerEgressListener({
        lifetime: runtime.#transport,
        factory: runtime.#native.egress,
        connections: runtime.#egress,
      });
      await runtime.#listener.start();
      runtime.#check();
      runtime.#started = true;
      runtime.#initializationVeto = undefined;
      return runtime;
    } catch {
      await runtime.close().catch(() => {});
      throw invalid();
    }
  }
  #veto(): void {
    this.#initializationVeto?.();
    BrokerBootSession.assertReady(this.#boot);
    if (this.#closing || this.#lifetime.drain.snapshot().mode === 'blocked') throw invalid();
  }
  #check(): void {
    this.#lifetime.drain.assertDispatch(this.#lifetime.owner);
    this.#veto();
  }
  create(slot: number, guard?: BrokerGroupGuard): Promise<OriginalBrokerGroup> {
    // Capture original methods before the first asynchronous boundary.
    let originalCheck: (() => void) | undefined;
    let originalVeto: (() => void) | undefined;
    try {
      if (guard) {
        originalCheck = guard.check.bind(guard);
        originalVeto = guard.veto.bind(guard);
      }
    } catch {
      return Promise.reject(invalid());
    }
    const veto = () => {
      originalVeto?.();
      this.#veto();
    };
    const check = () => {
      this.#check();
      originalCheck?.();
      veto();
    };
    const pending = Promise.resolve().then(async () => {
      check();
      if (
        !this.#started ||
        !this.#native ||
        !this.#egress ||
        !Number.isSafeInteger(slot) ||
        slot < 0 ||
        slot >= 32 ||
        this.#groups.has(slot)
      )
        throw invalid();
      const group = new Group(this.#lifetime, slot, check, veto);
      this.#groups.set(slot, group);
      // The boot owns the physical group, while the original allocation can
      // veto every actual control IO. This separate transport drain avoids
      // reservation.close -> client.close -> reservation.close cycles.
      const controlDrain = new ExecutionDrain(16, check);
      controlDrain.open();
      const controlOwner = controlDrain.admit('execution');
      const releaseControl = controlDrain.pin(controlOwner);
      const controlLifetime = Object.freeze({ drain: controlDrain, owner: controlOwner });
      let client: BrokerCreateClient | undefined;
      const finishControl = async () => {
        try {
          await client?.close();
          const state = controlDrain.snapshot();
          if (state.active > 1 || state.unknown) {
            this.#lifetime.drain.markUnknown(this.#lifetime.owner);
            if (state.active > 1) throw invalid();
          }
          releaseControl();
        } catch {
          this.#lifetime.drain.markUnknown(this.#lifetime.owner);
          throw invalid();
        }
      };
      try {
        check();
        client = new BrokerCreateClient({
          candidate: this.#native.candidate,
          boot: this.#native.boot,
          lifetime: controlLifetime,
          connector: new BrokerNativeControlConnector({
            factory: this.#native.control,
            lifetime: controlLifetime,
          }),
        });
        this.#clients.add(client);
        const registry = this.#egress;
        await client.start(slot, (prepared) => group.prepare(prepared, registry));
        await finishControl();
        check();
        return group.handle();
      } catch {
        await Promise.allSettled([Promise.resolve().then(() => client?.close()), group.close()]);
        await finishControl().catch(() => {});
        throw invalid();
      }
    });
    this.#creating.add(pending);
    void pending.then(
      () => this.#creating.delete(pending),
      () => this.#creating.delete(pending),
    );
    return pending;
  }
  close(): Promise<void> {
    if (this.#closePromise) return this.#closePromise;
    this.#closing = true;
    this.#transport.drain.block();
    this.#closePromise = Promise.resolve().then(async () => {
      const results = await Promise.allSettled([
        ...[...this.#groups.values()].map((group) => group.close()),
        ...[...this.#clients].map((client) => client.close()),
        Promise.resolve().then(() =>
          this.#listener ? this.#listener.close() : this.#egress?.close(),
        ),
      ]);
      await Promise.allSettled([...this.#creating]);
      if (results.some((result) => result.status === 'rejected')) {
        this.#lifetime.drain.markUnknown(this.#lifetime.owner);
        throw invalid();
      }
      while (this.#transport.drain.snapshot().active > 1) {
        if (this.#transport.drain.snapshot().unknown) {
          this.#lifetime.drain.markUnknown(this.#lifetime.owner);
          throw invalid();
        }
        await new Promise<void>((resolve) => setTimeout(resolve, 20));
      }
      this.#releaseTransport();
      if (this.#transport.drain.snapshot().unknown)
        this.#lifetime.drain.markUnknown(this.#lifetime.owner);
      else this.#release();
    });
    return this.#closePromise;
  }
}
