import { randomUUID } from 'node:crypto';
import {
  type BrowserGrantMetadata,
  type BrowserSessionState,
  type BrowserSessionStatus,
  browserGrantRequestSchema,
  browserSessionStateSchema,
} from '@holaday/shared-types';
import { cookieDomainInScope, cookieScopeForOrigin, hostInScope } from './cookie-scope.js';
import {
  type EncryptionContext,
  type Envelope,
  type KeyProvider,
  assertVaultConfiguration,
  seal,
  unseal,
} from './crypto.js';
export const SESSION_TTL = 7 * 86400000;
export const PROFILE_IDLE_TTL = 7 * 86400000;
export const PROFILE_ABSOLUTE_TTL = 30 * 86400000;
/** Writer lease. Renewed only by a write-back, so an idle task never writes. */
export const LEASE_TTL = 15 * 60000;
/** Active (usable or awaiting) grants per user; inactive history is pruned. */
export const MAX_ACTIVE_GRANTS = 100;
const MAX_INACTIVE_KEPT = 20;
export class VaultError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}
function fail(code: string): never {
  throw new VaultError(code);
}
interface Snapshot {
  envelope: Envelope;
  version: number;
  purpose: 'session' | 'profile';
  expiresAt: number;
}
export interface GrantRecord extends BrowserGrantMetadata {
  consumed: boolean;
  snapshot?: Snapshot;
  writer?: { token: string; expiresAt: number };
  profileCreatedAt?: number;
}
export interface VaultDocument {
  grants: GrantRecord[];
}
/** Earliest moment a live grant in `doc` can expire (drives the indexed sweep). */
export function nextExpiryAt(doc: VaultDocument): number | null {
  let next = Number.POSITIVE_INFINITY;
  for (const g of doc.grants) {
    if (g.status === 'revoked' || g.status === 'expired') continue;
    next = Math.min(next, g.expiresAt, g.snapshot?.expiresAt ?? Number.POSITIVE_INFINITY);
    if (g.profileCreatedAt)
      next = Math.min(
        next,
        g.profileCreatedAt + PROFILE_ABSOLUTE_TTL,
        (g.lastUsedAt ?? g.issuedAt) + PROFILE_IDLE_TTL,
      );
  }
  return Number.isFinite(next) ? next : null;
}
export interface VaultStore {
  update<T>(userId: string, change: (doc: VaultDocument) => Promise<T>): Promise<T>;
  /** Consistent read without locks or writes (status checks, matching, listing). */
  read<T>(userId: string, view: (doc: VaultDocument) => T | Promise<T>): Promise<T>;
}
/** Only for synthetic tests; the runtime uses the transactional SQL adapter. */
export class MemoryVaultStore implements VaultStore {
  private docs = new Map<string, VaultDocument>();
  private queues = new Map<string, Promise<unknown>>();
  constructor() {
    if (process.env.NODE_ENV !== 'test') fail('test_store_forbidden');
  }
  async update<T>(userId: string, change: (doc: VaultDocument) => Promise<T>): Promise<T> {
    const before = this.queues.get(userId) ?? Promise.resolve();
    const run = before
      .catch(() => {})
      .then(async () => {
        const doc = structuredClone(this.docs.get(userId) ?? { grants: [] });
        const result = await change(doc);
        this.docs.set(userId, doc);
        return result;
      });
    this.queues.set(userId, run);
    return run;
  }
  async read<T>(userId: string, view: (doc: VaultDocument) => T | Promise<T>): Promise<T> {
    await this.queues.get(userId)?.catch(() => {});
    return view(structuredClone(this.docs.get(userId) ?? { grants: [] }));
  }
  async dump(userId: string) {
    await this.queues.get(userId)?.catch(() => {});
    return structuredClone(this.docs.get(userId) ?? { grants: [] });
  }
}
export interface Checkout {
  state: BrowserSessionState;
  /** null for a read-only fork: no lease, changes are discarded at the end. */
  token: string | null;
  version: number;
  grant: BrowserGrantMetadata;
  mode: 'writer' | 'readonly';
  /** Why a fork is read-only (reason code only). */
  reason: 'session_only' | 'writer_busy' | null;
}
type Verify = (
  state: BrowserSessionState,
  grant: BrowserGrantMetadata,
) => Promise<'connected' | 'relogin' | 'risk_blocked'>;
export class SessionVault {
  private readonly active = new Map<string, Set<() => Promise<void>>>();
  constructor(
    private readonly options: {
      store: VaultStore;
      keys: KeyProvider;
      importEnabled: boolean;
      profileEnabled: boolean;
      now?: () => number;
      audit?: (event: {
        userId: string;
        grantId: string;
        origin: string;
        version: number;
        kind: string;
        count: number;
        status: BrowserSessionStatus;
        reason: string | null;
      }) => void;
    },
  ) {
    assertVaultConfiguration(options);
  }
  private now() {
    return (this.options.now ?? Date.now)();
  }
  private ensureEnabled() {
    if (!this.options.importEnabled && !this.options.profileEnabled) fail('vault_disabled');
  }
  private context(
    userId: string,
    grant: GrantRecord,
    snapshot: Pick<Snapshot, 'purpose' | 'version'>,
  ): EncryptionContext {
    return {
      userId,
      origin: grant.origin,
      grantId: grant.id,
      purpose: snapshot.purpose,
      version: snapshot.version,
    };
  }
  private metadata(grant: GrantRecord): BrowserGrantMetadata {
    const { snapshot: _s, writer: _w, consumed: _c, profileCreatedAt: _p, ...metadata } = grant;
    return structuredClone({ ...metadata, cookieDomains: this.scope(grant) });
  }
  private audit(userId: string, grant: GrantRecord, kind: string) {
    try {
      this.options.audit?.({
        userId,
        grantId: grant.id,
        origin: grant.origin,
        version: grant.version,
        kind,
        count: grant.cookieCount,
        status: grant.status,
        reason: grant.reason,
      });
    } catch {
      /* Audit transport cannot undo revocation. */
    }
  }
  private find(doc: VaultDocument, id: string) {
    return doc.grants.find((g) => g.id === id) ?? fail('grant_unavailable');
  }
  private usable(grant: GrantRecord) {
    return (
      grant.revokedAt === null &&
      grant.expiresAt > this.now() &&
      (grant.snapshot?.expiresAt ?? grant.expiresAt) > this.now() &&
      (!grant.profileCreatedAt ||
        (grant.profileCreatedAt + PROFILE_ABSOLUTE_TTL > this.now() &&
          (grant.lastUsedAt ?? grant.issuedAt) + PROFILE_IDLE_TTL > this.now()))
    );
  }
  private requireLive(grant: GrantRecord) {
    if (!this.usable(grant)) fail('grant_unavailable');
  }
  /** Cookie scope recorded at grant time (older records: derived from the origin). */
  private scope(grant: GrantRecord): string[] {
    return grant.cookieDomains?.length ? grant.cookieDomains : cookieScopeForOrigin(grant.origin);
  }
  private state(grant: GrantRecord, raw: unknown): BrowserSessionState {
    const parsed = browserSessionStateSchema.safeParse(raw);
    if (!parsed.success) fail('invalid_session');
    const state = parsed.data;
    if (Buffer.byteLength(JSON.stringify(state)) > 2 * 1024 * 1024) fail('invalid_session');
    const scope = this.scope(grant);
    for (const c of state.cookies) {
      if (
        !cookieDomainInScope(c.domain, scope) ||
        c.domain !== c.domain.toLowerCase() ||
        /[^a-z0-9.:-]/.test(c.domain) ||
        (c.secure && !grant.origin.startsWith('https:')) ||
        (!c.session && c.expirationDate === undefined) ||
        (c.session && c.expirationDate !== undefined) ||
        (c.partitionKey && c.partitionKey.topLevelSite !== grant.origin)
      )
        fail('scope_denied');
    }
    if (
      state.storage.some((s) => !grant.storageKeys.includes(s.name)) ||
      new Set(state.storage.map((s) => s.name)).size !== state.storage.length
    )
      fail('scope_denied');
    return state;
  }
  private expireAt(grant: GrantRecord, state: BrowserSessionState, profile = false) {
    const cookies = state.cookies.flatMap((c) =>
      c.expirationDate ? [c.expirationDate * 1000] : [],
    );
    return Math.min(
      grant.expiresAt,
      profile
        ? (grant.profileCreatedAt ?? this.now()) + PROFILE_ABSOLUTE_TTL
        : this.now() + SESSION_TTL,
      ...(cookies.length ? cookies : [Number.POSITIVE_INFINITY]),
    );
  }
  async grant(userId: string, raw: unknown): Promise<BrowserGrantMetadata> {
    this.ensureEnabled();
    const parsed = browserGrantRequestSchema.safeParse(raw);
    if (!parsed.success) fail('invalid_grant');
    const input = parsed.data;
    if (
      !input.origin.startsWith('https:') &&
      !(
        process.env.NODE_ENV === 'test' &&
        ['127.0.0.1', 'localhost'].includes(new URL(input.origin).hostname)
      )
    )
      fail('invalid_grant');
    const profileOnly = !input.purposes.includes('session-import');
    if (
      !input.purposes.includes('read') ||
      input.purposes.includes('act') ||
      input.purposes.includes('record') ||
      (input.purposes.includes('profile-persist') && !this.options.profileEnabled) ||
      (!profileOnly && !this.options.importEnabled)
    )
      fail('invalid_grant');
    const now = this.now();
    const max = now + (profileOnly ? PROFILE_ABSOLUTE_TTL : SESSION_TTL);
    const expiresAt = input.expiresAt ?? max;
    if (expiresAt <= now || expiresAt > max) fail('invalid_grant');
    let cookieDomains: string[];
    try {
      cookieDomains = cookieScopeForOrigin(input.origin);
    } catch {
      fail('invalid_grant');
    }
    return this.options.store.update(userId, async (doc) => {
      // Only usable or pending grants count; revoked/expired history is pruned.
      const active = doc.grants.filter((g) => g.status !== 'revoked' && this.usable(g));
      if (active.length >= MAX_ACTIVE_GRANTS) fail('grant_limit');
      const inactive = doc.grants
        .filter((g) => !active.includes(g))
        .sort((a, b) => b.issuedAt - a.issuedAt)
        .slice(0, MAX_INACTIVE_KEPT);
      doc.grants = [...active, ...inactive];
      const grant: GrantRecord = {
        id: randomUUID(),
        origin: input.origin,
        originSet: [input.origin],
        cookieDomains,
        importScope: { cookies: true, localStorageKeys: input.storageKeys, indexedDB: false },
        purposes: [...new Set(input.purposes)],
        storageKeys: input.storageKeys,
        issuedAt: now,
        expiresAt,
        revokedAt: null,
        version: 1,
        status: 'awaiting_import',
        lastUsedAt: null,
        cookieCount: 0,
        reason: null,
        consumed: false,
      };
      doc.grants.push(grant);
      this.audit(userId, grant, 'grant');
      return this.metadata(grant);
    });
  }
  async list(userId: string): Promise<BrowserGrantMetadata[]> {
    this.ensureEnabled();
    // Read first: listing and sweeps only write when something actually expired.
    const stale = await this.options.store.read(userId, (doc) =>
      doc.grants.some((g) => !this.usable(g) && g.status !== 'revoked' && g.status !== 'expired'),
    );
    if (!stale)
      return this.options.store.read(userId, (doc) => doc.grants.map((g) => this.metadata(g)));
    const result = await this.options.store.update(userId, async (doc) => {
      const expired: string[] = [];
      for (const g of doc.grants)
        if (!this.usable(g) && g.status !== 'revoked' && g.status !== 'expired') {
          g.status = 'expired';
          g.snapshot = undefined;
          g.writer = undefined;
          g.cookieCount = 0;
          expired.push(g.id);
        }
      return { metadata: doc.grants.map((g) => this.metadata(g)), expired };
    });
    for (const id of result.expired) await this.closeActive(userId, id);
    return result.metadata;
  }
  async importScope(userId: string, id: string): Promise<BrowserGrantMetadata> {
    this.ensureEnabled();
    return this.options.store.update(userId, async (doc) => {
      const g = this.find(doc, id);
      this.requireLive(g);
      if (g.consumed || !g.purposes.includes('session-import') || !this.options.importEnabled)
        fail('import_consumed');
      if (g.issuedAt + 300000 <= this.now()) fail('import_window_expired');
      return this.metadata(g);
    });
  }
  async import(
    userId: string,
    id: string,
    raw: unknown,
    verify: Verify,
  ): Promise<BrowserGrantMetadata> {
    this.ensureEnabled();
    const initial = await this.options.store.update(userId, async (doc) => {
      const g = this.find(doc, id);
      this.requireLive(g);
      if (g.consumed || !g.purposes.includes('session-import') || !this.options.importEnabled)
        fail('import_consumed');
      if (g.issuedAt + 300000 <= this.now()) fail('import_window_expired');
      const state = this.state(g, raw);
      if (!state.cookies.length && !state.storage.length) fail('empty_session');
      const snapshot = {
        version: 1,
        purpose: 'session' as const,
        expiresAt: this.expireAt(g, state),
        envelope: await seal(
          this.options.keys,
          this.context(userId, g, { version: 1, purpose: 'session' }),
          state,
        ),
      };
      if (snapshot.expiresAt <= this.now()) fail('session_expired');
      g.snapshot = snapshot;
      g.consumed = true;
      g.status = 'verifying';
      g.cookieCount = state.cookies.length;
      return { state, grant: this.metadata(g) };
    });
    let status: 'connected' | 'relogin' | 'risk_blocked';
    try {
      status = await verify(initial.state, initial.grant);
    } catch {
      status = 'relogin';
    }
    return this.options.store.update(userId, async (doc) => {
      const g = this.find(doc, id);
      this.requireLive(g);
      if (g.version !== initial.grant.version || g.status !== 'verifying')
        fail('grant_unavailable');
      g.status = status;
      g.reason = status === 'connected' ? null : status;
      if (status !== 'connected') {
        g.snapshot = undefined;
        g.cookieCount = 0;
      }
      this.audit(userId, g, 'import');
      return this.metadata(g);
    });
  }
  async authorize(userId: string, id: string, version: number, verifying = false): Promise<void> {
    this.ensureEnabled();
    await this.options.store.update(userId, async (doc) => {
      const g = this.find(doc, id);
      this.requireLive(g);
      if (
        g.version !== version ||
        (g.status !== 'connected' && !(verifying && g.status === 'verifying'))
      )
        fail('grant_unavailable');
    });
  }
  /** The newest connected, usable grant whose cookie scope covers `targetUrl`'s host. */
  async match(userId: string, targetUrl: string): Promise<BrowserGrantMetadata | null> {
    this.ensureEnabled();
    let host: string;
    try {
      const url = new URL(targetUrl);
      if (!/^https?:$/.test(url.protocol)) return null;
      host = url.hostname;
    } catch {
      return null;
    }
    return this.options.store.read(userId, (doc) => {
      const found = doc.grants
        .filter(
          (g) =>
            g.status === 'connected' &&
            g.snapshot &&
            this.usable(g) &&
            g.purposes.includes('read') &&
            hostInScope(host, this.scope(g)),
        )
        .sort((a, b) => b.issuedAt - a.issuedAt)[0];
      return found ? this.metadata(found) : null;
    });
  }
  /**
   * A task's copy of the session. Only a profile-persist grant with a free
   * lease checks out as the writer; every other task gets a read-only fork of
   * the same snapshot version (never a writer_busy allocation failure).
   */
  async checkout(userId: string, id: string, options: { write?: boolean } = {}): Promise<Checkout> {
    this.ensureEnabled();
    return this.options.store.update(userId, async (doc) => {
      const g = this.find(doc, id);
      this.requireLive(g);
      if (g.status !== 'connected' || !g.snapshot || !g.purposes.includes('read'))
        fail('grant_unavailable');
      const state = this.state(
        g,
        await unseal(this.options.keys, this.context(userId, g, g.snapshot), g.snapshot.envelope),
      );
      g.lastUsedAt = this.now();
      const persist = g.purposes.includes('profile-persist') && this.options.profileEnabled;
      const busy = Boolean(g.writer && g.writer.expiresAt > this.now());
      if (options.write !== false && persist && !busy) {
        g.writer = { token: randomUUID(), expiresAt: this.now() + LEASE_TTL };
        return {
          state,
          token: g.writer.token,
          version: g.snapshot.version,
          grant: this.metadata(g),
          mode: 'writer' as const,
          reason: null,
        };
      }
      return {
        state,
        token: null,
        version: g.snapshot.version,
        grant: this.metadata(g),
        mode: 'readonly' as const,
        reason: persist ? ('writer_busy' as const) : ('session_only' as const),
      };
    });
  }
  /**
   * Read-only liveness check for a running task (no lock, no write): the
   * grant is still usable and, for the writer, still holds this lease/version.
   */
  async status(userId: string, id: string, task: Pick<Checkout, 'token' | 'version'>) {
    this.ensureEnabled();
    return this.options.store.read(userId, (doc) => {
      const g = doc.grants.find((grant) => grant.id === id);
      if (!g || !this.usable(g) || g.status !== 'connected') return 'grant_unavailable' as const;
      if (task.token === null) return 'live' as const;
      if (g.writer?.token !== task.token || g.snapshot?.version !== task.version)
        return 'cas_conflict' as const;
      return 'live' as const;
    });
  }
  async release(
    userId: string,
    id: string,
    task: Pick<Checkout, 'token' | 'version'>,
  ): Promise<void> {
    if (task.token === null) return;
    await this.options.store.update(userId, async (doc) => {
      const g = this.find(doc, id);
      if (g.writer?.token === task.token) g.writer = undefined;
    });
  }
  async stopUser(userId: string): Promise<void> {
    for (const key of [...this.active.keys()])
      if (key.startsWith(`${userId}:`))
        await this.closeActive(userId, key.slice(userId.length + 1));
  }
  /**
   * Writer write-back. `keepLease` is a mid-task checkpoint (renews the lease,
   * returns the new version); otherwise the lease is released. CAS on
   * token + version; a revoked/expired grant always wins.
   */
  async save(
    userId: string,
    id: string,
    task: Pick<Checkout, 'token' | 'version'>,
    raw: unknown,
    options: { keepLease?: boolean } = {},
  ): Promise<number> {
    this.ensureEnabled();
    let loggedOut = false;
    let saved = task.version;
    await this.options.store.update(userId, async (doc) => {
      const g = this.find(doc, id);
      this.requireLive(g);
      if (
        task.token === null ||
        g.writer?.token !== task.token ||
        g.writer.expiresAt <= this.now() ||
        g.snapshot?.version !== task.version
      )
        fail('cas_conflict');
      const state = this.state(g, raw);
      if (!state.cookies.length && !state.storage.length) {
        this.tombstone(g, 'logout');
        loggedOut = true;
        return;
      }
      if (!g.purposes.includes('profile-persist') || !this.options.profileEnabled) {
        g.writer = undefined;
        return;
      }
      saved = task.version + 1;
      g.profileCreatedAt ??= this.now();
      const snapshot = {
        version: task.version + 1,
        purpose: 'profile' as const,
        expiresAt: this.expireAt(g, state, true),
        envelope: await seal(
          this.options.keys,
          this.context(userId, g, { version: task.version + 1, purpose: 'profile' }),
          state,
        ),
      };
      g.snapshot = snapshot;
      g.cookieCount = state.cookies.length;
      g.lastUsedAt = this.now();
      g.writer = options.keepLease
        ? { token: task.token, expiresAt: this.now() + LEASE_TTL }
        : undefined;
      this.audit(userId, g, options.keepLease ? 'checkpoint' : 'save');
    });
    if (loggedOut) await this.closeActive(userId, id);
    return saved;
  }
  private tombstone(g: GrantRecord, reason: string) {
    g.revokedAt = this.now();
    g.version++;
    g.status = 'revoked';
    g.reason = reason;
    g.cookieCount = 0;
    g.snapshot = undefined;
    g.writer = undefined;
  }
  track(userId: string, id: string, close: () => Promise<void>): () => void {
    const key = `${userId}:${id}`;
    const set = this.active.get(key) ?? new Set();
    set.add(close);
    this.active.set(key, set);
    return () => {
      set.delete(close);
      if (!set.size) this.active.delete(key);
    };
  }
  private async closeActive(userId: string, id: string) {
    const key = `${userId}:${id}`;
    const closes = [...(this.active.get(key) ?? [])];
    this.active.delete(key);
    const results = await Promise.allSettled(closes.map((close) => close()));
    if (results.some((r) => r.status === 'rejected')) fail('context_close_failed');
  }
  async revoke(userId: string, id: string, reason: 'revoke' | 'logout' = 'revoke') {
    this.ensureEnabled();
    await this.options.store.update(userId, async (doc) => {
      const g = this.find(doc, id);
      this.tombstone(g, reason);
      this.audit(userId, g, reason);
    });
    await this.closeActive(userId, id);
  }
  async clear(userId: string) {
    this.ensureEnabled();
    const ids = await this.options.store.update(userId, async (doc) => {
      for (const g of doc.grants) {
        this.tombstone(g, 'clear');
        this.audit(userId, g, 'clear');
      }
      return doc.grants.map((g) => g.id);
    });
    for (const id of ids) await this.closeActive(userId, id);
  }
}
