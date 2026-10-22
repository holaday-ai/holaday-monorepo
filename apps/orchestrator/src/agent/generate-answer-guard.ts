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
const OPENER_RE =
  /^(?:好的[，,。！!]?\s*)?(?:我来|让我|我先|我将|我会|稍等|马上|正在|先)(?:帮你|为你|给你|去)?(?:查|看|打开|搜索|检索|访问|浏览|确认)|^(?:sure[,!.]?\s*)?(?:I'?ll|I will|let me|I'm going to|I am going to)\s+(?:check|look|search|open|browse|find|visit|fetch)/i;
const CLAIMED_SOURCE_RE =
  /(?:根据|据|来自|参考|摘自|引自|查阅了?|查询了?)[^，。\n]{0,8}(?:维基百科|百度百科|百科|官网|官方网站|官方文档|网站|网页|新闻报道|报道|搜索结果)|\baccording to (?:the )?(?:wikipedia|official (?:site|website|docs?|documentation)|the website|search results|news reports?)\b/i;

export function answerQualityFailure(
  answer: string,
  opts: { readSources: boolean },
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
  if (flat(text.replace(TOOL_JSON_LINE_RE, ' ').replace(/`{3}\w*/g, ' ')).length < 15)
    return 'NON_ANSWER';
  // An opener with nothing after it: no 「：」 introducing an answer.
  if (text.length <= 80 && OPENER_RE.test(text) && !/[：:=]/.test(text)) return 'NON_ANSWER';
  if (!opts.readSources && CLAIMED_SOURCE_RE.test(text)) return 'UNREAD_SOURCE';
  return null;
}
