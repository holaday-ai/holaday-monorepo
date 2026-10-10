/** Site preference never grants an origin or a write. First cohort is read-only. */
const COHORT = [
  { name: /京东|\bjd\.com\b/i, domain: 'jd.com', origin: 'https://www.jd.com' },
  {
    name: /淘宝|天猫|\b(?:taobao|tmall)\.com\b/i,
    domain: 'taobao.com',
    origin: 'https://www.taobao.com',
  },
  {
    name: /小红书|\bxiaohongshu\.com\b/i,
    domain: 'xiaohongshu.com',
    origin: 'https://www.xiaohongshu.com',
  },
  { name: /微博|\bweibo\.(?:com|cn)\b/i, domain: 'weibo.com', origin: 'https://weibo.com' },
  { name: /携程|\bctrip\.com\b/i, domain: 'ctrip.com', origin: 'https://www.ctrip.com' },
] as const;
/**
 * Explicit personal-login / private-data need: never served from a logged-out
 * cloud browser. Only wording tied to the user's own account counts; public
 * mentions ("官方账号", "联系邮箱", "会员价格", "收藏数", "通知列表",
 * "余额宝") are not identity needs.
 */
const IDENTITY = new RegExp(
  [
    '我的|本人的|用我的|我(?:收藏|关注|订阅|购买|发布|下单)的',
    '已登录|登录态|登录(?!页|入口|按钮|界面|框|注册页|方式|流程|样式)|登陆(?!页)',
    '会员中心|会员到期|会员积分|收藏夹',
    '(?:账号|账户)(?:设置|安全|余额|信息|资料|里|中)',
    '订单(?:列表|详情|记录|状态|物流|历史)|历史订单|(?:我|自己)[^，。；\\n]{0,6}订单',
    '账单(?:明细|列表|记录)',
    '私信|站内信|购物车|(?:账户|剩余)余额|余额(?:多少|还有|是多少)',
    '私有|私密|私人|收件箱|(?:新|未读)邮件|邮箱(?:里|中)|打开(?:我的)?邮箱|查看邮件|未读',
    '个人(?:中心|资料|信息|设置)|消息中心|通知中心|关注列表|粉丝列表|草稿箱',
    '(?:去|进|进入|打开|登录|管理|商家|卖家|运营|创作者)(?:到)?后台|控制台|工作台',
    '\\binbox\\b',
    '\\bmy\\s+(?:account|orders?|profile|cart|messages|notifications|favou?rites|repos?(?:itor(?:y|ies))?|subscriptions|dashboard|inbox)\\b',
    '\\bprivate\\s+(?:repos?(?:itor(?:y|ies))?|projects?|messages?)\\b',
    '\\blog(?:ged)?[ -]?in\\b|\\bsign(?:ed)?[ -]?in\\b',
  ].join('|'),
  'i',
);
/**
 * "不登录 GitHub" / "无需登录" / "without logging in" is a constraint, not a login
 * need. Only the negated login phrase itself is removed: whatever follows it
 * ("无需登录直接查看我的订单") is still checked for a personal-data need.
 */
const NEGATED_LOGIN =
  /(?:不|不要|无需|不需要|不用|别|勿|无须|不必|免)\s*(?:要|用|必)?\s*(?:登录|登陆|登入|注册|sign\s*in|log\s*in)|\b(?:without|no need to|don'?t|do not|never)\s+(?:logging|signing|log|sign)(?:\s*(?:in|into))?\b|\bno\s+(?:login|sign[ -]?in)\b/gi;
/** Whether the request explicitly needs the user's own login / private data. */
export function requiresUserIdentity(intent: string): boolean {
  return IDENTITY.test(
    intent.replace(/https?:\/\/[^\s<>"'，。；）]+/gi, ' ').replace(NEGATED_LOGIN, ' '),
  );
}
/**
 * Services that are normally behind a login. Not certain enough to refuse an
 * explicit public-cloud choice, but without one the task waits for the user's
 * Chrome instead of silently running logged out.
 */
const IDENTITY_LIKELY =
  /gmail|outlook|hotmail|qq\s*邮箱|163\s*邮箱|网易邮箱|飞书|钉钉|企业微信|notion|slack|语雀|网银|网上银行|支付宝|微信(?!公众号文章)|linkedin|领英/i;
const URL_IN_TEXT = /https?:\/\/[^\s<>"'，。；）]+/i;
/** The site a browser task targets: an explicit URL, else a first-cohort site name. */
export function browserTaskTargetUrl(intent: string): string | null {
  const raw = intent.match(URL_IN_TEXT)?.[0];
  if (raw)
    try {
      const url = new URL(raw);
      if (/^https?:$/.test(url.protocol)) return url.href;
    } catch {
      /* normal URL validation owns malformed input */
    }
  return COHORT.find((site) => site.name.test(intent))?.origin ?? null;
}
export interface UserBrowserRoute {
  lane: 'legacy' | 'cloud' | 'user-chrome' | 'awaiting_user';
  /**
   * Set on awaiting routes: the request needs the user's own login. When false
   * the UI may offer "用公开云端（无登录态）继续" (re-submit as public cloud).
   */
  identityRequired?: boolean;
  question?: string;
  origin?: string;
  limitation?: string;
  reason:
    | 'flag_off'
    | 'public_site'
    | 'explicit_public_cloud'
    | 'extension_offline'
    | 'selection_required'
    | 'origin_grant_required'
    | 'selected'
    | 'vault_session';
}
export function decideUserBrowserRoute(input: {
  enabled: boolean;
  intent: string;
  extensionOnline: boolean;
  selectionOrigin?: string;
  publicCloudRequested?: boolean;
  /**
   * The automatic cookie sync is retired: with the routing flag off, a task
   * that explicitly needs a login still goes to the user's Chrome instead of
   * a logged-out cloud browser. Other tasks keep the legacy route.
   */
  legacyCookieSyncRetired?: boolean;
  /** A connected site grant covers the target: the cloud browser has its session. */
  cloudSessionAvailable?: boolean;
}): UserBrowserRoute {
  const identityRequired = requiresUserIdentity(input.intent);
  if (!input.enabled && !(input.legacyCookieSyncRetired && identityRequired))
    return { lane: 'legacy', reason: 'flag_off' };
  const raw = input.intent.match(/https?:\/\/[^\s<>"'，。；）]+/i)?.[0];
  let url: URL | null = null;
  try {
    if (raw) url = new URL(raw);
  } catch {
    /* normal URL validation owns malformed input */
  }
  const host = url?.hostname;
  const selectionOrigin = input.selectionOrigin;
  const cohort = url
    ? COHORT.find(
        (site) =>
          host === site.domain ||
          host?.endsWith(`.${site.domain}`) ||
          (site.domain === 'taobao.com' && /(^|\.)tmall\.com$/.test(host ?? '')) ||
          (site.domain === 'weibo.com' && /(^|\.)weibo\.cn$/.test(host ?? '')),
      )
    : COHORT.find((site) => site.name.test(input.intent));
  // Words, not addresses: "/login" in a URL names a page, not a login need.
  const identity = identityRequired;
  const likely = !identity && IDENTITY_LIKELY.test(input.intent);
  // Unsure whether a login is needed → wait for the user's Chrome (or an explicit public choice).
  const preferred = Boolean(cohort) || identity || likely;
  if (input.publicCloudRequested && !identity && !input.selectionOrigin)
    return {
      lane: 'cloud',
      reason: 'explicit_public_cloud',
      limitation: '已显式选择云端公开查询（无登录态）；可能遇到登录或反爬限制，无法读取个人信息。',
    };
  if (!preferred && !input.selectionOrigin) return { lane: 'cloud', reason: 'public_site' };
  const origin = url?.origin ?? cohort?.origin ?? input.selectionOrigin;
  // The user already authorized this site's session for the cloud browser.
  if (input.cloudSessionAvailable && !input.selectionOrigin)
    return { lane: 'cloud', reason: 'vault_session', origin };
  const fallback = identity
    ? '这个任务需要你的登录状态，不会改用无登录态的云端浏览器。'
    : '如果只需要公开信息，也可以选择“用公开云端（无登录态）继续”。';
  if (!input.extensionOnline)
    return {
      lane: 'awaiting_user',
      reason: 'extension_offline',
      origin,
      identityRequired: identity,
      question: `需要连接 HOLA DAY Chrome 插件：请安装或连接插件，并保持电脑和 Chrome 在线；在 Chrome 中登录目标站点，用“连接 Chrome”选择页面并授权该站点后重新提交原任务。${fallback}`,
    };
  if (!input.selectionOrigin)
    return {
      lane: 'awaiting_user',
      reason: 'selection_required',
      origin,
      identityRequired: identity,
      question: `需要连接 HOLA DAY Chrome 插件：请用“连接 Chrome”选择${origin ?? '目标站点'}的页面并确认站点授权，再重新提交原任务。仅使用现有登录态查询；付款、删除和提交仍需逐次确认。${fallback}`,
    };
  if (
    (url && url.origin !== input.selectionOrigin) ||
    (cohort &&
      !url &&
      ![cohort.domain, 'taobao.com', 'tmall.com', 'weibo.cn']
        .filter(
          (d) =>
            d === cohort.domain ||
            (cohort.domain === 'taobao.com' && d === 'tmall.com') ||
            (cohort.domain === 'weibo.com' && d === 'weibo.cn'),
        )
        .some((d) => {
          const host = new URL(selectionOrigin ?? '').hostname;
          return host === d || host.endsWith(`.${d}`);
        }))
  )
    return {
      lane: 'awaiting_user',
      reason: 'origin_grant_required',
      identityRequired: identity,
      origin,
      question: `当前 Chrome 页面未授权目标站点 ${origin}。请在页面选择器重新选择该站点，只授权这个 exact origin 后重新提交任务。`,
    };
  return { lane: 'user-chrome', reason: 'selected', origin: input.selectionOrigin };
}
