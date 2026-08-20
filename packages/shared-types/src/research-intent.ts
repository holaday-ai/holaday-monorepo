/**
 * Conservative, shared classifier for requests whose answer depends on
 * external facts, retrieval, or fresh information. Both the orchestrator's
 * terminal trust gate and the workbench's legacy-result warning consume this
 * function so the same user wording cannot be accepted by one layer and
 * rejected by the other.
 */
export function isResearchOrRetrievalIntent(intent?: string | null): boolean {
  const text = intent?.trim() ?? '';
  if (!text) return false;

  // Stock quotes have a stricter dedicated trust contract (price + timestamp
  // + source). Keep them out of the generic research branch.
  if (/股价|股票|股市|A股|港股|美股|stock\s+(?:price|quote)/i.test(text)) {
    return false;
  }

  const explicitResearch =
    /^(?:(?:请|麻烦|劳烦)?\s*(?:帮我|帮忙|给我|替我)?\s*)?(?:研究|调研|检索|搜索|搜集|搜寻|查询|查找|调查|查(?!看|验|错|重))/i.test(
      text,
    ) ||
    /^(?:(?:please|could you|can you)\s+)?(?:research|search(?:\s+for)?|look\s+up|investigate)\b/i.test(
      text,
    );
  if (explicitResearch) return true;

  // Transformation requests may contain words such as “今天” inside the
  // material being transformed. They do not become research tasks merely
  // because of that quoted content.
  if (
    /^(?:(?:请|麻烦)?\s*)?(?:把|将|翻译|改写|润色|总结|摘要|创作|写作|起草|生成|设计)/i.test(text)
  ) {
    return false;
  }

  const hasFreshnessCue =
    /最新|最近|近期|当前|现在|今日|今天|本周|本月|实时|截至|\b(?:latest|recent|current|today|now)\b/i.test(
      text,
    ) || /(?:^|\D)20\d{2}\s*(?:年|[-/.])/.test(text);
  const hasDynamicFactCue =
    /新闻|消息|头条|热搜|动态|进展|趋势|现状|政策|法规|规定|数据|报告|榜单|排名|财报|融资|发布|行情|价格|市场|行业|公司|产品|CEO|负责人|总统|首相|负责人|news|trend|policy|report|ranking|market/i.test(
      text,
    );
  if (hasFreshnessCue && hasDynamicFactCue) return true;

  const hasResearchTopic =
    /新闻|头条|热搜|行业趋势|市场动态|政策|法规|财报|融资|榜单|排名|news|industry\s+trend|market\s+update/i.test(
      text,
    );
  const asksForFact =
    /是什么|有哪些|是谁|多少|怎么样|如何|为何|为什么|什么时候|何时|在哪里|哪里|吗[？?]?$|[？?]$|\b(?:what|which|who|when|where|how|why)\b/i.test(
      text,
    );
  return hasResearchTopic && asksForFact;
}
