/**
 * Error translator — technical error strings → user-friendly Chinese.
 *
 * Surfaces from `anthropic.messages.create()` failures, Playwright
 * navigation errors, and other internal exceptions get patched up
 * before they reach the SSE/WS stream or task summary. Today, raw
 * strings like `Anthropic API error: 400 invalid_request_error` and
 * `net::ERR_NAME_NOT_RESOLVED` reach the user — translateError()
 * routes those to short, actionable Chinese sentences.
 *
 * Pattern matching is deliberately permissive (case-insensitive,
 * partial substring). The goal is "user never sees a stack-tracey
 * line", not perfect taxonomy. Every pattern is best-effort; the
 * fallback message is always safe to ship.
 */

const PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
  // Anthropic API
  [/tool_result.*missing|tool_result.*not provided/i,
    '任务执行中遇到了一个临时问题，正在自动重试。'],
  [/400.*invalid_request|invalid_request_error/i,
    '服务暂时繁忙，正在重新尝试。'],
  [/credit.*balance.*low|insufficient.*credit|quota.*exceeded/i,
    '系统资源暂时不足，请稍后再试。'],
  [/rate.?limit|too many requests/i,
    '请求过于频繁，正在稍候重试。'],
  [/anthropic api error.*5\d\d/i,
    '服务暂时不可用，正在重试。'],

  // Network / timeout
  [/timeout|ETIMEDOUT|timed out/i,
    '网络连接超时，正在重新加载页面。'],
  [/ECONNREFUSED|ECONNRESET|connection refused/i,
    '目标服务暂时无法连接，正在重试。'],
  [/ERR_NAME_NOT_RESOLVED/i,
    '网站地址无法解析，请检查 URL 是否正确。'],
  [/net::ERR_CONNECTION_REFUSED/i,
    '目标网站拒绝连接，可能暂时不可用。'],
  [/net::ERR_INTERNET_DISCONNECTED/i,
    '网络连接已断开，请稍后重试。'],

  // Browser / Playwright
  [/navigation.*failed|page\.goto.*failed/i,
    '无法打开目标页面，正在尝试其他方式访问。'],
  [/element.*not.*found|selector.*not.*found|locator.*not.*found/i,
    '页面结构发生了变化，正在重新定位元素。'],
  [/no executor.*available|browser unavailable/i,
    '浏览器暂时不可用，正在尝试搜索方式获取信息。'],

  // Anti-bot
  [/captcha|recaptcha|hcaptcha|turnstile/i,
    '页面需要人机验证，请在浏览器面板中手动完成验证后，任务将自动继续。'],
  [/cloudflare|just a moment|access denied|attention required/i,
    '网站安全检测触发，已切换至带浏览器指纹的通道重试。'],
  [/login.*required|authentication.*required|please log in/i,
    '该网站需要登录后才能继续，请在浏览器面板中登录。'],
];

const FALLBACK_MESSAGE =
  '任务执行中遇到了问题，正在尝试其他方式完成。如果持续失败，请尝试换一种方式描述您的需求。';

/**
 * Translate a technical error string into a user-friendly Chinese
 * message. Never returns the original string; if no pattern matches,
 * returns the safe fallback.
 *
 * `intent` is optional context — currently unused but reserved for
 * future per-domain customisation (e.g. "携程" + timeout → mention
 * the OTA site explicitly).
 */
export function translateError(technicalError: string, _intent?: string): string {
  if (!technicalError || typeof technicalError !== 'string') {
    return FALLBACK_MESSAGE;
  }
  for (const [pattern, friendly] of PATTERNS) {
    if (pattern.test(technicalError)) return friendly;
  }
  return FALLBACK_MESSAGE;
}

/**
 * Like `translateError` but preserves the technical detail in a
 * separate `originalError` field — useful for the response shape
 * where the user-facing summary is sanitised but internal logs /
 * task records still retain the raw string for debugging.
 */
export function translateErrorWithDetail(
  technicalError: string,
  intent?: string,
): { friendly: string; originalError: string } {
  return {
    friendly: translateError(technicalError, intent),
    originalError: technicalError ?? '',
  };
}
