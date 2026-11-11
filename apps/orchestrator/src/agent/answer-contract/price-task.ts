/**
 * REBUILD-3: which browser tasks answer through the price contract.
 *
 * A price task asks what something costs on a page: 价格 / 多少钱 / 报价 / 售价 / 比价 / 最便宜,
 * or price / cost / how much / cheapest. The same words the asked-field logic already reads
 * (`askedFields` has 价格; FIX-60's variant-price check is about the same answers). Excluded:
 * writing about prices (copy, a script, a report), share prices / funds / exchange rates (the
 * A-share lane and live facts own those), price arithmetic on numbers the user gave, and
 * requests that also ask for values the contract has no field for (rating, stock, …).
 */

const PRICE_ZH_RE =
  /价格|价钱|多少钱|几块钱|报价|售价|标价|定价|单价|到手价|券后价|最低价|最高价|比价|比一下价|最便宜|哪个便宜|哪款便宜|多少元|卖多少/u;
const PRICE_EN_RE =
  /\b(?:prices?|pricing|priced|costs?|how much|cheapest|lowest[- ]priced|price comparison)\b/iu;

/** Share prices and other market quotes are not product prices. */
const MARKET_RE =
  /股价|股票|个股|基金|净值|指数|涨跌|市值|汇率|币价|比特币|\b(?:stock|share|shares|ticker|nasdaq|nyse|exchange rate|crypto|bitcoin)\b/iu;

/** Writing about prices, or reasoning about them, is not reading one off a page. */
const WRITING_RE =
  /写(?:一|个|篇|段|份|首|封)?(?:文案|文章|脚本|报告|总结|邮件|小说|故事|诗|广告|推文|方案|计划)|文案|选题|起标题|帮我写|\b(?:write|draft|compose)\b.{0,30}\b(?:copy|post|article|email|script|essay|ad|story|poem)\b/iu;
/**
 * The contract's items carry name, variant, price and link only: a request that also asks for
 * other values (ratings, sales, stock, specs, opening hours) stays on the legacy path until the
 * schema carries them.
 */
const OTHER_FIELDS_RE =
  /评分|星级|评价数|评论数|销量|月销|库存|有货|参数|配置|尺寸表|开放时间|营业时间|地址|电话|\b(?:ratings?|stars|reviews?|sold|stock|in stock|availability|specs?|specifications|opening hours|address)\b/iu;
const ARITHMETIC_RE =
  /(?:单价|每[个件斤公斤盒])\s*[0-9０-９]+(?:\.\d+)?\s*元.{0,24}(?:多少钱|总价|一共)|(?:costs?|priced at)\s*\$?\d+(?:\.\d+)?.{0,40}\b(?:total|altogether|in all)\b/iu;

/** True when the request asks the browser for prices it should read off pages. */
export function isPriceTask(intent: string): boolean {
  const text = intent.normalize('NFKC');
  if (!PRICE_ZH_RE.test(text) && !PRICE_EN_RE.test(text)) return false;
  if (MARKET_RE.test(text) && !/商品|产品|手机|电脑|耳机|product|phone|laptop/iu.test(text))
    return false;
  if (WRITING_RE.test(text) || ARITHMETIC_RE.test(text) || OTHER_FIELDS_RE.test(text)) return false;
  return true;
}
