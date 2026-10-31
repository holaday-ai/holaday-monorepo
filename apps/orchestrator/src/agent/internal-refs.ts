/**
 * FIX-38 #1 (Deploy-38 core-11): the browser's own handles — element refs (「ref e12、e13、
 * e19–e23」, `[ref=e12]`), tab / frame ids (`tab_9eff90a8-…`) — are never shown to the user,
 * in the answer, its fields, the 未核实 note or a failure / pause message. 「页面上的按钮」 is
 * fine; 「ref e12」 is not.
 *
 * 复审 #1: only what is surely a handle goes. URLs, inline code and code blocks are left
 * alone (`?ref=e12&tab_abc123=1`, `if (value === "")`); 「坐标 (e1, e2)」「基向量 (e1–e3)」「矩阵
 * 元素 e12」「链接 e2」 and `frame_deadbeef12` are ordinary text.
 */

const ID = String.raw`e\d{1,6}`;
/** A snapshot-style id: two digits or more (e12, not e1). */
const SNAPSHOT_ID = String.raw`e\d{2,6}`;
const SEP = String.raw`\s*(?:[、,，/;；]|和|及|与|至|到|and|[–—~-])\s*`;
/** e12、e13、e19–e23 / e12, e13 and e19-e23 */
const ID_LIST = String.raw`${ID}(?:${SEP}${ID})*`;
// FIX-40 (Deploy-40 core-11): the plural too — 「(refs e12, e13, e19…)」「refs: e12–e23」.
const REF = String.raw`refs?\s*[=:：]?\s*`;

/**
 * A bracket holding only element ids: with 「ref」 (「（ref e12、e13）」「[ref=e12]」), or without
 * it a list or range of snapshot-style ids (「（e12、e13、e19–e23）」) — 「(e1, e2)」 is maths.
 */
const BRACKETED_RE = new RegExp(
  String.raw`\s*[（(\[【]\s*(?:元素|节点)?\s*(?:${REF}${ID_LIST}|${SNAPSHOT_ID}(?:${SEP}${SNAPSHOT_ID})+)\s*[）)\]】]`,
  'giu',
);
/** 「ref e12、e13」 inline. */
const INLINE_REF_RE = new RegExp(String.raw`\s*\b${REF}${ID_LIST}\b`, 'giu');
/** 「按钮 e12」 → 「按钮」, only for ids the browser itself gave out in this run. */
const NOUN_ID_RE = new RegExp(
  String.raw`(元素|节点|按钮|链接|输入框|段落|标签)\s*(${ID_LIST})\b`,
  'gu',
);
/** tab_ / frame_ handles: a UUID, whole or cut short (`tab_9eff90a8-…`). */
const HANDLE_RE =
  /\s*\b(?:tab|frame)_[0-9a-f]{8}(?:(?:-[0-9a-f]{1,12}){1,4}(?:-?(?:…|\.\.\.))?|-?(?:…|\.\.\.))(?![\w-])/giu;
/** Left as written: fenced code, inline code, URLs. */
const PROTECTED_RE = /```[\s\S]*?```|`[^`\n]*`|\bhttps?:\/\/[^\s<>"'）)」』]+/giu;

/**
 * Where a ref was removed (a private-use character no answer carries). Cleanup happens only
 * around it, so an untouched `if (value === "") reset();` next to 「e2e」 stays as written.
 */
const CUT = '';

function stripPlain(text: string, seen: ReadonlySet<string>): string {
  if (!/\be\d|\b(?:tab|frame)_/i.test(text)) return text;
  const marked = text
    .replace(BRACKETED_RE, CUT)
    .replace(INLINE_REF_RE, CUT)
    .replace(NOUN_ID_RE, (whole, noun: string, ids: string) =>
      (ids.match(/e\d+/gi) ?? []).every((id) => seen.has(id.toLowerCase()))
        ? `${noun}${CUT}`
        : whole,
    )
    .replace(HANDLE_RE, CUT);
  if (!marked.includes(CUT)) return text;
  return (
    marked
      // FIX-39 #4: a list separator left next to the removed ref — 「（Web browser，tab_…）」,
      // 「（tab_…，Web browser）」, 「A，ref e12，B」 — goes with it (only at a removal).
      .replace(/[，,、；;][ \t]*\uE000+[ \t]*(?=[）)\]】」』])/gu, '')
      .replace(/([（(\[【])[ \t]*\uE000+[ \t]*[，,、；;][ \t]*/gu, '$1')
      .replace(/([，,、；;])[ \t]*\uE000+[ \t]*[，,、；;][ \t]*/gu, '$1')
      // What a removal leaves behind: quotes / brackets that held only the ref,
      .replace(/[「“"『]\s*+\s*[」”"』]/gu, '')
      .replace(/[（(]\s*+\s*[）)]/gu, '')
      // a gap before punctuation or between Chinese words (「点击了 的按钮」),
      .replace(/[ \t]*+[ \t]*(?=[，。、；：,.;:！？）)」』”])/gu, '')
      .replace(/([一-鿿])[ \t]*+[ \t]*(?=[一-鿿])/gu, '$1')
      // or at a line's start or end; anywhere else one space stays.
      .replace(/^[ \t]*+[ \t]*|[ \t]*+[ \t]*$/gmu, '')
      .replace(/[ \t]*+[ \t]*/gu, ' ')
  );
}

/**
 * `text` without element refs or tab / frame handles; other text is left as written.
 * `seen`: element ids the browser gave out in this run (lower case), so 「按钮 e7」 may go.
 */
export function stripInternalRefs(text: string, seen: ReadonlySet<string> = new Set()): string {
  if (!text || !/\be\d|\b(?:tab|frame)_/i.test(text)) return text;
  let out = '';
  let at = 0;
  for (const match of text.matchAll(PROTECTED_RE)) {
    out += stripPlain(text.slice(at, match.index), seen) + match[0];
    at = match.index + match[0].length;
  }
  return out + stripPlain(text.slice(at), seen);
}

/** Any internal reference left in user-facing text. */
export function hasInternalRef(text: string, seen?: ReadonlySet<string>): boolean {
  return stripInternalRefs(text, seen) !== text;
}
