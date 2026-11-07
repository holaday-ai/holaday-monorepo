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
  /价格|价钱|售价|报价|标价|多少钱|几块钱|多少元|卖多少|怎么卖|什么价|到手价|优惠价|促销价|折扣价|库存|有货|现货|缺货|还有货|销量|排名|排行|榜单?|比分|赛果|天气|气温|行情|股价|汇率|币价|\bprices?\b|\bpriced\b|\bcosts?\b|\bhow much\b|\bin stock\b|\bstock levels?\b|\bavailability\b|\brankings?\b|\bscores?\b|\bweather\b|\bexchange rates?\b|\bquotes?\b/i;

/**
 * A price or stock question is a live fact on its own — the thing asked about is for sale
 * somewhere now (「苹果手机多少钱」). Rankings, scores and quotes also need a named site or
 * product, or (复审 #1) the weather, a rate or a quote asked about 「今天 / 现在」.
 */
const PRICE_STOCK_RE =
  /价格|价钱|售价|报价|标价|多少钱|几块钱|多少元|卖多少|怎么卖|什么价|到手价|优惠价|促销价|折扣价|库存|有货|现货|缺货|还有货|\bprices?\b|\bpriced\b|\bcosts?\b|\bhow much\b|\bin stock\b|\bstock levels?\b|\bavailability\b/i;

/**
 * Writing, explaining or planning — not a lookup, even when it mentions a price. 复审 #1: only the
 * request's main clause counts (its first clause, or the one asking the value): 「iPhone 16 Pro 多少钱？
 * 如果买两台要多少」 is a lookup; 「帮我写一段 iPhone 价格的促销文案」 is not. 「怎么样」「怎么卖」 ask a
 * value, they do not ask how.
 */
const WRITING_RE =
  /写(?:一|个|篇|段|首|封|几|条|份)|帮我写|撰写|起草|润色|改写|续写|仿写|文案|作文|海报|广告|标语|口号|宣传语|推文|脚本|翻译|解释|什么是|是什么意思|为什么|为啥|原因|原理|概念|定义|含义|区别|优缺点|怎么定价|如何定价|定价策略|策略|算法|规则|机制|(?:怎么|如何)(?!样|卖)|介绍|总结|概括|营销|方案|规划|模板|举例|例子|示例|假设|攻略|计划|行程|\bwrite\b|\bdraft\b|\btranslate\b|\bexplain\b|\bwhat\s+is\b(?!\s+(?:the\s+)?(?:weather|temperature|forecast|exchange rate|stock price|score|current|latest|price of)\b)|\bwhat\s+does\b.{0,30}\bmean\b|\bwhy\b|\bdefine\b|\bdifference between\b|\bstrategy\b|\bexamples?\b|\bsuppose\b|\bslogan\b|\bcopy\s?writing\b|\bhow (?:to|do|does|can|should)\b/i;

/** The user's own material — 「把以下价格表整理成表格」「附件里的报价」 — is theirs to work on. */
const MATERIAL_RE =
  /附件|附上|(?:以下|如下|下面|下列|上面|上述|这份|这张|这段|我(?:给|发)的)[^，。,.\n]{0,6}?(?:内容|文字|文本|表|数据|清单|列表|信息|材料|报价|价目|价格|商品|链接)|\battach(?:ed|ment)\b|\bthe following\b|\bbelow\b/i;

/** Arithmetic on prices the user gave (「单价 99 元，买 3 个一共多少钱」). */
const CALC_RE =
  /计算|算一下|算算|总价|合计|一共|总共|预算|折后|打完折|加税|含税|平均|\bcalculate\b|\btotal\b|\bbudget\b|\baverage\b/i;
const GIVEN_PRICE_RE =
  /(?:单价|原价|现价|售价|价格)\s*[:：]?\s*\d|\d[\d,]*(?:\.\d+)?\s?(?:元|块|美元|新币|港币)|(?:S\$|US\$|\$|¥|￥|€|£)\s?\d/i;

const clausesOf = (text: string) =>
  text
    .split(/[。！？!?；;\n，,]+/)
    .map((clause) => clause.trim())
    .filter(Boolean);

/** The request asks something other than a lookup: writing, explaining, the user's material, sums. */
function notALookup(text: string, value: string): boolean {
  if (MATERIAL_RE.test(text)) return true;
  if (CALC_RE.test(text) && GIVEN_PRICE_RE.test(text)) return true;
  const clauses = clausesOf(text);
  const main = [clauses[0] ?? '', clauses.find((clause) => clause.includes(value)) ?? ''];
  return main.some((clause) => WRITING_RE.test(clause));
}

/**
 * 复审 #1 必须修 4: the weather, a temperature, an exchange rate, a share price asked about
 * 「今天 / 现在」 is a live fact on its own — no site needs naming (「今天北京天气怎么样」).
 */
const NOW_VALUE_RE =
  /天气|气温|温度|下雨|降雨|下雪|降雪|空气质量|雾霾|汇率|股价|币价|金价|油价|行情|指数|点位|比分|\bweather\b|\btemperature\b|\bforecast\b|\bexchange rates?\b|\bstock price\b|\bscore\b/i;
const NOW_RE =
  /今天|今日|今晚|今早|明天|后天|现在|目前|当前|实时|最新|此刻|眼下|这会儿|刚刚|本周|这周|\bnow\b|\btoday\b|\btonight\b|\btomorrow\b|\bcurrent(?:ly)?\b|\blatest\b/i;

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
  const value = LIVE_VALUE_RE.exec(text)?.[0] ?? NOW_VALUE_RE.exec(text)?.[0];
  if (!value) return null;
  if (notALookup(text, value)) return null;
  const site = namedSite(text) ?? STORE_WORDS_RE.exec(text)?.[0];
  if (site) return { value, subject: site.trim().slice(0, 40) };
  if (namesProduct(text)) return { value, subject: 'product' };
  const price = PRICE_STOCK_RE.exec(text)?.[0];
  if (price) return { value: price, subject: 'price' };
  const now = NOW_VALUE_RE.exec(text)?.[0];
  if (now && NOW_RE.test(text)) return { value: now, subject: 'now' };
  return null;
}
