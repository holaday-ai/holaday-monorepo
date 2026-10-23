import type { CoreQualityFailure } from './core-task-settlement.js';

/**
 * FIX-30 (BENCH-1 generate lane: 1/14 passed, 7 answered wrong but marked complete).
 * A generate "answer" that is a tool call written out as text (r05
 * `<computer_use>{"action":"web_search"…}`, n06 `<tool_name>screenshot</tool_name>`),
 * only an opener (t04 「我来帮你查看…先打开网站看看。」, r06 "I'll check…"), or one
 * that cites a web source the task never read (r01 「根据维基百科」) is not delivered.
 */
const TOOL_TAG_RE =
  /<\/?(?:computer_use|tool_name|tool_call|tool_use|function_call|function_calls|invoke|parameter)\b[^>]*>/gi;
const TOOL_JSON_LINE_RE = /^\s*\{\s*"(?:action|tool|tool_name|function)"\s*:[^\n]*\}\s*$/gim;
/** A first-person opener announcing an action (「我来帮你查看…」 "I'll check…"). */
const OPENER_RE =
  /^(?:好的[，,。！!]?\s*)?(?:我来|让我|我先|我将|我会|稍等|马上|正在)(?:帮你|为你|给你|去)?(?:查|看|打开|搜索|检索|访问|浏览|确认)|^(?:sure[,!.]?\s*)?(?:I'?ll|I will|let me|I'm going to|I am going to)\s+(?:check|look|search|open|browse|find|visit|fetch)/i;
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
  opts: { readSources: boolean; userMaterial?: string },
): CoreQualityFailure | null {
  const text = answer.trim();
  if (!text) return null;
  const flat = (value: string) => value.replace(/\s+/g, ' ').trim();
  // Tool tags with little else around them; a bare action JSON with nothing else
  // (a JSON example inside an explanation is an answer).
  if (
    new RegExp(TOOL_TAG_RE.source, 'i').test(text) &&
    flat(text.replace(TOOL_TAG_RE, ' ').replace(/[{}[\]"':,]/g, ' ')).length < 60
  )
    return 'NON_ANSWER';
  // Only when there was such a line: a short answer (「4」「你好！」) is an answer.
  if (
    new RegExp(TOOL_JSON_LINE_RE.source, 'im').test(text) &&
    flat(text.replace(TOOL_JSON_LINE_RE, ' ').replace(/`{3}\w*/g, ' ')).length < 15
  )
    return 'NON_ANSWER';
  // A first-person opener with nothing of substance after it. Instructions
  // (「先打开设置，再点通用→关于本机」) are an answer.
  if (text.length <= 120 && OPENER_RE.test(text) && !/[：:=]/.test(text)) {
    const rest = text
      .split(/[。！!？?\n]+/)
      .map((sentence) => sentence.trim())
      .filter(Boolean)
      .slice(1);
    if (rest.every((sentence) => MORE_OPENER_RE.test(sentence))) return 'NON_ANSWER';
  }
  if (!opts.readSources && !pastedMaterial(opts.userMaterial ?? '') && CLAIMED_SOURCE_RE.test(text))
    return 'UNREAD_SOURCE';
  return null;
}
