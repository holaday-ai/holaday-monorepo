/**
 * FIX-58 P0 (诚实红线): an answer that read nothing outside — no web search, no scraped page,
 * no browser page — may not claim a source, and may not give live-looking values.
 *
 * Online tsk_pVJkbLniTrmcPdrjJoRm7 (「亚马逊新加坡站 USB C 线价格」, generate lane, 0 steps)
 * answered five invented products with prices, empty links and 「数据来自 Amazon Singapore
 * 搜索结果页」, and passed. This check is deterministic and lane-agnostic: it reads only the
 * evidence ledger (what was observed), the user's own words and the answer.
 *
 * Fails the task (hard_fail):
 * - the live value the user asked for (`matchLiveFact`: a price, stock, a ranking, the weather, a
 *   rate) given with nothing read;
 * - an answer that says it operated a page (「页面已加载」「数据已提取」「I opened the page」).
 *
 * Fixed in place (复审 #1 建议修, `groundSideMentions`), never a failure on their own:
 * - a source named in passing (「以上信息来自维基百科。」) — the sentence goes;
 * - a live value the user did not ask about, said as current (「故宫目前门票 60 元」 in a travel
 *   plan) — said as an estimate: 「门票约 60 元（以官网为准）」.
 *
 * Values the user gave (their request, their attachments, read whole) are theirs to repeat, and a
 * writing task's example prices (文案、海报、广告) are no claim about the world.
 */
import { matchLiveFact } from '../agent/live-fact.js';
import { namedSite } from '../agent/named-site-search.js';
import type { CheckResult } from './answer-verifier.js';
import type { EvidenceLedger } from './evidence-ledger.js';
import {
  type TaskVerificationContext,
  renderVerificationUserIntent,
} from './task-verification-context.js';

/** Anything read from outside this task: a search result, a scraped page, a browser page. */
export function readSomethingOutside(ledger: EvidenceLedger): boolean {
  return ledger.entries.some(
    (entry) =>
      (entry.sourceType === 'tool_result' || entry.sourceType === 'browser_state') &&
      /https?:\/\//i.test(entry.fact),
  );
}

type UserContext = Pick<TaskVerificationContext, 'initialRequest' | 'userTurns' | 'materials'>;

/** What the user asked: their request and later turns, else the ledger's first user input. */
function userRequest(ledger: EvidenceLedger, context?: UserContext, userIntent?: string): string {
  if (context) return renderVerificationUserIntent(context);
  if (userIntent) return userIntent;
  return ledger.entries.find((entry) => entry.sourceType === 'user_input')?.fact ?? '';
}

/**
 * 复审 #1 必须修 1: everything the user gave, whole — the request, later turns and the full text of
 * every attachment. The ledger's own facts are cut at 500 chars; a price on line 40 of the user's
 * price list is still theirs.
 */
export function userGivenText(
  ledger: EvidenceLedger,
  context?: UserContext,
  userIntent?: string,
): string {
  return [
    userIntent ?? '',
    context ? renderVerificationUserIntent(context) : '',
    ...(context?.materials ?? []).map((material) =>
      material.kind === 'text' ? material.text : '',
    ),
    ledger.userWords,
  ]
    .filter(Boolean)
    .join('\n');
}

/** A site, store, page or search result — not a statistics bureau or a book. */
const SITE_WORDS = String.raw`(?:网站?|站|官网|商城|旗舰店|百科|平台|搜索结果页?|搜索|结果页|商品页|页面|网页|app|App|APP)`;
const NOT_A_SITE_RE = /你|您|用户|上文|以上|上面|题目|材料|附件|文件|表格|对话|提供/;
const NOT_A_SITE_EN_RE =
  /^(?:you|your|my|our|the user|user|above|the above|following|this|these|that|request|instructions?|question|context|conversation|file|attachment|table|budget|recipe|plan|general|common|typical)\b/i;
/** An English name that is a site: a capitalised word, a domain, a known brand or a site word. */
const siteLike = (name: string) =>
  !NOT_A_SITE_EN_RE.test(name) &&
  (/^[A-Z]/.test(name) ||
    /\b[a-z0-9-]+\.[a-z]{2,}\b/i.test(name) ||
    !!namedSite(name) ||
    /\b(?:website|site|store|shop|page|search results?|listing|official)\b/i.test(name));

const SOURCE_CLAIMS: ReadonlyArray<{ re: RegExp; english?: boolean }> = [
  // 「数据来自 Amazon Singapore 搜索结果页」「来源：京东商城」「信息取自淘宝页面」
  {
    re: new RegExp(
      String.raw`(?:来自|来源(?:于|为|是)?\s*[：:]?|取自|摘自|出自|引自)\s*[「“"《\[]?\s*((?:[A-Za-z][\w.&'-]*(?:\s+[A-Za-z][\w.&'-]*){0,4})|(?:[一-龥A-Za-z0-9.]{1,16}?${SITE_WORDS}))`,
      'u',
    ),
  },
  // 「根据京东的搜索结果」「根据亚马逊页面」
  {
    re: /(?:根据|依据|参考|查询)\s*[「“"]?([一-龥A-Za-z0-9 .&-]{1,20}?)的?(?:搜索结果|页面|官网|网站|商品页|结果页|实时数据|实时价格)/u,
  },
  // 复审 #1 必须修 6: 「according to amazon singapore」 in lower case too.
  {
    re: /\baccording to\s+(?:the\s+)?([\w.&'-]+(?:\s+[\w.&'-]+){0,3})/iu,
    english: true,
  },
  {
    re: /\b(?:data|prices?|information|results?)\s+(?:is\s+|are\s+)?(?:from|sourced from|taken from)\s+(?:the\s+)?([\w.&'-]+(?:\s+[\w.&'-]+){0,3})/iu,
    english: true,
  },
  { re: /\bsources?\s*:\s*([A-Za-z][\w.-]{2,})/iu, english: true },
];

/**
 * 复审 #1 必须修 5: an answer that says it operated a page with no page read — 「页面已加载」
 * 「已打开网页」「数据已提取」「I opened the page」. Telling the user what to open is no claim.
 */
const PRETENDED_OPERATION_RES: readonly RegExp[] = [
  /页面已(?:经)?(?:成功)?(?:加载|打开|载入)/u,
  /已(?:经)?(?:成功)?(?:打开|访问|浏览|加载|载入|抓取|爬取)(?:了)?[^，。,\n]{0,16}?(?:网页|页面|网站|链接|官网|商品页|搜索结果|结果页)/u,
  /数据已(?:经)?(?:成功)?(?:提取|抓取|获取|采集)|已(?:经)?(?:成功)?(?:提取|抓取|采集)(?:了)?(?:页面|网页)?(?:上的)?数据/u,
  /我(?:刚刚?|刚才|已经?)?(?:打开|访问|浏览)了[^，。,\n]{0,10}?(?:网页|页面|网站|官网|链接|商品页)/u,
  /\bI(?:'ve| have)?\s+(?:just\s+)?(?:opened|visited|browsed|loaded|scraped)\s+(?:the\s+)?(?:[\w.-]+\s+){0,3}?(?:page|site|website|link|listing|search results)\b/iu,
  /\b(?:the\s+)?(?:page|data|website)\s+(?:has been|was|is)\s+(?:successfully\s+)?(?:loaded|opened|extracted|scraped)\b/iu,
];

/** A price with a currency (「S$12.45」「SGD 11.52」「12.9 元」「"price": 12.90」). */
const PRICE_RE =
  /(?:S\$|US\$|HK\$|NT\$|A\$|C\$|RM|\$|¥|￥|€|£|₩)\s?\d[\d,]*(?:\.\d+)?|\b(?:SGD|USD|RMB|CNY|HKD|EUR|GBP|JPY|MYR|TWD)\s?\d[\d,]*(?:\.\d+)?|\d[\d,]*(?:\.\d+)?\s?(?:元|块钱|美元|新币|新元|港币|港元|日元|欧元|英镑|人民币)|"price"\s*:\s*"?\d[\d,]*(?:\.\d+)?/giu;
/** 复审 #1 必须修 4: a temperature (「12℃」「气温 12 度」「54°F」) — never 「5 度电」「30 度角」. */
const TEMPERATURE_RE =
  /-?\d+(?:\.\d+)?\s?(?:℃|°\s?[CF]?|摄氏度|华氏度|度(?![电角数量的]))|\b-?\d+(?:\.\d+)?\s?degrees?\b/giu;
/** An exchange rate or a quote (「汇率 7.12」「USD/CNY 7.12」「1 美元兑 7.1 元」「股价 1680.5」). */
const RATE_RE =
  /(?:汇率|兑换?)[^\n。，,]{0,10}?\d+(?:\.\d+)?|\b[A-Z]{3}\s?\/\s?[A-Z]{3}\s?[:：=]?\s?\d+(?:\.\d+)?|(?:股价|收盘价?|开盘价?|现价|最新价|报价)\s*[:：]?\s*\d+(?:\.\d+)?|\bexchange rate[^\n.]{0,12}?\d+(?:\.\d+)?/giu;
/** Stock or availability (「库存 22」「有货」「In stock (20 available)」). */
const STOCK_RE =
  /库存\s*[:：]?\s*\d+|(?<![没无])有货|现货|仅剩\s*\d+|\bin stock\b|\b\d+\s+available\b/iu;
/** A live ranking (「排名第 3」「榜单第 1」「#2 in Electronics」). */
const RANK_RE = /(?:排名|排行|榜)[^\n。]{0,8}第\s*\d+|(?:#|No\.)\s?\d+\s+in\b|\branked\s+#?\d+/iu;

/** The answer itself says the value is current. */
const CURRENT_CN_RE = /实时|当前|目前|现价|现在|今日|今天|最新/u;
const CURRENT_EN_RE =
  /\bcurrently\b|\bright now\b|\bas of (?:today|now|this (?:week|month|morning))\b|\btoday\b|\bat the moment\b|\blive\b|\blatest\b/iu;
const ESTIMATE_RE =
  /约|大约|左右|预计|估计|参考|大概|以官网为准|以实时预报为准|\babout\b|\baround\b|\bapprox|\broughly\b|\btypically\b|\busually\b|\bestimated?\b|\bexpected\b/iu;
/** Sentence ends; a decimal point (「9.99」) is none. */
const SENTENCE_END_RE = /[。！？!?\n]|\.(?!\d)/gu;

function sentenceAround(text: string, at: number, length: number): { start: number; end: number } {
  let start = 0;
  for (const m of text.slice(0, at).matchAll(SENTENCE_END_RE)) start = m.index + m[0].length;
  const rest = text.slice(at + length);
  const next = rest.search(/[。！？!?\n]|\.(?!\d)/u);
  const end = next < 0 ? text.length : at + length + next + 1;
  return { start, end };
}

/**
 * 「目前售价 ¥7999」 — a current word right before the value; in English (复审 #1 必须修 6)
 * anywhere in its sentence (「The price is currently listed at $999」「$999 as of today」). An
 * estimate (「约」「about」) is no claim.
 */
function currentAt(answer: string, at: number, length: number): boolean {
  const before = answer.slice(Math.max(0, at - 14), at);
  if (CURRENT_CN_RE.test(before) && !ESTIMATE_RE.test(before)) return true;
  const { start, end } = sentenceAround(answer, at, length);
  const sentence = answer.slice(start, end);
  return CURRENT_EN_RE.test(sentence) && !ESTIMATE_RE.test(sentence);
}

const digitsOf = (text: string) => text.replace(/[^\d.]/g, '').replace(/^\.+|\.+$/g, '');

/** The first source claim naming a site or page, or null. */
export function sourceClaim(answer: string): string | null {
  return sourceClaimMatch(answer)?.text ?? null;
}

function sourceClaimMatch(answer: string): { text: string; at: number } | null {
  for (const { re, english } of SOURCE_CLAIMS) {
    const m = re.exec(answer);
    const named = m?.[1]?.trim();
    if (!m || !named || NOT_A_SITE_RE.test(named)) continue;
    if (english && !siteLike(named)) continue;
    return { text: m[0].trim().slice(0, 60), at: m.index };
  }
  return null;
}

/** The first claim to have operated a page, or null. */
export function pretendedOperation(answer: string): string | null {
  for (const re of PRETENDED_OPERATION_RES) {
    const m = re.exec(answer);
    if (m) return m[0].trim().slice(0, 60);
  }
  return null;
}

interface LiveValue {
  text: string;
  at: number;
}

function liveValueMatches(answer: string, given: string): LiveValue[] {
  const givenDigits = new Set(
    [...given.matchAll(/\d[\d,]*(?:\.\d+)?/g)].map((m) => digitsOf(m[0])).filter(Boolean),
  );
  const out: LiveValue[] = [];
  for (const re of [PRICE_RE, TEMPERATURE_RE, RATE_RE]) {
    for (const m of answer.matchAll(re)) {
      const digits = digitsOf(m[0]);
      if (!digits || givenDigits.has(digits)) continue;
      // A rate's digits inside a price already listed.
      if (out.some((value) => m.index >= value.at && m.index < value.at + value.text.length))
        continue;
      out.push({ text: m[0].trim(), at: m.index });
    }
  }
  for (const re of [STOCK_RE, RANK_RE]) {
    const m = re.exec(answer);
    if (m && !given.includes(m[0])) out.push({ text: m[0], at: m.index });
  }
  return out.sort((a, b) => a.at - b.at);
}

/** Live-looking values in the answer the user did not give. */
export function unbackedLiveValues(answer: string, given: string): string[] {
  return [...new Set(liveValueMatches(answer, given).map((value) => value.text))];
}

/** 文案、海报、广告: the model's example prices are no claim about the world. */
const WRITING_TASK_RE =
  /文案|海报|广告|宣传|促销|推文|标语|口号|朋友圈|slogan|\bad copy\b|\bposter\b|\bcopy\s?writing\b|\bmarketing copy\b|\badvert/i;

/**
 * 复审 #2 必须修 2: a story, a script, a poem, copy — its characters open pages (「他已经打开了网页…」
 * 「I opened the page…」) and nobody claims to have done so.
 */
const CREATIVE_TASK_RE =
  /小说|故事|剧本|剧情|情节|台词|童话|寓言|散文|诗|歌词|段子|小品|相声|文案|海报|广告|\bstor(?:y|ies)\b|\bscripts?\b|\bscreenplay\b|\bpoems?\b|\bpoetry\b|\blyrics\b|\bfiction\b|\bnovel\b|\bfable\b|\b(?:ad|marketing|sales|product)\s+copy\b|\bcopy\b(?!\s+(?:the|this|that|these|those|it|from|of|and)\b)|\bposter\b/i;

interface Assessment {
  pretend: string | null;
  /** The live values the user asked for, invented. */
  asked: string[];
  claim: { text: string; at: number } | null;
  /** Live values said on the side as current. */
  side: LiveValue[];
}

function assess(answerText: string, request: string, given: string): Assessment {
  const pretend = CREATIVE_TASK_RE.test(request) ? null : pretendedOperation(answerText);
  const values = liveValueMatches(answerText, given);
  const asksLive = !!matchLiveFact(request);
  const writing = WRITING_TASK_RE.test(request);
  const claimed = sourceClaimMatch(answerText);
  return {
    pretend: pretend && !given.includes(pretend) ? pretend : null,
    asked: asksLive ? [...new Set(values.map((value) => value.text))] : [],
    claim: claimed && !given.includes(claimed.text) ? claimed : null,
    side:
      asksLive || writing
        ? []
        : values.filter((value) => currentAt(answerText, value.at, value.text.length)),
  };
}

export function checkUngroundedLiveClaims(input: {
  answerText: string;
  ledger: EvidenceLedger;
  /** The user's own words when the ledger does not carry them (core executions). */
  userIntent?: string;
  /** The task's whole request and attachments, when the lane has them. */
  verificationContext?: UserContext;
}): CheckResult | null {
  const { answerText, ledger } = input;
  if (!answerText.trim() || readSomethingOutside(ledger)) return null;
  const request = userRequest(ledger, input.verificationContext, input.userIntent);
  const given = userGivenText(ledger, input.verificationContext, input.userIntent);
  const found = assess(answerText, request, given);
  const failed = (criterionId: string, detail: string, fixable = false): CheckResult => ({
    criterionId,
    criterionType: 'ungrounded_live_claim',
    passed: false,
    checker: 'deterministic',
    severity: fixable ? 'fixable' : 'hard_fail',
    detail,
  });
  if (found.pretend) {
    return failed(
      'generic.pretended_operation',
      `本次没有打开或读取任何页面，答案却说操作过：「${found.pretend}」`,
    );
  }
  if (found.asked.length) {
    return failed(
      'generic.ungrounded_live_values',
      `本次没有读到任何外部页面，答案却给出了实时数值：${found.asked.slice(0, 4).join('、')}${found.claim ? `，还声称了来源「${found.claim.text}」` : ''}`,
    );
  }
  if (found.claim || found.side.length) {
    return failed(
      'generic.ungrounded_side_mention',
      [
        found.claim ? `顺口提到的来源「${found.claim.text}」没有读过，删掉这一句` : '',
        found.side.length
          ? `顺带提到的实时数 ${found.side
              .map((value) => value.text)
              .slice(0, 4)
              .join('、')} 没有读过，改成估计值`
          : '',
      ]
        .filter(Boolean)
        .join('；'),
      true,
    );
  }
  return null;
}

/** The sentence holding `at`, removed with its trailing space. */
function withoutSentenceAt(text: string, at: number): string {
  const { start, end } = sentenceAround(text, at, 1);
  const cut = `${text.slice(0, start)}${text.slice(end).replace(/^[ \t]+/, '')}`;
  return cut.replace(/\n{3,}/g, '\n\n').trim();
}

/** 「故宫目前门票 60 元」 → 「故宫门票约 60 元（以官网为准）」; English 「about $999 (check the official site)」. */
function asEstimate(text: string, value: LiveValue): string {
  const english = !/[一-龥]/u.test(text);
  const weather = /℃|°|度|degree/iu.test(value.text);
  const said = english
    ? `about ${value.text} (${weather ? 'check a live forecast' : 'check the official site'})`
    : `约 ${value.text}（${weather ? '以实时预报为准' : '以官网为准'}）`;
  const windowStart = Math.max(0, value.at - 14);
  const before = text
    .slice(windowStart, value.at)
    .replace(/目前|当前|实时|最新/u, '')
    .replace(/(?<=[一-龥])[ \t]+$/u, '');
  return `${text.slice(0, windowStart)}${before}${said}${text.slice(value.at + value.text.length)}`;
}

/**
 * 复审 #1 建议修: the in-place fix for `generic.ungrounded_side_mention` — a source named in
 * passing goes with its sentence, a live value said on the side becomes an estimate. Nothing is
 * invented; an answer with nothing to fix comes back as it was.
 */
export function groundSideMentions(input: {
  answerText: string;
  ledger: EvidenceLedger;
  userIntent?: string;
  verificationContext?: UserContext;
}): { text: string; removed: string[]; estimated: string[] } {
  let text = input.answerText;
  const removed: string[] = [];
  const estimated: string[] = [];
  if (readSomethingOutside(input.ledger)) return { text, removed, estimated };
  const request = userRequest(input.ledger, input.verificationContext, input.userIntent);
  const given = userGivenText(input.ledger, input.verificationContext, input.userIntent);
  for (let round = 0; round < 24; round += 1) {
    const found = assess(text, request, given);
    if (found.pretend || found.asked.length) break;
    if (found.claim) {
      removed.push(found.claim.text);
      text = withoutSentenceAt(text, found.claim.at);
      continue;
    }
    const [value] = found.side.slice(-1);
    if (!value) break;
    estimated.push(value.text);
    text = asEstimate(text, value);
  }
  return { text, removed, estimated };
}
