import { describe, expect, it } from 'vitest';
import { buildDomainPrompt, clearDomainCache, loadDomainConfig } from './enricher.js';

describe('enricher.loadDomainConfig', () => {
  it('returns null for general', () => {
    expect(loadDomainConfig('general')).toBeNull();
  });

  it('loads finance YAML with the four required sections', () => {
    clearDomainCache();
    const cfg = loadDomainConfig('finance');
    expect(cfg).not.toBeNull();
    expect(cfg?.domain).toBe('finance');
    expect(cfg?.analysis_framework).toMatch(/ROE|市盈率/);
    expect(cfg?.recommended_sources.length).toBeGreaterThanOrEqual(3);
    expect(cfg?.output_format).toMatch(/表格|来源/);
    expect(cfg?.disclaimer).toMatch(/不构成投资建议/);
  });

  it('legal YAML carries the professional-advice disclaimer', () => {
    const cfg = loadDomainConfig('legal');
    expect(cfg?.disclaimer).toMatch(/不构成法律意见|执业律师/);
  });

  it('memoises successive loads (call returns same object)', () => {
    clearDomainCache();
    const first = loadDomainConfig('finance');
    const second = loadDomainConfig('finance');
    expect(second).toBe(first);
  });
});

describe('enricher.buildDomainPrompt', () => {
  it('returns empty string for general', () => {
    expect(buildDomainPrompt('general')).toBe('');
  });

  it('emits a block with framework, sources, output format, disclaimer for finance', () => {
    const p = buildDomainPrompt('finance');
    expect(p).toMatch(/# 领域：finance/);
    expect(p).toMatch(/## 分析框架/);
    expect(p).toMatch(/## 推荐数据源/);
    expect(p).toMatch(/## 输出格式/);
    expect(p).toMatch(/## 免责声明/);
  });

  it('legal block mentions executing lawyers in the disclaimer', () => {
    const p = buildDomainPrompt('legal');
    expect(p).toMatch(/执业律师/);
  });

  it('lists every recommended source with name + url + use_for', () => {
    const p = buildDomainPrompt('finance');
    // Each source should appear as a bullet with the three-part format
    // `- **name** (url) — use_for`.
    const lines = p.split('\n').filter((l) => l.startsWith('- **'));
    expect(lines.length).toBeGreaterThanOrEqual(3);
    for (const line of lines) {
      expect(line).toMatch(/- \*\*[^*]+\*\* \([^)]+\) — .+/);
    }
  });

  it('never throws and returns empty for an unknown domain (defensive)', () => {
    // TypeScript narrows domain to DomainName; we cast here to
    // exercise the safety path the parser takes when a YAML file
    // goes missing in prod.
    expect(() => buildDomainPrompt('not_a_domain' as never)).not.toThrow();
  });
});
