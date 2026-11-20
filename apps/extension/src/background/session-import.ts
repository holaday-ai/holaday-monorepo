import { type ServerMessage, browserSessionStateSchema } from '@holaday/shared-types';
import { LOCAL_CHROME_QA, ORCHESTRATOR_HTTP } from '../shared/config.js';
import { getAccessToken } from '../shared/storage.js';
import { validateSelectedTab } from './selected-tab-read.js';
type Command = NonNullable<
  NonNullable<
    Extract<ServerMessage, { type: 'server.extension.tool_call' }>['args']
  >['sessionImport']
>;
/** Credentials travel only via authenticated TLS to the vault, never the model/tool result. */
export async function importSelectedSession(
  command: Command,
): Promise<{ status: string; cookieCount: number }> {
  let phase = 'transport';
  try {
    const endpoint = new URL(ORCHESTRATOR_HTTP);
    const localFixture = LOCAL_CHROME_QA && ['127.0.0.1', 'localhost'].includes(endpoint.hostname);
    if (endpoint.protocol !== 'https:' && !localFixture) throw new Error();
    phase = 'owner';
    const token = await getAccessToken();
    if (!token) throw new Error();
    const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
    const base = `${ORCHESTRATOR_HTTP}/browser-data/grants/${encodeURIComponent(command.grantId)}`;
    phase = 'scope';
    const scopeResponse = await fetch(`${base}/scope`, {
      headers,
      redirect: 'error',
      signal: AbortSignal.timeout(8000),
    });
    if (!scopeResponse.ok) throw new Error();
    const scope: unknown = await scopeResponse.json();
    if (
      !scope ||
      typeof scope !== 'object' ||
      !('origin' in scope) ||
      !('storageKeys' in scope) ||
      !('purposes' in scope)
    )
      throw new Error();
    const grant = scope as {
      origin: string;
      storageKeys: string[];
      purposes: string[];
      cookieDomains?: unknown;
    };
    // The server computes the cookie scope (registrable domain via the public
    // suffix list + reviewed related login domains); the extension only checks shape.
    const cookieDomains = grant.cookieDomains;
    if (
      !Array.isArray(grant.storageKeys) ||
      grant.storageKeys.length > 20 ||
      grant.storageKeys.some((k) => typeof k !== 'string') ||
      !grant.purposes.includes('session-import') ||
      !Array.isArray(cookieDomains) ||
      cookieDomains.length < 1 ||
      cookieDomains.length > 5 ||
      cookieDomains.some((d) => typeof d !== 'string' || !/^[a-z0-9-]+(\.[a-z0-9-]+)*$/.test(d))
    )
      throw new Error();
    const domains = cookieDomains as string[];
    const inDomain = (value: string, domain: string) => {
      const bare = value.replace(/^\./, '').toLowerCase();
      return bare === domain || bare.endsWith(`.${domain}`);
    };
    phase = 'selection';
    const tab = await validateSelectedTab(command.target);
    if (
      new URL(tab.url ?? '').origin !== grant.origin ||
      new URL(command.target.expectedUrl).origin !== grant.origin
    )
      throw new Error();
    // The selected site itself must be inside the first (its own registrable) domain.
    const [siteDomain] = domains;
    if (!siteDomain || !inDomain(new URL(grant.origin).hostname, siteDomain)) throw new Error();
    phase = 'cookie_store';
    const stores = await chrome.cookies.getAllCookieStores();
    const store = stores.find((s) => s.tabIds.includes(command.target.tabId));
    if (!store) throw new Error();
    const seen = new Set<string>();
    const all: chrome.cookies.Cookie[] = [];
    for (const domain of domains)
      for (const cookie of await chrome.cookies.getAll({
        domain,
        storeId: store.id,
        partitionKey: {},
      })) {
        const key = JSON.stringify([cookie.name, cookie.domain, cookie.path, cookie.partitionKey]);
        if (!seen.has(key) && domains.some((d) => inDomain(cookie.domain, d))) {
          seen.add(key);
          all.push(cookie);
        }
      }
    const cookies = all.map((c) => ({
      name: c.name,
      value: c.value,
      domain: c.domain,
      path: c.path,
      secure: c.secure,
      httpOnly: c.httpOnly,
      hostOnly: c.hostOnly,
      sameSite: c.sameSite,
      session: c.session,
      ...(c.expirationDate ? { expirationDate: c.expirationDate } : {}),
      ...(c.partitionKey ? { partitionKey: c.partitionKey } : {}),
    }));
    phase = 'selected_storage';
    let storage: Array<{ name: string; value: string }> = [];
    if (grant.storageKeys.length) {
      const [result] = await chrome.scripting.executeScript({
        target: { tabId: command.target.tabId },
        world: 'ISOLATED',
        func: (origin: string, names: string[]) => {
          if (location.origin !== origin) return null;
          return names.flatMap((name) => {
            const value = localStorage.getItem(name);
            return value === null ? [] : [{ name, value }];
          });
        },
        args: [grant.origin, grant.storageKeys],
      });
      if (!Array.isArray(result?.result)) throw new Error();
      storage = result.result;
    }
    phase = 'revalidation';
    await validateSelectedTab(command.target);
    if ((await getAccessToken()) !== token) throw new Error();
    const state = browserSessionStateSchema.parse({ cookies, storage });
    phase = 'upload';
    const response = await fetch(`${base}/import`, {
      method: 'POST',
      headers,
      body: JSON.stringify(state),
      redirect: 'error',
      signal: AbortSignal.timeout(18000),
    });
    if (!response.ok) throw new Error();
    phase = 'acknowledgement';
    const result = await response.json();
    if (
      !['connected', 'relogin', 'risk_blocked'].includes(result.status) ||
      !Number.isInteger(result.cookieCount)
    )
      throw new Error();
    return { status: result.status, cookieCount: result.cookieCount };
  } catch {
    throw new Error(`session_import_failed:${phase}`);
  }
}
