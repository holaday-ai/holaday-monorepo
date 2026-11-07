/**
 * FIX-58 P0 (线上 tsk_pVJkbLniTrmcPdrjJoRm7): 「亚马逊新加坡站 USB C 线价格」 went to generate,
 * read nothing, and answered with five invented products and prices as 「完成」.
 *
 * A live fact is a value that changes — a price, stock, a ranking, a score, the weather, a
 * quote — asked about a named site or store, or a concrete product. It is never answered
 * from memory: the router sends it to the browser, and the verifier rejects live values
 * that no read page backs (see `checkUngroundedLiveClaims`).
 */
import { namedSite } from './named-site-search.js';

/** A value that changes over time. */
export const LIVE_VALUE_RE =
  /价格|价钱|售价|报价|标价|多少钱|几块钱|多少元|卖多少|什么价|到手价|优惠价|促销价|折扣价|库存|有货|现货|缺货|还有货|销量|排名|排行|榜单?|比分|赛果|天气|气温|行情|股价|汇率|币价|\bprices?\b|\bpriced\b|\bcosts?\b|\bhow much\b|\bin stock\b|\bstock levels?\b|\bavailability\b|\brankings?\b|\bscores?\b|\bweather\b|\bexchange rates?\b|\bquotes?\b/i;

/**
 * A price or stock question is a live fact on its own — the thing asked about is for sale
 * somewhere now (「苹果手机多少钱」). Rankings, scores, weather and quotes also need a named
 * site or product: 「上证指数现在多少点」「新加坡今天天气」 keep their own search road.
 */
const PRICE_STOCK_RE =
  /价格|价钱|售价|报价|标价|多少钱|几块钱|多少元|卖多少|什么价|到手价|优惠价|促销价|折扣价|库存|有货|现货|缺货|还有货|\bprices?\b|\bpriced\b|\bcosts?\b|\bhow much\b|\bin stock\b|\bstock levels?\b|\bavailability\b/i;

/** Writing, explaining or planning — not a lookup, even when it mentions a price. */
const NOT_A_LOOKUP_RE =
  /写(?:一|个|篇|段|首|封|几|条)|帮我写|撰写|起草|润色|改写|续写|文案|作文|翻译|解释|什么是|是什么意思|为什么|为啥|原因|原理|概念|定义|含义|区别|对比一下.{0,6}优缺点|怎么定价|如何定价|定价策略|策略|算法|规则|机制|怎么|如何|介绍|总结|概括|下面这段|以下|如下|营销|方案|规划|模板|举例|例子|假设|如果|计算|算一下|算算|总价|合计|一共|预算|\bwrite\b|\bdraft\b|\btranslate\b|\bexplain\b|\bwhat\s+is\b|\bwhat\s+does\b.{0,30}\bmean\b|\bwhy\b|\bdefine\b|\bdifference between\b|\bstrategy\b|\bexample\b|\bsuppose\b|\bif\b|\bcalculate\b|\bbudget\b/i;

/** A store or site named in other words: 「XX站」「XX商城」「XX旗舰店」「XX官网」, a domain, 「on/at <Store>」. */
const STORE_WORDS_RE =
  /[一-龥A-Za-z0-9]{1,12}(?:站|商城|旗舰店|官方店|官网|专卖店)|\b[a-z0-9-]+\.(?:com|cn|sg|co|jp|net|hk|tw|uk|de|my)\b|\b(?:on|at|from)\s+[A-Z][\w.&-]+/;

/**
 * A concrete product: a Latin model or brand word inside a Chinese request (「iPhone 16 Pro」
 * 「USB C 线」「Anker」), or a model number (「RTX 4090」「Galaxy S24」「Mate 60」).
 */
function namesProduct(text: string): boolean {
  if (/[A-Za-z]{1,12}[\s-]?\d{1,5}\b/.test(text)) return true;
  const han = /[一-龥]/.test(text);
  return han && /[A-Za-z]{2,}/.test(text);
}

/**
 * 「亚马逊新加坡站 USB C 线价格」「京东 iPhone 16 Pro 多少钱」「USB C cable price on Amazon
 * Singapore」 — the matched value word and where, or null. 「帮我写一段介绍 USB C 线的文案」
 * 「解释一下什么是 PD 快充」 are not.
 */
export function matchLiveFact(text: string): { value: string; subject: string } | null {
  const value = LIVE_VALUE_RE.exec(text)?.[0];
  if (!value) return null;
  if (NOT_A_LOOKUP_RE.test(text)) return null;
  const site = namedSite(text) ?? STORE_WORDS_RE.exec(text)?.[0];
  if (site) return { value, subject: site.trim().slice(0, 40) };
  if (namesProduct(text)) return { value, subject: 'product' };
  const price = PRICE_STOCK_RE.exec(text)?.[0];
  if (price) return { value: price, subject: 'price' };
  return null;
}
