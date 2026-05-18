/**
 * Phase 27C — pure helpers for the admin learning engine.
 *
 * Two responsibilities, kept off the request hot path so the router
 * can compose without worrying about side effects:
 *
 *   extractDomain    — pull a canonical hostname out of free-form
 *                      intent text. URL-shaped tasks return a host
 *                      ("item.taobao.com"); pure-LLM tasks (no URL
 *                      anywhere in the prompt) return null and are
 *                      dropped from per-site stats.
 *
 *   classifyTaskError — bucket a failure into one of seven
 *                       categories based on the task's `error_code`
 *                       + `error_message`. Keyword-based; biased
 *                       toward the failure modes we actually see in
 *                       practice rather than a generic taxonomy.
 *
 * Both are total functions (always return a value) and side-effect
 * free, so they can be unit-tested in isolation.
 */

/**
 * Match the first URL-like sequence inside a string. Excludes common
 * trailing punctuation (`. , ' " < > ) ]`) that wraps URLs in human
 * writing. Captures both `http://` and `https://`.
 */
const URL_PATTERN = /https?:\/\/[^\s'"<>)\]]+/i;

/**
 * Extract a canonical hostname from intent text.
 *
 * Returns lowercased hostname with leading `www.` stripped.
 * Subdomain is preserved (item.taobao.com !== taobao.com) — they're
 * meaningfully different surfaces for the agent.
 *
 * Returns `null` when:
 *   - intent is empty / null / undefined
 *   - intent contains no URL pattern
 *   - the URL parser rejects the matched substring
 *   - the parsed hostname has no dot (likely a non-URL like "http://localhost")
 */
export function extractDomain(intent: string | null | undefined): string | null {
  if (!intent) return null;
  const match = URL_PATTERN.exec(intent);
  if (!match) return null;
  // Trim trailing sentence punctuation the regex couldn't catch
  // (e.g. trailing period or comma at end of a sentence: "去 taobao.com.")
  let raw = match[0].replace(/[.,;:!?]+$/, '');
  try {
    const parsed = new URL(raw);
    let host = parsed.hostname.toLowerCase();
    if (host.startsWith('www.')) host = host.slice(4);
    if (!host || !host.includes('.')) return null;
    return host;
  } catch {
    return null;
  }
}

export type ErrorCategory =
  | 'dns_error'
  | 'timeout'
  | 'auth_required'
  | 'captcha'
  | 'not_found'
  | 'page_structure'
  | 'unknown';

/** Display label for each category, surfaced in the admin UI. */
export const ERROR_LABELS: Record<ErrorCategory, string> = {
  dns_error: 'DNS / 网络',
  timeout: '超时',
  auth_required: '需要登录',
  captcha: '验证码 / 人机',
  not_found: '页面不存在',
  page_structure: '页面结构变化',
  unknown: '其他',
};

/**
 * Classify a task's failure into one of the listed categories. We
 * search both `errorCode` (structured) and `errorMessage` (free-form,
 * often Chinese). Order matters: the first matching category wins,
 * so we put the more specific patterns before the catch-all.
 */
export function classifyTaskError(
  errorMessage: string | null | undefined,
  errorCode: string | null | undefined,
): ErrorCategory {
  const haystack = `${errorCode ?? ''} ${errorMessage ?? ''}`.toLowerCase();
  if (!haystack.trim()) return 'unknown';

  // DNS / network — both Node-style ENOTFOUND and Chromium net:: codes.
  if (/dns|enotfound|getaddrinfo|net::err_name|net::err_address|网络错误|网络异常|无法访问/.test(haystack)) {
    return 'dns_error';
  }
  // Timeout — match English + Chinese variants.
  if (/timeout|timed.?out|time.?out|超时/.test(haystack)) {
    return 'timeout';
  }
  // Auth — login required, unauthorized, 401, login park signal.
  if (/login|sign[\s_-]?in|登录|401|未登录|unauthor|凭据|身份认证|需要授权/.test(haystack)) {
    return 'auth_required';
  }
  // Captcha / bot check.
  if (/captcha|recaptcha|hcaptcha|验证码|人机|滑块|cloudflare|are you a (human|robot)/.test(haystack)) {
    return 'captcha';
  }
  // Element-not-found / selector failure / layout change. Checked
  // BEFORE the broader `not_found` bucket because phrases like
  // "element not found" contain "not found" and would otherwise
  // misclassify as a 404.
  if (/element[\s_]not[\s_]found|selector[\s_]not[\s_]found|找不到元素|找不到按钮|missing.*element|页面结构|布局变化|定位失败/.test(haystack)) {
    return 'page_structure';
  }
  // 404 / page gone.
  if (/\b404\b|not found|页面不存在|找不到页面|页面已删除|资源不存在/.test(haystack)) {
    return 'not_found';
  }
  return 'unknown';
}
