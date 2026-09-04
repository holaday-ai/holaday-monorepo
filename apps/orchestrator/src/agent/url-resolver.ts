/**
 * Trusted URL resolution for browser tasks.
 *
 * A model cannot prove that a candidate domain is official. This resolver
 * therefore accepts only URLs supplied by the user or canonical domains from
 * Holaday's curated site playbooks. Unknown and ambiguous names become an
 * explicit search-and-verify instruction instead of a guessed URL.
 */

import {
  type BrowserNetworkDecision,
  defaultBrowserNetworkPolicy,
} from './browser-network-policy.js';
import { matchPlaybooks } from './supercar/playbook-service.js';

type RejectionReason = Extract<BrowserNetworkDecision, { allowed: false }>['reason'];

export type UrlResolution =
  | { source: 'passthrough'; url: string }
  | { source: 'registry'; url: string }
  | { source: 'search_required' }
  | { source: 'rejected'; reason: RejectionReason };

export interface UrlSafetyPolicy {
  check(rawUrl: string): Promise<BrowserNetworkDecision>;
}

const NAVIGATION_REQUEST_CN =
  /^\s*(?:(?:请(?:你)?|帮我|请帮我|麻烦(?:你)?|我要|我想(?:要)?)\s*)?(?:打开|访问|去|进入|浏览)\s*\S/u;
const NAVIGATION_REQUEST_EN =
  /^\s*(?:(?:please|(?:can|could|would) you)\s+)?(?:open|go to|visit|navigate to|browse)\s+\S/i;
const EXPLICIT_URI_REGEX = /\b[a-z][a-z0-9+.-]*:(?:\/\/)?[^\s"'<>]+/i;
const TRAILING_SENTENCE_PUNCTUATION = /[),.;!?，。；！？）】》]+$/u;

export async function resolveIntentUrl(
  intent: string,
  opts: { networkPolicy?: UrlSafetyPolicy } = {},
): Promise<UrlResolution | null> {
  if (!intent.trim()) return null;

  const networkPolicy = opts.networkPolicy ?? defaultBrowserNetworkPolicy;
  const explicitUri = EXPLICIT_URI_REGEX.exec(intent)?.[0]?.replace(
    TRAILING_SENTENCE_PUNCTUATION,
    '',
  );
  if (explicitUri) {
    return resolveSafeUrl(explicitUri, 'passthrough', networkPolicy);
  }

  if (!NAVIGATION_REQUEST_CN.test(intent) && !NAVIGATION_REQUEST_EN.test(intent)) return null;
  if (!extractSiteToken(intent)) return null;

  const playbooks = matchPlaybooks(intent);
  if (playbooks.length !== 1) return { source: 'search_required' };

  return resolveSafeUrl(`https://${playbooks[0]?.domain}/`, 'registry', networkPolicy);
}

async function resolveSafeUrl(
  rawUrl: string,
  source: 'passthrough' | 'registry',
  networkPolicy: UrlSafetyPolicy,
): Promise<UrlResolution> {
  const decision = await networkPolicy.check(rawUrl);
  if (!decision.allowed) return { source: 'rejected', reason: decision.reason };
  return { source, url: decision.url };
}

/**
 * Best-effort extraction used only to decide whether a navigation request has
 * a non-empty site name. The extracted value is never logged or persisted.
 */
export function extractSiteToken(intent: string): string {
  const trimmed = intent.trim();

  const quoted = /[""'「『]([^""'」』\n]{2,64})[""'」』]/.exec(trimmed);
  if (quoted?.[1]) return quoted[1].trim();

  let rest = trimmed
    .replace(/^\s*(打开|访问|去|进入|浏览|上)\s*/, '')
    .replace(/^\s*(open|go to|visit|navigate to|browse)\s+/i, '')
    .trim();
  if (!rest) return '';

  const domain = /([\w-]{2,64}(?:\.[\w-]{2,12}){1,3})/.exec(rest);
  if (domain?.[1]) return domain[1];

  rest = rest.split(/[\s，,。.、；;：:]/)[0] ?? rest;
  return rest.trim().slice(0, 64);
}

export function injectResolvedUrl(intent: string, resolution: UrlResolution): string {
  if (resolution.source === 'passthrough') return intent;

  const trimmed = intent.trim();
  if (resolution.source === 'registry') {
    const annotation = `系统可信站点映射：${resolution.url}`;
    return trimmed.includes(annotation) ? intent : `${trimmed}（${annotation}）`;
  }

  if (resolution.source === 'search_required') {
    const instruction =
      '系统安全提示：未找到唯一可信站点映射。先通过搜索结果核对官方网站域名，再导航；不要根据名称猜测域名。';
    return trimmed.includes(instruction) ? intent : `${trimmed}（${instruction}）`;
  }

  const instruction = '系统安全提示：目标网址未通过安全校验，不要导航。';
  return trimmed.includes(instruction) ? intent : `${trimmed}（${instruction}）`;
}

export function toSafeUrlResolutionLog(resolution: UrlResolution): {
  outcome: UrlResolution['source'];
  reason?: RejectionReason;
} {
  return resolution.source === 'rejected'
    ? { outcome: resolution.source, reason: resolution.reason }
    : { outcome: resolution.source };
}
