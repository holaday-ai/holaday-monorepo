/**
 * Domain enricher — loads the per-domain YAML config and composes a
 * Chinese prompt fragment to append to `VISION_SYSTEM_PROMPT`.
 *
 * Loading is memoised because the files never change between process
 * starts, and the YAML parse is non-trivial. Missing YAML for a
 * classified domain logs a warning and returns empty (fall-through to
 * general), NOT an error — a misconfigured deploy should degrade to
 * generic commander behaviour, not crash tasks.
 *
 * The output is intentionally append-to-end: the base prompt already
 * defines action semantics + safety rules; this fragment adds
 * domain-specific analysis style so the model has concrete heuristics
 * the base prompt stays neutral about.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import { logger } from '../../../config/logger.js';
import type { DomainName } from './classifier.js';

interface RecommendedSource {
  readonly name: string;
  readonly url: string;
  readonly use_for: string;
}

export interface DomainConfig {
  readonly domain: DomainName;
  readonly keywords: readonly string[];
  readonly analysis_framework: string;
  readonly recommended_sources: readonly RecommendedSource[];
  readonly output_format: string;
  readonly disclaimer: string;
}

const CACHE = new Map<DomainName, DomainConfig | null>();

/**
 * Clear the memoised YAML cache. Only useful in tests / hot-reload
 * scenarios — prod never calls this.
 */
export function clearDomainCache(): void {
  CACHE.clear();
}

export function loadDomainConfig(domain: DomainName): DomainConfig | null {
  if (domain === 'general') return null;
  if (CACHE.has(domain)) return CACHE.get(domain) ?? null;
  const here = dirname(fileURLToPath(import.meta.url));
  const path = join(here, 'domains', `${domain}.yaml`);
  try {
    const raw = readFileSync(path, 'utf8');
    const parsed = yaml.load(raw) as Partial<DomainConfig> | null;
    if (!parsed || typeof parsed !== 'object') {
      logger.warn({ domain, path }, 'domain YAML parsed to non-object — treating as absent');
      CACHE.set(domain, null);
      return null;
    }
    const cfg: DomainConfig = {
      domain,
      keywords: parsed.keywords ?? [],
      analysis_framework: (parsed.analysis_framework ?? '').trim(),
      recommended_sources: parsed.recommended_sources ?? [],
      output_format: (parsed.output_format ?? '').trim(),
      disclaimer: (parsed.disclaimer ?? '').trim(),
    };
    CACHE.set(domain, cfg);
    return cfg;
  } catch (err) {
    logger.warn(
      { domain, path, err: err instanceof Error ? err.message : String(err) },
      'failed to load domain YAML — falling back to general',
    );
    CACHE.set(domain, null);
    return null;
  }
}

/**
 * Compose the prompt fragment for a classified domain. Returns an
 * empty string for `general` or any domain whose YAML is missing /
 * malformed — callers can append unconditionally without worrying
 * about extra whitespace.
 */
export function buildDomainPrompt(domain: DomainName): string {
  if (domain === 'general') return '';
  const cfg = loadDomainConfig(domain);
  if (!cfg) return '';
  const sourcesBlock = cfg.recommended_sources
    .map((s) => `- **${s.name}** (${s.url}) — ${s.use_for}`)
    .join('\n');
  const lines = [
    '',
    '---',
    `# 领域：${cfg.domain}`,
    '',
    '## 分析框架',
    cfg.analysis_framework,
    '',
    ...(sourcesBlock
      ? ['## 推荐数据源（按权威性排序）', sourcesBlock, '']
      : []),
    '## 输出格式',
    cfg.output_format,
    '',
    ...(cfg.disclaimer ? ['## 免责声明', cfg.disclaimer] : []),
  ];
  return lines.join('\n');
}
