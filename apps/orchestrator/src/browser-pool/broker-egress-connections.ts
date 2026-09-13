import { timingSafeEqual } from 'node:crypto';
import type { Socket } from 'node:net';
import type { BrowserNetworkPolicy } from '../agent/browser-network-policy.js';
import type { OperationLifetime } from '../execution/owned-operation.js';
import {
  type BrokerDataScope,
  acceptEgressClientHandshake,
  replyToBrokerEgressProbe,
} from './broker-data-protocol.js';
import { BrowserEgressProxy } from './egress-proxy.js';

interface Group {
  scope: BrokerDataScope;
  key: Buffer;
  lifetime: OperationLifetime;
  proxy: BrowserEgressProxy;
  sockets: Set<Peer>;
  closing: boolean;
  closePromise?: Promise<void>;
}

interface Peer {
  socket: Socket;
  closed: Promise<void>;
  group?: Group;
  abort(): void;
}

const invalid = (): never => {
  throw new Error('POOL_EGRESS_REGISTRATION_INVALID');
};

function scopeSnapshot(input: BrokerDataScope): BrokerDataScope {
  try {
    if (Object.keys(input).sort().join(',') !== 'boot,candidate,resource') invalid();
    const { candidate, boot, resource } = input;
    if (
      !/^[a-f0-9]{40}$/.test(candidate) ||
      !/^[a-f0-9]{32}$/.test(boot) ||
      !/^[a-f0-9]{32}$/.test(resource) ||
      [candidate, boot, resource].some((value) => typeof value !== 'string' || /^0+$/.test(value))
    )
      invalid();
    return Object.freeze({ candidate, boot, resource });
  } catch {
    return invalid();
  }
}

/** Private original-boot owner of accepted sockets, not a listener installer.
 * The fixed listener must stop accepting before its owner reports completion.
 * Registration and socket handoff are internal capabilities, never API inputs.
 */
export class BrokerEgressConnections {
  private readonly groups = new Map<string, Group>();
  private readonly reservedResources = new Set<string>();
  private readonly peers = new Set<Peer>();
  private readonly seen = new WeakSet<Socket>();
  private readonly lifetime: OperationLifetime;
  private readonly release: () => boolean;
  private readonly candidate: string;
  private readonly boot: string;
  private closing = false;
  private closePromise?: Promise<void>;

  constructor(options: { candidate: string; boot: string; lifetime: OperationLifetime }) {
    const scope = scopeSnapshot({
      candidate: options.candidate,
      boot: options.boot,
      resource: '01'.repeat(16),
    });
    this.candidate = scope.candidate;
    this.boot = scope.boot;
    const { drain, owner: parent } = options.lifetime;
    const owner = drain.fork(parent, 'execution');
    this.release = drain.pin(owner);
    this.lifetime = Object.freeze({ drain, owner });
    try {
      drain.assertDispatch(owner);
    } catch {
      this.release();
      invalid();
    }
  }

  register(
    input: BrokerDataScope,
    key: Buffer,
    lifetime: OperationLifetime,
    options: { policy?: Pick<BrowserNetworkPolicy, 'check'> } = {},
  ): Readonly<{ close(): Promise<void> }> {
    this.assertLive();
    const scope = scopeSnapshot(input);
    if (
      scope.candidate !== this.candidate ||
      scope.boot !== this.boot ||
      this.reservedResources.has(scope.resource) ||
      this.reservedResources.size >= 32 ||
      !Buffer.isBuffer(key) ||
      key.length !== 32 ||
      key.every((byte) => byte === 0) ||
      [...this.groups.values()].some((group) => timingSafeEqual(group.key, key))
    )
      invalid();
    // Constructor drain callbacks may reenter. Failed reservations are not reusable.
    this.reservedResources.add(scope.resource);
    const original = Object.freeze({ drain: lifetime.drain, owner: lifetime.owner });
    const ownedKey = Buffer.from(key);
    let proxy: BrowserEgressProxy;
    try {
      proxy = new BrowserEgressProxy({ lifetime: original, policy: options.policy });
    } catch {
      ownedKey.fill(0);
      return invalid();
    }
    const group: Group = {
      scope,
      key: ownedKey,
      lifetime: original,
      proxy,
      sockets: new Set(),
      closing: false,
    };
    this.groups.set(scope.resource, group);
    try {
      this.assertLive(group);
    } catch {
      void this.closeGroup(group).catch(() => {});
      return invalid();
    }
    return Object.freeze({ close: () => this.closeGroup(group) });
  }

  accept(socket: Socket): void {
    // An already handed-off object cannot be adopted by this registry twice.
    if (this.seen.has(socket)) throw new Error('POOL_EGRESS_HANDOFF_INVALID');
    this.seen.add(socket);
    if (this.closing || socket.destroyed) {
      socket.destroy();
      return;
    }
    const overLimit = this.peers.size >= 64;
    socket.pause();
    let finish!: () => void;
    const closed = new Promise<void>((resolve) => {
      finish = resolve;
    });
    let input = Buffer.alloc(0);
    let phase: 'first' | 'writing' | 'ack' | 'transferred' | 'closed' = 'first';
    let handshake: ReturnType<typeof acceptEgressClientHandshake> | undefined;
    const deadline = performance.now() + 5000;
    const disposeAuth = () => {
      clearTimeout(timer);
      socket.off('data', data);
      handshake?.close();
      handshake = undefined;
      input.fill(0);
      input = Buffer.alloc(0);
    };
    const abort = () => {
      if (phase !== 'transferred') {
        phase = 'closed';
        disposeAuth();
      }
      socket.destroy();
    };
    const peer: Peer = { socket, closed, abort };
    const timer = setTimeout(abort, 5000);
    const check = () => {
      this.assertLive(peer.group);
      const now = performance.now();
      if (!Number.isFinite(now) || now >= deadline || phase === 'closed' || socket.destroyed)
        throw new Error('POOL_EGRESS_AUTH_INVALID');
    };
    const associate = (frame: Buffer, resourceOffset: number) => {
      const group = this.groups.get(
        frame.subarray(resourceOffset, resourceOffset + 16).toString('hex'),
      );
      if (!group) throw new Error('POOL_EGRESS_AUTH_INVALID');
      this.assertLive(group);
      peer.group = group;
      group.sockets.add(peer);
      return group;
    };
    const data = (chunk: Buffer) => {
      try {
        check();
        if (phase !== 'first' && phase !== 'ack') throw new Error('POOL_EGRESS_AUTH_INVALID');
        const limit = phase === 'first' ? 154 : 154 + 64 * 1024;
        if (!Buffer.isBuffer(chunk) || input.length + chunk.length > limit)
          throw new Error('POOL_EGRESS_AUTH_INVALID');
        const previous = input;
        input = Buffer.concat([previous, chunk]);
        previous.fill(0);
        if (phase === 'first') {
          if (input.length < 4) return;
          const magic = input.subarray(0, 4).toString('ascii');
          if (magic === 'HPE1') {
            if (input.length < 89) return;
            if (input.length !== 89) throw new Error('POOL_EGRESS_AUTH_INVALID');
            const group = associate(input, 25);
            const response = replyToBrokerEgressProbe(group.scope, input);
            check();
            phase = 'writing';
            socket.pause();
            socket.write(response, (error) => {
              try {
                if (error) throw error;
                check();
                socket.end();
              } catch {
                abort();
              } finally {
                response.fill(0);
              }
            });
            return;
          }
          if (magic !== 'HPG1') throw new Error('POOL_EGRESS_AUTH_INVALID');
          if (input.length < 154) return;
          const group = associate(input, 26);
          handshake = acceptEgressClientHandshake(group.scope, group.key, input);
          input.fill(0);
          input = Buffer.alloc(0);
          check();
          phase = 'writing';
          socket.pause();
          const challenge = handshake.challenge;
          socket.write(challenge, (error) => {
            try {
              if (error) throw error;
              check();
              phase = 'ack';
              socket.resume();
            } catch {
              abort();
            } finally {
              challenge.fill(0);
            }
          });
          return;
        }
        if (input.length < 154) return;
        if (!handshake || !peer.group) throw new Error('POOL_EGRESS_AUTH_INVALID');
        handshake.acceptAcknowledgement(input.subarray(0, 154));
        const remaining = Buffer.from(input.subarray(154));
        socket.pause();
        check();
        disposeAuth();
        if (remaining.length > 0) socket.unshift(remaining);
        this.assertLive(peer.group);
        peer.group.proxy.acceptAuthenticatedConnection(socket, deadline);
        phase = 'transferred';
      } catch {
        abort();
      }
    };
    socket.once('close', () => {
      disposeAuth();
      phase = 'closed';
      peer.group?.sockets.delete(peer);
      this.peers.delete(peer);
      finish();
    });
    socket.on('error', abort);
    this.peers.add(peer);
    socket.on('data', data);
    try {
      this.assertLive();
      if (overLimit) abort();
      else socket.resume();
    } catch {
      abort();
    }
  }

  close(): Promise<void> {
    if (this.closePromise) return this.closePromise;
    this.closing = true;
    // Seal each original proxy synchronously; only physical waiting is deferred.
    const groups = [...this.groups.values()].map((group) => this.closeGroup(group));
    this.closePromise = Promise.resolve()
      .then(async () => {
        for (const peer of this.peers) peer.abort();
        const results = await Promise.allSettled(groups);
        while (this.peers.size > 0) await Promise.all([...this.peers].map((peer) => peer.closed));
        if (results.some((result) => result.status === 'rejected'))
          throw new Error('POOL_EGRESS_CLOSE_UNPROVEN');
        this.release();
      })
      .catch(() => {
        this.lifetime.drain.markUnknown(this.lifetime.owner);
        throw new Error('POOL_EGRESS_CLOSE_UNPROVEN');
      });
    return this.closePromise;
  }

  private closeGroup(group: Group): Promise<void> {
    if (group.closePromise) return group.closePromise;
    group.closing = true;
    group.key.fill(0);
    const proxyClosed = group.proxy.close();
    group.closePromise = Promise.resolve().then(async () => {
      for (const peer of group.sockets) peer.abort();
      await proxyClosed;
      while (group.sockets.size > 0)
        await Promise.all([...group.sockets].map((peer) => peer.closed));
    });
    return group.closePromise;
  }

  private assertLive(group?: Group): void {
    if (this.closing || group?.closing) throw new Error('POOL_EGRESS_CLOSED');
    this.lifetime.drain.assertDispatch(this.lifetime.owner);
    if (group) group.lifetime.drain.assertDispatch(group.lifetime.owner);
    if (this.closing || group?.closing) throw new Error('POOL_EGRESS_CLOSED');
  }
}
