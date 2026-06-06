/**
 * Translate technical error strings the orchestrator might surface
 * (boot-sweep markers, Anthropic upstream text, generic exception
 * messages) into user-friendly Chinese copy. Defense-in-depth on top
 * of source-level fixes — when a new error path slips through with
 * raw English, the SPA still doesn't show "exhausted maxIterations".
 *
 * Strategy: prefix-match on the most distinctive substring. Stable
 * order; first match wins. The catch-all final entry returns the
 * original string when nothing matches — better than silently
 * dropping unfamiliar errors on the floor.
 */

import { classifyBrowserErrorKind } from './browser-error-kind';

interface Rule {
  /** Regex tested against the raw error string. */
  match: RegExp;
  /** Either a static replacement or a function that derives one. */
  to: string | ((m: RegExpMatchArray) => string);
}

const RULES: Rule[] = [
  {
    match: /orchestrator restarted while task was in-flight/i,
    to: '服务重启导致任务中断，重新发送一次即可。',
  },
  {
    match: /exhausted\s+maxIterations/i,
    to: '任务步骤过多，未能在限制内完成。试着把意图写得更具体，或换个方式提问。',
  },
];

const AI_SERVICE_RULES: Rule[] = [
  {
    match: /API call timed out twice/i,
    to: 'AI 服务连续超时，请稍后重试。',
  },
  {
    match: /Anthropic API error:\s*4\d\d/i,
    to: 'AI 服务暂时无法处理请求，可能是配额或参数问题。请稍后重试。',
  },
  {
    match: /Anthropic API error/i,
    to: 'AI 服务暂时出错，请稍后重试。',
  },
];

RULES.push(
  ...AI_SERVICE_RULES,
  {
    match: /browser unavailable/i,
    to: '浏览器服务暂时不可用，请稍后重试。',
  },
  {
    match: /扩展.*未连接|no_extension|extension.*not connected|receiving end does not exist|could not establish connection/i,
    to: '浏览器扩展未连接，请打开 HOLA DAY 扩展后重试。',
  },
  {
    match: /cannot access contents of (the )?url|extension manifest must request permission|missing host permission|host permission|扩展.*权限|浏览器.*权限不足/i,
    to: '浏览器扩展缺少当前网站权限，请在扩展里允许访问该网站后重试。',
  },
  {
    match: /bad_args|bad_url|invalid url|expected http\(s\) url|只支持.*http|不支持.*网址|网址.*无效|导航地址无效/i,
    to: '网址格式不支持，请使用 http(s) 开头的网页链接后重试。',
  },
  {
    match: /浏览器扩展连接已断开|扩展.*断开|extension.*disconnect|extension.*closed|socket_closed|message port closed before a response/i,
    to: '浏览器扩展连接已断开，请重新打开 HOLA DAY 扩展后重试。',
  },
  {
    match: /扩展工具调用超时|浏览器扩展响应超时|extension tool.*timeout|browser tool.*timeout|navigation.*timeout|navigate.*timeout/i,
    to: '浏览器响应超时，页面可能仍在加载。请稍后重试。',
  },
  {
    match: /protocol error|target closed|session closed|socket_closed|websocket.*closed|browser.*disconnected|cdp.*closed/i,
    to: '浏览器连接中断，请重新执行任务。',
  },
  {
    match: /execution context.*destroyed|frame detached|frame[^\w]not/i,
    to: '页面正在切换，本次浏览器步骤未能稳定完成。请重试。',
  },
  {
    match: /missing\s+ANTHROPIC_API_KEY/i,
    to: '后端模型密钥未配置，请联系管理员。',
  },
  {
    match: /SUPERCAR_TIMEOUT/i,
    to: '任务执行超时，请稍后重试。',
  },
  {
    match: /paypal sdk failed to load|paypal sdk/i,
    to: 'PayPal 加载失败，请刷新页面后重试。',
  },
);

/**
 * Apply the rules in order; return the first match's replacement, or
 * the original string when nothing matches.
 */
export function humaniseTaskError(raw: string | null | undefined): string {
  if (!raw) return '';
  const trimmed = raw.trim();
  if (!trimmed) return '';
  for (const rule of AI_SERVICE_RULES) {
    const m = trimmed.match(rule.match);
    if (m) return typeof rule.to === 'function' ? rule.to(m) : rule.to;
  }
  const browserKind = classifyBrowserErrorKind(trimmed);
  switch (browserKind) {
    case 'extension_timeout':
      return '浏览器响应超时，页面可能仍在加载。请稍后重试。';
    case 'extension_missing':
      return '浏览器扩展未连接，请打开 HOLA DAY 扩展后重试。';
    case 'extension_disconnected':
      return '浏览器扩展连接已断开，请重新打开 HOLA DAY 扩展后重试。';
    case 'extension_permission':
      return '浏览器扩展缺少当前网站权限，请在扩展里允许访问该网站后重试。';
    case 'invalid_url':
      return '网址格式不支持，请使用 http(s) 开头的网页链接后重试。';
    case 'no_active_tab':
      return '浏览器当前没有活动标签页，请打开一个网页后重试。';
    case 'dns':
      return '无法访问该网址，请检查网址是否拼写正确。';
    case 'ssl':
      return '该网站证书有问题，无法安全连接。请确认网址是否正确或换一个站点。';
    case 'connection':
      return '无法连接到该站点，请稍后重试或换一个站点。';
    case 'transport_closed':
      return '浏览器连接中断，请重新执行任务。';
    case 'page_switch':
      return '页面正在切换，本次浏览器步骤未能稳定完成。请重试。';
    case 'hibernated':
      return '浏览器已休眠，重新执行任务会打开新的浏览器。';
    case 'timeout':
      return '浏览器响应超时，页面可能仍在加载。请稍后重试。';
    default:
      break;
  }
  for (const rule of RULES) {
    const m = trimmed.match(rule.match);
    if (m) return typeof rule.to === 'function' ? rule.to(m) : rule.to;
  }
  // Last resort — any string that's >80% ASCII is probably internal
  // English; show a generic wrapper instead of leaking it.
  if (looksLikeEnglishTech(trimmed)) {
    return '任务执行出错，请重试。如果反复出现请联系 support@holaday.ai。';
  }
  return trimmed;
}

export function taskActionError(action: string, raw: string | null | undefined): string {
  const friendly = humaniseTaskError(raw);
  return friendly ? `${action}：${friendly}` : action;
}

function looksLikeEnglishTech(s: string): boolean {
  if (s.length === 0) return false;
  let ascii = 0;
  for (const ch of s) {
    if (ch.codePointAt(0)! < 128) ascii += 1;
  }
  return ascii / s.length > 0.85;
}
