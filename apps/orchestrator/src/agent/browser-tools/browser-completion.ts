import { detectCaptchaPage, detectLoginPage } from '../login-detector.js';
import type { UnifiedToolResult } from './playwright-unified-executor.js';

export interface BrowserBlockerEvidence {
  frameHost: string;
  framePath: string;
  rule: string;
  visible: boolean;
  scope: 'document' | 'dialog' | 'player' | 'frame' | 'comments' | 'component';
}
const SMS_LOGIN_RE = /短信验证码|获取验证码|发送验证码|手机号(?:码)?登录|验证码登录|短信登录/;
// FIX-36 复审 #1 #4: an image code (图形 / 图片验证码, 看不清 换一张) or a behaviour check next to
// an SMS login is still a captcha.
const BOT_CHECK_RE =
  /滑块|滑动|拼图|人机验证|安全验证|点选|旋转|图形验证码|图片验证码|图形码|看不清|换一张|点击按钮进行验证|行为验证|captcha|robot|human|security check|unusual traffic/i;

export function detectBrowserBlocker(page: {
  url: string;
  title: string;
  text: string;
  visible?: boolean;
  blocking?: boolean;
  readableContent?: boolean;
  scope?: BrowserBlockerEvidence['scope'];
}) {
  if (
    page.visible === false ||
    page.blocking === false ||
    (page.readableContent && page.scope === 'document')
  )
    return null;
  const input = { url: page.url, title: page.title, prominentText: page.text };
  const captcha = detectCaptchaPage(input);
  const login = detectLoginPage(input);
  // FIX-36 #9 (Deploy-36 b-m01): Gaode's 「手机号 + 短信验证码」 popup is a login, not a bot
  // check — 「验证码」 there is the SMS code. Only with no slider / puzzle / human-check sign.
  const smsLogin =
    captcha.matched &&
    captcha.source === 'body' &&
    captcha.match === '验证码' &&
    SMS_LOGIN_RE.test(page.text) &&
    !BOT_CHECK_RE.test(`${page.title} ${page.text}`);
  const hit =
    captcha.matched && !smsLogin
      ? captcha
      : smsLogin
        ? { matched: true as const, source: 'body' as const, match: '短信验证码登录' }
        : login;
  if (!hit.matched) return null;
  let frameHost = '';
  let framePath = '/';
  try {
    const url = new URL(page.url);
    frameHost = url.hostname;
    framePath = url.pathname
      .split('/')
      .map((part) => (part.length > 40 || /@|%40/i.test(part) ? '[redacted]' : part))
      .join('/')
      .slice(0, 300);
  } catch {}
  const reason = captcha.matched && !smsLogin ? 'captcha' : 'login';
  return {
    reason,
    message:
      reason === 'captcha'
        ? '页面遇到机器人验证或验证码，需要你接管完成验证；当前任务尚未完成。'
        : '页面遇到登录墙，需要你接管登录；当前任务尚未完成。',
    evidence: {
      frameHost,
      framePath,
      rule: `${reason}:${hit.source}:${hit.match}`,
      visible: true,
      scope: page.scope ?? 'document',
    } satisfies BrowserBlockerEvidence,
  };
}

export type BrowserTrace = Pick<
  UnifiedToolResult,
  'ok' | 'url' | 'download' | 'tabId' | 'scroll' | 'form' | 'openedTab' | 'dialogs'
> & {
  tool: string;
  screenshot?: boolean;
  /** The tab that was active when this action opened a new tab. */
  fromTabId?: string;
  /** Text a successful `type` entered (a host fact for answer checks). */
  typedText?: string;
  /** The page a form receipt was made on. */
  pageUrl?: string;
};
/** A prohibition or an admission of non-completion is not a claim of execution. */
function positiveActionText(text: string): string {
  return (
    text
      // FIX-30 (BENCH-1 d04): 「下载链接给我」 names a link, not a download to do.
      .replace(/下载(?:链接|地址|页面?|入口|按钮)|download\s+(?:link|url|page|button)s?/gi, ' ')
      .replace(
        /(?:不要|不用|不需要|无需|不必|禁止|没有|并未|尚未|未曾|未|不)(?:成功|实际|真的?|真正)?\s*(?:下载|上传|切换|切回|返回|新建|创建|打开|滚动|读取|截图|截屏|填写|填表|填入)[^，,。；;.!?\n]*/g,
        ' ',
      )
      .replace(
        /\b(?:do not|don['’]t|did not|didn['’]t|have not|haven['’]t|has not|hasn['’]t|never|without|not|no)\s+(?:(?:successfully|actually)\s+)?(?:download(?:ed|ing)?|upload(?:ed|ing)?|switch(?:ed|ing)?|open(?:ed|ing)?|creat(?:e|ed|ing)|scroll(?:ed|ing)?|read(?:ing)?|screenshot|fill(?:ing)?)[^,.;!?\n]*/gi,
        ' ',
      )
  );
}
/** Claims must be grounded in successful, host-owned receipts, not model prose. */
export function completionGap(
  intent: string,
  summary: string,
  trace: readonly BrowserTrace[],
  requireBrowser: boolean,
): string | null {
  const successful = trace.filter((entry) => entry.ok);
  const claimed = positiveActionText(summary);
  const requested = positiveActionText(intent);
  if (requireBrowser && !successful.some((entry) => entry.url && /^https?:\/\//i.test(entry.url)))
    return '尚无真实浏览器页面证据，请先 navigate 到任务网址，再 snapshot 核验；不能直接生成答案。';
  if (
    /youtube/i.test(intent) &&
    /视频|videos?/i.test(intent) &&
    /搜索|前\s*\d|search/i.test(intent)
  ) {
    const results = summary.split('\n').filter((line) => /^\s*\d+[.)、]|^[|]/.test(line));
    if (
      results.some((line) =>
        /[（(【\[]\s*(?:播放列表|playlist|课程合集)\s*[）)】\]]|\/playlist[?]|[?&]list=/i.test(
          line,
        ),
      )
    )
      return '用户要求视频，结果中仍有播放列表或课程合集；请只保留实际视频条目。';
  }
  // AP3 core-10: "JavaScript alerts" asks for native dialogs; an in-page
  // notice closed by a button is not one.
  if (
    /javascript\s*alerts?|\bjs\s*(?:alert|confirm|prompt)s?\b/i.test(intent) &&
    !successful.some((entry) => entry.dialogs?.length)
  )
    return '用户要求 JavaScript alerts，但本次没有触发过任何原生对话框（alert/confirm/prompt）；页面内的提示框不算。请打开带触发按钮的页面点击按钮，再读取页面显示的结果；做不到就如实说明。';
  // AP4 core-02: "opened weather.com" with no visit is a claimed action without
  // a receipt. A site counts as visited when a successful step landed on it.
  const visited = new Set(
    successful.flatMap((entry) => {
      try {
        return entry.url ? [new URL(entry.url).hostname.replace(/^www\./, '')] : [];
      } catch {
        return [];
      }
    }),
  );
  for (const match of claimed.matchAll(
    /(?:打开|访问|进入|跳转到|浏览了|读取了|opened|visited|navigated to)[^。；\n]{0,24}?\b((?:[a-z0-9-]+\.)+(?:com|net|org|cn|io|gov|edu|info|co|uk|sg|jp|de)\b)/gi,
  )) {
    // FIX-26 (INTEGRATE-26 sa core-02): the words before the verb in the same
    // clause decide. "未实际访问 / 没有打开" admit the opposite; "可进一步打开 /
    // 可再打开 / 可自行访问 / 如需…" suggest a site to the user. "已打开 / 我访问了"
    // claim it.
    const clause =
      claimed
        .slice(0, match.index!)
        .split(/[，,。；;：:！!？?\n]/)
        .at(-1) ?? '';
    if (/(?:未|没有|没|并未|无法|不能|不要|不必|尚未)[^已]{0,6}$/.test(clause)) continue;
    if (/(?:可|自行|请|建议|如需|若需|如果需要|您可|也可)[^已我]{0,6}$/.test(clause)) continue;
    const host = match[1]!.toLowerCase().replace(/^www\./, '');
    // Search engines are covered by the fallback's own receipts across attempts.
    if (/(?:^|\.)(?:google\.[a-z.]+|bing\.com|duckduckgo\.com|baidu\.com)$/.test(host)) continue;
    if (![...visited].some((seen) => seen === host || seen.endsWith(`.${host}`)))
      return `答案说打开/访问了 ${host}，但本次没有成功访问该网站的回执；只能报告实际打开并读取过的页面。`;
  }
  const claims: Array<[RegExp, string]> = [
    [/(?:切回|切换|返回).{0,10}(?:标签|tab)|switched? (?:back )?to.{0,20}tab/i, 'switch_tab'],
    // FIX-40: 「在新标签页中打开了…」 / 「in a new tab」 claim a new tab too.
    [
      /(?:新建|打开|创建).{0,8}(?:新标签|\d+个标签)|(?:在|于)\s*(?:\d+\s*个)?新(?:的)?标签页?.{0,6}(?:打开|读取|访问)|opened? .{0,12}new tabs?|\bin (?:a )?new tabs?\b/i,
      'new_tab',
    ],
    [/\bread_url\b/i, 'read_url'],
    [/(?:已|成功).{0,6}(?:上传)|uploaded/i, 'upload'],
  ];
  for (const [pattern, tool] of claims) {
    // FIX-40 (Deploy-40 core-04): 「切换到 Videos 标签」「点开『热门』标签」 is a control on the
    // page, not a browser tab (FIX-26 kept). Only a browser tab (标签页 / 新标签 / 第 N 个 /
    // 起始 / tab_… / new tab) needs a switch_tab receipt.
    const needed = [...claimed.matchAll(new RegExp(pattern.source, 'gi'))].some(
      (match) => tool !== 'switch_tab' || browserTabWords(match[0]),
    );
    if (
      needed &&
      !successful.some((entry) => entry.tool === tool || (tool === 'new_tab' && entry.openedTab))
    )
      return `动作 ${tool} 没有成功工具回执，请实际执行或如实说明未完成。`;
  }
  // FIX-26 (INTEGRATE-26 sb core-07): three in-page anchors of one article are
  // one page. Links opened from a page must reach pages other than it and
  // each other (the #fragment does not count).
  if (/打开.{0,8}(?:\d+|[一二两三四五六七八九十])\s*个?链接|open .{0,12}links?/i.test(intent)) {
    const page = (url: string | undefined) => url?.split('#')[0]?.replace(/\/$/, '');
    const opened = successful
      .filter((entry) => entry.openedTab && entry.url)
      .map((e) => page(e.url));
    const source = page(successful.find((entry) => !entry.openedTab && entry.url)?.url);
    if (opened.length && (new Set(opened).size < opened.length || opened.includes(source)))
      return '打开的链接里有同一页面（只差 # 锚点，或就是起始页）：请换成指向不同页面的链接，各自读标题后再回到起始标签。';
  }
  const numericCount = (value: string) =>
    (
      ({ 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 }) as Record<
        string,
        number
      >
    )[value] ?? Number(value);
  const count = claimed.match(
    /(?:新建|打开|创建)(?:了)?\s*(\d+|[一二两三四五六七八九十])\s*个?\s*(?:新)?标签/,
  );
  if (
    count &&
    successful.filter((entry) => entry.tool === 'new_tab' || entry.openedTab).length <
      numericCount(count[1]!)
  )
    return '新标签数量没有足够的 new_tab 回执。';
  const opened = successful.some((entry) => entry.tool === 'new_tab' || entry.openedTab);
  if (
    /(?:切回|切换回|换回|返回|回到|switch(?:ed)? back to).{0,10}(?:原|最初|第一个|源|来源|起始|初始|first|original).{0,5}(?:标签|tab)/i.test(
      claimed,
    ) ||
    // FIX-24 (Deploy-24 core-07): the task's own 回到第一个 is checked whatever
    // the answer calls the tab it ended on ("切换回第一个新标签").
    (opened &&
      /(?:切回|切换回|换回|返回|回到)(?:到)?\s*(?:第一个|原来|最初|起始|初始|原)/.test(requested))
  ) {
    // The original tab is the one active when the first new tab was opened —
    // never the new tab a click(newTab) receipt names.
    const first =
      trace.find((entry) => entry.fromTabId)?.fromTabId ??
      successful.find((entry) => entry.tabId && !entry.openedTab && entry.tool !== 'new_tab')
        ?.tabId;
    const lastSwitch = successful.filter((entry) => entry.tool === 'switch_tab').at(-1);
    if (!first || lastSwitch?.tabId !== first)
      return first
        ? `switch_tab 回执未证明切回原标签：起始标签是 ${first}（打开这些链接的页面），不是新打开的标签；请 switch_tab 到 ${first} 后再完成。`
        : 'switch_tab 回执未证明切回原标签。';
  }
  const scrollText = `${requested} ${claimed}`;
  const scrollCount =
    scrollText.match(
      /(?:滚动|scroll(?:ed)?)(?:了)?\s*(\d+|[一二两三四五六七八九十])\s*(?:次|times?)/i,
    ) ?? scrollText.match(/(\d+|[一二两三四五六七八九十])\s*次\s*(?:向下|向上)?滚动/i);
  const scrollReceipts = successful.flatMap(
    (entry) => entry.scroll?.steps ?? (entry.scroll ? [entry.scroll] : []),
  );
  if (scrollCount && scrollReceipts.length < numericCount(scrollCount[1]!))
    return '滚动次数/增长没有足够的实际滚动回执。';
  if (
    /无限滚动|infinite[\s_-]*scroll/i.test(intent) &&
    scrollCount &&
    !scrollReceipts.some((r) => r.grew)
  )
    return '无限滚动没有加载新增内容，任务未完成；请检查滚动目标与站点加载状态。';
  const forms = successful.flatMap((t) => (t.form ? [t.form] : []));
  if (/(?:填表|填写|填入|fill.*form)/i.test(requested) && !forms.some((f) => f.filled))
    return '没有实际填表回执，不能宣告已填表。';
  if (
    /(?:不提交|不要提交|do not submit|without submitting)/i.test(intent) &&
    // A search box submits a GET query; only business forms are "submitted".
    forms.some((f) => f.submitted && !f.search)
  )
    return '表单已提交，违反只填不提交的要求。';
  if (/(?:截图|screenshot)/i.test(requested) && !successful.some((t) => t.screenshot))
    return '缺少实际截图回执。';
  const receipts = successful.flatMap((entry) => (entry.download ? [entry.download] : []));
  // Source titles may contain Download; only the task's request requires a receipt.
  if (/(下载|download)/i.test(requested) && !receipts.length)
    return '下载没有成功保存回执，不能宣告完成。请使用 download 保存文件。';
  for (const name of claimed.matchAll(
    /[\p{L}\d_][\p{L}\d_.-]*\.(?:txt|csv|tsv|json|pdf|zip|xlsx|docx|png|jpg)\b/giu,
  ))
    if (receipts.length && !receipts.some((r) => r.filename === name[0]))
      return '文件名与实际下载回执不符。';
  if (receipts.length)
    for (const match of claimed.matchAll(/(\d[\d,]*)\s*(?:字节|bytes?|B\b)/gi))
      if (!receipts.some((receipt) => receipt.sizeBytes === Number(match[1]?.replaceAll(',', ''))))
        return '声称的字节数与真实文件回执不符。';
  return null;
}

/** Canonical evidence from successful host actions, never from the model. */
export function receiptEvidence(intent: string, trace: readonly BrowserTrace[]): string {
  const ok = trace.filter((t) => t.ok);
  if (/下载|download/i.test(positiveActionText(intent))) {
    const files = ok.flatMap((t) => (t.download ? [t.download] : []));
    return files
      .map(
        (f) => `${f.filename} | ${f.sizeBytes} bytes/字节 | ${f.downloadUrl} | sha256=${f.sha256}`,
      )
      .join('\n');
  }
  if (/滚动|scroll/i.test(positiveActionText(intent))) {
    const scrolls = ok.flatMap((t) => t.scroll?.steps ?? (t.scroll ? [t.scroll] : []));
    if (scrolls.length) return JSON.stringify({ scrollCount: scrolls.length, steps: scrolls });
  }
  if (
    /填|填写|fill|form/i.test(intent) &&
    ok.some((t) => t.form?.filled) &&
    !ok.some((t) => t.form?.submitted) &&
    ok.some((t) => t.screenshot)
  )
    return '表单字段已填写，未提交；已截取当前页面截图。';
  return '';
}

/**
 * FIX-26 (INTEGRATE-26 sb core-04): "切换到「视频」筛选标签" is a filter on the
 * page, not a browser tab. A browser tab is still meant by 标签页 / 新标签 /
 * 原标签 / 第一个 / 起始 / tab ids.
 */
/** A browser tab, not a tab control on the page (FIX-40; FIX-36 筛选/分类 kept as page words). */
function browserTabWords(text: string): boolean {
  return /标签页|新标签|原标签|源标签|起始|初始|第一个|第\s*[一二三四五六七八九十\d]+\s*个|tab_|\b(?:new|first|original|previous|browser|other|last|second|third)\s+tabs?\b|\btab\s*#?\d|\b\d+(?:st|nd|rd|th)\s+tab\b/i.test(
    text,
  );
}
