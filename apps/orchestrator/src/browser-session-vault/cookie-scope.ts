import { getDomain } from 'tldts';

/**
 * Cookie scope of a site grant: the selected site's registrable domain
 * (eTLD+1 from the public suffix list, e.g. `www.jd.com` → `jd.com`) plus a
 * short, reviewed list of related login domains. Anything across another
 * registrable domain is never collected or injected.
 */
export const RELATED_LOGIN_DOMAINS: Readonly<
  Record<string, ReadonlyArray<{ domain: string; reason: string }>>
> = {
  'taobao.com': [
    {
      domain: 'tmall.com',
      reason: '淘宝与天猫共用同一账号体系，登录后会话 Cookie 同时写入 .tmall.com',
    },
  ],
  'tmall.com': [
    {
      domain: 'taobao.com',
      reason: '天猫登录由 login.taobao.com 完成，会话 Cookie 位于 .taobao.com',
    },
  ],
  'weibo.com': [
    {
      domain: 'sina.com.cn',
      reason: '微博经 login.sina.com.cn 统一登录，SSO Cookie 位于 .sina.com.cn',
    },
    { domain: 'weibo.cn', reason: '微博移动站使用同一账号，登录态 Cookie 位于 .weibo.cn' },
  ],
};

/** Payment / wallet domains: never part of a login import, even when related. */
export const EXCLUDED_PAYMENT_DOMAINS: ReadonlySet<string> = new Set([
  'alipay.com',
  'alipay.cn',
  'tenpay.com',
  'unionpay.com',
  '95516.com',
  'paypal.com',
  'jdpay.com',
  'chinapay.com',
]);

const isTestHost = (host: string) =>
  process.env.NODE_ENV === 'test' && ['127.0.0.1', 'localhost'].includes(host);

function registrable(host: string): string | null {
  const normalized = host.replace(/^\./, '').toLowerCase();
  if (isTestHost(normalized)) return normalized;
  // null for a bare public suffix ("com", "co.uk", "github.io") or an IP literal.
  // Private suffixes count as boundaries, as they do for browser cookies.
  return getDomain(normalized, { allowPrivateDomains: true }) || null;
}

/** Registrable domain of the grant origin + reviewed related login domains. */
export function cookieScopeForOrigin(origin: string): string[] {
  const host = new URL(origin).hostname;
  const site = registrable(host);
  if (!site || EXCLUDED_PAYMENT_DOMAINS.has(site)) throw new Error('scope_denied');
  const related = (RELATED_LOGIN_DOMAINS[site] ?? [])
    .map((entry) => entry.domain)
    .filter((domain) => !EXCLUDED_PAYMENT_DOMAINS.has(domain));
  return [site, ...related];
}

/** A cookie domain is in scope when its own registrable domain is one of the scope's. */
export function cookieDomainInScope(cookieDomain: string, scope: readonly string[]): boolean {
  const domain = cookieDomain.replace(/^\./, '').toLowerCase();
  if (!domain || /[^a-z0-9.-]/.test(domain)) return false;
  const site = registrable(domain);
  return (
    site !== null &&
    !EXCLUDED_PAYMENT_DOMAINS.has(site) &&
    scope.includes(site) &&
    (domain === site || domain.endsWith(`.${site}`))
  );
}

/** Whether a request/navigation host belongs to the grant's cookie scope. */
export function hostInScope(host: string, scope: readonly string[]): boolean {
  return cookieDomainInScope(host, scope);
}
