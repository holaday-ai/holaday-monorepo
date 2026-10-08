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
const IDENTITY =
  /我的|本人|已登录|登录态|会员|收藏|账号|账户|订单|账单|私信|购物车|余额|my\s+(?:account|orders|profile)|logged[ -]?in|sign[ -]?in/i;
export interface UserBrowserRoute {
  lane: 'legacy' | 'cloud' | 'user-chrome' | 'awaiting_user';
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
    | 'selected';
}
export function decideUserBrowserRoute(input: {
  enabled: boolean;
  intent: string;
  extensionOnline: boolean;
  selectionOrigin?: string;
  publicCloudRequested?: boolean;
}): UserBrowserRoute {
  if (!input.enabled) return { lane: 'legacy', reason: 'flag_off' };
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
  const identity = IDENTITY.test(input.intent);
  const preferred = Boolean(cohort) || identity;
  if (input.publicCloudRequested && !identity && !input.selectionOrigin)
    return {
      lane: 'cloud',
      reason: 'explicit_public_cloud',
      limitation: '已显式选择云端公开查询（无登录态）；可能遇到登录或反爬限制，无法读取个人信息。',
    };
  if (!preferred && !input.selectionOrigin) return { lane: 'cloud', reason: 'public_site' };
  const origin = url?.origin ?? cohort?.origin ?? input.selectionOrigin;
  if (!input.extensionOnline)
    return {
      lane: 'awaiting_user',
      reason: 'extension_offline',
      origin,
      question:
        '请安装或连接 HOLADAY Chrome 插件，并保持电脑和 Chrome 在线。在 Chrome 中登录目标站点，使用“连接 Chrome”选择页面并授权该站点后重新提交原任务。身份必需任务不会自动换用无登录态云端；公开查询可显式选择云端继续（无登录态）。',
    };
  if (!input.selectionOrigin)
    return {
      lane: 'awaiting_user',
      reason: 'selection_required',
      origin,
      question: `请使用“连接 Chrome”选择${origin ?? '目标站点'}的页面并确认站点授权，再重新提交原任务。仅使用现有登录态查询；付款、删除和提交仍需逐次确认。`,
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
      origin,
      question: `当前 Chrome 页面未授权目标站点 ${origin}。请在页面选择器重新选择该站点，只授权这个 exact origin 后重新提交任务。`,
    };
  return { lane: 'user-chrome', reason: 'selected', origin: input.selectionOrigin };
}
