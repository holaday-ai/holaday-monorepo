/**
 * FIX-38 #1 (Deploy-38 core-11): the browser's own handles — element refs (「ref e12、e13、
 * e19–e23」, `[ref=e12]`), tab / frame ids (`tab_9eff90a8-…`) — are never shown to the user,
 * in the answer, its fields, the 未核实 note or a failure / pause message. 「页面上的按钮」 is
 * fine; 「ref e12」 is not.
 *
 * 复审 #1: only what is surely a handle goes. URLs and code are left alone
 * (`?ref=e12&tab_abc123=1`, `if (value === "")`); 「坐标 (e1, e2)」「基向量 (e1–e3)」「矩阵
 * 元素 e12」「链接 e2」 and `frame_deadbeef12` are ordinary text.
 *
 * FIX-51 复审 #1 (Deploy-51 A core-10 「通过 frameId `frame_4c3d2bdc-…` 读取」): backticks do not make a
 * handle code. An inline code holding one goes whole, and a handle in a code block goes.
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
/** Code holding a handle: also one cut to its first eight digits (`frame_4c3d2bdc`). */
const CODE_HANDLE_RE =
  /\b(?:tab|frame)_[0-9a-f]{8}(?:(?:-[0-9a-f]{1,12}){1,4}(?:-?(?:…|\.\.\.))?|-?(?:…|\.\.\.))?(?![\w-])/iu;
const CODE_REF_RE = new RegExp(String.raw`^\[?\s*${REF}${ID_LIST}\s*\]?$`, 'iu');
const CODE_IDS_RE = new RegExp(String.raw`^${ID_LIST}$`, 'iu');
/** 「frameId」 before a removed handle says nothing without it. */
const HANDLE_LABEL_RE = /\b(?:frame|tab)\s*_?id\s*[=:：]?\s*(?=\uE000)/giu;
/** Left as written, unless they hold a handle: fenced code, inline code, URLs. */
const PROTECTED_RE = /```[\s\S]*?```|`[^`\n]*`|\bhttps?:\/\/[^\s<>"'）)」』]+/giu;

/**
 * Where a ref was removed (a private-use character no answer carries). Cleanup happens only
 * around it, so an untouched `if (value === "") reset();` next to 「e2e」 stays as written.
 */
const CUT = '';

/** Code with the handles out; inline code holding one is a removal. URLs and other code stay. */
function markCode(code: string, seen: ReadonlySet<string>): string {
  if (code.startsWith('```')) return code.replace(HANDLE_RE, '');
  if (!code.startsWith('`')) return code;
  const inner = code.slice(1, -1).trim();
  if (/https?:\/\//i.test(inner)) return code;
  return CODE_HANDLE_RE.test(inner) ||
    CODE_REF_RE.test(inner) ||
    (CODE_IDS_RE.test(inner) &&
      (inner.match(/e\d+/gi) ?? []).every((id) => seen.has(id.toLowerCase())))
    ? CUT
    : code;
}

function stripPlain(text: string, seen: ReadonlySet<string>): string {
  if (!text.includes(CUT) && !/\be\d|\b(?:tab|frame)_/i.test(text)) return text;
  const marked = text
    .replace(BRACKETED_RE, CUT)
    .replace(INLINE_REF_RE, CUT)
    .replace(NOUN_ID_RE, (whole, noun: string, ids: string) =>
      (ids.match(/e\d+/gi) ?? []).every((id) => seen.has(id.toLowerCase()))
        ? `${noun}${CUT}`
        : whole,
    )
    .replace(HANDLE_RE, CUT)
    .replace(HANDLE_LABEL_RE, '');
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
  const marked = text.replace(PROTECTED_RE, (code) => markCode(code, seen));
  let out = '';
  let at = 0;
  for (const match of marked.matchAll(PROTECTED_RE)) {
    out += stripPlain(marked.slice(at, match.index), seen) + match[0];
    at = match.index + match[0].length;
  }
  return out + stripPlain(marked.slice(at), seen);
}

/** Any internal reference left in user-facing text. */
export function hasInternalRef(text: string, seen?: ReadonlySet<string>): boolean {
  return stripInternalRefs(text, seen) !== text;
}

/**
 * FIX-61B P0-1 (Deploy-61 new-bestbuy 「我在Best Buy在「- generic [ref=e6]:」里输入了内容」): accessibility
 * snapshot syntax — a line 「- generic [ref=e6]:」, a bare role word 「generic」 — is never shown to the
 * user, and is never a control's name.
 */
const SNAPSHOT_ROLE =
  'generic|button|link|textbox|searchbox|combobox|checkbox|radio|option|listbox|list|listitem|img|image|heading|paragraph|region|group|navigation|main|banner|contentinfo|complementary|form|search|dialog|alertdialog|menu|menubar|menuitem|tab|tablist|tabpanel|table|row|cell|gridcell|columnheader|rowheader|article|section|figure|separator|iframe|document|text|status|alert|tooltip|switch|slider|spinbutton|progressbar|term|definition|code|strong|emphasis|blockquote|caption|time|mark|superscript|subscript|insertion|deletion|log|marquee|timer|toolbar|tree|treeitem|grid|application|note|math|meter|LabelText|StaticText|none|presentation';
/** 「- generic [ref=e6]:」「- button "OK" [ref=e7] [cursor=pointer]:」 — a snapshot line, anywhere. */
const SNAPSHOT_LINE_RE = new RegExp(
  String.raw`(?:^|\s)-\s+(?:${SNAPSHOT_ROLE})\b(?:\s+"[^"\n]{0,120}")?(?:\s*\[[a-z]+(?:=[^\]\n]*)?\])+\s*:?`,
  'giu',
);
const REF_MARK_RE =
  /\s*\[(?:ref|cursor|active|level|checked|selected|expanded|disabled|pressed)(?:=[^\]\n]*)?\]/giu;
const BARE_ROLE_RE = new RegExp(String.raw`^(?:${SNAPSHOT_ROLE})$`, 'iu');

/** Whether user-facing text still carries snapshot syntax (`[ref=…]`, 「- generic …:」). */
export function hasSnapshotSyntax(text: string): boolean {
  if (!text) return false;
  SNAPSHOT_LINE_RE.lastIndex = 0;
  return /\[ref=[^\]\n]*\]/i.test(text) || SNAPSHOT_LINE_RE.test(text);
}

/** User-facing text with snapshot lines and `[ref=…]` marks taken out (other text as written). */
export function stripSnapshotSyntax(text: string): string {
  if (!hasSnapshotSyntax(text)) return text;
  return text
    .replace(SNAPSHOT_LINE_RE, ' ')
    .replace(REF_MARK_RE, '')
    .replace(/「\s*」/g, '')
    .replace(/[ \t]{2,}/g, ' ');
}

/**
 * A control's name for the user, or null when what we have is snapshot syntax, a bare role word
 * (「generic」「button」) or an element handle — the caller then says 「这个按钮」「输入框」.
 */
export function cleanElementName(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const name = stripInternalRefs(stripSnapshotSyntax(raw))
    .replace(/^[\s:：\-–—]+|[\s:：\-–—]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!name || BARE_ROLE_RE.test(name) || /^e\d{1,6}$/i.test(name)) return null;
  return name;
}

/**
 * FIX-61B P0-2 (Deploy-61 as-shan: the answer opened with the model's reasoning and a 「</think>」):
 * a model's reasoning never reaches the user. A `<think>…</think>` block goes whole; a lone closing
 * `</think>` takes everything before it with it. Other text is left as written.
 */
export function stripReasoning(text: string): string {
  if (!text || !/<\/?think>/i.test(text)) return text;
  let out = text.replace(/<think>[\s\S]*?<\/think>/gi, '');
  const close = out.search(/<\/think>/i);
  if (close >= 0) out = out.slice(close + '</think>'.length);
  return out.replace(/<\/?think>/gi, '').replace(/^\s+/, '');
}

/** Whether user-facing text still carries reasoning tags. */
export function hasReasoningTag(text: string): boolean {
  return /<\/?think>/i.test(text ?? '');
}
