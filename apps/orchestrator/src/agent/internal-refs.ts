/**
 * FIX-38 #1 (Deploy-38 core-11): the browser's own handles — element refs (「ref e12、e13、
 * e19–e23」, `[ref=e12]`), tab / frame ids (`tab_9eff90a8-…`) — are never shown to the user,
 * in the answer, its fields, the 未核实 note or a failure / pause message. 「页面上的按钮」 is
 * fine; 「ref e12」 is not.
 */

const ID = String.raw`e\d{1,6}`;
/** e12、e13、e19–e23 / e12, e13 and e19-e23 */
const NEXT_ID = String.raw`\s*(?:[、,，/;；]|和|及|与|至|到|and|[–—~-])\s*${ID}`;
const ID_LIST = String.raw`${ID}(?:${NEXT_ID})*`;
const REF_CORE = String.raw`ref\s*[=:：]?\s*`;
const REF = `(?:${REF_CORE})`;

/**
 * A bracket holding only element ids: 「（ref e12、e13）」「[ref=e12]」, or without 「ref」 a
 * list or range 「(e12–e23)」 — a lone 「(e2)」 may be the page's own text.
 */
const BRACKETED_RE = new RegExp(
  String.raw`\s*[（(\[【]\s*(?:元素|节点)?\s*(?:${REF}${ID_LIST}|${ID}(?:${NEXT_ID})+)\s*[）)\]】]`,
  'giu',
);
/** 「ref e12、e13」 inline. */
const INLINE_REF_RE = new RegExp(String.raw`\s*\b${REF}${ID_LIST}\b`, 'giu');
/** 「按钮 e12」 → 「按钮」. */
const NOUN_ID_RE = new RegExp(
  String.raw`(元素|节点|按钮|链接|输入框|段落|标签)\s*(?:${REF})?${ID_LIST}\b`,
  'gu',
);
/** tab_ / frame_ handles, whole or cut short with an ellipsis. */
const HANDLE_RE =
  /\s*\b(?:tab|frame)_[0-9a-f]{6,}(?:-[0-9a-f]{1,12}){0,4}(?:-?(?:…|\.\.\.))?(?![\w-])/giu;

/** Any internal reference left in user-facing text. */
export const INTERNAL_REF_RE = new RegExp(
  String.raw`\b${REF_CORE}${ID}\b|\[ref=${ID}\]|\b(?:tab|frame)_[0-9a-f]{6,}`,
  'iu',
);

export function hasInternalRef(text: string): boolean {
  return INTERNAL_REF_RE.test(text);
}

/** `text` without element refs or tab / frame handles; other text is left as written. */
export function stripInternalRefs(text: string): string {
  if (!text || !/\be\d|\b(?:tab|frame)_/i.test(text)) return text;
  const stripped = text
    .replace(BRACKETED_RE, '')
    .replace(NOUN_ID_RE, '$1')
    .replace(INLINE_REF_RE, '')
    .replace(HANDLE_RE, '')
    // What the removal leaves behind: empty quotes / brackets, a space before punctuation.
    .replace(/[「“"『]\s*[」”"』]/gu, '')
    .replace(/[（(]\s*[）)]/gu, '')
    .replace(/[ \t]+([，。、；：,.;:！？）)」])/gu, '$1')
    .replace(/[ \t]{2,}/g, ' ')
    // 「点击了 的按钮」: a removed id leaves no gap between Chinese words.
    .replace(/([\u4e00-\u9fff])[ \t]+([\u4e00-\u9fff])/gu, '$1$2');
  return stripped === text ? text : stripped.replace(/[ \t]+$/gm, '');
}
