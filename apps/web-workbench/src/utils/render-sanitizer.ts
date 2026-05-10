/**
 * Phase 1 follow-up — SPA render-time sanitiser.
 *
 * Defence-in-depth complement to the orchestrator's text-sanitizer
 * (which runs at the runner→DB boundary). This function runs in
 * the SPA before ReactMarkdown turns the persisted summary into
 * DOM, and its job is to:
 *
 *   1. Catch leaks the backend sanitizer missed (rare, but forensic
 *      runs occasionally surface new patterns).
 *   2. Clean up HISTORY data — rows persisted before the backend
 *      sanitiser shipped still carry tool-XML / base64 noise. Those
 *      rows never re-pass through the backend; this layer is the
 *      only place they get cleaned.
 *   3. Strip agent-thinking-out-loud lines that surfaced AFTER the
 *      backend sanitizer finished (model writes "页面是空白，等一下
 *      重试" mid-paragraph and the user shouldn't have to read it).
 *
 * Intentionally NOT a security boundary — ReactMarkdown still
 * sanitises HTML / scrips. This module is for readability.
 *
 * Pure function, no React imports — safe to unit-test or share.
 */

/**
 * Markdown image reference whose URL is a screenshot artifact:
 *   ![alt](data:image/...)
 *   ![alt](screenshot_2026...png)
 *   ![alt](file:///tmp/...)
 *   ![screenshot...](anything)        ← any image whose ALT starts
 *                                       with "screenshot" or
 *                                       "screen_" — agent's own
 *                                       inline references.
 *
 * Stripped wholesale because the SPA can't render local file paths
 * and the data: payloads are never legitimate user content.
 */
const MARKDOWN_IMAGE_SCREENSHOT_RE =
  /!\[(?:screenshot[^\]]*|screen[_\-][^\]]*|[^\]]*)\]\((?:data:image\/[^)]*|file:\/\/[^)]*|[^)]*screenshot[^)]*|[^)]*\.(?:png|jpe?g|gif|webp)[^)]*)\)/gi;

/**
 * Bare local-file image reference left around after the markdown
 * shape was already stripped (e.g. just `screenshot_20260510_034521.png`
 * sitting on its own line as a leftover).
 */
const BARE_SCREENSHOT_FILENAME_RE =
  /^[ \t]*(?:screenshot|screen[_\-]?capture)[_\-]?\d{6,14}[a-zA-Z0-9_\-]*\.(?:png|jpe?g|gif|webp)[ \t]*$/gim;

/**
 * Agent execution-narrative line patterns. The model occasionally
 * narrates its own retry / reroute / error-recovery thinking in
 * the visible answer. These lines aren't useful to the end user.
 *
 * Pattern: a LINE that STARTS WITH (after optional bullet markers
 * "- ", "* ", "> ", or whitespace) one of the narrative phrases.
 * Whole-line strip — the rest of the line goes too. This is a
 * judgement call: occasionally a legitimate user reply might
 * begin with one of these phrases ("需要登录才能查看，所以我..."
 * is something the agent might write to acknowledge a constraint),
 * but in practice the lines that start with these phrases are
 * almost always junk.
 */
const NARRATIVE_LINE_STARTERS = [
  '页面是空白',
  '页面空白',
  '页面加载失败',
  '等一下重试',
  '稍等，重试',
  '稍等，再试',
  '我换',
  '换用 Google 搜索',
  '换用Google搜索',
  '换 Google',
  '改用搜索',
  '让我换一下',
  '让我换个',
  '让我重新',
  '让我再试',
  '需要登录才能',
  '抓取失败，让我',
  '抓取超时，让我',
  '让我打开',
  '让我去',
  '让我直接',
];

/**
 * Build the line-starter regex once. Anchored at line start
 * (after optional bullet/quote/whitespace).
 */
const NARRATIVE_LINE_RE = (() => {
  // Escape regex specials in the phrases (just in case).
  const escaped = NARRATIVE_LINE_STARTERS.map((s) =>
    s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
  );
  // Match: line start, optional bullet/quote/space, one of the
  // phrases, anything else to end of line.
  return new RegExp(
    `^[ \\t]*(?:[-*>][ \\t]+)?(?:${escaped.join('|')})[^\\n]*$`,
    'gim',
  );
})();

/**
 * Tool-XML envelope leak patterns — paranoid duplicate of the
 * backend sanitiser's coverage. Cheaper to do a defensive pass
 * here than to debug a stray `<tool_call>` rendering as raw text
 * in production.
 */
const PAIRED_TOOL_TAG_RE =
  /<(tool_call|tool_calls|tool_response|tool_use|tool_result|function_calls|function_call|function_response|invoke|parameter)\b[^>]*>[\s\S]*?<\/\1\s*>/gi;
const ORPHAN_TOOL_TAG_RE =
  /<\/?(?:tool_call|tool_calls|tool_response|tool_use|tool_result|function_calls|function_call|function_response|invoke|parameter)\b[^>]*\/?>/gi;

/**
 * Image magic-byte base64 — JPEG/PNG/GIF/WEBP marker prefixes.
 * Mirror of the backend pattern.
 */
const IMAGE_MARKER_BASE64_RE =
  /(?:\/9j\/|iVBORw0KGgo|R0lGOD[a-zA-Z0-9]+|UklGR)[A-Za-z0-9+/=]{20,}/g;

/**
 * Stop-reason markers leak occasionally on legacy rows.
 */
const STOP_REASON_RE = /\[(?:STOP[_ ]REASON:[^\]]*|END[_ ]TURN|MAX[_ ]TOKENS|AWAITING[_ ]USER[_ ]INPUT)\]/gi;

/**
 * Triple+ blank lines collapse — visual hygiene after strips.
 */
const TRIPLE_BLANK_RE = /\n{3,}/g;

/**
 * Top-level entrypoint. Pure — input → output, no React, no
 * side-effects. Returns empty string for null/undefined input
 * so callers can pipe through ReactMarkdown without an extra
 * null check.
 */
export function sanitizeForRender(input: string | null | undefined): string {
  if (!input) return '';
  let text = input;
  // 1. Tool-XML envelopes (paired + orphan).
  text = text.replace(PAIRED_TOOL_TAG_RE, '');
  text = text.replace(ORPHAN_TOOL_TAG_RE, '');
  // 2. Markdown image references with screenshot / data-URL targets.
  text = text.replace(MARKDOWN_IMAGE_SCREENSHOT_RE, '');
  // 3. Bare screenshot filenames.
  text = text.replace(BARE_SCREENSHOT_FILENAME_RE, '');
  // 4. Image magic-byte base64 anywhere.
  text = text.replace(IMAGE_MARKER_BASE64_RE, '');
  // 5. Agent narrative lines.
  text = text.replace(NARRATIVE_LINE_RE, '');
  // 6. Stop-reason markers.
  text = text.replace(STOP_REASON_RE, '');
  // 7. Collapse blank-line gaps left by the strips.
  text = text.replace(TRIPLE_BLANK_RE, '\n\n');
  return text.trim();
}
