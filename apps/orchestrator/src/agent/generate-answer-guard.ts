import type { CoreQualityFailure } from './core-task-settlement.js';

import { hasToolCallMarkup, stripToolCallMarkup } from '@holaday/shared-types';
import { namedSiteSearch } from './named-site-search.js';

/**
 * FIX-30 (BENCH-1 generate lane: 1/14 passed, 7 answered wrong but marked complete).
 * A generate "answer" that is a tool call written out as text (r05
 * `<computer_use>{"action":"web_search"…}`, n06 `<tool_name>screenshot</tool_name>`,
 * FIX-33 new-bestbuy `<li_call><function>browser_use</function>…`), only an opener
 * (t04 「我来帮你查看…先打开网站看看。」, r06 "I'll check…"), or one that cites a web
 * source the task never read (r01 「根据维基百科」) is not delivered.
 */
/** A first-person opener announcing an action (「我来帮你查看…」 "I'll check…"). */
const OPENER_RE =
  /^(?:好的[，,。！!]?\s*)?(?:我来|让我|我先|我将|我会|稍等|马上|正在)(?:帮你|为你|给你|去)?(?:在[^，,。！!？?\n]{1,30}?)?(?:查|看|打开|搜索|检索|访问|浏览|确认|找)|^(?:sure[,!.]?\s*)?(?:I'?ll|I will|let me|I'm going to|I am going to)\s+(?:check|look|search|open|browse|find|visit|fetch)/i;
/** What may follow an opener without being content: 「先打开网站看看」「请稍候」. */
const MORE_OPENER_RE =
  /^(?:然后|再|先|稍等|请稍候|马上)?[^，,。]{0,6}(?:打开|访问|搜索|查看|查一下|看看|看一下|浏览)[^，,。]{0,30}$|^(?:请稍候|稍等|one moment|please wait)/i;
/**
 * A sentence citing a web source as where facts came from: 「根据维基百科，…」
 * 「据官网显示…」「以下数据来自官网」「according to Wikipedia」. Advice
 * (「请参考官网」「以官网为准」), the user's own material (「根据你提供的网页内容」),
 * and 据 inside 数据/证据/依据 (「完整数据可在官网查询」) are not.
 */
const CLAIMED_SOURCE_RE =
  /(?:根据|(?<![数证依根占凭])据|来自|摘自|引自|查阅了|查询了)(?!你|您|用户|上文|上面|以上|下面|以下|所给|提供|前面)[^，。\n]{0,10}(?:维基百科|百度百科|百科|官网|官方网站|官方文档|网站|网页|新闻报道|报道|搜索结果)|\baccording to (?:the )?(?:wikipedia|official (?:site|website|docs?|documentation)|the website|search results|news reports?)\b/i;
/** A concrete price: ¥99 / $14.99 / SGD 15 / S$12 / 15 元 / 12 新元. */
const PRICE_RE =
  /[$¥￥€£]\s*\d|\b(?:SGD|USD|RMB|CNY|HKD|JPY|MYR|EUR|GBP|AUD|CAD)\s*\d|\d[\d,.]*\s*(?:元|块钱|美元|新元|新加坡元|日元|港币|港元)/i;
/**
 * FIX-32 (FIX-30 review): what the answer may be "根据" is material the user actually
 * pasted — a quote or code block, a long quoted passage, or a long text after a colon
 * (「翻译这段：……」) — not a long request, nor a bare URL nobody read.
 */
const PASTED_MATERIAL_RE =
  /^\s*>\s?\S|```[\s\S]{20,}```|[「“"『][^」”"』]{40,}[」”"』]|[：:]\s*\S[^\n]{59,}|[：:]\s*\n(?:[^\n]*\S[^\n]*\n?){2,}/m;
export function pastedMaterial(text: string): boolean {
  return PASTED_MATERIAL_RE.test(text);
}

export function answerQualityFailure(
  answer: string,
  opts: { readSources: boolean; userMaterial?: string; intent?: string },
): CoreQualityFailure | null {
  const text = answer.trim();
  if (!text) return null;
  // Tool-call syntax (in code too) with nothing of substance left — only an
  // opener, or a few characters. A JSON or tag example inside an explanation is an answer.
  if (hasToolCallMarkup(text) && !substantive(stripToolCallMarkup(text, { code: true })))
    return 'NON_ANSWER';
  if (openerOnly(text)) return 'NON_ANSWER';
  if (!opts.readSources && !pastedMaterial(opts.userMaterial ?? '') && CLAIMED_SOURCE_RE.test(text))
    return 'UNREAD_SOURCE';
  // FIX-33 (new-amazon-sg): asked to search a named site, nothing was read, yet the
  // answer names prices — they came from memory.
  if (!opts.readSources && PRICE_RE.test(text) && namedSiteSearch(opts.intent ?? ''))
    return 'UNREAD_LISTING';
  return null;
}

/**
 * A first-person opener with nothing of substance after it. Instructions
 * (「先打开设置，再点通用→关于本机」) are an answer.
 */
function openerOnly(text: string): boolean {
  if (text.length > 120 || !OPENER_RE.test(text) || /[：:=]/.test(text)) return false;
  return text
    .split(/[。！!？?\n]+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean)
    .slice(1)
    .every((sentence) => MORE_OPENER_RE.test(sentence));
}

function substantive(rest: string): boolean {
  const meaningful = rest.replace(/[\s{}[\]"'`:,，。.!！?？<>/\\-]+/g, '');
  return meaningful.length >= 6 && !openerOnly(rest.trim());
}

/** A legacy-lane result that was only tool-call syntax: failed, refunded as ours. */
export const TOOL_CALL_TEXT_ONLY = Object.freeze({
  code: 'TOOL_CALL_TEXT_ONLY',
  reason:
    '没有拿到实际结果：模型只输出了工具调用指令，没有给出答案，这是平台的问题（本次不扣次数）。请稍后重试。',
});

/**
 * FIX-33 — the last display filter for every lane: what may be delivered once
 * tool-call syntax is removed (outside code). `null` when nothing but tool syntax
 * and/or an opener is left — such a result must not be marked completed.
 */
export function deliverableAnswer(answer: string): string | null {
  if (!hasToolCallMarkup(answer)) return answer;
  const shown = stripToolCallMarkup(answer);
  return substantive(stripToolCallMarkup(answer, { code: true })) && shown.trim() ? shown : null;
}
