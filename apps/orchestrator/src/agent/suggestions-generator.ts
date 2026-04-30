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
 * Cheap by design: one Sonnet call, capped at 200 output tokens, no
 * thinking, no tools. Failures are absorbed (returns empty array)
 * so a slow / errored generation never visibly degrades the task UI.
 */

import Anthropic from '@anthropic-ai/sdk';

const MODEL = 'claude-sonnet-4-6';
const MAX_TOKENS = 200;

const SYSTEM_PROMPT = `根据用户的任务和结果，给出 2-3 个用户可能想继续做的相关任务。

要求：
- 每条 8-20 字，**完整可执行的下一个任务**（不是问题、不是建议、不是温馨提示）
- 跟当前任务高度相关：用户做完了 X，下一步合理想做的 Y
- 不要写："购买建议"、"温馨提示"、"数据来源"、"风险提示"、问号结尾的句子

只回复 JSON 数组，不要其他文字。例如：["搜索东京酒店","比较机票价格","查看签证要求"]`;

export interface GenerateSuggestionsOptions {
  apiKey: string;
  intent: string;
  /** Final task summary text. Truncated to 500 chars before sending. */
  summary: string;
  /**
   * Override the default model. Useful in tests; production callers
   * should let the default Sonnet handle this.
   */
  model?: string;
}

/**
 * Single Anthropic call returning a parsed string[]. Never throws —
 * returns [] on any parse / API failure. Filters out empties + dups
 * + over-length items so the caller can render directly.
 */
export async function generateSuggestions(
  opts: GenerateSuggestionsOptions,
): Promise<string[]> {
  if (!opts.apiKey || !opts.intent || !opts.summary) return [];
  const client = new Anthropic({ apiKey: opts.apiKey });
  const userMsg = `任务：${opts.intent}\n结果摘要：${opts.summary.slice(0, 500)}`;
  let raw = '';
  try {
    const resp = await client.messages.create({
      model: opts.model ?? MODEL,
      max_tokens: MAX_TOKENS,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userMsg }],
    });
    for (const b of resp.content) {
      if (b.type === 'text') raw += b.text;
    }
  } catch {
    return [];
  }
  return parseSuggestions(raw);
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
  const candidate = fenced && fenced[1] ? fenced[1].trim() : trimmed;
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
