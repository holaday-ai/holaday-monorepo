/**
 * FIX-57 #4: next steps that guess what the person wants to do with this result.
 *
 * One cheap model call after a task ends (completed, partial or failed). The model sees
 * the goal, the answer, what is missing and the person's recent tasks, and proposes 0–3
 * next steps in the assistant's voice (「要不要我把…整理成一张对比表？」), each with the
 * instruction that runs it. A partial or failed task leads with the step that fills the gap.
 * Nothing is better than something generic: an empty list is a valid answer.
 *
 * Never throws; any parse / model failure is an empty list.
 */

import { type SQL, sql } from 'drizzle-orm';
import { tasks } from '../db/schema/tasks.js';
import type { MessagesAdapter } from '../llm/messages-adapter.js';
import { filterByIntentConstraints } from './suggestions-generator.js';

export interface NextStep {
  /** What the person reads: the assistant offering, first person. */
  label: string;
  /** What is sent when they pick it: the user's own instruction, complete on its own. */
  prompt: string;
}

export type NextStepsOutcome = 'completed' | 'partial' | 'failed';

const MAX_TOKENS = 700;
export const NEXT_STEP_LABEL_MAX = 48;
export const NEXT_STEP_PROMPT_MAX = 300;

export const NEXT_STEPS_SYSTEM_PROMPT = `你是用户的私人助理，刚替用户做完一件事。请预判用户接下来最可能想让你做什么，给出 0–3 个下一步提议。

要求：
- 紧扣这次的目标和结果：具体到对象（哪只股票、哪个商品、哪个网站、哪段时间）和产出（对比表、提醒、摘要、清单…）。不要泛泛的「查看更多」「搜索相关新闻」「分析一下」。
- 不重复这次已经回答过的内容；用户最近的任务可以帮你判断偏好和延续方向。
- 绝不原样照抄用户这次的原话或最近任务的原话当作提议（最近任务只用来判断偏好）；每条提议都要是新的一步。
- 行情、点位这类结果：从结果里最显眼的具体变化出发，例如「创业板今天跌了 2.87%，要我看看是什么带动的吗？」「收盘后再告诉你三大指数的结果？」；只陈述事实和查原因，不预测涨跌、不给买卖建议。
- 结果是「部分完成」时，第一条必须是补齐缺口的那一步（换个时间/换个方式拿到缺的那部分）。
- 不要提议重新打开刚被拦下或打不开的那个页面（包括它的电脑版、原链接）；补缺口可以去同一网站的别的页面（如「再打开第 3 条商品页拿价格」）。
- 不要给「再试一次？」「重试一下？」这类原样重来的提议：每条提议都要说清换成什么做法、去哪个页面或要什么。
- 平台要和用户的任务对得上：用户给的链接域名就代表用户在用的平台（如 item.jd.com 就是京东）。不要跳到用户没提过、和任务无关的平台；用户自己说了要比价、跟其他平台比，才可以提其他平台。
- 用户这次没说比价、也没提到别的平台时，所有提议都只能留在这次任务的网站上，不能出现任何其他平台或网站（用户最近其他任务里的平台也不行）。例如用户只让你在亚马逊查价格，就不要提「和京东同款对比」。
- 结果是「失败」时，界面已经固定给出「你登录后我接着看」「换公开来源查」「再试一次」「你来完成验证」这几种做法，不要再提这几类（意思相同的也不要），只提别的真正有用的下一步，没有就返回空；绝不提议替用户输入账号密码或绕过验证。
- label：助理主动提议的口吻，第一人称，简短自然，可以用问句，例如「今天开盘后我再帮你拉一次实时点位，跟昨天收盘对比？」，不超过 30 个字。
- prompt：用户点了之后发给你的完整指令，用户的口吻，单独拿出来也能直接执行（写清对象、网站、要什么），不超过 150 个字。
- 继承用户原话里的限制：用户说过「不要提交/不要购买/不要发送/不要点击…」，提议里绝不能出现相反的动作。
- 不给买卖、投资建议，不预测涨跌；不出现内部工具名、网址参数或服务商名字。
- 不提议换浏览器内核、伪装身份、换 IP、走代理或任何规避网站限制的做法。
- 没有真正有价值的下一步就返回空数组，宁缺毋滥。

另外给这个任务起一个侧栏标题 title：从任务内容和结果里提炼的名词短语，2–14 个字，说清对象和要什么，例如「京东 iPhone 16 Pro 价格」「上证指数点位」「西湖开放时间」；不要「请使用云端浏览器」「帮我」这类话，不要网址。

只回复 JSON，不要其他文字，格式：{"title":"…","steps":[{"label":"…","prompt":"…"}]}`;

export interface GenerateNextStepsOptions {
  messagesAdapter: MessagesAdapter;
  /** The person's request (all turns), not truncated: its prohibitions are inherited. */
  intent: string;
  outcome: NextStepsOutcome;
  /** The answer, or for a failed task the reason it failed. */
  summary: string;
  /** What is missing (a partial's `missing`, or the failure reason). */
  missing?: string | null;
  /** The person's latest other requests, newest first. */
  recentIntents?: readonly string[];
  /** 复审 #3: addresses that stopped the run (never offered again). */
  blockedUrls?: readonly string[];
}

const OUTCOME_LABEL: Record<NextStepsOutcome, string> = {
  completed: '完成',
  partial: '部分完成',
  failed: '失败',
};

/** 协调方第 2 次代体验: the request itself asks to compare platforms. */
const CROSS_PLATFORM_RE =
  /比价|对比|比较|比一下|哪家|哪个平台|其他平台|别的平台|各平台|多个平台|跨平台|同款|全网|compare|vs\.?|versus/i;

export function nextStepsUserMessage(opts: Omit<GenerateNextStepsOptions, 'messagesAdapter'>) {
  const recent = (opts.recentIntents ?? [])
    .map((intent) => intent.replace(/\s+/g, ' ').trim().slice(0, 80))
    .filter(Boolean)
    .slice(0, 5);
  const domains = [
    ...new Set(
      (opts.intent.match(/https?:\/\/[^\s)）」，。]+/g) ?? [])
        .map((u) => {
          try {
            return new URL(u).hostname.replace(/^www\./, '');
          } catch {
            return '';
          }
        })
        .filter(Boolean),
    ),
  ];
  return [
    `用户这次的要求：${opts.intent}`,
    domains.length ? `用户给的链接域名：${domains.join('、')}` : '',
    CROSS_PLATFORM_RE.test(opts.intent)
      ? ''
      : '用户这次没有要求比价或跨平台：提议只能留在这次任务的网站上，不要出现其他平台。',
    `结果：${OUTCOME_LABEL[opts.outcome]}`,
    `${opts.outcome === 'failed' ? '失败原因' : '结果内容'}：${opts.summary.slice(0, 1200)}`,
    opts.missing ? `没拿到的部分：${opts.missing.slice(0, 300)}` : '',
    recent.length ? `用户最近的其他任务：\n${recent.map((r) => `- ${r}`).join('\n')}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

export async function generateNextSteps(opts: GenerateNextStepsOptions): Promise<NextStep[]> {
  return (await generateNextStepsWithTitle(opts)).steps;
}

/** FIX-57 复审 #1-1d: the same call also names the task for the sidebar. */
export async function generateNextStepsWithTitle(
  opts: GenerateNextStepsOptions,
): Promise<{ steps: NextStep[]; title: string | null }> {
  const none = { steps: [] as NextStep[], title: null };
  if (!opts.intent.trim() || !opts.summary.trim()) return none;
  let raw = '';
  try {
    const resp = await opts.messagesAdapter.create(
      {
        maxTokens: MAX_TOKENS,
        thinking: { type: 'disabled' },
        system: NEXT_STEPS_SYSTEM_PROMPT,
        messages: [{ role: 'user', content: nextStepsUserMessage(opts) }],
      },
      { timeoutMs: 15_000, maxRetries: 0 },
    );
    for (const b of resp.content) if (b.type === 'text') raw += b.text;
  } catch {
    return none;
  }
  return {
    steps: withoutEchoes(
      [opts.intent, ...(opts.recentIntents ?? [])],
      relevantNextSteps(opts.blockedUrls ?? [], filterNextSteps(opts.intent, parseNextSteps(raw))),
    ),
    title: parseTaskTitle(raw),
  };
}

/** The sidebar title from the same JSON: 2–20 chars, no address, no browser preamble. */
export function parseTaskTitle(raw: string): string | null {
  const m = raw.match(/"title"\s*:\s*"([^"]{1,60})"/);
  const title = m?.[1]
    ?.replace(/[「」『』"“”]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!title || title.length < 2 || title.length > 20) return null;
  if (/https?:|www\.|云端浏览器|请使用|帮我/.test(title) || INTERNAL_RE.test(title)) return null;
  return title;
}

/** Internal references and provider names never reach the person. */
const INTERNAL_RE =
  /\b(?:tab|frame)_[\w-]+|\bref\s*=\s*\S+|\[ref=[^\]]*\]|\b(?:firecrawl|brave|playwright|browserbase|qwen|dashscope|anthropic|claude|openai|gpt-\S+|tavily|serpapi)\b|read_page|get_page_text|web_search|snapshot|request_human/i;
const BANNED_RE =
  /温馨提示|购买建议|风险提示|免责声明|买入|卖出|加仓|减仓|抄底|会涨|会跌|涨跌预测|内核|指纹|伪装|代理|换\s*IP|user[\s-]?agent|破解/i;

/** Tolerant parse: a fenced block, a bare object, or a bare array of {label, prompt} items. */
export function parseNextSteps(raw: string): NextStep[] {
  if (!raw) return [];
  const trimmed = raw.trim();
  const fenced = trimmed.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/i);
  const body = fenced?.[1]?.trim() ?? trimmed;
  const json = body.match(/[[{][\s\S]*[\]}]/)?.[0] ?? body;
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return [];
  }
  const list = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === 'object' && Array.isArray((parsed as { steps?: unknown }).steps)
      ? (parsed as { steps: unknown[] }).steps
      : [];
  const out: NextStep[] = [];
  for (const item of list) {
    // 协调方第 3 次代体验: a bare string is not a step — the model echoing the person's
    // recent requests (「上证指数现在多少点」) came back as one; nothing fills in for it.
    if (typeof item === 'string') continue;
    if (!item || typeof item !== 'object') continue;
    const label = (item as { label?: unknown }).label;
    const prompt = (item as { prompt?: unknown }).prompt;
    if (typeof label !== 'string') continue;
    out.push({
      label: label.trim(),
      prompt: (typeof prompt === 'string' && prompt.trim() ? prompt : label).trim(),
    });
  }
  return out;
}

const echoKey = (text: string) =>
  text
    .replace(/请使用云端浏览器|请用浏览器|帮我|请/g, '')
    .replace(/[\s，。？！、,.?!「」"“”：:]/g, '')
    .toLowerCase();

/**
 * 协调方第 3 次代体验: a step is never this request or one of the recent ones said again —
 * not as its label, not as what it sends. With nothing left, no step is shown.
 */
export function withoutEchoes(asked: readonly string[], steps: readonly NextStep[]): NextStep[] {
  const said = new Set(asked.map(echoKey).filter((k) => k.length >= 2));
  return steps.filter((step) => !said.has(echoKey(step.label)) && !said.has(echoKey(step.prompt)));
}

/** Shape, safety and the user's own prohibitions; at most 3, no duplicates. */
/** 复审 #4: query parameters that name the item itself (淘宝 `item.htm?id=…`). */
const ITEM_ID_PARAMS = new Set(['id', 'itemid', 'item_id', 'sku', 'skuid', 'sku_id']);

/**
 * A web address as host + path, plus its item-id parameters (复审 #4), for comparing a
 * step's link with the walled one: `item.htm?id=111` and `item.htm?id=222` are two pages.
 */
function pageOf(url: string): string | null {
  try {
    const u = new URL(url);
    const ids = [...u.searchParams]
      .filter(([key, value]) => ITEM_ID_PARAMS.has(key.toLowerCase()) && value)
      .map(([key, value]) => `${key.toLowerCase()}=${value}`)
      .sort();
    const page = `${u.hostname.replace(/^(?:(?:www|m|item)\.)+/, '')}${u.pathname.replace(/\/+$/, '')}`;
    return `${page}${ids.length ? `?${ids.join('&')}` : ''}`.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * 复审 #3: the one hard rule — no step that reopens the address that just stopped the run
 * (judged by address, not wording). Which platforms fit is the model's call (the prompt
 * gives it the request and its link domains).
 */
export function relevantNextSteps(
  blockedUrls: readonly string[],
  steps: readonly NextStep[],
): NextStep[] {
  const blocked = new Set(blockedUrls.map(pageOf).filter((p): p is string => Boolean(p)));
  if (blocked.size === 0) return [...steps];
  return steps.filter((step) => {
    const links = `${step.label} ${step.prompt}`.match(/https?:\/\/[^\s)）」，。]+/g) ?? [];
    return !links.some((link) => {
      const page = pageOf(link);
      return page !== null && blocked.has(page);
    });
  });
}

export function filterNextSteps(intent: string, steps: readonly NextStep[]): NextStep[] {
  const seen = new Set<string>();
  const out: NextStep[] = [];
  for (const step of steps) {
    const label = step.label.replace(/\s+/g, ' ').trim();
    const prompt = step.prompt.replace(/\s+/g, ' ').trim();
    if (label.length < 4 || label.length > NEXT_STEP_LABEL_MAX) continue;
    if (prompt.length < 4 || prompt.length > NEXT_STEP_PROMPT_MAX) continue;
    if (INTERNAL_RE.test(label) || INTERNAL_RE.test(prompt)) continue;
    if (BANNED_RE.test(label) || BANNED_RE.test(prompt)) continue;
    if (/(?:账号|密码|验证码).{0,6}(?:给我|告诉我|发我|输入)/.test(`${label}${prompt}`)) continue;
    if (filterByIntentConstraints(intent, [label, prompt]).length < 2) continue;
    const key = label.replace(/[\s，。？！,.?!]/g, '');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ label, prompt });
    if (out.length >= 3) break;
  }
  return out;
}

/** What a repository accepts: 1–3 steps of the filtered shape. */
export function validNextSteps(steps: readonly NextStep[]): boolean {
  return (
    steps.length > 0 &&
    steps.length <= 3 &&
    steps.every(
      (step) =>
        typeof step?.label === 'string' &&
        typeof step.prompt === 'string' &&
        step.label.trim().length >= 4 &&
        step.label.length <= NEXT_STEP_LABEL_MAX &&
        step.prompt.trim().length >= 4 &&
        step.prompt.length <= NEXT_STEP_PROMPT_MAX,
    )
  );
}

/** `result.nextSteps` (what the page shows) and `result.followUpSuggestions` (the labels). */
export function nextStepsJsonSet(steps: readonly NextStep[]): SQL {
  return sql`JSON_SET(${tasks.result}, '$.followUpSuggestions', CAST(${JSON.stringify(steps.map((step) => step.label))} AS JSON), '$.nextSteps', CAST(${JSON.stringify(steps)} AS JSON))`;
}
