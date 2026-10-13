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
 * Identity is decided by POSITIVE evidence only: the task must read or act on
 * data/pages that belong to the user. Mentioning 登录/验证/账号/login (a login
 * wall to stop at, a login button not to confuse with a wall, "不需要登录",
 * "登录页面长什么样") never makes a task private on its own.
 *
 * Evidence is (a) an ownership marker (我的/本人/自己的/用我的/以我的/我在X的,
 * my, as me) followed by a personal-data object or (b) an object that is
 * personal by nature (收件箱, 私信, 私有仓库, 购物车里, 订单详情, 账单明细,
 * 个人中心, 后台…). Public mentions ("官方账号", "联系邮箱", "会员价格",
 * "收藏数", "通知列表", "余额宝") match neither.
 */
const OWNER =
  '(?:我的|我自己的|本人的?|自己的|用我的|以我的|我(?:在)?(?:京东|淘宝|天猫|拼多多|美团|饿了么|携程|小红书|微博|知乎|抖音|快手|B站|哔哩哔哩|闲鱼|支付宝|微信|钉钉|飞书|GitHub|Gmail|QQ|Outlook)(?:上|里)?的)';
const PERSONAL_OBJECT =
  '(?:订单|物流|快递|购物车|收藏|关注|粉丝|订阅|私信|消息|站内信|通知|邮箱|邮件|收件箱|账号|帐号|账户|余额|积分|会员|优惠券|红包|钱包|账单|交易|支付记录|收货地址|地址|个人(?:中心|资料|信息|主页)|资料|简历|仓库|项目|文档|网盘|云盘|相册|照片|日程|日历|待办|工作台|后台|店铺|笔记|草稿|浏览记录|历史记录|足迹|评论|帖子|动态|作品|主页|数据|报表|仪表盘|设置|权限|关注的人|好友|聊天记录)';
const PERSONAL_EVIDENCE: Array<{ pattern: RegExp; reason: (match: string) => string }> = [
  {
    pattern: new RegExp(`${OWNER}[^，。；;、,\\s]{0,8}?${PERSONAL_OBJECT}`, 'i'),
    reason: (m) => `要读取或操作属于你本人的数据：「${m}」`,
  },
  {
    pattern:
      /我(?:在[^，。；;、,\s]{1,8}?)?(?:收藏|关注|订阅|购买|买|下单|发布|发|保存|上传|点赞|评论|加入)(?:过)?的/,
    reason: (m) => `要读取你本人收藏、关注或发布过的内容：「${m}」`,
  },
  {
    pattern: /(?:以|用)(?:我的|本人的?|我自己的)(?:身份|名义|账号|帐号|账户)/,
    reason: (m) => `要以你本人的身份操作：「${m}」`,
  },
  {
    pattern:
      /收件箱|私信|站内信|私有(?:仓库|项目|文档|频道|群|笔记)|私密(?:笔记|相册|文档)|购物车(?:里|中|内)|(?:账户|剩余)余额|订单(?:详情|列表|物流|记录|历史)|历史订单|账单(?:明细|列表|记录)|个人中心|会员中心|会员到期|消息中心|收藏夹|关注列表|粉丝列表|草稿箱|(?:新|未读)(?:邮件|消息|私信)|(?:看看?|查看|打开|进入|清空|整理|列出|读取|检查)[^，。；;、,\s]{0,6}购物车|打开邮箱|邮箱(?:里|中)|(?:去|进|进入|打开|管理|商家|卖家|运营|创作者)(?:到)?后台|工作台/,
    reason: (m) => `要读取本身就属于个人的页面：「${m}」`,
  },
  {
    pattern:
      /\bmy\s+(?:account|orders?|profile|cart|messages?|notifications?|favou?rites|repos?(?:itor(?:y|ies))?|subscriptions?|dashboard|inbox|e-?mails?|mail(?:box)?|wallet|balance|bookmarks?|watchlist|history|drafts?|documents?|files?|drive|photos?|calendar|purchases?|address(?:es)?|settings|followers|following)\b|\bprivate\s+(?:repos?(?:itor(?:y|ies))?|projects?|messages?)\b|\binbox\b|\b(?:open|check|read|view|list)\s+(?:the\s+)?(?:notifications|direct messages|DMs|unread messages|order history|shopping cart)\b|\b(?:as me|on my behalf|from my account|with my account|using my account)\b/i,
    reason: (m) => `要读取或操作属于你本人的数据：「${m}」`,
  },
];
/**
 * "不登录 GitHub" / "无需登录" / "without logging in" is a constraint, not a login
 * need. Only the negated login phrase itself is removed: whatever follows it
 * ("无需登录直接查看我的订单") is still checked for a personal-data need.
 */
const NEGATED_LOGIN =
  /(?:不|不要|无需|不需要|不用|别|勿|无须|不必|免)\s*(?:要|用|必)?\s*(?:登录|登陆|登入|注册|sign\s*in|log\s*in)|\b(?:without|no need to|don'?t|do not|never)\s+(?:logging|signing|log|sign)(?:\s*(?:in|into))?\b|\bno\s+(?:login|sign[ -]?in)\b/gi;
/**
 * A stop condition — "若有验证码、登录墙就立即停止", "遇到账号门槛立即暂停",
 * "if you hit a login wall, stop" — describes an obstacle to report, not a
 * request to use the user's login. Removed only when the clause names no
 * personal data (see PERSONAL_DATA), so "遇到登录页就用我的账号登录" still counts.
 */
const CONDITIONAL_OBSTACLE =
  /(?:若|如果|如若|假如|假若|倘若|要是|一旦|万一|如遇|若遇|遇到|碰到|遇上|出现)[^。；;！!？?\n]{0,40}?(?:登录|登陆|登入|验证|账号|账户|人机)[^。；;！!？?\n]{0,30}?(?:停止|停下|暂停|中止|终止|停|报告|交给我|交还|交接|告诉我|通知我|退出|放弃|不要继续|不再继续)|\b(?:if|when|should)\b[^.;!?\n]{0,60}?\b(?:log-?\s?in|sign-?\s?in|captcha|verification)\b[^.;!?\n]{0,40}?\b(?:stop|pause|halt|hand|report|abort)\b|\b(?:stop|pause|halt|abort)\b[^.;!?\n]{0,30}?\b(?:if|when)\b[^.;!?\n]{0,40}?\b(?:log-?\s?in|sign-?\s?in|captcha|verification)\b/gi;
/**
 * A forbidden action — "不加购物车", "不要下单", "不提交任何表单", "don't add to
 * cart" — limits what the task may do; it is not a request for account data.
 */
const NEGATED_OPERATION =
  /(?:不|不要|别|勿|切勿|禁止|不得|不能|不可|无需|不用|不必|无须)\s*(?:要|用|必)?\s*(?:把[^，。；、,;\n]{0,10}?)?(?:加入|加到|加|放入|放进|添加到|添加)?\s*(?:购物车|加购|下单|购买|付款|支付|结算|提交(?:任何)?(?:表单|订单|申请)?|收藏|关注|点赞|评论|转发|发帖|发布|发消息|发送消息)|\b(?:don'?t|do not|never|without)\s+(?:add(?:ing)?\s+(?:\w+\s+)?to\s+(?:the\s+|a\s+)?cart|buy(?:ing)?|purchas(?:e|ing)|check(?:ing)?\s*out|order(?:ing)?|plac(?:e|ing)\s+(?:an?\s+)?order|pay(?:ing)?|submit(?:ting)?|post(?:ing)?)\b/gi;
/** Personal-data wording that keeps a clause from being treated as a mere condition. */
const PERSONAL_DATA = /我的|本人|用我|自己的|私有|私密|\bmy\b|\bprivate\b/i;
/**
 * A safety note that FORBIDS touching personal data ("不读取我的任何私人数据",
 * "不要打开私有仓库", "don't access my account") is the opposite of a request.
 */
const NEGATED_PERSONAL =
  /(?:不|不要|不会|别|勿|切勿|禁止|不得|无需|不需要|不用|不能)\s*(?:去|会)?\s*(?:打开|查看|访问|读取|看|进入|获取|收集|使用|动|碰|修改|用|保存|上传)?\s*(?:任何)?\s*(?:我的|你的|用户的?|本人的?|个人|私人|私有|私密)[^，。；;、,\s]{0,10}|\b(?:don'?t|do not|never|without)\s+(?:access(?:ing)?|read(?:ing)?|open(?:ing)?|touch(?:ing)?|us(?:e|ing)|collect(?:ing)?)\s+(?:my|any\s+personal|any\s+private|private)\b[^,.;!?\n]{0,20}/gi;
export interface IdentityDecision {
  required: boolean;
  /** Readable reason: the personal-data object that was matched, or why none applies. */
  reason: string;
}
/**
 * Whether the request reads or acts on the user's own data, with the reason.
 * Login / verification / account wording alone is never evidence; uncertain
 * tasks run publicly and pause through the normal takeover flow if a real
 * login wall appears during execution.
 */
export function classifyIdentityNeed(intent: string): IdentityDecision {
  const text = intent
    .replace(/https?:\/\/[^\s<>"'，。；）]+/gi, ' ')
    .replace(NEGATED_LOGIN, ' ')
    .replace(CONDITIONAL_OBSTACLE, (clause) => (PERSONAL_DATA.test(clause) ? clause : ' '))
    .replace(NEGATED_OPERATION, ' ')
    .replace(NEGATED_PERSONAL, ' ');
  for (const evidence of PERSONAL_EVIDENCE) {
    const match = text.match(evidence.pattern)?.[0];
    if (match) return { required: true, reason: evidence.reason(match.trim()) };
  }
  return {
    required: false,
    reason:
      '未发现要读取你本人数据的请求（提到登录、验证或账号不算），按公开任务在云端执行；执行中遇到真实登录墙会暂停交给你。',
  };
}
/** Whether the request explicitly needs the user's own login / private data. */
export function requiresUserIdentity(intent: string): boolean {
  return classifyIdentityNeed(intent).required;
}
/**
 * Public sites that are usually unreachable from mainland-China networks: the
 * user's own Chrome may not open them, so they stay in the cloud browser even
 * with routing v2 (unless the request needs the user's own login, or the user
 * explicitly picked a Chrome page).
 */
const CN_UNREACHABLE_HOST =
  /(?:^|\.)(?:google\.[a-z.]{2,}|googleusercontent\.com|youtube\.com|youtu\.be|wikipedia\.org|wikimedia\.org|twitter\.com|x\.com|facebook\.com|instagram\.com|reddit\.com)$/i;
const CN_UNREACHABLE_NAME =
  /\bgoogle\b|谷歌|youtube|油管|wikipedia|维基百科|\btwitter\b|推特|\bfacebook\b|脸书|\binstagram\b|\breddit\b/i;
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
   * Set on awaiting routes: the request needs the user's own login. Every
   * extension wait offers "用公开云端继续（看不到你的个人信息）"; for an identity
   * task the copy states that personal data stays out of reach.
   */
  identityRequired?: boolean;
  /** Readable identity decision (which personal-data object matched, if any). */
  identityReason?: string;
  /**
   * Set when the route promises a logged-out run ("无登录态" / "看不到你的个人
   *信息"): the browser for this task must not load any user session.
   */
  sessionPolicy?: 'anonymous';
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
  const decision = classifyIdentityNeed(input.intent);
  const identityRequired = decision.required;
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
  const identity = identityRequired;
  const cnUnreachable = url
    ? CN_UNREACHABLE_HOST.test(host ?? '')
    : !cohort && CN_UNREACHABLE_NAME.test(input.intent);
  // Only a task that reads the user's own data waits before departure. Anything
  // else (public or uncertain) runs in the public cloud; a real login wall met
  // during execution pauses through the normal takeover flow.
  if (!identity && !input.selectionOrigin)
    return cnUnreachable
      ? {
          lane: 'cloud',
          reason: 'public_site',
          sessionPolicy: 'anonymous',
          limitation:
            '该站点在中国大陆网络常无法直接访问，已使用云端浏览器公开查询（无登录态），无法读取个人信息。',
        }
      : input.publicCloudRequested
        ? {
            lane: 'cloud',
            reason: 'explicit_public_cloud',
            sessionPolicy: 'anonymous',
            limitation:
              '已显式选择云端公开查询（无登录态）；可能遇到登录或反爬限制，无法读取个人信息。',
          }
        : { lane: 'cloud', reason: 'public_site' };
  // The user explicitly chose to continue without their login: run publicly.
  if (identity && input.publicCloudRequested && !input.selectionOrigin)
    return {
      lane: 'cloud',
      reason: 'explicit_public_cloud',
      identityRequired: true,
      identityReason: decision.reason,
      sessionPolicy: 'anonymous',
      limitation:
        '已按你的选择用公开云端继续（无登录态），看不到你的个人信息；需要个人数据的部分无法完成。',
    };
  const origin = url?.origin ?? cohort?.origin ?? input.selectionOrigin;
  // The user already authorized this site's session for the cloud browser.
  if (identity && input.cloudSessionAvailable && !input.selectionOrigin)
    return { lane: 'cloud', reason: 'vault_session', origin, identityReason: decision.reason };
  const fallback = identity
    ? `这个任务${decision.reason}，需要你的登录状态；也可以选择“用公开云端继续（看不到你的个人信息）”。`
    : '如果只需要公开信息，也可以选择“用公开云端继续（看不到你的个人信息）”。';
  if (!input.extensionOnline)
    return {
      lane: 'awaiting_user',
      reason: 'extension_offline',
      origin,
      identityRequired: identity,
      identityReason: decision.reason,
      question: `需要连接 HOLA DAY Chrome 插件：请安装或连接插件，并保持电脑和 Chrome 在线；在 Chrome 中登录目标站点，用“连接 Chrome”选择页面并授权该站点后重新提交原任务。${fallback}`,
    };
  if (!input.selectionOrigin)
    return {
      lane: 'awaiting_user',
      reason: 'selection_required',
      origin,
      identityRequired: identity,
      identityReason: decision.reason,
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
      identityReason: decision.reason,
      origin,
      question: `当前 Chrome 页面未授权目标站点 ${origin}。请在页面选择器重新选择该站点，只授权这个 exact origin 后重新提交任务。`,
    };
  return { lane: 'user-chrome', reason: 'selected', origin: input.selectionOrigin };
}
