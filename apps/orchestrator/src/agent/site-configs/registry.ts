/**
 * Phase 3 R2 — SiteConfig registry + URL matching.
 *
 * Pure-function lookup: given a URL, return the matching SiteConfig
 * (or null). No I/O, no Playwright deps — easy to unit test.
 */
import { DOUYIN_COMPASS_SITE_CONFIG } from './douyin-compass.js';
import { TAOBAO_SITE_CONFIG } from './taobao.js';
import { WEIBO_SITE_CONFIG } from './weibo.js';
import { XIAOHONGSHU_SITE_CONFIG } from './xiaohongshu.js';
import { ZHIHU_SITE_CONFIG } from './zhihu.js';
import type { SiteConfig } from './types.js';

const ALL_SITE_CONFIGS: readonly SiteConfig[] = [
  XIAOHONGSHU_SITE_CONFIG,
  DOUYIN_COMPASS_SITE_CONFIG,
  TAOBAO_SITE_CONFIG,
  ZHIHU_SITE_CONFIG,
  WEIBO_SITE_CONFIG,
];

/**
 * Match a URL to a registered config. Returns the FIRST match —
 * configs shouldn't have overlapping domain lists, but if they do,
 * registration order in `ALL_SITE_CONFIGS` decides priority.
 *
 * Match rule: lowerHost === domain OR lowerHost.endsWith('.' + domain).
 * Subdomain match is intentionally permissive (`m.zhihu.com` →
 * zhihu config) but won't false-match `evil.zhihu.com.attacker.com`
 * because the literal `.attacker.com` suffix breaks the endsWith
 * check.
 *
 * Returns null on:
 *   - URL parse failure (malformed input)
 *   - Non-http(s) scheme (chrome:// / about:blank / data: etc.)
 *   - Host that no config covers
 */
export function matchSiteConfig(url: string | null | undefined): SiteConfig | null {
  if (!url) return null;
  let host: string;
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    host = u.host.toLowerCase();
  } catch {
    return null;
  }
  if (!host) return null;
  for (const cfg of ALL_SITE_CONFIGS) {
    for (const d of cfg.domains) {
      const dLower = d.toLowerCase();
      if (host === dLower || host.endsWith('.' + dLower)) return cfg;
    }
  }
  return null;
}

/**
 * Test-only — list every registered config (for shape introspection).
 */
export function _getAllSiteConfigsForTest(): readonly SiteConfig[] {
  return ALL_SITE_CONFIGS;
}
