import { detectCaptchaPage, detectLoginPage } from '../login-detector.js';
import type { UnifiedToolResult } from './playwright-unified-executor.js';

export interface BrowserBlockerEvidence {
  frameHost: string;
  framePath: string;
  rule: string;
  visible: boolean;
  scope: 'document' | 'dialog' | 'player' | 'frame' | 'comments' | 'component';
}
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
  const hit = captcha.matched ? captcha : login;
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
  const reason = captcha.matched ? 'captcha' : 'login';
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
  'ok' | 'url' | 'download' | 'tabId' | 'scroll' | 'form'
> & { tool: string; screenshot?: boolean };
/** A prohibition or an admission of non-completion is not a claim of execution. */
function positiveActionText(text: string): string {
  return text
    .replace(
      /(?:不要|不用|不需要|无需|不必|禁止|没有|并未|尚未|未曾|未|不)(?:成功|实际)?\s*(?:下载|上传|切换|切回|返回|新建|创建|打开|滚动|读取|截图|截屏|填写|填表|填入)[^，,。；;.!?\n]*/g,
      ' ',
    )
    .replace(
      /\b(?:do not|don['’]t|did not|didn['’]t|have not|haven['’]t|has not|hasn['’]t|never|without|not|no)\s+(?:(?:successfully|actually)\s+)?(?:download(?:ed|ing)?|upload(?:ed|ing)?|switch(?:ed|ing)?|open(?:ed|ing)?|creat(?:e|ed|ing)|scroll(?:ed|ing)?|read(?:ing)?|screenshot|fill(?:ing)?)[^,.;!?\n]*/gi,
      ' ',
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
  const claims: Array<[RegExp, string]> = [
    [/(?:切回|切换|返回).{0,10}(?:标签|tab)|switched? (?:back )?to.{0,20}tab/i, 'switch_tab'],
    [/(?:新建|打开|创建).{0,8}(?:新标签|\d+个标签)|opened? .{0,12}new tabs?/i, 'new_tab'],
    [/\bread_url\b/i, 'read_url'],
    [/(?:已|成功).{0,6}(?:上传)|uploaded/i, 'upload'],
  ];
  for (const [pattern, tool] of claims)
    if (pattern.test(claimed) && !successful.some((entry) => entry.tool === tool))
      return `动作 ${tool} 没有成功工具回执，请实际执行或如实说明未完成。`;
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
    successful.filter((entry) => entry.tool === 'new_tab').length < numericCount(count[1]!)
  )
    return '新标签数量没有足够的 new_tab 回执。';
  if (/(?:切回|返回).{0,10}(?:原|最初|第一个).{0,5}标签/.test(claimed)) {
    const first = successful.find((entry) => entry.tabId)?.tabId;
    const lastSwitch = successful.filter((entry) => entry.tool === 'switch_tab').at(-1);
    if (!first || lastSwitch?.tabId !== first) return 'switch_tab 回执未证明切回原标签。';
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
    forms.some((f) => f.submitted)
  )
    return '表单已提交，违反只填不提交的要求。';
  if (/(?:截图|screenshot)/i.test(requested) && !successful.some((t) => t.screenshot))
    return '缺少实际截图回执。';
  const receipts = successful.flatMap((entry) => (entry.download ? [entry.download] : []));
  if (/(下载|download)/i.test(positiveActionText(intent) + claimed) && !receipts.length)
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
