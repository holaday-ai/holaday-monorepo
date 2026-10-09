import { createHash } from 'node:crypto';
import type { BrowserGrantMetadata, BrowserSessionState } from '@holaday/shared-types';
import type { BrowserContext, BrowserContextOptions, Page } from 'playwright';
import {
  type BrowserNetworkPolicy,
  defaultBrowserNetworkPolicy,
} from '../agent/browser-network-policy.js';
import { detectCaptchaPage, detectLoginPage } from '../agent/login-detector.js';
import { cookieDomainInScope, hostInScope } from './cookie-scope.js';
import { type Checkout, type SessionVault, VaultError } from './vault.js';

type Probe = { path: string; selector: string };
/** Revocation status poll for running vault tasks (lock-free read, no write). */
export const STATUS_POLL_MS = 5000;
/** Minimum interval between mid-task write-backs of a changed session. */
export const CHECKPOINT_MS = 30000;
export type ContextFactory = (options: BrowserContextOptions) => Promise<BrowserContext>;
export interface VaultTask {
  page: Page;
  context: BrowserContext;
  mode: 'writer' | 'readonly';
  close(save?: boolean): Promise<void>;
}
/** Only trusted site adapters define login evidence. A 200 response alone is never login proof. */
export class VaultBrowserWorker {
  constructor(
    private readonly vault: SessionVault,
    private readonly options: {
      context: ContextFactory;
      probes: ReadonlyMap<string, Probe>;
      networkPolicy?: Pick<BrowserNetworkPolicy, 'check'>;
      statusPollMs?: number;
      checkpointMs?: number;
      /** Reason code when a write-back happened (never values). */
      onWriteBack?: (reason: 'interval' | 'site_change') => void;
      /** Reason code when a task's session changes were discarded (never values). */
      onDiscard?: (reason: string) => void;
    },
  ) {}
  private browserState(
    state: BrowserSessionState,
    grant: BrowserGrantMetadata,
  ): NonNullable<Exclude<BrowserContextOptions['storageState'], string>> {
    if (state.cookies.some((c) => c.partitionKey)) throw new VaultError('partition_unsupported');
    return {
      cookies: state.cookies.map((c) => ({
        name: c.name,
        value: c.value,
        domain: c.hostOnly ? c.domain.replace(/^\./, '') : `.${c.domain.replace(/^\./, '')}`,
        path: c.path,
        expires: c.expirationDate ?? -1,
        httpOnly: c.httpOnly,
        secure: c.secure,
        sameSite:
          c.sameSite === 'no_restriction' ? 'None' : c.sameSite === 'strict' ? 'Strict' : 'Lax',
      })),
      origins: [{ origin: grant.origin, localStorage: state.storage }],
    };
  }
  /**
   * Network + liveness guard for a vault context. No DB access per request:
   * requests consult in-memory state; revocation is detected by the in-process
   * tracker immediately and by a lock-free status read every few seconds.
   */
  private async guard(
    userId: string,
    grant: BrowserGrantMetadata,
    context: BrowserContext,
    task?: Checkout,
  ) {
    const scope = grant.cookieDomains;
    let live = true;
    const check = async () => {
      if (!task) return this.vault.authorize(userId, grant.id, grant.version, true);
      const status = await this.vault.status(userId, grant.id, task);
      if (status !== 'live') throw new VaultError(status);
    };
    await context.route('**/*', async (route) => {
      try {
        const req = route.request();
        const url = new URL(req.url());
        if (
          !live ||
          !['GET', 'HEAD'].includes(req.method()) ||
          !(
            url.protocol === 'https:' ||
            (url.protocol === 'http:' && grant.origin.startsWith('http:'))
          ) ||
          !hostInScope(url.hostname, scope) ||
          !(await (this.options.networkPolicy ?? defaultBrowserNetworkPolicy).check(req.url()))
            .allowed
        )
          return await route.abort('blockedbyclient');
        await route.continue();
      } catch {
        await route.abort('blockedbyclient').catch(() => {});
      }
    });
    // WebSockets can mutate state without a POST. They are unavailable in this read-only version.
    await context.routeWebSocket('**/*', (socket) => socket.close());
    let closed = false;
    let checking = false;
    const stop = async () => {
      live = false;
      if (closed) return;
      closed = true;
      clearInterval(timer);
      untrack();
      await context.close();
    };
    const untrack = this.vault.track(userId, grant.id, stop);
    const timer = setInterval(() => {
      if (checking || closed) return;
      checking = true;
      void check()
        .catch(stop)
        .finally(() => {
          checking = false;
        });
    }, this.options.statusPollMs ?? STATUS_POLL_MS);
    timer.unref();
    context.on('close', () => {
      live = false;
      closed = true;
      clearInterval(timer);
      untrack();
    });
    try {
      await check();
    } catch (error) {
      await stop();
      throw error;
    }
    return stop;
  }
  /** Current context state restricted to the grant's scope (cookies + selected storage keys). */
  private async capture(context: BrowserContext, page: Page, grant: BrowserGrantMetadata) {
    const captured = await context.storageState();
    const cdp = await context.newCDPSession(page);
    try {
      const raw = await cdp.send('Network.getAllCookies');
      if (
        raw.cookies.some(
          (c) =>
            ('partitionKey' in c && c.partitionKey) ||
            ('partitionKeyOpaque' in c && c.partitionKeyOpaque),
        )
      )
        throw new VaultError('partition_unsupported');
    } finally {
      await cdp.detach();
    }
    const state: BrowserSessionState = {
      cookies: captured.cookies
        .filter((c) => cookieDomainInScope(c.domain, grant.cookieDomains))
        .map((c) => ({
          name: c.name,
          value: c.value,
          domain: c.domain,
          path: c.path,
          secure: c.secure,
          httpOnly: c.httpOnly,
          hostOnly: !c.domain.startsWith('.'),
          sameSite:
            c.sameSite === 'None' ? 'no_restriction' : c.sameSite === 'Strict' ? 'strict' : 'lax',
          session: c.expires === -1,
          ...(c.expires > 0 ? { expirationDate: c.expires } : {}),
        })),
      storage: (captured.origins.find((o) => o.origin === grant.origin)?.localStorage ?? []).filter(
        (s) => grant.storageKeys.includes(s.name),
      ),
    };
    return { state, digest: createHash('sha256').update(JSON.stringify(state)).digest('hex') };
  }
  async verify(
    userId: string,
    state: BrowserSessionState,
    grant: BrowserGrantMetadata,
  ): Promise<'connected' | 'relogin' | 'risk_blocked'> {
    const probe = this.options.probes.get(grant.origin);
    if (!probe) return 'relogin';
    const url = new URL(probe.path, grant.origin);
    if (url.origin !== grant.origin || url.search || url.hash || url.username || url.password)
      return 'relogin';
    let context: BrowserContext | undefined;
    try {
      context = await this.options.context({
        storageState: this.browserState(state, grant),
        serviceWorkers: 'block',
        acceptDownloads: false,
      });
      await this.guard(userId, grant, context);
      const page = await context.newPage();
      const response = await page.goto(url.href, { waitUntil: 'domcontentloaded', timeout: 10000 });
      const title = await page.title();
      if (
        [403, 429].includes(response?.status() ?? 0) ||
        detectCaptchaPage({ url: page.url(), title }).matched
      )
        return 'risk_blocked';
      if (response?.status() !== 200 || detectLoginPage({ url: page.url(), title }).matched)
        return 'relogin';
      return (await page.locator(probe.selector).count()) > 0 ? 'connected' : 'relogin';
    } catch {
      return 'relogin';
    } finally {
      await context?.close().catch(() => {});
    }
  }
  /**
   * Open a task context from the grant's snapshot. The writer (at most one
   * task per grant) accumulates changes in memory and writes back only when
   * the state actually changed: at most every `checkpointMs`, when the page
   * leaves the current site, and at the end. Read-only forks never write;
   * their changes are discarded with a reason code.
   */
  async open(
    userId: string,
    id: string,
    factory = this.options.context,
    options: { write?: boolean } = {},
  ): Promise<VaultTask> {
    const task = await this.vault.checkout(userId, id, options);
    let context: BrowserContext | undefined;
    try {
      context = await factory({
        storageState: this.browserState(task.state, task.grant),
        serviceWorkers: 'block',
        acceptDownloads: false,
      });
      const ownedContext = context;
      const stop = await this.guard(userId, task.grant, ownedContext, task);
      const page = await context.newPage();
      const writer = task.mode === 'writer';
      let ended = false;
      let lastDigest = writer
        ? ((await this.capture(ownedContext, page, task.grant).catch(() => null))?.digest ?? null)
        : null;
      let lastWrite = Date.now();
      let flushing: Promise<void> | null = null;
      const flush = async (reason: 'interval' | 'site_change') => {
        if (!writer || ended || flushing) return;
        if (reason === 'interval' && Date.now() - lastWrite < this.checkpointMs) return;
        flushing = (async () => {
          try {
            const { state, digest } = await this.capture(ownedContext, page, task.grant);
            if (digest === lastDigest) return;
            task.version = await this.vault.save(userId, id, task, state, { keepLease: true });
            lastDigest = digest;
            lastWrite = Date.now();
            this.options.onWriteBack?.(reason);
          } catch {
            // Lost lease/revoked: the final close discards; never retry with stale state.
          } finally {
            flushing = null;
          }
        })();
        await flushing;
      };
      const interval = writer
        ? setInterval(() => void flush('interval'), Math.min(this.checkpointMs, 30000))
        : undefined;
      interval?.unref();
      // Leaving the current site (main-frame origin change) writes back pending changes.
      let siteOrigin: string | null = null;
      const onNavigate = (frame: import('playwright').Frame) => {
        if (frame !== page.mainFrame()) return;
        let origin: string | null = null;
        try {
          const url = new URL(frame.url());
          if (/^https?:$/.test(url.protocol)) origin = url.origin;
        } catch {}
        if (origin && siteOrigin && origin !== siteOrigin) void flush('site_change');
        if (origin) siteOrigin = origin;
      };
      page.on('framenavigated', onNavigate);
      return {
        page,
        context,
        mode: task.mode,
        close: async (save = true) => {
          if (ended) return;
          if (interval) clearInterval(interval);
          page.off('framenavigated', onNavigate);
          await flushing;
          ended = true;
          let state: BrowserSessionState | undefined;
          try {
            if (save && writer) {
              const captured = await this.capture(ownedContext, page, task.grant).catch(
                (error: unknown) => {
                  // Already stopped (revoked/expired/closed): nothing to write back.
                  if (error instanceof VaultError) throw error;
                  return null;
                },
              );
              if (captured && captured.digest !== lastDigest) state = captured.state;
            }
          } finally {
            await stop();
          }
          if (!writer) {
            // A read-only fork never writes back; record why, never the values.
            if (save) this.options.onDiscard?.(task.reason ?? 'readonly');
            return;
          }
          // Commit only after Chromium confirms context.close. CAS/revocation is checked again.
          if (state) await this.vault.save(userId, id, task, state);
          else await this.vault.release(userId, id, task);
        },
      };
    } catch (error) {
      await context?.close().catch(() => {});
      await this.vault.release(userId, id, task).catch(() => {});
      throw error;
    }
  }
  private get checkpointMs() {
    return this.options.checkpointMs ?? CHECKPOINT_MS;
  }
}
