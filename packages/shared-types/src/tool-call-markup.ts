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
const TOOL_JSON_START_RE = /\{\s*"(?:action|tool|tool_name|tool_use|function|function_call)"\s*:/g;
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

function stripPlain(text: string): string {
  return stripToolJson(text.replace(PAIRED_RE, '').replace(TAG_RE, '')).replace(
    TOOL_NAME_LINE_RE,
    '',
  );
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
  if (opts.code) return tidy(stripPlain(text.replace(/```\w*/g, ' ')));
  let out = '';
  let from = 0;
  for (const match of text.matchAll(CODE_RE)) {
    const start = match.index ?? 0;
    out += stripPlain(text.slice(from, start)) + match[0];
    from = start + match[0].length;
  }
  const stripped = out + stripPlain(text.slice(from));
  return stripped === text ? text : tidy(stripped);
}

function tidy(text: string): string {
  return text
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
