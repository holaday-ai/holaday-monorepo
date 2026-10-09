import { randomUUID } from 'node:crypto';
import {
  type BrowserGrantMetadata,
  type BrowserSessionState,
  type BrowserSessionStatus,
  browserGrantRequestSchema,
  browserSessionStateSchema,
} from '@holaday/shared-types';
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
const LEASE_TTL = 120000;
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
export interface VaultStore {
  update<T>(userId: string, change: (doc: VaultDocument) => Promise<T>): Promise<T>;
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
  async dump(userId: string) {
    await this.queues.get(userId)?.catch(() => {});
    return structuredClone(this.docs.get(userId) ?? { grants: [] });
  }
}
export interface Checkout {
  state: BrowserSessionState;
  token: string;
  version: number;
  grant: BrowserGrantMetadata;
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
    return structuredClone(metadata);
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
  private state(grant: GrantRecord, raw: unknown): BrowserSessionState {
    const parsed = browserSessionStateSchema.safeParse(raw);
    if (!parsed.success) fail('invalid_session');
    const state = parsed.data;
    const host = new URL(grant.origin).hostname;
    if (Buffer.byteLength(JSON.stringify(state)) > 2 * 1024 * 1024) fail('invalid_session');
    for (const c of state.cookies) {
      if (
        c.domain.replace(/^\./, '') !== host ||
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
    return this.options.store.update(userId, async (doc) => {
      if (doc.grants.length >= 100) fail('grant_limit');
      const grant: GrantRecord = {
        id: randomUUID(),
        origin: input.origin,
        originSet: [input.origin],
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
    const result = await this.options.store.update(userId, async (doc) => {
      const expired: string[] = [];
      for (const g of doc.grants)
        if (!this.usable(g) && g.status !== 'revoked') {
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
  async checkout(userId: string, id: string): Promise<Checkout> {
    this.ensureEnabled();
    return this.options.store.update(userId, async (doc) => {
      const g = this.find(doc, id);
      this.requireLive(g);
      if (g.status !== 'connected' || !g.snapshot || !g.purposes.includes('read'))
        fail('grant_unavailable');
      if (g.writer && g.writer.expiresAt > this.now()) fail('writer_busy');
      const state = this.state(
        g,
        await unseal(this.options.keys, this.context(userId, g, g.snapshot), g.snapshot.envelope),
      );
      g.writer = { token: randomUUID(), expiresAt: this.now() + LEASE_TTL };
      g.lastUsedAt = this.now();
      return { state, token: g.writer.token, version: g.snapshot.version, grant: this.metadata(g) };
    });
  }
  async release(
    userId: string,
    id: string,
    task: Pick<Checkout, 'token' | 'version'>,
  ): Promise<void> {
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
  async check(
    userId: string,
    id: string,
    task: Pick<Checkout, 'token' | 'version'>,
  ): Promise<void> {
    this.ensureEnabled();
    await this.options.store.update(userId, async (doc) => {
      const g = this.find(doc, id);
      this.requireLive(g);
      if (
        g.status !== 'connected' ||
        g.writer?.token !== task.token ||
        g.writer.expiresAt <= this.now() ||
        g.snapshot?.version !== task.version
      )
        fail('cas_conflict');
      g.writer.expiresAt = this.now() + LEASE_TTL;
    });
  }
  async save(
    userId: string,
    id: string,
    task: Pick<Checkout, 'token' | 'version'>,
    raw: unknown,
  ): Promise<void> {
    this.ensureEnabled();
    let loggedOut = false;
    await this.options.store.update(userId, async (doc) => {
      const g = this.find(doc, id);
      this.requireLive(g);
      if (
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
      g.writer = undefined;
      this.audit(userId, g, 'save');
    });
    if (loggedOut) await this.closeActive(userId, id);
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
