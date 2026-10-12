import { detectCaptchaPage, detectLoginPage } from '../login-detector.js';
import type { UnifiedToolResult } from './playwright-unified-executor.js';

export interface BrowserBlockerEvidence {
  frameHost: string;
  framePath: string;
  rule: string;
  visible: boolean;
  scope: 'document' | 'dialog' | 'player' | 'frame';
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
  'ok' | 'url' | 'download' | 'tabId' | 'scroll'
> & { tool: string };
/** A prohibition or an admission of non-completion is not a claim of execution. */
function positiveActionText(text: string): string {
  return text
    .replace(
      /(?:不要|不用|无需|不必|禁止|没有|并未|尚未|未曾|未|不)(?:成功|实际)?\s*(?:下载|上传|切换|切回|返回|新建|创建|打开|滚动|读取)[^，,。；;.!?\n]*/g,
      ' ',
    )
    .replace(
      /\b(?:do not|don['’]t|did not|didn['’]t|have not|haven['’]t|has not|hasn['’]t|never|without|not)\s+(?:(?:successfully|actually)\s+)?(?:download(?:ed|ing)?|upload(?:ed|ing)?|switch(?:ed|ing)?|open(?:ed|ing)?|creat(?:e|ed|ing)|scroll(?:ed|ing)?|read(?:ing)?)[^,.;!?\n]*/gi,
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
  const scrollCount = claimed.match(
    /(?:滚动|scroll(?:ed)?)(?:了)?\s*(\d+|[一二两三四五六七八九十])\s*(?:次|times?)/i,
  );
  if (
    scrollCount &&
    successful.filter((entry) => entry.scroll?.grew).length < numericCount(scrollCount[1]!)
  )
    return '滚动新增内容次数没有足够的增长回执。';
  const receipts = successful.flatMap((entry) => (entry.download ? [entry.download] : []));
  if (/(下载|download)/i.test(positiveActionText(intent) + claimed) && !receipts.length)
    return '下载没有成功保存回执，不能宣告完成。请使用 download 保存文件。';
  for (const match of claimed.matchAll(/(\d[\d,]*)\s*(?:字节|bytes?)/gi))
    if (!receipts.some((receipt) => receipt.sizeBytes === Number(match[1]?.replaceAll(',', ''))))
      return '声称的字节数与真实文件回执不符。';
  return null;
}
