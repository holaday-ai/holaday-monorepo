import type { UiStep, UiTask } from '@/types/task';
import { friendlyHost } from '@/utils/step-humanize';
import { isEnglishRequestText } from '@holaday/shared-types';
/**
 * FIX-57 — the task page reads like a chat with your own assistant.
 *
 * Pure copy helpers for the conversational task turn:
 *   - one live status line generated from the step events (「正在打开东方财富…」),
 *   - the quiet 「参考了 N 个来源 · 查看过程」 footer,
 *   - a failed run told as an assistant message (what is missing, where it got stuck,
 *     what I can do next) with 1–3 options to pick,
 *   - next steps (assistant voice + the instruction each one sends).
 *
 * Honesty is not relaxed: the status and scoring stay what the server recorded; a
 * failed or partial run always says, in plain words, what it did not get.
 */
import { assertedFailureText } from './browser-error-kind';
import { classifyFriendlyFailure } from './failure-copy';

/**
 * Internal references and provider names never reach the person. They are replaced with
 * plain words (复审 #1-3) so the sentence still reads: 「在 tab_2 上点击 e123 没有反应」 →
 * 「在页面上点击那个按钮没有反应」. Web addresses are left alone (their `ref=` is the site's).
 */
const TOOL_READ = '(?:read_page|get_page_text|read_url)';
const TOOL_SEARCH = '(?:web_search)';
const TOOL_ACT =
  '(?:click_ref|type_in_ref|press_key|wait_for|switch_tab|list_tabs|request_human|scroll_until)';
/** 复审 #4: a tool name with an underscore (read_page, web_search…) is always replaced,
 * whatever is around it, together with its call parentheses. */
const toolAlways = (names: string, to: string): Array<[RegExp, string]> => [
  [new RegExp(`\\b${names}\\b(?:\\s*\\([^)]*\\))?`, 'g'), to],
];
/** 复审 #3: an ordinary English word used as a tool name (snapshot) only where it is used
 * as one — 「调用 snapshot」, 「snapshot(…)」, or opening a sentence before Chinese;
 * 「读取 snapshot 结果」 stays as written. */
const TOOL_WORD = '(?:snapshot)';
const toolInContext = (names: string, to: string): Array<[RegExp, string]> => [
  [
    new RegExp(`(调用|工具|通过|执行|使用)\\s*(?:了\\s*)?${names}\\b(?:\\s*\\([^)]*\\))?`, 'g'),
    `$1${to}`,
  ],
  [new RegExp(`\\b${names}\\s*\\([^)]*\\)`, 'g'), to],
  [new RegExp(`(^|[。；;\\n]\\s*)${names}(?=\\s*[\\u4e00-\\u9fa5])`, 'g'), `$1${to}`],
];
const REF_REPLACEMENTS: ReadonlyArray<[RegExp, string]> = [
  [/\[?\bref\s*=\s*e?\d+\]?/gi, ''],
  [/\btab_[\w-]+/gi, '页面'],
  [/\bframe_[\w-]+/gi, '内嵌框'],
  // 复审 #3: element ids only after a click or an input — 「Friends s1e2」 stays.
  [/(点击|输入|点)\s*(?:了\s*)?s\d+e\d{1,6}\b/g, '$1那个元素'],
  [/(点击|输入|点)\s*(?:了\s*)?e\d{1,6}\b/g, '$1那个按钮'],
  ...toolAlways(TOOL_READ, '读取页面'),
  ...toolAlways(TOOL_SEARCH, '搜索'),
  ...toolAlways(TOOL_ACT, '操作'),
  ...toolInContext(TOOL_WORD, '读取页面'),
  [/\b(?:firecrawl|brave(?:\s+search)?|playwright|browserbase|tavily|serpapi)\b/gi, ''],
  [/\b(?:dashscope|anthropic|openai|qwen[\w.-]*|claude[\w.-]*|gpt-[\w.-]+)\b/gi, ' AI '],
  [/通义千问|千问|通义|百炼/g, ' AI '],
  // 协调方第 2 次代体验: data-source interface names (akshare:stock_zh_index_spot_sina).
  [/\s*[（(][^（）()\n]*akshare[^（）()\n]*[）)]/gi, ''],
  [/\bakshare(?::[\w.+]+)?/gi, '公开行情数据'],
  [/\b(?:stock|index|fund|bond)_[a-z0-9_]+\b/gi, ''],
  [/\b[a-z0-9]+_(?:sina|em|ths)\b/gi, ''],
  [/\bsina\s*接口/gi, '新浪财经'],
];
const URL_SPLIT_RE = /(https?:\/\/[^\s)\]>"'，。）]+)/g;

export function stripInternalRefs(text: string): string {
  return text
    .split(URL_SPLIT_RE)
    .map((part, i) => {
      if (i % 2 === 1) return part;
      let out = part;
      for (const [re, to] of REF_REPLACEMENTS) out = out.replace(re, to);
      return out;
    })
    .join('')
    .replace(/[（(]\s*[)）]/g, '')
    .replace(/([\u4e00-\u9fa5，。、])\s+(?=[\u4e00-\u9fa5，。、])/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/** True when text (outside its web addresses) names an internal ref or a provider. */
export function hasInternalRef(text: string): boolean {
  const outside = text.replace(URL_SPLIT_RE, ' ');
  return REF_REPLACEMENTS.some(([re]) =>
    new RegExp(re.source, re.flags.replace('g', '')).test(outside),
  );
}

/** 复审 #1-1c: a bare long address shown as a link reads as the site's short name. */
export function shortLinkLabel(text: string, href: string): string {
  const t = text.trim();
  if (!/^(?:https?:\/\/|www\.)/i.test(t) || t.length <= 30) return text;
  const host = hostOf(href) ?? hostOf(t.startsWith('www.') ? `https://${t}` : t);
  return host ? siteLabel(host).trim() : text;
}

function hostOf(url: string | undefined | null): string | null {
  if (!url) return null;
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    return host || null;
  } catch {
    return null;
  }
}

const MORE_SITES: ReadonlyArray<[RegExp, string]> = [
  [/(^|\.)m\.jd\.com$/, '京东手机版'],
  [/(^|\.)baike\.baidu\.com$/, '百度百科'],
  [/(^|\.)map\.baidu\.com$/, '百度地图'],
  [/(^|\.)zhihu\.com$/, '知乎'],
  [/(^|\.)amap\.com$/, '高德地图'],
  [/(^|\.)amazon\.[a-z.]+$/, '亚马逊'],
  [/(^|\.)y\.qq\.com$/, 'QQ 音乐'],
  [/(^|\.)sohu\.com$/, '搜狐'],
  [/(^|\.)sina\.com(\.cn)?$/, '新浪'],
  [/(^|\.)163\.com$/, '网易'],
  [/(^|\.)investing\.com$/, '英为财情'],
  [/(^|\.)10jqka\.com\.cn$/, '同花顺'],
  [/(^|\.)youtube\.com$/, 'YouTube'],
  [/(^|\.)wikipedia\.org$/, '维基百科'],
  [/(^|\.)smzdm\.com$/, '什么值得买'],
];

/** A site's name for a sentence: 东方财富 / 知乎, or the bare host spaced off. */
export function siteLabel(host: string): string {
  const h = host.replace(/^www\./, '').toLowerCase();
  const named = MORE_SITES.find(([re]) => re.test(h))?.[1] ?? friendlyHost(h);
  return /[\u4e00-\u9fa5]/.test(named) ? named : ` ${named} `;
}

/** The site a step sequence is on: the latest `打开 <url>` navigate. */
export function currentSiteLabel(steps: readonly UiStep[]): string | null {
  for (let i = steps.length - 1; i >= 0; i--) {
    const step = steps[i];
    if (step?.actionKind !== 'navigate') continue;
    const url = step.actionSummary?.match(/https?:\/\/\S+/)?.[0];
    const host = hostOf(url);
    if (host) return siteLabel(host);
  }
  return null;
}

const READ_KINDS = new Set([
  'snapshot',
  'read_page',
  'get_page_text',
  'get_text',
  'sections',
  'find',
  'links',
  'screenshot',
  'observe',
]);

/** A visible label from a step summary (「点击 搜索」), never a bare ref id. */
/** 复审 #6: accessibility roles and tag names (「generic」) are not something a person sees. */
const ROLE_WORD =
  '(?:generic|div|span|img|image|link|button|listitem|list|option|menuitem|menu|checkbox|radio|textbox|combobox|searchbox|heading|paragraph|section|article|region|group|cell|row|gridcell|tab|svg|path|a|li|ul|input|label|none|presentation|main|navigation|banner|figure|StaticText|元素|节点)';
// DEPLOY-57 第 0 步 6: a target that is only a role word (「Menu」 too) is never quoted.
const ROLE_ONLY_RE = new RegExp(`^${ROLE_WORD}$`, 'i');
// 复审 #7: only a lowercase role word, or one right before a quote — 「Main Street 店」 stays.
const ROLE_PREFIX_RE = new RegExp(
  `^(?:(?=[a-z])${ROLE_WORD}\\s*[:：]?\\s+(?=\\S)|${ROLE_WORD}\\s*[:：]?\\s*(?=["'「“]))`,
);

function stepTarget(summary: string | undefined, prefix: RegExp): string | null {
  const raw = summary
    ?.replace(prefix, '')
    .trim()
    .replace(ROLE_PREFIX_RE, '')
    .replace(/^["'「“]+|["'」”]+$/g, '')
    .trim();
  if (!raw || ROLE_ONLY_RE.test(raw)) return null;
  if (/^(?:e|ref|s\d*e)\d+$/i.test(raw) || /ref=|tab_|frame_/.test(raw)) return null;
  const clean = stripInternalRefs(raw).replace(/^「|」$/g, '');
  return clean && clean.length <= 18 ? clean : null;
}

/**
 * The one live status line while the task runs, from the latest step (and the site
 * it is on). Plain words, no tool names, no internal references.
 */
export function liveStatusText(input: {
  steps: readonly UiStep[];
  progressMessage?: string | null;
  subStatus?: string | null;
}): string {
  const last = input.steps[input.steps.length - 1];
  const site = currentSiteLabel(input.steps);
  const on = site ? site : '页面';
  if (!last) {
    if (input.progressMessage) return stripInternalRefs(input.progressMessage);
    switch (input.subStatus) {
      case 'browsing':
        return '正在打开浏览器…';
      case 'extracting':
        return '在整理拿到的数据…';
      case 'verifying':
        return '在核对结果…';
      case 'generating':
        return '正在写回答…';
      case 'generating_image':
        return '正在生成图片…';
      default:
        return '正在理解你的需求…';
    }
  }
  const kind = last.actionKind ?? '';
  switch (kind) {
    case 'browser_rescue':
      return stripInternalRefs(last.actionSummary ?? '') || '这条路没走通，换个来源试试…';
    case 'browser_blocker':
    case 'browser_login_wall':
    case 'browser_local_wall':
      return `${on}要求登录或验证，看看能不能换条路…`;
    case 'navigate': {
      const url = last.actionSummary?.match(/https?:\/\/\S+/)?.[0];
      const host = hostOf(url);
      return `正在打开${host ? siteLabel(host) : '页面'}…`.replace(/\s+…$/, '…');
    }
    case 'read_url':
      return `在读取${on}的内容…`;
    case 'web_search':
      return '正在搜索资料…';
    case 'click':
    case 'click_ref': {
      const target = stepTarget(last.actionSummary, /^点击\s*/);
      return target ? `正在点「${target}」…` : `正在点${on}上的一个选项…`;
    }
    case 'type':
    case 'type_in_ref':
    case 'select':
      return '正在输入…';
    case 'press_key':
      return `在${on}上操作…`;
    case 'scroll':
      return `在${on}上往下翻看…`;
    case 'wait':
    case 'wait_for':
      return `等${on}加载…`;
    case 'switch_tab':
    case 'list_tabs':
      return '切到另一个标签页看看…';
    case 'finish':
      return '正在整理答案…';
    case 'request_human':
    case 'wait_for_human':
      return '需要你帮一下…';
    case 'text':
    case '':
      return '正在思考下一步…';
    default:
      if (READ_KINDS.has(kind)) return `在读${on}的内容…`;
      return '正在处理…';
  }
}

/** Seconds → 「45 秒」 / 「2 分 05 秒」. */
export function elapsedLabel(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  if (s < 60) return `${s} 秒`;
  return `${Math.floor(s / 60)} 分 ${String(s % 60).padStart(2, '0')} 秒`;
}

/** Elapsed time shows once a task has run longer than this (FIX-57 #3: > 20 s). */
export const ELAPSED_AFTER_SECONDS = 20;

/** Distinct sites the answer links to. */
export function answerSourceCount(text: string): number {
  const hosts = new Set<string>();
  for (const match of text.matchAll(/https?:\/\/[^\s)\]>"'，。）]+/g)) {
    const host = hostOf(match[0]);
    if (host) hosts.add(host);
  }
  return hosts.size;
}

/** The quiet footer under an answer. */
export function processLinkLabel(sourceCount: number, en = false): string {
  // FIX-59 P1-8: an English task's footer is English.
  if (en)
    return sourceCount > 0
      ? `${sourceCount} source${sourceCount === 1 ? '' : 's'} · Show steps`
      : 'Show steps';
  return sourceCount > 0 ? `参考了 ${sourceCount} 个来源 · 查看过程` : '查看过程';
}

export interface TurnOption {
  label: string;
  /** retry: run the same task again; prompt: send `prompt` as the next instruction. */
  kind: 'retry' | 'prompt';
  prompt?: string;
}

export interface NextStepOption {
  label: string;
  prompt: string;
}

/** Server suggestions (strings from older servers, or {label,prompt}) → options. */
export function normalizeNextSteps(
  raw: ReadonlyArray<string | { label?: unknown; prompt?: unknown }> | undefined | null,
): NextStepOption[] {
  const out: NextStepOption[] = [];
  const seen = new Set<string>();
  for (const item of raw ?? []) {
    const label = typeof item === 'string' ? item : item?.label;
    const prompt = typeof item === 'string' ? item : (item?.prompt ?? item?.label);
    if (typeof label !== 'string' || typeof prompt !== 'string') continue;
    if (hasInternalRef(`${label} ${prompt}`)) continue;
    const l = label.trim();
    const p = prompt.trim();
    if (l.length < 2 || p.length < 2 || seen.has(l)) continue;
    seen.add(l);
    out.push({ label: l, prompt: p });
    if (out.length >= 3) break;
  }
  return out;
}

/** The answer of a partial result opens with 「部分完成：」; it is said in words instead. */
export function partialLead(text: string, en = false): { lead: string | null; body: string } {
  const m = text.match(/^\s*(?:\*\*)?(?:部分完成|Partially done|Partial)(?:\*\*)?\s*[:：]\s*/i);
  if (!m) return { lead: null, body: text };
  const body = text.slice(m[0].length);
  // 复审 #1/#2: the answer's own first sentence is the lead — only when it says what is
  // missing (缺 / 没 / 未 / 只 / 部分 …); otherwise the fixed lead stays.
  // 复审 #7: links first — a 「?」 inside an address is not the end of a sentence.
  const plain = body.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/https?:\/\/\S+/g, '');
  const first = plain.trim().split(/(?<=[。！？!?\n]|[.!?]\s)/)[0] ?? '';
  // 复审 #3: not a bare 「没」 (「没问题的两款如下」 says nothing is missing).
  const saysMissing =
    /缺|没有(?!问题)|没(?:拿到|读到|找到|查到|显示|能|给出|标|看到)|未(?:能|读到|找到|显示|拿到|获取|标|看到)|只(?:拿到|找到|读到|有|显示)|部分|不全|不完整|打码|遮|截断|看不到|读不到|拿不到|找不到|无法|\bonly\b|\bpart(?:ial|ly)?\b|\bmissing\b|couldn['’]t|could not|\bnot (?:shown|available|found|visible)|\bmasked\b|log ?in|cut off/i.test(
      first,
    );
  if (saysMissing) return { lead: '', body };
  return {
    lead: en
      ? "I only got part of it — what's missing is below."
      : '这次只拿到了一部分，缺的我写在下面了。',
    body,
  };
}

/**
 * 协调方第 2 次代体验 (京东): a partial answer that stopped at a login (masked price, login-only
 * text) offers the most useful next step first — you log in, I read it properly. Same
 * handover as the failed turn; the person logs in, never me.
 */
export function partialLoginStep(input: {
  text: string;
  intent: string;
  finalUrl?: string | null;
}): NextStepOption | null {
  const intent = input.intent.trim();
  if (!intent) return null;
  if (
    !/需(?:要)?登录|没登录|未登录|登录后(?:才|可)?(?:能)?(?:看|显示|查看)|要登录才|log ?in|sign ?in/i.test(
      input.text,
    )
  )
    return null;
  // 复审 #7: an English task gets the step in English.
  if (isEnglishTask(intent)) {
    const site = taskSite(intent, input.finalUrl, true);
    if (!site) return null;
    const what = /price|cost|how much/i.test(intent) ? 'the exact price' : 'the full page';
    return {
      label: `Log in to ${site} in the browser and I'll read ${what}`,
      prompt: `I'll log in to ${site} myself in the browser. Reopen the page, pause at the login page, and continue once I've logged in: ${intent}`,
    };
  }
  const site = siteName(null, intent) ?? siteName(input.finalUrl, '');
  if (!site) return null;
  const what = /价格|价钱|多少钱|报价|price/i.test(intent) ? '准确价格' : '完整内容';
  return {
    label: `你在浏览器里登录${site}，我帮你读${what}`,
    prompt: `我会在浏览器里自己登录${site}。请重新打开刚才的页面，遇到登录页就暂停，等我登录好再继续：${intent}`,
  };
}

/** The site a task is on, by its short Chinese name when known (「知乎」, not 「zhihu.com」). */
export function siteName(finalUrl: string | null | undefined, intent: string): string | null {
  const host = hostOf(finalUrl) ?? hostOf(intent.match(/https?:\/\/\S+/)?.[0]);
  if (!host) return null;
  return siteLabel(host.replace(/^(?:passport|login|sso)\./, '')).trim();
}

/** The agent's own first sentence of a failure reason, minus prefixes, URLs and advice. */
export function failureOwnWords(errorText: string): string | null {
  let text = errorText
    .replace(/^\s*任务执行失败[:：]\s*/, '')
    .replace(/建议[:：][\s\S]*$/, '')
    .replace(/[（(][^）)]*https?:\/\/[^）)]*[）)]/g, '')
    .replace(/https?:\/\/\S+/g, '')
    .trim();
  text = stripInternalRefs(text);
  const first = text.split(/(?<=[。！？!?])/)[0]?.trim() ?? '';
  if (first.length < 6 || first.length > 90) return null;
  if (/[A-Z_]{6,}|error|exception|stack|\bat\s/i.test(first)) return null;
  // 协调方第 3 次代体验: 「质量校验未通过：没有通过格式或数据规则检查」 is our own check talking.
  if (INTERNAL_CHECK_RE.test(first)) return null;
  return first.replace(/[。.]$/, '');
}

export interface FailureTurn {
  /** First sentence: what happened, and that the result was not obtained (honesty). */
  lead: string;
  /** One more plain sentence, or empty. */
  why: string;
  options: TurnOption[];
}

/** Our own model / service failing — never the person's fault, never shown verbatim. */
const SERVICE_RE =
  /模型|千问|通义|百炼|AI 服务|能力正在迁移|服务尚未配置|provider|PROVIDER_|LLM|MessagesAdapter/i;

/** What the agent said it could not get: 「无法读取该京东商品的标题和价格」 → 「京东商品的标题和价格」. */
export function missingObject(own: string | null): string | null {
  if (!own) return null;
  const m = own.match(
    /(?:无法|未能|没能|没有|不能)(?:读取|获取|拿到|读到|找到|查到|显示)(?:到)?(?:该|这个|此)?(.{2,30}?)(?:[。，,；;（(]|$)/,
  );
  return m?.[1]?.trim() || null;
}

/**
 * A failed or cancelled run as an assistant message (复审 #1-1b): the first sentence says
 * directly what happened and that the result was not obtained — no 「这次没拿到你要的结果：」
 * preamble. Options lead with the step that fills the gap.
 */
/** 协调方第 3 次代体验: failure reasons that are our own checks, never shown as the lead. */
const INTERNAL_CHECK_RE =
  /质量校验|校验未通过|格式或数据规则|数据规则|规则检查|格式检查|结果复核|质量门禁|门禁|verifier|quality.?(?:gate|check)|schema|post.?check/i;
const LIVE_ASK_RE =
  /价格|价钱|多少钱|报价|售价|库存|有货|现货|实时|现在|今天|最新|price|stock|in stock/i;

/**
 * 复审 #7: the turn speaks the task's language — an English task gets English. FIX-60 P0-2: the
 * request's main language, the same rule the answer prompts follow.
 */
export function isEnglishTask(intent: string): boolean {
  return isEnglishRequestText(intent);
}

/** FIX-58 P1-5: the line above a failed task's ways on follows the task's language. */
export function optionsHeader(intent: string): string {
  return isEnglishTask(intent) ? "Here's what I can do:" : '我可以这样继续：';
}

/** 复审 #7: sites by the name a person uses — 「亚马逊新加坡站」 / 「Amazon Singapore」, not amazon.sg. */
const SITE_WORDS: ReadonlyArray<[RegExp, string, string]> = [
  [/亚马逊新加坡站?|amazon\.sg\b|amazon\s+(?:sg|singapore)/i, '亚马逊新加坡站', 'Amazon Singapore'],
  [/亚马逊美国站?|amazon\.com\b|amazon\s+us\b/i, '亚马逊美国站', 'Amazon US'],
  [/亚马逊日本站?|amazon\.co\.jp\b|amazon\s+japan/i, '亚马逊日本站', 'Amazon Japan'],
  [/亚马逊英国站?|amazon\.co\.uk\b|amazon\s+uk\b/i, '亚马逊英国站', 'Amazon UK'],
  [/亚马逊|amazon/i, '亚马逊', 'Amazon'],
  [/京东手机版|\bm\.jd\.com|item\.m\.jd\.com/i, '京东手机版', 'JD mobile'],
  [/京东|jd\.com/i, '京东', 'JD.com'],
  [/淘宝|taobao/i, '淘宝', 'Taobao'],
  [/天猫|tmall/i, '天猫', 'Tmall'],
  [/拼多多|pinduoduo|yangkeduo/i, '拼多多', 'Pinduoduo'],
  [/知乎|zhihu/i, '知乎', 'Zhihu'],
  [/小红书|xiaohongshu/i, '小红书', 'Xiaohongshu'],
  [/抖音|douyin/i, '抖音', 'Douyin'],
  [/哔哩哔哩|B ?站|bilibili/i, '哔哩哔哩', 'Bilibili'],
  [/微博|weibo/i, '微博', 'Weibo'],
  [/豆瓣|douban/i, '豆瓣', 'Douban'],
  [/携程|ctrip|trip\.com/i, '携程', 'Trip.com'],
  [/美团|meituan/i, '美团', 'Meituan'],
  [/大众点评|dianping/i, '大众点评', 'Dianping'],
  [/闲鱼|goofish/i, '闲鱼', 'Xianyu'],
  [/苏宁|suning/i, '苏宁', 'Suning'],
  [/唯品会|vip\.com/i, '唯品会', 'Vipshop'],
  [/得物|dewu/i, '得物', 'Dewu'],
  [/飞猪|fliggy/i, '飞猪', 'Fliggy'],
  [/\bebay\b/i, 'eBay', 'eBay'],
  [/shopee/i, 'Shopee', 'Shopee'],
  [/lazada/i, 'Lazada', 'Lazada'],
];

/** The site the task names (in its words or its link), else the page it ended on. */
export function taskSite(
  intent: string,
  finalUrl: string | null | undefined,
  en: boolean,
): string | null {
  const link = intent.match(/https?:\/\/\S+/)?.[0];
  for (const source of [
    intent.replace(/https?:\/\/\S+/g, ' '),
    hostOf(link) ?? '',
    hostOf(finalUrl) ?? '',
  ]) {
    if (!source) continue;
    const hit = SITE_WORDS.find(([re]) => re.test(source));
    if (hit) return en ? hit[2] : hit[1];
  }
  const host = hostOf(link) ?? hostOf(finalUrl);
  if (!host) return null;
  return en ? host.replace(/^(?:www|m|item|passport|login|sso)\./, '') : siteName(finalUrl, intent);
}

/**
 * 协调方第 3 次代体验: 「点名网站 + 价格/库存/实时」 that did not get an answer — say what was
 * not obtained, and offer to open that site and look now (the same request, in the browser).
 */
function liveSiteFailure(
  intent: string,
  finalUrl: string | null | undefined,
  executionMode: string | undefined,
  retry: TurnOption | null,
  en: boolean,
): FailureTurn | null {
  if (!intent || !LIVE_ASK_RE.test(intent)) return null;
  const site = taskSite(intent, finalUrl, en);
  if (!site) return null;
  const stock = /库存|有货|现货|stock/i.test(intent);
  const price = /价格|价钱|多少钱|报价|售价|price/i.test(intent);
  const inBrowser = executionMode === 'browser';
  const open: TurnOption | null = inBrowser
    ? null
    : en
      ? {
          kind: 'prompt',
          label: `Open ${site} and check it live`,
          prompt: /\b(?:use|using|in|with|via|open)\s+(?:a\s+|the\s+)?(?:cloud\s+)?browser\b/i.test(
            intent,
          )
            ? intent
            : `Use the cloud browser: ${intent}`,
        }
      : {
          kind: 'prompt',
          label: `打开${site}帮你实时查`,
          prompt: /^请使用云端浏览器/.test(intent) ? intent : `请使用云端浏览器，${intent}`,
        };
  if (en) {
    const what = stock ? 'stock' : price ? 'live prices' : 'live information';
    return {
      lead: `I couldn't get the ${what} from ${site} this time.`,
      why: inBrowser
        ? "The page didn't show it this time — I can open it again."
        : 'This needs the site’s current page, so it has to be checked live.',
      options: [open, retry].filter((o): o is TurnOption => Boolean(o)),
    };
  }
  const what = stock ? '库存' : price ? '实时价格' : '实时信息';
  return {
    lead: `这次没拿到${site}的${what}。`,
    why: inBrowser
      ? '页面这次没给出要的内容，可以让我再打开一次看看。'
      : '这种要看网站当前页面的问题，得打开网页实时查。',
    options: [open, retry].filter((o): o is TurnOption => Boolean(o)),
  };
}

/**
 * 复审 #7: our own check stopped an answer we wrote (周报、翻译、纪要…) — say what was not done
 * and offer to do it again; never 「答案没通过我自己的核对」 or the check's name.
 */
export function notDoneLead(intent: string, en: boolean): string {
  const word = (m: RegExpMatchArray | null) =>
    m?.[1]
      ?.replace(/^(?:一下|一份|一篇|一封|一个|一张|个|份|篇|封|张)/, '')
      .replace(/(?:吧|呢|给我|一下)$/, '')
      .trim();
  if (en) {
    if (/\btranslat/i.test(intent))
      return "The translation didn't come out right this time — want me to try again?";
    const obj = intent.match(
      /\b(?:write|draft|make|create|prepare|summari[sz]e|organi[sz]e)\s+(?:me\s+)?(?:an?\s+|the\s+|my\s+|our\s+)?([a-z][a-z\s-]{1,30}?)(?=\s+(?:for|about|on|in|from|to|with|of)\b|[.,!?:;]|$)/i,
    )?.[1];
    return obj
      ? `The ${obj.trim()} didn't come out right this time — want me to try again?`
      : "That didn't come out right this time — want me to try again?";
  }
  if (/翻译/.test(intent)) return '这段翻译这次没做好，我再翻一次？';
  const wrote = word(
    intent.match(/(?:写|起草|拟)(?:一下|一份|一篇|一封|个|份|篇|封)?([^\s，。,.！!？?：:]{1,12})/),
  );
  if (wrote) return `${wrote}这次没写好，我再写一次？`;
  const sorted = word(
    intent.match(/(?:整理|总结|归纳|汇总|梳理)(?:一下|一份)?([^\s，。,.！!？?：:]{0,12})/),
  );
  if (sorted !== undefined) return `${sorted || '这份整理'}这次没整理好，我再整理一次？`;
  const made = word(
    intent.match(
      /(?:做|生成|制作|画|设计)(?:一下|一份|一个|一张|个|份|张)?([^\s，。,.！!？?：:]{1,12})/,
    ),
  );
  if (made) return `${made}这次没做好，我再做一次？`;
  return '这次没做好，我再试一次？';
}

export function failureTurn(input: {
  status: UiTask['status'];
  errorText: string;
  intent: string;
  finalUrl?: string | null;
  executionMode?: string;
  canRetry: boolean;
}): FailureTurn {
  const intent = input.intent.trim();
  const en = isEnglishTask(intent);
  const retry: TurnOption | null = input.canRetry
    ? { kind: 'retry', label: en ? 'Try again' : '再试一次' }
    : null;
  if (input.status === 'cancelled') {
    return en
      ? {
          lead: 'The task was cancelled before it finished.',
          why: 'What I had so far is below.',
          options: input.canRetry ? [{ kind: 'retry', label: 'Start over' }] : [],
        }
      : {
          lead: '任务已取消，没有做完。',
          why: '停之前拿到的内容我留在下面了。',
          options: input.canRetry ? [{ kind: 'retry', label: '从头再做一次' }] : [],
        };
  }
  // 复审 #1-3: model / service errors get one fixed sentence, never the raw text.
  if (SERVICE_RE.test(input.errorText)) {
    return {
      lead: en
        ? 'Something went wrong on my side, so this didn’t finish — you can ask me to try again in a moment.'
        : '我这边的服务刚刚出了点问题，这次没做完，你可以稍后再让我试一次。',
      why: '',
      options: retry ? [retry] : [],
    };
  }
  // 复审 #7: our own check comes first — 「verifier 拦截了答案」 is not a login wall.
  if (INTERNAL_CHECK_RE.test(input.errorText)) {
    const live = liveSiteFailure(intent, input.finalUrl, input.executionMode, retry, en);
    if (live) return live;
    return {
      lead: notDoneLead(intent, en),
      why: '',
      options: [retry].filter((o): o is TurnOption => Boolean(o)),
    };
  }
  const own = failureOwnWords(input.errorText);
  const what = missingObject(own);
  const notGot = en
    ? "so I couldn't get what you asked for"
    : what
      ? `所以没拿到${what}`
      : '所以这次没拿到你要的内容';
  const friendly = classifyFriendlyFailure(input.errorText, {
    executionMode: input.executionMode,
  });
  const site = en ? taskSite(intent, input.finalUrl, true) : siteName(input.finalUrl, intent);
  // 复审 #3 (BOSS run, 知乎): 「比价网站」 only where prices are what the person wants.
  const shopping =
    /价格|价钱|多少钱|报价|商品|购买|比价|优惠|price|buy|product|item\.|jd\.com|taobao|tmall|amazon|亚马逊|京东|淘宝|天猫/i.test(
      intent,
    );
  const publicSource: TurnOption | null = !intent
    ? null
    : en
      ? shopping
        ? {
            kind: 'prompt',
            label: "I'll check public search or price-comparison pages instead",
            prompt: `No login — use a public source that doesn't need one (site search, price-comparison sites or the brand's own site) for: ${intent}. Say which site the answer comes from.`,
          }
        : {
            kind: 'prompt',
            label: "I'll look for a public source that doesn't need a login",
            prompt: `No login — use a public source that doesn't need one (a search engine or a related public site) for: ${intent}. Say which site the answer comes from.`,
          }
      : shopping
        ? {
            kind: 'prompt',
            label: '我去公开的搜索页或比价网站查同类信息',
            prompt: `不用登录，换一个不需要登录的公开来源（站内搜索页、比价网站或品牌官网）帮我查：${intent}。答案里注明信息来自哪个网站。`,
          }
        : {
            kind: 'prompt',
            label: '我换个不需要登录的公开来源找找',
            prompt: `不用登录，换一个不需要登录的公开来源（搜索引擎或相关的公开网站）帮我查：${intent}。答案里注明信息来自哪个网站。`,
          };
  // FIX-57 #5: the run already routed around the wall — say so, and do not offer it again.
  const triedElsewhere =
    /替代(?:来源|路线|渠道)|换(?:了|个|一个)?(?:公开)?(?:来源|渠道|网站)|尝试.{0,16}搜索|搜索.{0,30}均无|均无(?:返回)?结果|比价网站.{0,10}(?:都|也)?(?:没有|无)/.test(
      input.errorText,
    );
  const tried = triedElsewhere
    ? en
      ? ', and public sources did not have it either'
      : '，我换了公开来源也没找到'
    : '';
  const others = triedElsewhere ? null : publicSource;
  const title = friendly.title;
  // FIX-61 P1-7 (DEPLOY-60 dy-1): the real cause, not the run's guess about a login.
  if (title === '网站把链接转到了别的页面') {
    return {
      lead: en
        ? `${site ?? 'The site'} sent the link to another page (such as its recommendations) instead of the one you gave${tried}, ${notGot}.`
        : `${site ?? '网站'}把这个链接转到了推荐页等别的页面，没打开你给的那一页${tried}，${notGot}。`,
      why: '',
      options: [retry, others].filter((o): o is TurnOption => Boolean(o)),
    };
  }
  if (title === '页面被一个引导层挡住了') {
    return {
      lead: en
        ? `A guide layer covered the ${site ?? ''} page and I couldn't close it${tried}, ${notGot}.`.replace(
            /\s{2,}/g,
            ' ',
          )
        : `${site ?? ''}页面被一个引导层挡住了，我没能关掉它${tried}，${notGot}。`,
      why: en
        ? 'You can press 「我来操作」, close it yourself, and hand it back.'
        : '你可以点「我来操作」自己关掉它，再交还给我接着看。',
      options: [retry, others].filter((o): o is TurnOption => Boolean(o)),
    };
  }
  if (/登录/.test(title) || /风控|拦截|拦下/.test(assertedFailureText(input.errorText))) {
    const blocked = /风控|拦截|拦下|403|异常提示/.test(assertedFailureText(input.errorText));
    const login: TurnOption | null = !intent
      ? null
      : en
        ? {
            kind: 'prompt',
            label: `Log in to ${site ?? 'the site'} in the browser and I'll pick it up`,
            prompt: `I'll log in to ${site ?? 'the site'} myself in the browser. Reopen the page, pause at the login page, and continue once I've logged in: ${intent}`,
          }
        : {
            kind: 'prompt',
            label: `你在浏览器里登录${site ?? ''}，我接着帮你看`,
            prompt: `我会在浏览器里自己登录${site ?? '这个网站'}。请重新打开刚才的页面，遇到登录页就暂停，等我登录好再继续：${intent}`,
          };
    return {
      // 复审 #2-4: 「京东这个页面…」 or just 「这个页面…」 — never 「这个网站这个页面」.
      lead: en
        ? `${
            blocked
              ? `${site ? `${site} blocked this page` : 'This page was blocked'} — it needs a login or a check first`
              : `${site ? `This ${site} page` : 'This page'} needs a login`
          }${tried}, ${notGot}.`
        : `${
            blocked
              ? site
                ? `${site}把这个页面拦下了`
                : '这个页面被拦下了'
              : `${site ?? ''}这个页面要登录才能看`
          }${blocked ? '，要登录或验证后才显示' : ''}${tried}，${notGot}。`,
      why: en
        ? "I can't log in for you, and I won't get around it."
        : '我不能替你登录，也不会绕过它。',
      options: [login, others].filter((o): o is TurnOption => Boolean(o)),
    };
  }
  if (/验证/.test(title)) {
    const verify: TurnOption | null = !intent
      ? null
      : en
        ? {
            kind: 'prompt',
            label: 'Reopen it — you do the check when it shows',
            prompt: `Run again: ${intent}. If a human check appears, pause until I finish it myself.`,
          }
        : {
            kind: 'prompt',
            label: '重新打开，遇到验证由你来完成',
            prompt: `重新执行：${intent}。遇到人机验证就暂停，等我自己完成验证后再继续。`,
          };
    return {
      lead: en
        ? `${site ?? 'The site'} wants a human check first — only you can do that${tried}, ${notGot}.`
        : `${site ?? '网站'}要求先做人机验证，这一步只能你本人来${tried}，${notGot}。`,
      why: '',
      options: [verify, others].filter((o): o is TurnOption => Boolean(o)),
    };
  }
  // In the browser a timeout or a broken page keeps its own words.
  const live =
    input.executionMode !== 'browser'
      ? liveSiteFailure(intent, input.finalUrl, input.executionMode, retry, en)
      : null;
  if (live) return live;
  if (/超时|响应|连接|打开这个网站|浏览器|页面正在切换|休眠|中断|长时间/.test(title)) {
    return {
      lead: en
        ? `${site ?? 'The site'} didn't open properly this time${tried}, ${notGot}.`
        : `${site ?? '网站'}这次没有正常打开（${title}）${tried}，${notGot}。`,
      why: en ? "It's not something you did." : '不是你的问题。',
      options: [retry, others].filter((o): o is TurnOption => Boolean(o)),
    };
  }
  if (INTERNAL_CHECK_RE.test(title)) {
    return {
      lead: notDoneLead(intent, en),
      why: '',
      options: [retry].filter((o): o is TurnOption => Boolean(o)),
    };
  }
  if (en) {
    return {
      lead: "This didn't finish — want me to try again?",
      why: 'If it misses again, an example of what you want helps.',
      options: [retry].filter((o): o is TurnOption => Boolean(o)),
    };
  }
  return {
    lead: own ? `${own}，这次没做完。` : `这次没做完：${title}。`,
    why: own ? '可以让我再试一次，或者把要求说得更具体一点（比如给个例子）。' : friendly.subtitle,
    options: [retry].filter((o): o is TurnOption => Boolean(o)),
  };
}

/** 复审 #1-1a: what an option or a next step offers, so the same offer is shown once. */
export function offerKind(label: string): string | null {
  if (/登录|手动打开|你(?:自己|亲自)?打开|你来操作|接管/.test(label)) return 'handover';
  if (/验证/.test(label)) return 'verify';
  if (
    /公开|比价|搜索页|换(?:个|一个)?(?:来源|渠道|网站|平台)|别的(?:来源|渠道|网站|平台)/.test(label)
  )
    return 'public';
  if (/再试|重试|重新(?:执行|打开|试|读|抓)|从头再|稍后再/.test(label)) return 'retry';
  return null;
}

/** Next steps that do not repeat an option already offered (same kind or same words). */
export function withoutRepeatedOffers(
  steps: readonly NextStepOption[],
  options: readonly TurnOption[],
): NextStepOption[] {
  const kinds = new Set(options.map((o) => offerKind(o.label)).filter(Boolean));
  const labels = new Set(options.map((o) => o.label));
  return steps.filter((s) => {
    const kind = offerKind(s.label);
    return !labels.has(s.label) && !(kind && kinds.has(kind));
  });
}

/** Screenshots are evidence (they live in 「查看过程」); other files are the product. */
export function isEvidenceAttachment(a: { kind?: string; mimetype?: string }): boolean {
  return a.kind === 'screenshot';
}

/**
 * The step timeline behind the status line / 「查看过程」: one plain line per step,
 * repeats folded together, the latest last. Agent remarks (text steps) stay as said.
 */
export function stepTimeline(
  steps: readonly UiStep[],
  limit = 40,
): Array<{ key: string; text: string; status: UiStep['status'] }> {
  const out: Array<{ key: string; text: string; status: UiStep['status'] }> = [];
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    if (!step) continue;
    const said = step.actionKind === 'text' ? stripInternalRefs(step.actionSummary ?? '') : '';
    const live = said && said !== 'text' ? said : liveStatusText({ steps: steps.slice(0, i + 1) });
    if (live === '正在思考下一步…' || live === '正在处理…') continue;
    // Before any page opened there is nothing to read yet.
    if (!said && live === '在读页面的内容…') continue;
    // The timeline tells what was done: 「打开亚马逊」, not 「正在打开亚马逊…」.
    const text = said ? said : live.replace(/…$/, '').replace(/^正在|^在(?=读|.+上)/, '');
    if (!text) continue;
    const prev = out[out.length - 1];
    if (prev && prev.text === text) {
      prev.status = step.status;
      prev.key = String(step.tickIndex);
      continue;
    }
    out.push({ key: String(step.tickIndex), text, status: step.status });
  }
  return out.slice(-limit);
}

/**
 * 复审 #3 (BOSS run, amazon): the verifier's 「未核实：以下内容未能在已读页面中逐字找到，请自行确认
 * ——…」 note leaves the answer; the answer gets one plain sentence and 「查看过程」 keeps the items.
 */
export function splitUnverifiedNote(
  text: string,
  opts: { partial?: boolean; en?: boolean } = {},
): { body: string; unverified: string | null } {
  const m = text.match(
    // FIX-61 P1-2: an English task's note is English.
    /\n*\s*(?:未核实[:：]\s*以下内容未能在已读页面中逐字找到，请自行确认——|Not verified: these were not found word for word on the pages read; please check them yourself — )([\s\S]*?)(?=\n\s*\n|$)/,
  );
  if (!m) return { body: text, unverified: null };
  // 第 0 步核对 3: a partial answer's lead says what is missing, not which written items were
  // not checked — so a short note stays, unless those items are exactly the gap the lead names.
  const items = (m[1] ?? '')
    .split(/[；;]/u)
    .map((item) => item.trim())
    .filter(Boolean);
  const before = text.slice(0, m.index);
  const firstLine =
    before.replace(/^\s*(?:\*\*)?部分完成(?:\*\*)?\s*[:：]\s*/u, '').split(/\n/)[0] ?? '';
  // The first line has to name it as the gap (没能确认 / 缺 / 未…), not just state it.
  const namesGap =
    /缺|没(?:能|有|拿到|读到|找到|确认|核对)|未(?:能|读到|找到|确认|核对|获取)|无法|不确定|不全|拿不到|读不到|\bcouldn['’]t\b|\bnot (?:confirmed|verified|found)\b|\bmissing\b/iu.test(
      firstLine,
    );
  const gapOnly =
    namesGap &&
    items.length > 0 &&
    items.every((item) => {
      const quoted = /「([^」]+)」/u.exec(item)?.[1] ?? item;
      return firstLine.includes(quoted.trim());
    });
  const said = opts.partial
    ? gapOnly
      ? ''
      : opts.en
        ? "\n\nA few items here I couldn't match word for word on the page — see “Show steps”."
        : '\n\n其中有几项我没在页面上逐字核对到，见「查看过程」。'
    : opts.en
      ? "\n\nSome details I couldn't match word for word on the page — they're listed under “Show steps”; worth a look before you rely on them."
      : '\n\n有些内容我没能在页面上逐字核对到，细节在「查看过程」里，用之前可以再看一眼。';
  const body = `${text.slice(0, m.index).trimEnd()}${said}${text.slice((m.index ?? 0) + m[0].length)}`;
  return { body: body.trim(), unverified: m[1]?.trim() || null };
}

/** The distinct links an answer cites, for the 「来源」 part of 「查看过程」. */
export function answerLinks(text: string): Array<{ label: string; url: string }> {
  const out: Array<{ label: string; url: string }> = [];
  const seen = new Set<string>();
  const push = (label: string, url: string) => {
    const host = hostOf(url);
    if (!host || seen.has(url)) return;
    seen.add(url);
    out.push({ label: label && !/^https?:/.test(label) ? label : siteLabel(host).trim(), url });
  };
  for (const m of text.matchAll(/\[([^\]]{1,60})\]\((https?:\/\/[^)\s]+)\)/g))
    push(m[1] ?? '', m[2] ?? '');
  for (const m of text.matchAll(/(?<!\]\()https?:\/\/[^\s)\]>"'，。）]+/g)) push('', m[0]);
  return out.slice(0, 12);
}

/** 复审 #3 (BOSS run, 知乎): a verification handover said once, where the browser really is. */
export function captchaRequestLine(site: string | null): string {
  return `${site ?? '网站'}要求先做人机验证，请在浏览器画面里完成（只能你本人操作），完成后我会自动接着做，最多等 10 分钟。`;
}
