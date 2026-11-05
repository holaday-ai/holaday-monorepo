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
- 结果是「部分完成」或「失败」时，第一条必须是补齐缺口的那一步（换个来源/换个时间/换个方式拿到缺的那部分）；失败的原因是需要登录或人机验证时，可以提议「你登录后我接着看」，但绝不提议替用户输入账号密码或绕过验证。
- label：助理主动提议的口吻，第一人称，简短自然，可以用问句，例如「今天开盘后我再帮你拉一次实时点位，跟昨天收盘对比？」，不超过 30 个字。
- prompt：用户点了之后发给你的完整指令，用户的口吻，单独拿出来也能直接执行（写清对象、网站、要什么），不超过 150 个字。
- 继承用户原话里的限制：用户说过「不要提交/不要购买/不要发送/不要点击…」，提议里绝不能出现相反的动作。
- 不给买卖、投资建议，不预测涨跌；不出现内部工具名、网址参数或服务商名字。
- 不提议换浏览器内核、伪装身份、换 IP、走代理或任何规避网站限制的做法。
- 没有真正有价值的下一步就返回空数组，宁缺毋滥。

只回复 JSON，不要其他文字，格式：{"steps":[{"label":"…","prompt":"…"}]}`;

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
}

const OUTCOME_LABEL: Record<NextStepsOutcome, string> = {
  completed: '完成',
  partial: '部分完成',
  failed: '失败',
};

export function nextStepsUserMessage(opts: Omit<GenerateNextStepsOptions, 'messagesAdapter'>) {
  const recent = (opts.recentIntents ?? [])
    .map((intent) => intent.replace(/\s+/g, ' ').trim().slice(0, 80))
    .filter(Boolean)
    .slice(0, 5);
  return [
    `用户这次的要求：${opts.intent}`,
    `结果：${OUTCOME_LABEL[opts.outcome]}`,
    `${opts.outcome === 'failed' ? '失败原因' : '结果内容'}：${opts.summary.slice(0, 1200)}`,
    opts.missing ? `没拿到的部分：${opts.missing.slice(0, 300)}` : '',
    recent.length ? `用户最近的其他任务：\n${recent.map((r) => `- ${r}`).join('\n')}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

export async function generateNextSteps(opts: GenerateNextStepsOptions): Promise<NextStep[]> {
  if (!opts.intent.trim() || !opts.summary.trim()) return [];
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
    return [];
  }
  return filterNextSteps(opts.intent, parseNextSteps(raw));
}

/** Internal references and provider names never reach the person. */
const INTERNAL_RE =
  /\b(?:tab|frame)_[\w-]+|\bref\s*=\s*\S+|\[ref=[^\]]*\]|\b(?:firecrawl|brave|playwright|browserbase|qwen|dashscope|anthropic|claude|openai|gpt-\S+|tavily|serpapi)\b|read_page|get_page_text|web_search|snapshot|request_human/i;
const BANNED_RE =
  /温馨提示|购买建议|风险提示|免责声明|买入|卖出|加仓|减仓|抄底|会涨|会跌|涨跌预测|内核|指纹|伪装|代理|换\s*IP|user[\s-]?agent|破解/i;

/** Tolerant parse: a fenced block, a bare object, or a bare array of either shape. */
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
    if (typeof item === 'string') {
      out.push({ label: item.trim(), prompt: item.trim() });
      continue;
    }
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

/** Shape, safety and the user's own prohibitions; at most 3, no duplicates. */
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
