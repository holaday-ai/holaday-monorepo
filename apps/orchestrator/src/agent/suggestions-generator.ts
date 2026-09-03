/**
 * Post-task suggestion generator.
 *
 * Spec calls out that the agent's in-summary `suggestions` JSON block
 * is unreliable — Claude omits it under some prompts. This module
 * makes generation backend-driven instead: after a task reaches
 * `completed`, the caller fires `generateSuggestions(intent, summary)`
 * and broadcasts the resulting array via the
 * `server.supercar.suggestions` WS frame.
 *
 * Cheap by design: one provider-neutral call, capped at 200 output tokens,
 * no thinking and no tools. Failures are absorbed (returns empty array)
 * so a slow / errored generation never visibly degrades the task UI.
 */

import type { MessagesAdapter } from '../llm/messages-adapter.js';

const MAX_TOKENS = 200;

const SYSTEM_PROMPT = `根据用户的任务和结果，给出 2-3 个用户可能想继续做的相关任务。

要求：
- 每条 8-20 字，**完整可执行的下一个任务**（不是问题、不是建议、不是温馨提示）
- 跟当前任务高度相关：用户做完了 X，下一步合理想做的 Y
- 不要写："购买建议"、"温馨提示"、"数据来源"、"风险提示"、问号结尾的句子

**约束继承（重要）**：如果用户的原始任务里包含禁止/限制条件
（如"不要提交""不要购买""不要发送""别下单""不要点击 Submit"等），
你生成的建议**绝不能**包含相反的动作。例如：
- 用户说"打开表单但不要提交" → 建议不能包含"提交表单""点击 Submit""完成提交"
- 用户说"加入购物车但不要付款" → 建议不能包含"付款""下单""购买"
- 用户说"起草邮件但不要发送" → 建议不能包含"发送""发出"
约束在多步任务里仍然有效——下一步任务也要遵守原始约束。

只回复 JSON 数组，不要其他文字。例如：["搜索东京酒店","比较机票价格","查看签证要求"]`;

export interface GenerateSuggestionsOptions {
  messagesAdapter: MessagesAdapter;
  intent: string;
  /** Final task summary text. Truncated to 500 chars before sending. */
  summary: string;
}

/**
 * Single provider-neutral call returning a parsed string[]. Never throws —
 * returns [] on any parse / API failure. Filters out empties + dups
 * + over-length items so the caller can render directly.
 */
export async function generateSuggestions(opts: GenerateSuggestionsOptions): Promise<string[]> {
  if (!opts.intent || !opts.summary) return [];
  // Pass the FULL intent — earlier callsites used to truncate it,
  // which dropped tail-of-sentence prohibitions like "...但不要提交".
  // The summary stays capped because it's bigger and the gist is in
  // the head.
  const userMsg = `任务：${opts.intent}\n结果摘要：${opts.summary.slice(0, 500)}`;
  let raw = '';
  try {
    const resp = await opts.messagesAdapter.create({
      maxTokens: MAX_TOKENS,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userMsg }],
    });
    for (const b of resp.content) {
      if (b.type === 'text') raw += b.text;
    }
  } catch {
    return [];
  }
  const candidates = parseSuggestions(raw);
  return filterByIntentConstraints(opts.intent, candidates);
}

/**
 * Each entry pairs a "user said don't do X" pattern in the intent
 * with the verbs that constitute X in a follow-up suggestion. If
 * the intent matches the prohibition pattern, any suggestion that
 * contains one of the banned verbs is dropped.
 *
 * Belt-and-suspenders next to the prompt-side constraint: the LLM
 * usually obeys, but this filter is what catches the once-in-50
 * regression where it forgets.
 */
const INTENT_CONSTRAINT_RULES: ReadonlyArray<{
  prohibition: RegExp;
  banned: RegExp;
}> = [
  // 不要提交 / 不提交 / 别提交 / 不要点击 Submit ...
  {
    prohibition: /(不要|不|别|禁止|勿)(提交|点击\s*submit|点\s*submit|submit)/i,
    banned: /(提交|完成提交|点击\s*submit|点\s*submit|submit\s*(订单|表单|order|form))/i,
  },
  // 不要发送 / 不发送 / 别发送 / 不要 send ...
  {
    prohibition: /(不要|不|别|禁止|勿)(发送|发出|寄出|send)/i,
    banned: /(发送|发出|寄出|send\s+(?:the\s+)?(?:email|message|邮件))/i,
  },
  // 不要购买 / 不购买 / 别购买 / 不要下单 / 别下单 / 不要付款 ...
  {
    prohibition: /(不要|不|别|禁止|勿)(购买|下单|付款|支付|结账|结算|buy|order|pay|checkout)/i,
    banned: /(购买|下单|付款|支付|结账|结算|buy|place\s+order|checkout)/i,
  },
  // 不要点击 (general click prohibitions — narrower banned to avoid
  // killing every "查看…" suggestion that contains 点)
  {
    prohibition: /(不要|不|别|禁止|勿)点击/,
    banned: /(点击|tap)/,
  },
];

export function filterByIntentConstraints(
  intent: string,
  suggestions: readonly string[],
): string[] {
  const active = INTENT_CONSTRAINT_RULES.filter((r) => r.prohibition.test(intent));
  if (active.length === 0) return [...suggestions];
  return suggestions.filter((s) => !active.some((r) => r.banned.test(s)));
}

/**
 * Tolerant JSON parser. The model is instructed to output bare JSON
 * but sometimes wraps it in fenced blocks ("```json\n[...]\n```")
 * or prefaces with a polite intro. Extract the first array from the
 * response and parse it; on any failure return [].
 */
export function parseSuggestions(raw: string): string[] {
  if (!raw) return [];
  const trimmed = raw.trim();
  // Strip a leading ```json / ``` fence if present.
  const fenced = trimmed.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/i);
  const candidate = fenced?.[1] ? fenced[1].trim() : trimmed;
  // Find the first `[...]` JSON array (greedy so nested commas survive).
  const arrayMatch = candidate.match(/\[[\s\S]*\]/);
  const jsonText = arrayMatch ? arrayMatch[0] : candidate;
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of parsed) {
    if (typeof item !== 'string') continue;
    const s = item.trim();
    // 6..40 chars covers the spec's "8-20" target with slack for
    // edge-case longer Chinese phrases. Reject anything that looks
    // like a question or contains banned keywords.
    if (s.length < 4 || s.length > 40) continue;
    if (s.endsWith('?') || s.endsWith('？')) continue;
    if (/温馨提示|购买建议|数据来源|风险提示|免责声明/.test(s)) continue;
    if (seen.has(s)) continue;
    seen.add(s);
    out.push(s);
    if (out.length >= 3) break;
  }
  return out;
}
