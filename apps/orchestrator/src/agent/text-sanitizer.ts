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

/**
 * Image-format magic-byte base64 prefixes. When the agent's tool
 * response leaks into the visible answer, the JPEG `/9j/` (or PNG
 * `iVBORw0KGgo`, GIF `R0lGOD`, WEBP `UklGR`) prefix is the only
 * portable way to recognise embedded screenshots regardless of
 * quoting context. Catches both bare runs and quoted runs inside
 * a JSON `"data":"..."` field.
 */
const IMAGE_MARKER_BASE64_RE =
  /(?:\/9j\/|iVBORw0KGgo|R0lGOD[a-zA-Z0-9]+|UklGR)[A-Za-z0-9+/=]{20,}/g;

/**
 * JSON-quoted screenshot payload — the wrapping `"data":"..."` plus
 * the base64 string. Stripped wholesale so the surrounding JSON
 * doesn't end up with a half-removed string literal.
 */
const QUOTED_IMAGE_DATA_RE =
  /"data"\s*:\s*"(?:\/9j\/|iVBORw0KGgo|R0lGOD|UklGR)[A-Za-z0-9+/=]*"/g;

/**
 * Standalone bare base64 — surrounded by whitespace (or string
 * ends). Threshold lowered from 200 to 50 chars to catch the
 * smaller payloads observed in production. Capture the boundary
 * whitespace so the replacement preserves paragraph breaks.
 */
const STANDALONE_BASE64_RE = /(^|\s)([A-Za-z0-9+/=]{50,})(\s|$)/g;

/**
 * Tool-response JSON markers — substrings whose presence inside
 * a `{...}` block strongly signals "this is a tool response, not
 * narrative". Used by `stripToolJsonBlocks()` to decide whether
 * to drop a JSON block.
 */
const TOOL_RESPONSE_MARKERS_RE =
  /"(?:status|content|screenshot|base64)"|"type"\s*:\s*"image"|"data"\s*:\s*"(?:\/9j\/|iVBORw0KGgo|R0lGOD|UklGR)/i;

/**
 * Brace-counted tool-response JSON stripper. Walks the input,
 * finds every `{...}` (handles arbitrary nesting), and drops the
 * block when it contains a tool-response marker. Native string
 * scan — no regex backtracking, O(n) in input. Bounded at 50_000
 * chars per block to defend against pathological input.
 *
 * Why brace-counted instead of regex: the JSON BOSS observed has
 * 2+ levels of nesting (`{"content":{"data":"..."}}`); JS regex
 * doesn't recurse, so a flat `\{[^{}]*\}` only catches the
 * innermost block and a marker-bearing outer block survives the
 * pass.
 */
function stripToolJsonBlocks(text: string): string {
  const MAX_BLOCK = 50_000;
  let out = '';
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '{') {
      const start = i;
      let depth = 1;
      let j = i + 1;
      while (j < text.length && depth > 0 && j - start < MAX_BLOCK) {
        const c = text[j];
        if (c === '{') depth++;
        else if (c === '}') depth--;
        j++;
      }
      if (depth !== 0) {
        // Unbalanced / truncated — bail conservatively and keep the
        // tail untouched so a syntax glitch doesn't eat real text.
        out += text.slice(start);
        return out;
      }
      const block = text.slice(start, j);
      if (TOOL_RESPONSE_MARKERS_RE.test(block)) {
        // Drop the block entirely; iterator continues at j.
      } else {
        out += block;
      }
      i = j;
    } else {
      out += ch;
      i++;
    }
  }
  return out;
}

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
 * Phase 4 R1 — Claude self-signature patterns. The product is
 * branded HOLA DAY (橙子智能), not Claude; when the agent emits
 * "I'm Claude Sonnet 4.6" or "由 Claude Opus 生成" the user trusts
 * the answer less ("am I talking to OpenAI's competitor?") and the
 * brand surface is wrong.
 *
 * Each pattern is anchored so it only strips the self-ID phrase,
 * NOT every occurrence of the word "Claude" — a user can still ask
 * about "Claude Shannon" or "Claude Monet" without losing the word.
 * The strict matcher is "Claude" + Sonnet/Opus/Haiku (the model
 * family), Anthropic-attribution, or known self-intro openers.
 *
 * Order matters: the leading-dash model-ID pattern is FIRST so it
 * eats both the dash and the model ID together. Without that,
 * stripping the model ID in isolation would leave an orphan "— "
 * sign-off that the footer pass then has to clean up separately.
 */
const CLAUDE_SIGNATURE_PATTERNS: ReadonlyArray<RegExp> = [
  // Model identifier WITH a leading em-dash / dash sign-off marker.
  // Sweeps the entire sign-off footer in one pass.
  /[ \t]*[—\-–][ \t]*Claude[\s-](?:Sonnet|Opus|Haiku)(?:[\s-]?\d+(?:\.\d+)?)?(?:\s*\([^)]{0,60}\))?/gi,
  // Model identifier (no leading dash). Anchored with a required
  // family word (Sonnet/Opus/Haiku) so "Claude Shannon" / "Apple
  // and Claude" stay intact. Optional version + parenthetical
  // release tag follow if present.
  /\bClaude[\s-](?:Sonnet|Opus|Haiku)(?:[\s-]?\d+(?:\.\d+)?)?(?:\s*\([^)]{0,60}\))?/gi,
  // English inline self-introduction. Lookahead asserts a clause
  // boundary (punctuation / whitespace / end-of-string) so this
  // does NOT match "I'm Claudette" or similar.
  /\b(?:I['’]m|I am|This is)\s+Claude(?=[,.\s]|$)/gi,
  // Anthropic-branded self-ID — strip the whole envelope. Two
  // shapes: Anthropic-prefix and Claude-then-Anthropic-attribution.
  /\bAnthropic['’]s?\s+(?:AI|assistant|model)\s+(?:named\s+|called\s+)?Claude\b/gi,
  /\bClaude,?\s+Anthropic['’]s?\s+(?:AI|assistant|model)[^.\n]{0,60}/gi,
  // English provenance attributions.
  /\b(?:Generated|Created|Made|Powered|Built|Written|Drafted|Authored)\s+by\s+Claude\b/gi,
  // Chinese inline self-introduction + provenance.
  /我(?:是|叫|为)\s*Claude[^。\n]{0,40}/gi,
  /(?:由|来自)\s*Claude(?:\s*(?:Sonnet|Opus|Haiku))?(?:\s*生成|\s*提供|\s*回答|\s*撰写|\s*作答|\s*出品)?/gi,
  /作为\s*Claude[^，。\n]{0,40}/gi,
];

/**
 * Trailing-signature line cleanup — catches sign-offs left over by
 * the substring strips. Three shapes:
 *   1. Bare-dash + Claude-family token line (uncommon now that the
 *      first inline pattern eats the dash too, but a belt-and-braces
 *      catch for unusual whitespace).
 *   2. Bare-dash + Anthropic-attribution suffix line ("— Anthropic
 *      AI assistant" remains after stripping "Claude, ").
 *   3. Pure-dash / whitespace orphan line.
 *
 * All bounded to one line + ≤60 trailing chars so a real bulleted
 * paragraph can't accidentally match.
 */
const CLAUDE_FOOTER_LINE_RE: ReadonlyArray<RegExp> = [
  /^[ \t]*[—\-–][ \t]*(?:Claude|Sonnet|Opus|Haiku)[^\n]{0,60}$/gim,
  /^[ \t]*[—\-–][ \t]*,?[ \t]*Anthropic[^\n]{0,60}$/gim,
  /^[ \t]*[—\-–]+[ \t]*$/gim,
];

/**
 * Collapse 3+ consecutive blank lines down to 2. After stripping
 * tool envelopes the answer often has gaps; this keeps paragraphs
 * separated without a giant gulf between them.
 */
const TRIPLE_BLANK_RE = /\n{3,}/g;

/**
 * Orphan JSON fragment line. After `stripToolJsonBlocks` bails out
 * on unbalanced braces (conservative: keeps the tail intact), a
 * line like `{"image": "` (no closing `}`) survives. This regex
 * line-strips any line that:
 *   - starts with `{"<marker_key>"` (after optional whitespace)
 *   - has no `}` until end of line (so it's an orphan opener,
 *     not a fully-closed JSON object the user might have written
 *     intentionally)
 *
 * Marker keys are the same set TOOL_RESPONSE_MARKERS_RE uses.
 * Multiline + case-insensitive flags so it sweeps every line in
 * one pass.
 */
const ORPHAN_JSON_FRAGMENT_LINE_RE =
  /^[ \t]*\{"(?:status|content|type|data|image|screenshot|base64)"[^}\n]*$/gim;

/**
 * Stray closing brace on its own line — common leftover after the
 * inner block of nested JSON gets stripped. e.g. input
 * `{"outer":{"image":"x"}}` → stripToolJsonBlocks removes the
 * outer too (markers present); but for `{"outer":{"image":"x"}}`
 * where the OUTER doesn't have markers the scanner kept the
 * outer block. With the inner stripped post-hoc, the user might
 * see `}\n}` orphans. This kills purely brace/bracket lines that
 * are clearly cleanup leftovers (≤6 chars, only braces/brackets).
 */
const STRAY_CLOSER_LINE_RE = /^[ \t]*[\}\]]{1,3}[\s,]*$/gm;

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
  // 1. XML tool envelopes (paired + orphan).
  text = text.replace(PAIRED_TAG_RE, '');
  text = text.replace(ORPHAN_TAG_RE, '');
  // 2. Tool-response JSON blocks — handled BEFORE the bare-base64
  //    pass because the JSON wrapping (`"data": "..."`) has no
  //    whitespace boundary, so STANDALONE_BASE64_RE wouldn't catch
  //    the embedded payload.
  text = stripToolJsonBlocks(text);
  // 3. Quoted JSON image-data field — survives if the surrounding
  //    JSON didn't have a marker that triggered stripToolJsonBlocks
  //    (rare, but cheap to belt-and-braces).
  text = text.replace(QUOTED_IMAGE_DATA_RE, '');
  // 4. Inline image-magic-byte base64 — anywhere, regardless of
  //    quoting context. Catches the payload on its own line, in
  //    a sentence, mid-paragraph.
  text = text.replace(IMAGE_MARKER_BASE64_RE, '');
  // 5. data: URLs (image/* with base64).
  text = text.replace(BASE64_DATA_URL_RE, '');
  // 6. Standalone 50+ char base64 runs (whitespace-bounded).
  text = text.replace(STANDALONE_BASE64_RE, '$1$3');
  // 7. Stop-reason / model-internal markers.
  for (const re of STOP_REASON_MARKERS) text = text.replace(re, '');
  // 8. Orphan JSON fragments — lines like `{"image": "` that the
  //    brace-counted scanner conservatively preserved when the
  //    closing brace was missing. Phase 1 follow-up: BOSS observed
  //    these surviving in production output.
  text = text.replace(ORPHAN_JSON_FRAGMENT_LINE_RE, '');
  // 9. Stray brace/bracket-only lines left over from a stripped
  //    inner block whose outer wrapper was kept.
  text = text.replace(STRAY_CLOSER_LINE_RE, '');
  // 10. Phase 4 R1 — Claude self-signatures. Strip every leak shape
  //     (model ID, English self-intro, Chinese self-intro,
  //     provenance attribution). Then run the footer-line pass to
  //     mop up orphan dashes / Anthropic-only sign-off lines that
  //     the inline substring strips can leave behind.
  for (const re of CLAUDE_SIGNATURE_PATTERNS) text = text.replace(re, '');
  for (const re of CLAUDE_FOOTER_LINE_RE) text = text.replace(re, '');
  // 11. Collapse whitespace gaps left by the strips.
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
