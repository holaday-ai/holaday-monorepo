import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { logger } from '../config/logger.js';

/**
 * CAPTCHA-REDUCE-1 — a per-user browser profile that survives tasks. A site
 * that let a user through after one verification (Google's exemption cookie,
 * Cloudflare's cf_clearance, consent choices) sees the same browser next time
 * instead of a blank, high-risk one.
 *
 * - Encrypted at rest (AES-256-GCM); the user hash is authenticated data, so a
 *   profile can never be read as another user's.
 * - Only verification clearance and consent state is kept; sign-in sessions
 *   stay with the browser-session vault and its per-site consent. There is no
 *   wider scope (FOLLOWUPS-282: `BROWSER_PROFILE_STORE_SCOPE=all` was removed).
 * - Idle profiles expire; the user can clear theirs at any time.
 * Off unless BROWSER_PROFILE_STORE_ENABLED=true with a key configured.
 */
export interface StoredCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires: number;
  httpOnly: boolean;
  secure: boolean;
  sameSite: 'Strict' | 'Lax' | 'None';
}
export interface StoredProfile {
  cookies: StoredCookie[];
  origins: Array<{ origin: string; localStorage: Array<{ name: string; value: string }> }>;
}

/** Variable names only; values are never logged. */
export const BROWSER_PROFILE_ENV = {
  enabled: 'BROWSER_PROFILE_STORE_ENABLED',
  dir: 'BROWSER_PROFILE_STORE_DIR',
  key: 'BROWSER_PROFILE_STORE_KEY',
  scope: 'BROWSER_PROFILE_STORE_SCOPE',
} as const;
export const PROFILE_IDLE_MS = 7 * 86_400_000;
const MAX_BYTES = 2 * 1024 * 1024;

/**
 * Anti-bot clearance and consent cookies: what spares a user the next challenge.
 * A name counts only on the domains that issue it (FOLLOWUPS-282), so another
 * site's cookie that happens to share the name is not kept. Bot-management
 * vendors set theirs on the protected site itself, so those match any domain.
 */
const GOOGLE = /(?:^|\.)(?:google\.[a-z]{2,3}(?:\.[a-z]{2})?|youtube\.com)$/;
const MICROSOFT = /(?:^|\.)(?:bing\.com|microsoft\.com|msn\.com)$/;
const ANY = /./;
const CLEARANCE_COOKIES: Array<{ names: RegExp; domains: RegExp }> = [
  { names: /^(?:GOOGLE_ABUSE_EXEMPTION|NID|AEC|SOCS|CONSENT|__Secure-ENID)$/, domains: GOOGLE },
  { names: /^(?:MUID|SRCHUID|SRCHD|_EDGE_S|_EDGE_V)$/, domains: MICROSOFT },
  // Cloudflare, DataDome, Akamai and AWS WAF clearance on the site they protect.
  {
    names: /^(?:cf_clearance|__cf_bm|_cfuvid|datadome|_abck|bm_sz|ak_bmsc|aws-waf-token)$/,
    domains: ANY,
  },
];
const isClearanceCookie = (cookie: StoredCookie) => {
  const domain = cookie.domain.toLowerCase().replace(/^\./, '');
  return CLEARANCE_COOKIES.some(
    (rule) => rule.names.test(cookie.name) && rule.domains.test(domain),
  );
};

export function filterProfile(profile: StoredProfile, now = Date.now()) {
  const live = profile.cookies.filter((c) => c.expires === -1 || c.expires * 1000 > now);
  return {
    // Session-only cookies do not outlive the browser that set them.
    cookies: live.filter((c) => c.expires !== -1 && isClearanceCookie(c)),
    origins: [],
  };
}

const userHash = (userId: string) =>
  createHash('sha256').update(`holaday-browser-profile:${userId}`).digest('hex');
const aad = (userId: string) => Buffer.from(`holaday-browser-profile:v1:${userHash(userId)}`);

export class BrowserProfileStore {
  /** When each user last cleared, so a task that was already running cannot write it back. */
  private readonly cleared = new Map<string, number>();
  constructor(
    private readonly options: {
      dir: string;
      key: Buffer;
      now?: () => number;
    },
  ) {
    if (options.key.length !== 32) throw new Error('browser_profile_key_invalid');
  }
  private file(userId: string) {
    return join(this.options.dir, `${userHash(userId)}.json`);
  }
  private now() {
    return this.options.now?.() ?? Date.now();
  }
  async load(userId: string): Promise<StoredProfile | null> {
    let raw: string;
    try {
      raw = await readFile(this.file(userId), 'utf8');
    } catch {
      return null;
    }
    try {
      const record = JSON.parse(raw) as {
        v: 1;
        savedAt: number;
        nonce: string;
        tag: string;
        data: string;
      };
      if (record.v !== 1 || this.now() - record.savedAt > PROFILE_IDLE_MS) {
        // Expiry is not a user clear: the task that found it may save afresh.
        await rm(this.file(userId), { force: true });
        return null;
      }
      const decipher = createDecipheriv(
        'aes-256-gcm',
        this.options.key,
        Buffer.from(record.nonce, 'base64'),
      );
      decipher.setAAD(aad(userId));
      decipher.setAuthTag(Buffer.from(record.tag, 'base64'));
      const plain = Buffer.concat([
        decipher.update(Buffer.from(record.data, 'base64')),
        decipher.final(),
      ]);
      return filterProfile(JSON.parse(plain.toString('utf8')) as StoredProfile, this.now());
    } catch {
      // Unreadable (wrong key, tampered, other user's file): start blank.
      return null;
    }
  }
  /** `since`: when the saving task began; a clear after that wins over the save. */
  async save(userId: string, profile: StoredProfile, since?: number): Promise<void> {
    const clearedAfterStart = () =>
      since !== undefined && (this.cleared.get(userHash(userId)) ?? -1) >= since;
    if (clearedAfterStart()) return;
    const kept = filterProfile(profile, this.now());
    const plain = Buffer.from(JSON.stringify(kept));
    if (plain.length > MAX_BYTES) return;
    const nonce = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.options.key, nonce);
    cipher.setAAD(aad(userId));
    const data = Buffer.concat([cipher.update(plain), cipher.final()]);
    await mkdir(this.options.dir, { recursive: true, mode: 0o700 });
    const file = this.file(userId);
    const temp = `${file}.${nonce.toString('hex')}.tmp`;
    await writeFile(
      temp,
      JSON.stringify({
        v: 1,
        savedAt: this.now(),
        nonce: nonce.toString('base64'),
        tag: cipher.getAuthTag().toString('base64'),
        data: data.toString('base64'),
      }),
      { mode: 0o600 },
    );
    if (clearedAfterStart()) {
      await rm(temp, { force: true });
      return;
    }
    await rename(temp, file);
  }
  /** One-click clear (settings) and account closure. */
  async clear(userId: string): Promise<void> {
    this.cleared.set(userHash(userId), this.now());
    await rm(this.file(userId), { force: true });
  }
}

let cached: { signature: string; store: BrowserProfileStore | null } | null = null;
/** The configured store, or null when disabled or without a valid key. */
export function browserProfileStore(
  env: NodeJS.ProcessEnv = process.env,
  warn: (message: string) => void = (message) => logger.warn(message),
): BrowserProfileStore | null {
  const signature = [
    env[BROWSER_PROFILE_ENV.enabled],
    env[BROWSER_PROFILE_ENV.dir],
    env[BROWSER_PROFILE_ENV.scope],
    createHash('sha256')
      .update(env[BROWSER_PROFILE_ENV.key] ?? '')
      .digest('hex'),
  ].join('|');
  if (cached?.signature === signature) return cached.store;
  let store: BrowserProfileStore | null = null;
  const scope = env[BROWSER_PROFILE_ENV.scope]?.trim();
  if (scope && scope !== 'clearance')
    warn(`${BROWSER_PROFILE_ENV.scope} only supports "clearance"; the configured value is ignored`);
  if (env[BROWSER_PROFILE_ENV.enabled] === 'true') {
    const key = Buffer.from(env[BROWSER_PROFILE_ENV.key] ?? '', 'base64');
    if (key.length === 32)
      store = new BrowserProfileStore({
        dir: env[BROWSER_PROFILE_ENV.dir] || join(process.cwd(), 'data', 'browser-profiles'),
        key,
      });
  }
  cached = { signature, store };
  return store;
}

/** Restores a user's saved clearance into a fresh browser context. */
export async function restoreBrowserProfile(
  context: import('playwright').BrowserContext,
  store: BrowserProfileStore,
  userId: string,
): Promise<number> {
  const saved = await store.load(userId).catch(() => null);
  if (!saved) return 0;
  if (saved.cookies.length) await context.addCookies(saved.cookies).catch(() => {});
  if (saved.origins.length)
    await context
      .addInitScript((origins) => {
        const own = origins.find((entry) => entry.origin === location.origin);
        if (own && localStorage.length === 0)
          for (const item of own.localStorage) localStorage.setItem(item.name, item.value);
      }, saved.origins)
      .catch(() => {});
  return saved.cookies.length;
}

/** Saves the clearance the store keeps from the context at the end of a task. */
export async function saveBrowserProfile(
  context: import('playwright').BrowserContext,
  store: BrowserProfileStore,
  userId: string,
  /** When the task restored the profile; a clear since then is not undone. */
  since?: number,
): Promise<void> {
  const state = await context.storageState().catch(() => null);
  if (state) await store.save(userId, state, since).catch(() => {});
}
