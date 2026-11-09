/**
 * FIX-58 复审 #2 第 4 项: the pause after an action the page answered with a request it may have
 * written was 「检测到写请求或交易状态变化，已暂停后续操作。第一次副作用无法事前阻止，请核对结果后确认如何
 * 继续。」 — machine words. It is said as what happened, then what the user should do:
 * 「我在故宫博物院网站点了「导览」，页面像是提交了一个请求，我先停下了。你看一下右侧画面有没有生成预约或
 * 订单；没有的话回复「继续」，我接着只读查看。」 English tasks are answered in English. No
 * 「副作用 / 写请求 / 交易状态」.
 */

export interface PausedAction {
  tool: string;
  /** The control's visible name, when the snapshot gave one. */
  label?: string | null;
  /** A select's chosen value. */
  value?: string | null;
}

/** The visible name of a ref in a snapshot: 「- link "导览" [ref=e5]」, 「- generic [ref=e5]: 导览」, or its first child's text. */
export function refName(snapshot: string, ref: string): string | null {
  const lines = snapshot.split('\n');
  const at = lines.findIndex((line) => line.includes(`[ref=${ref}]`));
  if (at < 0) return null;
  const own = lines[at]!;
  const quoted = own.match(/^\s*-\s+[a-z]+\s+"([^"]{1,80})"/i)?.[1];
  if (quoted?.trim()) return tidy(quoted);
  const trailing = own.match(/\[ref=[^\]]+\][^:]*:\s*(.+)$/)?.[1];
  if (trailing?.trim()) return tidy(trailing);
  const indent = own.match(/^\s*/)?.[0].length ?? 0;
  for (const line of lines.slice(at + 1, at + 6)) {
    if ((line.match(/^\s*/)?.[0].length ?? 0) <= indent) break;
    const child =
      line.match(/^\s*-\s+[a-z]+\s+"([^"]{1,80})"/i)?.[1] ??
      line.match(/^\s*-\s+text:\s*(.+)$/)?.[1] ??
      line.match(/\[ref=[^\]]+\][^:]*:\s*(.+)$/)?.[1];
    if (child?.trim()) return tidy(child);
  }
  return null;
}

/**
 * FIX-59 P1-4: a control's name is one line, about 20 characters at most. 高德's logo link carried
 * the page's whole title with a literal 「\\n」 (「高德地图 — 在线地图查询与路线规划服务\\n …」): only the
 * first line is kept, and it is cut at about 20.
 */
const LABEL_MAX = 20;
/** The control's name as one line, whole. */
const oneLine = (text: string) => {
  const first =
    text
      .split(/\r?\n|\\n|\\r/)
      .map((line) => line.trim())
      .find((line) => line && !/^[…\s.]+$/.test(line)) ?? '';
  return first
    .replace(/\s+/g, ' ')
    .replace(/^["「]|["」]$/g, '')
    .replace(/\s*…$/, '')
    .trim();
};
const tidy = (text: string) => {
  const one = oneLine(text);
  return one.length > LABEL_MAX ? `${one.slice(0, LABEL_MAX - 1)}…` : one;
};

/**
 * FIX-59 P1-4: a name shaped like a page title — 「site — slogan」, one part being the site's name
 * (高德's logo link: 「高德地图 — 在线地图查询与路线规划服务」) — is no control's name either.
 */
export function labelLooksLikeTitle(label: string, site: string): boolean {
  const parts = label
    .replace(/…$/, '')
    .split(/\s+[-|_｜—–·]\s+|\s*[｜—–]\s*/)
    .map((part) => part.trim())
    .filter(Boolean);
  const name = site.trim();
  return parts.length >= 2 && name.length >= 2 && parts.some((part) => part === name);
}

/** FIX-59 P1-4: the page's own title (or a part of it) is never a control's name. */
export function labelIsPageTitle(label: string, title: string | null | undefined): boolean {
  const clean = (text: string) => text.replace(/\s+/g, '').replace(/…$/, '').toLowerCase();
  const name = clean(label);
  const whole = clean(title ?? '');
  if (!name || !whole) return false;
  if (whole === name || (name.length >= 6 && whole.startsWith(name))) return true;
  const parts = (title ?? '').split(/\s*[-|_｜—–·]\s*/).map(clean);
  return parts.length > 1 && name.length >= 6 && parts.join('').startsWith(name);
}

/**
 * FIX-59 P1-7: a Chinese task names a site in Chinese (「故宫博物院」), never by its host, and a search
 * result's title (「Amazon.sg: usb c」) is never the site's name.
 */
const CHINESE_SITE_NAMES: ReadonlyArray<[RegExp, string]> = [
  [/(?:^|\.)dpm\.org\.cn$/, '故宫博物院'],
  [/(?:^|\.)jd\.com$/, '京东'],
  [/(?:^|\.)taobao\.com$/, '淘宝'],
  [/(?:^|\.)tmall\.com$/, '天猫'],
  [/(?:^|\.)(?:ctrip|trip)\.com$/, '携程'],
  [/(?:^|\.)amap\.com$/, '高德地图'],
  [/(?:^|\.)douyin\.com$/, '抖音'],
  [/(?:^|\.)(?:xiaohongshu|rednote)\.com$/, '小红书'],
  [/(?:^|\.)zhihu\.com$/, '知乎'],
  [/(?:^|\.)bilibili\.com$/, '哔哩哔哩'],
  [/(?:^|\.)baidu\.com$/, '百度'],
  [/(?:^|\.)y\.qq\.com$/, 'QQ 音乐'],
  [/(?:^|\.)amazon\.sg$/, '亚马逊新加坡站'],
  [/(?:^|\.)amazon\.cn$/, '亚马逊中国'],
  [/(?:^|\.)amazon\.[a-z.]+$/, '亚马逊'],
  [/(?:^|\.)bestbuy\.com$/, 'Best Buy'],
  [/(?:^|\.)google\.[a-z.]+$/, 'Google'],
  [/(?:^|\.)youtube\.com$/, 'YouTube'],
  [/(?:^|\.)wikipedia\.org$/, '维基百科'],
];

/**
 * English names of a few sites whose pages title themselves only in Chinese (协调方核对第 0 步: an
 * English pause names 「the Palace Museum」, not 「故宫博物院」). Others fall back to the host.
 */
const ENGLISH_SITE_NAMES: ReadonlyArray<[RegExp, string]> = [
  [/(?:^|\.)dpm\.org\.cn$/, 'the Palace Museum website'],
  [/(?:^|\.)jd\.com$/, 'JD.com'],
  [/(?:^|\.)taobao\.com$/, 'Taobao'],
  [/(?:^|\.)tmall\.com$/, 'Tmall'],
  [/(?:^|\.)ctrip\.com$/, 'Trip.com (Ctrip)'],
  [/(?:^|\.)amap\.com$/, 'Amap'],
  [/(?:^|\.)douyin\.com$/, 'Douyin'],
  [/(?:^|\.)(?:xiaohongshu|rednote)\.com$/, 'Xiaohongshu'],
  [/(?:^|\.)zhihu\.com$/, 'Zhihu'],
  [/(?:^|\.)bilibili\.com$/, 'Bilibili'],
  [/(?:^|\.)amazon\.sg$/, 'Amazon Singapore'],
  [/(?:^|\.)amazon\.[a-z.]+$/, 'Amazon'],
  [/(?:^|\.)bestbuy\.com$/, 'Best Buy'],
];
const CJK_RE = /[\u3400-\u9fff\uf900-\ufaff]/;

function hostOf(url: string | null | undefined): string {
  try {
    return url ? new URL(url).hostname.replace(/^www\./, '') : '';
  } catch {
    return '';
  }
}

/**
 * The site as a person names it. FIX-59 P1-7: in Chinese a known site's Chinese name (「故宫博物院」
 * 「亚马逊新加坡站」), else the page title's site part (「门票-某某景区」→「某某景区」), else the host.
 * In English an English title part, else the site's English name, else the host. A title part that
 * reads as a search (「Amazon.sg: usb c」) or a bare domain is never the name.
 */
export function siteCalled(
  title: string | null | undefined,
  url: string | null | undefined,
  english = false,
): string {
  const host = hostOf(url);
  const known = (english ? ENGLISH_SITE_NAMES : CHINESE_SITE_NAMES).find(([re]) =>
    re.test(host),
  )?.[1];
  const parts = (title ?? '')
    .split(/\s*[-|_｜—–·]\s*/)
    .map((part) => part.trim())
    .filter(
      (part) =>
        part.length >= 2 &&
        part.length <= (english ? 32 : 16) &&
        !/[:：]/.test(part) &&
        !/^[\w-]+(?:\.[a-z]{2,})+$/i.test(part),
    );
  // A known site's Chinese name beats a title part: 高德's title ends in its slogan.
  if (!english) return known ?? [...parts].reverse()[0] ?? host;
  const englishPart = [...parts]
    .reverse()
    .find((part) => !CJK_RE.test(part) && /[a-z]/i.test(part));
  return englishPart ?? known ?? host;
}

/**
 * DEPLOY-58 第 0 步 2 (复审 #3): a control or request that looks like an order, a payment, a booking,
 * a submit or a confirm. Then the pause does not say it lightly: it may already have gone through.
 *
 * 协调方核对第 0 步: only a control named for the act counts (「立即购票」「提交订单」「确认支付」
 * 「确认预约」「Place order」「Pay now」「Book now」「Submit」). A word alone does not:「预约须知」
 * 「门票预订说明」「Booking info」, a dialog's 「确定」, a menu's 「预约参观」「购票」 are reading
 * or navigation. Anything named as information (须知 / 说明 / 规则 / 指南 / 详情 / info / policy /
 * FAQ) never counts. DEPLOY-59 第 0 步 3: nor 流程 / 时间 / guide (「在线购票流程」「预约参观时间」
 * 「Reserve a table guide」).
 */
const INFO_LABEL_RE =
  /须知|说明|规则|指南|详情|介绍|政策|帮助|常见问题|流程|时间|\binfo\b|information|\bpolic(?:y|ies)\b|\bfaq\b|\bguide\b|\bhelp\b|\bterms\b|\bdetails?\b|\blearn more\b/i;
/** A whole label that is itself the act: 「提交」「下单」「支付」「Submit」「Pay」. */
// FIX-59 P1-5: a button that says only 「购票 / 预约 / Buy tickets / Reserve / Checkout」 is the act too.
const SUBMIT_WHOLE_LABEL_RE =
  /^(?:提交|下单|支付|付款|立即支付|立即付款|购票|购买|预约|预订|订票|订购|结算|去结算|submit|pay|place order|place your order|buy now|book now|pay now|send|post|buy tickets?|get tickets?|reserve|checkout|check out|proceed to checkout)$/i;
// FIX-59 复审 #1 建议: 「在线购票」「预约参观」「购票入口」「Reserve a table」 are the act too.
const SUBMIT_ACT_RE =
  /在线(?:购票|订票|预约|预订|支付)|预约参观|(?:购票|订票|预约|预订)入口|\breserve (?:a|your) (?:table|seat|spot|room|ticket)s?\b|提交(?:订单|预约|预订|申请|报名|支付)|确认(?:支付|付款|订单|下单|预约|预订|购买|购票|提交|报名)|立即(?:购买|购票|订票|预约|预订|支付|付款|下单|抢购|抢票|报名|注册)|去(?:支付|付款)|马上(?:购买|抢购|预约|下单)|\bplace (?:your )?order\b|\bpay now\b|\bpay (?:s?\$|¥|€|£|rm|usd|sgd)|\bbook now\b|\breserve now\b|\bbuy now\b|\bcomplete (?:purchase|order|booking|payment)\b|\bconfirm (?:and pay|payment|order|booking|purchase|reservation)\b|\bsubmit (?:order|booking|payment|application|request)\b/i;
/** What paused it was itself a transaction (a checkout or payment request or page, a new receipt). */
const SUBMIT_TRIGGER_BRANCHES = new Set([
  'transaction_request',
  'transaction_navigation',
  'transaction_popup',
  'new_transaction_receipt',
]);

function labelSubmits(label: string): boolean {
  const one = label
    .replace(/\s+/g, ' ')
    .replace(/[…。.!！]+$/, '')
    .trim();
  if (!one || INFO_LABEL_RE.test(one)) return false;
  return SUBMIT_WHOLE_LABEL_RE.test(one) || SUBMIT_ACT_RE.test(one);
}

export function looksSubmitted(
  action: PausedAction | null,
  triggers: ReadonlyArray<{ branch: string; url: string }> = [],
): boolean {
  if (action?.label && labelSubmits(action.label)) return true;
  // An ordinary unexpected POST (「unknown_post」, a form, a method write) never counts by its path
  // alone: 故宫's 「导览」 may fire `/ticket/list` or `/register`. The path counts only through the
  // transaction triggers, which the observation already sets from the checkout / payment paths.
  return triggers.some((trigger) => SUBMIT_TRIGGER_BRANCHES.has(trigger.branch));
}

export function effectPauseQuestion(input: {
  english: boolean;
  site: string;
  action: PausedAction | null;
  /** The task only reads (look up a price, read a page): the user is asked to let it read on. */
  readOnly: boolean;
  /** Every request that paused was a background report nothing could place. */
  background: boolean;
  /** What paused it (branch and address), to tell a real submit. */
  triggers?: ReadonlyArray<{ branch: string; url: string }>;
  /** The page's title: a control named like the page itself is left unnamed (FIX-59 P1-4). */
  pageTitle?: string | null;
}): string {
  const { english, site, readOnly, background } = input;
  const raw = input.action?.label ? tidy(input.action.label) : '';
  const label =
    raw && !labelIsPageTitle(raw, input.pageTitle) && !labelLooksLikeTitle(raw, site)
      ? raw
      : undefined;
  const action = input.action ? { ...input.action, label: label ?? null } : null;
  // FIX-60 P2: whether it submits is read from the whole name — cut at 20, 「Reserve a table guide」
  // lost its 「guide」 and read as the booking itself.
  const submitted = looksSubmitted(
    action && label ? { ...action, label: oneLine(input.action!.label!) } : action,
    input.triggers,
  );
  if (english) {
    const did =
      action?.tool === 'click'
        ? label
          ? `clicked “${label}”`
          : 'clicked something'
        : action?.tool === 'type'
          ? label
            ? `typed into “${label}”`
            : 'typed into the page'
          : action?.tool === 'select'
            ? `chose “${action.value ?? label ?? ''}”`
            : action?.tool === 'navigate'
              ? 'opened the page'
              : 'acted on the page';
    const where = site ? ` on ${site}` : '';
    if (submitted)
      return `I ${did}${where}. This step may already have gone through (an order or booking may have been created). Please check the screen on the right first, and cancel it if needed.`;
    const what = background
      ? 'the page sent a background request I could not identify'
      : 'the page seems to have submitted a request';
    const next = readOnly
      ? 'Please check the screen on the right for any booking or order. If there is none, reply “continue” and I will keep to reading only.'
      : 'Please check the screen on the right. If it is what you expected, reply “continue” and I will carry on.';
    return `I ${did}${where} and ${what}, so I stopped. ${next}`;
  }
  const did =
    action?.tool === 'click'
      ? label
        ? `点了「${label}」`
        : '点了一下'
      : action?.tool === 'type'
        ? label
          ? `在「${label}」里输入了内容`
          : '输入了内容'
        : action?.tool === 'select'
          ? `选了「${action.value ?? label ?? ''}」`
          : action?.tool === 'navigate'
            ? '打开了页面'
            : '操作了一下页面';
  const where = site ? `在${site}` : '';
  if (submitted)
    return `我${where}${did}，这一步可能已经提交成功了（可能已经生成订单或预约）。请先在右侧画面核对，需要的话去取消。`;
  const what = background ? '页面在后台发出了一个我认不出的请求' : '页面像是提交了一个请求';
  const next = readOnly
    ? '你看一下右侧画面有没有生成预约或订单；没有的话回复「继续」，我接着只读查看。'
    : '你看一下右侧画面，结果符合预期的话回复「继续」，我接着往下做。';
  return `我${where}${did}，${what}，我先停下了。${next}`;
}
