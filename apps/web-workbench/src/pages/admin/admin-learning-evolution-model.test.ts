import { describe, expect, it } from 'vitest';
import { formatRate, normalizeEvolution } from './admin-learning-evolution-model';

describe('学习引擎 · 自进化闭环 view-model', () => {
  it('normalises the evolution metrics payload', () => {
    const n = normalizeEvolution({
      paths: { total: 7, draft: 2, verified: 4, stale: 1 },
      canary: { runs: 20, passed: 18, passRate: 90 },
      reuse: { attempts: 10, hits: 9, repaired: 2, hitRate: 90 },
      modelCallsSaved: 41,
      windowDays: 30,
    });
    expect(n).toEqual({
      paths: { total: 7, verified: 4, draft: 2, stale: 1 },
      canary: { runs: 20, passRate: 90 },
      reuse: { attempts: 10, hits: 9, repaired: 2, hitRate: 90 },
      modelCallsSaved: 41,
      windowDays: 30,
    });
  });

  it('degrades safely on missing or malformed data', () => {
    const n = normalizeEvolution(null);
    expect(n.paths.total).toBe(0);
    expect(n.canary.passRate).toBeNull();
    expect(n.reuse.hitRate).toBeNull();
    expect(n.windowDays).toBe(30);
    expect(normalizeEvolution({ canary: { passRate: 140 } }).canary.passRate).toBe(100);
  });

  it('formats rates with one decimal and a dash when unknown', () => {
    expect(formatRate(92.34)).toBe('92.3%');
    expect(formatRate(null)).toBe('—');
  });
});
