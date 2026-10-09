import type { BrowserGrantMetadata, BrowserSessionState } from '@holaday/shared-types';
import type { BrowserContext, BrowserContextOptions, Page } from 'playwright';
import {
  type BrowserNetworkPolicy,
  defaultBrowserNetworkPolicy,
} from '../agent/browser-network-policy.js';
import { detectCaptchaPage, detectLoginPage } from '../agent/login-detector.js';
import { type Checkout, type SessionVault, VaultError } from './vault.js';

type Probe = { path: string; selector: string };
export type ContextFactory = (options: BrowserContextOptions) => Promise<BrowserContext>;
export interface VaultTask {
  page: Page;
  context: BrowserContext;
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
  private async guard(
    userId: string,
    grant: BrowserGrantMetadata,
    context: BrowserContext,
    task?: Checkout,
  ) {
    const check = () =>
      task
        ? this.vault.check(userId, grant.id, task)
        : this.vault.authorize(userId, grant.id, grant.version, true);
    await context.route('**/*', async (route) => {
      try {
        await check();
        const req = route.request();
        if (
          !(await (this.options.networkPolicy ?? defaultBrowserNetworkPolicy).check(req.url()))
            .allowed
        )
          return await route.abort('blockedbyclient');
        if (new URL(req.url()).origin !== grant.origin || !['GET', 'HEAD'].includes(req.method()))
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
    }, 1000);
    timer.unref();
    context.on('close', () => {
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
  async open(userId: string, id: string, factory = this.options.context): Promise<VaultTask> {
    const task = await this.vault.checkout(userId, id);
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
      let ended = false;
      return {
        page,
        context,
        close: async (save = true) => {
          if (ended) return;
          ended = true;
          let state: BrowserSessionState | undefined;
          try {
            if (save) {
              await this.vault.check(userId, id, task);
              const captured = await ownedContext.storageState();
              const cdp = await ownedContext.newCDPSession(page);
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
              const host = new URL(task.grant.origin).hostname;
              state = {
                cookies: captured.cookies
                  .filter((c) => c.domain.replace(/^\./, '') === host)
                  .map((c) => ({
                    name: c.name,
                    value: c.value,
                    domain: c.domain,
                    path: c.path,
                    secure: c.secure,
                    httpOnly: c.httpOnly,
                    hostOnly: !c.domain.startsWith('.'),
                    sameSite:
                      c.sameSite === 'None'
                        ? 'no_restriction'
                        : c.sameSite === 'Strict'
                          ? 'strict'
                          : 'lax',
                    session: c.expires === -1,
                    ...(c.expires > 0 ? { expirationDate: c.expires } : {}),
                  })),
                storage: (
                  captured.origins.find((o) => o.origin === task.grant.origin)?.localStorage ?? []
                ).filter((s) => task.grant.storageKeys.includes(s.name)),
              };
            }
          } finally {
            await stop();
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
}
