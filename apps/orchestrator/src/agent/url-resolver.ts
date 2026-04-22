/**
 * URL resolver — one-shot Anthropic call that turns a colloquial
 * reference ("openclaw", "BOSS直聘") into an authoritative URL BEFORE
 * the commander starts guessing. Without this, Claude routinely
 * hallucinates TLDs: "openclaw" → openclaw.cn (squatter), "ying2" →
 * ying2.com (unrelated), etc.
 *
 * Policy:
 *   - If the intent already contains a full http(s) URL, return as-is
 *     (no extra API spend).
 *   - Otherwise, extract the site-name-ish token and ask Claude for
 *     the official URL. Failure (API down, vague intent) is non-fatal
 *     — we return `null` and the commander proceeds with its normal
 *     plan (which now, after the prompt update, prefers Google search
 *     for unknown names over blind guessing).
 */

import type Anthropic from '@anthropic-ai/sdk';
import { logger } from '../config/logger.js';

export interface UrlResolution {
  /** The URL we decided should be injected into the intent. */
  url: string;
  /** Short token from the intent that triggered resolution (e.g. "openclaw"). */
  token: string;
  /** One of `passthrough` (URL was already in intent), `model` (Claude resolved), `skipped`. */
  source: 'passthrough' | 'model';
}

const NAV_VERBS_CN = /打开|访问|去|进入|浏览|上/;
const NAV_VERBS_EN = /\b(open|go to|visit|navigate to|browse)\b/i;
const URL_REGEX = /https?:\/\/[^\s"'<>]+/i;

/**
 * Run the resolver against a user intent. Returns `null` when there's
 * nothing to do (no nav verb, empty intent) — caller leaves the intent
 * untouched.
 */
export async function resolveIntentUrl(
  intent: string,
  opts: { client: Anthropic | null; model?: string },
): Promise<UrlResolution | null> {
  if (!intent || !intent.trim()) return null;

  const hasUrl = URL_REGEX.exec(intent);
  if (hasUrl) {
    return { url: hasUrl[0], token: hasUrl[0], source: 'passthrough' };
  }

  // Only spend an Anthropic call when the intent actually asks us to
  // *navigate* somewhere. "查 AAPL 股价" doesn't imply a specific URL —
  // commander's search-first prompt handles that.
  if (!NAV_VERBS_CN.test(intent) && !NAV_VERBS_EN.test(intent)) {
    return null;
  }

  const token = extractSiteToken(intent);
  if (!token) return null;
  if (!opts.client) return null;

  const system =
    '你是一个 URL 查找助手。用户会给你一个站点名称或关键词，你返回最可能的官方网站 URL（包含 https://），仅返回一行 URL，不要任何其他文字、引号、markdown 或说明。如果你不确定，返回空字符串。';
  const prompt = `用户要求打开「${token}」。请返回官方网站 URL。`;

  try {
    const resp = await opts.client.messages.create({
      model: opts.model ?? 'claude-haiku-4-5-20251001',
      max_tokens: 128,
      system,
      messages: [{ role: 'user', content: prompt }],
    });
    const text = resp.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('')
      .trim();
    const match = URL_REGEX.exec(text);
    if (!match) {
      logger.info({ token, reply: text.slice(0, 200) }, 'urlResolve: model returned no URL');
      return null;
    }
    const url = match[0];
    logger.info({ action: 'urlResolve', token, url }, 'urlResolve: model resolved');
    return { url, token, source: 'model' };
  } catch (err) {
    logger.warn(
      { token, err: err instanceof Error ? err.message : String(err) },
      'urlResolve: model call failed — commander will fall back to search',
    );
    return null;
  }
}

/**
 * Best-effort "give me the thing-to-resolve" extraction. The input is
 * a natural-language sentence; we strip the leading navigation verb
 * and keep the first quoted substring, CJK run, or domain-like token.
 * Never throws — returns `''` when we can't find anything useful (the
 * caller then skips the API call).
 */
export function extractSiteToken(intent: string): string {
  const trimmed = intent.trim();

  // Quoted "name" wins first.
  const quoted = /[""'「『]([^""'」』\n]{2,64})[""'」』]/.exec(trimmed);
  if (quoted?.[1]) return quoted[1].trim();

  // Strip CN / EN navigation verbs from the head.
  let rest = trimmed
    .replace(/^\s*(打开|访问|去|进入|浏览|上)\s*/, '')
    .replace(/^\s*(open|go to|visit|navigate to|browse)\s+/i, '')
    .trim();
  if (!rest) return '';

  // Prefer a bare-word domain if present (openclaw.com, boss.cn).
  const domain = /([\w-]{2,64}(?:\.[\w-]{2,12}){1,3})/.exec(rest);
  if (domain?.[1]) return domain[1];

  // Otherwise: chop at the first separator (space, punctuation) so
  // we keep just the name, not the whole "打开 X 然后做 Y" tail.
  rest = rest.split(/[\s，,。.、；;：:]/)[0] ?? rest;
  return rest.trim().slice(0, 64);
}

/**
 * Rewrite the intent so the commander sees both the original phrasing
 * AND the resolved URL. Commander's prompt already tells it to prefer
 * `computer_navigate`, so embedding the URL as a parenthetical hint
 * is enough — no need for templated output.
 */
export function injectResolvedUrl(intent: string, resolution: UrlResolution): string {
  if (resolution.source === 'passthrough') return intent;
  const trimmed = intent.trim();
  if (trimmed.includes(resolution.url)) return intent;
  return `${trimmed}（系统确认 URL: ${resolution.url}）`;
}
