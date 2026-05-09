/**
 * Phase 1 follow-up — final-text sanitizer.
 *
 * Applied AT THE BOUNDARY between the agent's `outcome.summary` and
 * the persisted `result.summary` (which the SPA renders to the user).
 * The agent loop occasionally emits machine-readable scaffolding —
 * tool-call XML envelopes, base64 screenshot blobs, stop-reason
 * markers — alongside the human-facing answer; this strips it out.
 *
 * Scope: cosmetic / data-hygiene only. NOT a security boundary —
 * the SPA's markdown renderer should still treat the output as
 * untrusted (escape XSS, lock URL schemes, etc.). This sanitiser
 * exists for readability.
 */

const TOOL_TAG_NAMES = [
  'tool_call',
  'tool_calls',
  'tool_response',
  'tool_use',
  'tool_result',
  'function_calls',
  'function_call',
  'function_response',
  'invoke',
  'parameter',
];

/**
 * Build a regex that matches an opening + closing tag pair (with
 * arbitrary content between them, including newlines) for any of
 * the tag names. Greedy match `[\s\S]*?` is non-greedy so
 * "a <tool_call>x</tool_call> b <tool_call>y</tool_call> c"
 * strips both pairs cleanly without eating the middle text.
 */
function buildPairedRegex(): RegExp {
  const tagAlternation = TOOL_TAG_NAMES.join('|');
  return new RegExp(
    `<(${tagAlternation})\\b[^>]*>[\\s\\S]*?</\\1\\s*>`,
    'gi',
  );
}

const PAIRED_TAG_RE = buildPairedRegex();

/**
 * Standalone fragments that escaped the paired strip — orphan
 * opening or closing tags that didn't have a partner. We don't
 * try to be clever about content; if we see `<tool_call>` without
 * a closer, drop it. Same for the closer alone.
 */
const ORPHAN_TAG_RE = new RegExp(
  `</?(?:${TOOL_TAG_NAMES.join('|')})\\b[^>]*/?>`,
  'gi',
);

/**
 * Massive base64 blobs (e.g. inline screenshots the model occasionally
 * writes back to itself in a thinking trace). Matches a `data:image/`
 * URL OR a bare 200+ char base64 run. The 200 floor avoids stripping
 * legitimate short hash-like strings.
 */
const BASE64_DATA_URL_RE = /data:image\/[a-zA-Z]+;base64,[A-Za-z0-9+/=]+/g;
// Standalone bare base64 — surrounded by whitespace (or string ends).
// Capture the boundary whitespace so the replacement preserves the
// paragraph break the blob sat between, instead of welding the
// surrounding text together.
const STANDALONE_BASE64_RE = /(^|\s)([A-Za-z0-9+/=]{200,})(\s|$)/g;

/**
 * Stop-reason / model-internal markers that occasionally surface in
 * visible text. The Anthropic SDK normally strips these, but a
 * stop-reason inside a streamed-but-truncated continuation can leak
 * the marker text into the saved summary.
 */
const STOP_REASON_MARKERS = [
  /\[STOP[_ ]REASON:[^\]]*\]/gi,
  /\[END[_ ]TURN\]/gi,
  /\[MAX[_ ]TOKENS\]/gi,
  /\[AWAITING[_ ]USER[_ ]INPUT\]/gi,
];

/**
 * Collapse 3+ consecutive blank lines down to 2. After stripping
 * tool envelopes the answer often has gaps; this keeps paragraphs
 * separated without a giant gulf between them.
 */
const TRIPLE_BLANK_RE = /\n{3,}/g;

/**
 * Strip every known scaffold pattern, then collapse whitespace
 * gaps. Returns the cleaned text. Idempotent: sanitising an
 * already-sanitised string returns the same string.
 *
 * Empty / falsy input returns empty string — never undefined,
 * never null. The DB column is `result.summary: string`.
 */
export function sanitizeFinalText(input: string | null | undefined): string {
  if (!input) return '';
  let text = input;
  text = text.replace(PAIRED_TAG_RE, '');
  text = text.replace(ORPHAN_TAG_RE, '');
  text = text.replace(BASE64_DATA_URL_RE, '');
  text = text.replace(STANDALONE_BASE64_RE, '$1$3');
  for (const re of STOP_REASON_MARKERS) text = text.replace(re, '');
  text = text.replace(TRIPLE_BLANK_RE, '\n\n');
  return text.trim();
}

/**
 * Map common Firecrawl / scrape failure reasons to user-facing
 * Chinese explanations + actionable next steps. Default falls back
 * to the raw reason string. Used by tasks.ts when the scrape
 * runner returns status='failed' so the user sees something
 * useful instead of a stack trace or English error code.
 */
export function humaniseScrapeFailure(rawReason: string | undefined): string {
  if (!rawReason) {
    return '抓取失败，原因未知。建议换个关键词或换一个数据源重试。';
  }
  const r = rawReason.toLowerCase();
  if (/login|sign[ -]?in|forbidden|403|401|unauthor/.test(r)) {
    return [
      '该站点需要登录才能访问内容，scrape 模式没有登录态。',
      '建议：',
      '1) 切换到浏览器模式登录后再操作；',
      '2) 换一个公开站点的关键词重试。',
    ].join('\n');
  }
  if (/(no\s*results|empty|0\s*results|没有结果)/.test(r)) {
    return [
      '搜索没有返回任何结果。',
      '建议：换更通用或更具体的关键词，或换一个数据源。',
    ].join('\n');
  }
  if (/(rate.?limit|429|throttl)/.test(r)) {
    return [
      '抓取被对方站点限流（429），稍后再试或更换 IP。',
      '建议：休息几分钟后重试。',
    ].join('\n');
  }
  if (/(timeout|timed?\s*out|deadline)/.test(r)) {
    return [
      '抓取超时，可能是站点响应过慢或防爬严格。',
      '建议：换一个数据源或简化查询。',
    ].join('\n');
  }
  // DNS / connection check runs BEFORE 404 — Node's "ENOTFOUND" error
  // string contains the substring "notfound" and would otherwise be
  // misclassified as an HTTP 404.
  if (/(dns|getaddrinfo|enotfound|econnref|enetunreach|connection)/.test(r)) {
    return [
      '无法连接到目标站点（DNS / 网络层错误）。',
      '建议：确认域名拼写正确，或换一个数据源。',
    ].join('\n');
  }
  if (/(not\s*found|404|no\s*such)/.test(r)) {
    return [
      '该页面不存在（404）。',
      '建议：检查 URL 拼写，或换一个有效的链接。',
    ].join('\n');
  }
  if (/firecrawl/.test(r)) {
    return `数据抓取服务返回错误：${rawReason}\n建议：稍后重试，或换一个数据源。`;
  }
  return `抓取失败：${rawReason}`;
}
