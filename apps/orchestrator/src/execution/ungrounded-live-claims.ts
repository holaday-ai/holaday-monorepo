/**
 * FIX-58 P0 (诚实红线): an answer that read nothing outside — no web search, no scraped page,
 * no browser page — may not claim a source, and may not give live-looking values.
 *
 * Online tsk_pVJkbLniTrmcPdrjJoRm7 (「亚马逊新加坡站 USB C 线价格」, generate lane, 0 steps)
 * answered five invented products with prices, empty links and 「数据来自 Amazon Singapore
 * 搜索结果页」, and passed. This check is deterministic and lane-agnostic: it reads only the
 * evidence ledger (what was observed) and the answer.
 *
 * - A source claim (「数据来自 X」「来源：X」「根据 X 的搜索结果」「according to X」) naming a
 *   site, store, page or search result fails whenever nothing was read.
 * - Prices, stock and live rankings fail when nothing was read and the user asked a live fact
 *   (`matchLiveFact`) or the answer itself presents them as current. Values the user gave
 *   (「原价 199 现价 99 帮我写文案」) are theirs to repeat.
 */
import { matchLiveFact } from '../agent/live-fact.js';
import type { CheckResult } from './answer-verifier.js';
import type { EvidenceLedger } from './evidence-ledger.js';

/** Anything read from outside this task: a search result, a scraped page, a browser page. */
export function readSomethingOutside(ledger: EvidenceLedger): boolean {
  return ledger.entries.some(
    (entry) =>
      (entry.sourceType === 'tool_result' || entry.sourceType === 'browser_state') &&
      /https?:\/\//i.test(entry.fact),
  );
}

/** A site, store, page or search result — not a statistics bureau or a book. */
const SITE_WORDS = String.raw`(?:网站?|站|官网|商城|旗舰店|百科|平台|搜索结果页?|搜索|结果页|商品页|页面|网页|app|App|APP)`;
const NOT_A_SITE_RE = /你|您|用户|上文|以上|上面|题目|材料|附件|文件|表格|对话|提供/;
const SOURCE_CLAIM_RES: readonly RegExp[] = [
  // 「数据来自 Amazon Singapore 搜索结果页」「来源：京东商城」「信息取自淘宝页面」
  new RegExp(
    String.raw`(?:来自|来源(?:于|为|是)?\s*[：:]?|取自|摘自|出自|引自)\s*[「“"《\[]?\s*((?:[A-Za-z][\w.&'-]*(?:\s+[A-Za-z][\w.&'-]*){0,4})|(?:[一-龥A-Za-z0-9.]{1,16}?${SITE_WORDS}))`,
    'u',
  ),
  // 「根据京东的搜索结果」「根据亚马逊页面」
  /(?:根据|依据|参考|查询)\s*[「“"]?([一-龥A-Za-z0-9 .&-]{1,20}?)的?(?:搜索结果|页面|官网|网站|商品页|结果页|实时数据|实时价格)/u,
  /\b[Aa]ccording to\s+(?:the\s+)?((?:[A-Z][\w.&-]*|[a-z0-9-]+\.[a-z]{2,})(?:\s+[A-Z][\w.&-]*){0,3})/u,
  /\b(?:[Dd]ata|[Pp]rices?|[Ii]nformation|[Rr]esults?)\s+(?:is\s+|are\s+)?(?:from|sourced from|taken from)\s+(?:the\s+)?([A-Z][\w.&-]*(?:\s+[A-Z][\w.&-]*){0,3}|[a-z0-9-]+\.[a-z]{2,})/u,
  /\bsources?\s*:\s*([A-Za-z][\w.-]{2,})/iu,
];

/** A price with a currency (「S$12.45」「SGD 11.52」「12.9 元」「"price": 12.90」). */
const PRICE_RE =
  /(?:S\$|US\$|HK\$|NT\$|A\$|C\$|RM|\$|¥|￥|€|£|₩)\s?\d[\d,]*(?:\.\d+)?|\b(?:SGD|USD|RMB|CNY|HKD|EUR|GBP|JPY|MYR|TWD)\s?\d[\d,]*(?:\.\d+)?|\d[\d,]*(?:\.\d+)?\s?(?:元|块钱|美元|新币|新元|港币|港元|日元|欧元|英镑)|"price"\s*:\s*"?\d[\d,]*(?:\.\d+)?/giu;
/** Stock or availability (「库存 22」「有货」「In stock (20 available)」). */
const STOCK_RE =
  /库存\s*[:：]?\s*\d+|(?<![没无])有货|现货|仅剩\s*\d+|\bin stock\b|\b\d+\s+available\b/iu;
/** A live ranking (「排名第 3」「榜单第 1」「#2 in Electronics」). */
const RANK_RE = /(?:排名|排行|榜)[^\n。]{0,8}第\s*\d+|(?:#|No\.)\s?\d+\s+in\b|\branked\s+#?\d+/iu;
/** The answer itself says the value is current. */
const PRESENTED_AS_CURRENT_RE =
  /实时|当前|目前|现价|现在|今日|今天|最新|\bcurrently\b|\bright now\b|\btoday\b|\blive\b|\blatest\b/iu;

/** 「目前售价 ¥7999」 — a current-word right before the value, not an estimate (「约」「预计」). */
function presentedAsCurrent(answer: string, value: string): boolean {
  let at = answer.indexOf(value);
  while (at >= 0) {
    const before = answer.slice(Math.max(0, at - 14), at);
    if (
      PRESENTED_AS_CURRENT_RE.test(before) &&
      !/约|大约|左右|预计|估计|参考|大概|\babout\b|\baround\b|\bapprox/i.test(before)
    )
      return true;
    at = answer.indexOf(value, at + value.length);
  }
  return false;
}

const digitsOf = (text: string) => text.replace(/[^\d.]/g, '').replace(/^\.+|\.+$/g, '');

function userText(ledger: EvidenceLedger, extra: string): string {
  return [
    extra,
    ...ledger.entries
      .filter((entry) => entry.sourceType === 'user_input' || entry.sourceType === 'file_parse')
      .map((entry) => entry.fact),
  ].join('\n');
}

/** The first source claim naming a site or page, or null. */
export function sourceClaim(answer: string): string | null {
  for (const re of SOURCE_CLAIM_RES) {
    const m = re.exec(answer);
    const named = m?.[1]?.trim();
    if (!m || !named || NOT_A_SITE_RE.test(named)) continue;
    return m[0].trim().slice(0, 60);
  }
  return null;
}

/** Live-looking values in the answer the user did not give. */
export function unbackedLiveValues(answer: string, given: string): string[] {
  const givenDigits = new Set(
    [...given.matchAll(/\d[\d,]*(?:\.\d+)?/g)].map((m) => digitsOf(m[0])).filter(Boolean),
  );
  const out: string[] = [];
  for (const m of answer.matchAll(PRICE_RE)) {
    if (!givenDigits.has(digitsOf(m[0]))) out.push(m[0].trim());
  }
  const stock = STOCK_RE.exec(answer)?.[0];
  if (stock && !given.includes(stock)) out.push(stock);
  const rank = RANK_RE.exec(answer)?.[0];
  if (rank && !given.includes(rank)) out.push(rank);
  return [...new Set(out)];
}

export function checkUngroundedLiveClaims(input: {
  answerText: string;
  ledger: EvidenceLedger;
  /** The user's own words when the ledger does not carry them (core executions). */
  userIntent?: string;
}): CheckResult | null {
  const { answerText, ledger } = input;
  if (!answerText.trim() || readSomethingOutside(ledger)) return null;
  const given = userText(ledger, input.userIntent ?? '');
  const claim = sourceClaim(answerText);
  if (claim && !given.includes(claim)) {
    return {
      criterionId: 'generic.ungrounded_source_claim',
      criterionType: 'ungrounded_live_claim',
      passed: false,
      checker: 'deterministic',
      severity: 'hard_fail',
      detail: `本次没有读到任何外部页面，答案却声称了来源：「${claim}」`,
    };
  }
  const asksLive = !!matchLiveFact(given);
  const values = asksLive
    ? unbackedLiveValues(answerText, given)
    : unbackedLiveValues(answerText, given).filter((value) =>
        presentedAsCurrent(answerText, value),
      );
  if (values.length) {
    return {
      criterionId: 'generic.ungrounded_live_values',
      criterionType: 'ungrounded_live_claim',
      passed: false,
      checker: 'deterministic',
      severity: 'hard_fail',
      detail: `本次没有读到任何外部页面，答案却给出了实时数值：${values.slice(0, 4).join('、')}`,
    };
  }
  return null;
}
