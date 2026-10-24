/**
 * FIX-33 (new-bestbuy, Deploy-33 rollback): a generate "answer" was
 * 「我来帮你在 BestBuy 搜索 usb c cable。」 followed by
 * `<li_call><function>browser_use</function><arguments>{"action":"navigate","url":""}…`
 * and was delivered as completed — the FIX-30 guard only knew a list of tag names.
 * A tool call written out as text is recognised by its shape instead: a tag named
 * like a call / function / arguments / parameter / tool / *_use (any namespace),
 * a JSON object whose first key is action / tool / function, or a bare `browser_use`
 * line. Code the user asked about stays: fenced blocks and inline code are only
 * read for detection, never rewritten for display.
 */
const TAG_NAME = String.raw`(?:[a-z][\w-]*:)?(?:[a-z]+_)*(?:calls?|functions?|function_[a-z_]+|arguments?|args|parameters?|invoke|tools?|tool_[a-z_]+|[a-z]+_use|[a-z]+_(?:result|results|response))`;
const PAIRED_RE = new RegExp(String.raw`<(${TAG_NAME})\b[^<>]*>[\s\S]*?</\1\s*>`, 'gi');
const TAG_RE = new RegExp(String.raw`</?${TAG_NAME}\b[^<>]*/?>`, 'gi');
/** A line that is nothing but a tool name: `browser_use`, `computer_use`, `tool_call`. */
const TOOL_NAME_LINE_RE = /^[ \t]*[a-z]+_(?:use|call)[ \t]*$/gim;
/** Where a JSON tool call starts: `{"action":`, `{ "tool_name":`, `{"function":`. */
/**
 * FIX-35 #1: `{"name":"Alice","args":…}` in prose is data, not a call. Only a known tool
 * name (`browser_use`, `web_search`, `navigate`…) or a name followed by `arguments` /
 * `parameters` is a tool JSON.
 */
const TOOL_JSON_START_RE =
  /\{\s*(?:"(?:action|tool|tool_name|tool_use|function|function_call)"\s*:|"name"\s*:\s*"(?:[a-z]+_(?:use|call)|web_search|computer|browser|navigate|click|screenshot|snapshot|read_page|get_page_text|finish|[\w.-]+"\s*,\s*"(?:arguments|parameters))")/g;
const CODE_RE = /```[\s\S]*?(?:```|$)|`[^`\n]+`/g;

/** End index (exclusive) of the balanced `{…}` starting at `start`, or -1. */
function jsonBlockEnd(text: string, start: number): number {
  let depth = 0;
  let quoted = false;
  for (let i = start; i < text.length && i - start < 20_000; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '\\') i++;
      else if (ch === '"') quoted = false;
    } else if (ch === '"') quoted = true;
    else if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return i + 1;
  }
  return -1;
}

function stripToolJson(text: string): string {
  let out = '';
  let from = 0;
  for (const match of text.matchAll(TOOL_JSON_START_RE)) {
    const start = match.index ?? 0;
    if (start < from) continue;
    const end = jsonBlockEnd(text, start);
    // An unclosed call (truncated stream) runs to the end of its line.
    const stop = end > 0 ? end : text.indexOf('\n', start) + 1 || text.length;
    out += text.slice(from, start);
    from = stop;
  }
  return out + text.slice(from);
}

/**
 * FIX-34 (FIX-33 review): only a tool-call *structure* is removed. A tag named like a
 * tool artifact (`tool_call`, `li_call`, `function_calls`, `computer_use`, any
 * `ns:` tag), an `invoke name=…`, a tool JSON or a bare `browser_use` line is one; a lone
 * `<function>` / `<parameter>` / `<arguments>` in prose (「用 <function> 包住函数名」) is a
 * word, and stays unless such a structure is present in the same text.
 */
const STRUCTURE_RE =
  /<\/?(?:[a-z][\w-]*:[a-z][\w-]*|(?:[a-z]+_)+[a-z]+)\b[^<>]*>|<invoke\s+name=|<(?:function|parameter|invoke|tool)=[\w.-]+\s*>|<(?:function|arguments?|parameters?|args)\b[^<>]*>\s*[a-z]+_(?:use|call)\b/i;

function hasStructure(text: string): boolean {
  return (
    STRUCTURE_RE.test(text) ||
    new RegExp(TOOL_JSON_START_RE.source).test(text) ||
    new RegExp(TOOL_NAME_LINE_RE.source, 'im').test(text)
  );
}

function stripPlain(text: string, structured = hasStructure(text)): string {
  if (!structured) return text;
  return stripToolJson(text.replace(PAIRED_RE, '').replace(TAG_RE, '')).replace(
    TOOL_NAME_LINE_RE,
    '',
  );
}

/**
 * FIX-34: the cloud browser's internal element refs (「Google Logo（ref=e23）」, 「标题
 * ref=e255」) are page-snapshot handles, not something the user can read or use. `REFS`
 * is one ref or a run of them (「ref=e12、e13、e23」).
 */
const REFS = String.raw`ref=e\d+(?:\s*[、,，/和及–~-]\s*(?:ref=)?e\d+)*\b`;
const INTERNAL_REF_RES: Array<[RegExp, string]> = [
  // 「（ref=e23）」「（ref=e12、e13）」: the whole parenthetical goes.
  [new RegExp(String.raw`\s*[（(]\s*${REFS}\s*[)）]`, 'g'), ''],
  [/\s*\[ref=e\d+\]/g, ''],
  // 「（h2，ref=e36）」 → 「（h2）」; 「（ref=e77，frame …）」 → 「（frame …）」.
  [new RegExp(String.raw`\s*[，,、；;]\s*${REFS}(?=\s*[)）])`, 'g'), ''],
  [new RegExp(String.raw`(?<=[（(])\s*${REFS}\s*[，,、；;]\s*`, 'g'), ''],
  // 「对应 snapshot 中的 ref=e12、e13。」 still names something: 「…中的相应元素。」
  [new RegExp(String.raw`(?<=的)\s*${REFS}(?=\s*[。；;，,])`, 'g'), '相应元素'],
  // Never inside a URL or a word (「/dp/B0?ref=e23」「preference=e5」).
  [new RegExp(String.raw`[ \t]?(?<![?&=/#.\w-])${REFS}`, 'g'), ''],
];

function stripRefs(text: string): string {
  if (!text.includes('ref=e')) return text;
  return INTERNAL_REF_RES.reduce((out, [re, to]) => out.replace(re, to), text);
}

/**
 * A fenced code block that is nothing but a browser/computer tool call written as JSON
 * (「```json {"name":"browser_use","arguments":{…}}```」). Not a generic JSON example:
 * `{"action":"deploy"}` explained in prose stays.
 */
const TOOL_CALL_JSON_RE =
  /"name"\s*:\s*"[\w.-]*(?:_use|_call|browser|computer)[\w.-]*"|"(?:tool|tool_name|tool_use|function|function_call)"\s*:|"action"\s*:\s*"(?:navigate|goto|open|click|left_click|double_click|right_click|type|key|scroll|screenshot|snapshot|read_page|get_page_text|wait|wait_for|mouse_move|finish)"/i;
const FENCED_RE = /```[\w-]*[ \t]*\n?([\s\S]*?)(?:```|$)/g;

/**
 * FIX-34 (协调方复审阻塞 3): removes fenced blocks that are only a tool-call JSON. Callers
 * apply it unless the user asked for such an example (`asksForToolCallExample`).
 */
export function stripToolCallBlocks(text: string): string {
  let removed = false;
  const out = text.replace(FENCED_RE, (block, inner: string) => {
    const body = inner.trim();
    if (!/^[[{]/.test(body) || !TOOL_CALL_JSON_RE.test(body)) return block;
    removed = true;
    return '';
  });
  return removed ? tidy(out) : text;
}

/** True when the text carries tool-call syntax anywhere (code included). */
export function hasToolCallMarkup(text: string): boolean {
  return stripPlain(text) !== text;
}

/**
 * Removes tool-call syntax. Outside code by default (what the user sees); with
 * `code: true` also inside code (what is left to judge as an answer).
 */
export function stripToolCallMarkup(text: string, opts: { code?: boolean } = {}): string {
  if (opts.code) return tidy(stripRefs(stripPlain(text.replace(/```\w*/g, ' '))));
  let out = '';
  let from = 0;
  const structured = hasStructure(text.replace(CODE_RE, ' '));
  for (const match of text.matchAll(CODE_RE)) {
    const start = match.index ?? 0;
    out += stripRefs(stripPlain(text.slice(from, start), structured)) + match[0];
    from = start + match[0].length;
  }
  const stripped = out + stripRefs(stripPlain(text.slice(from), structured));
  return stripped === text ? text : tidy(stripped);
}

function tidy(text: string): string {
  return text
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
