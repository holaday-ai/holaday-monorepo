/** Batch 06 — pure view-model for the 学习引擎 · 自进化闭环 panel. */
import { asRecord, nonNegativeNumber } from './admin-shared';

export interface NormalizedEvolution {
  paths: { total: number; verified: number; draft: number; stale: number };
  canary: { runs: number; passRate: number | null };
  reuse: { attempts: number; hits: number; repaired: number; hitRate: number | null };
  modelCallsSaved: number;
  windowDays: number;
}

function rate(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(100, Math.max(0, value))
    : null;
}

export function normalizeEvolution(value: unknown): NormalizedEvolution {
  const root = asRecord(value);
  const paths = asRecord(root.paths);
  const canary = asRecord(root.canary);
  const reuse = asRecord(root.reuse);
  return {
    paths: {
      total: nonNegativeNumber(paths.total),
      verified: nonNegativeNumber(paths.verified),
      draft: nonNegativeNumber(paths.draft),
      stale: nonNegativeNumber(paths.stale),
    },
    canary: { runs: nonNegativeNumber(canary.runs), passRate: rate(canary.passRate) },
    reuse: {
      attempts: nonNegativeNumber(reuse.attempts),
      hits: nonNegativeNumber(reuse.hits),
      repaired: nonNegativeNumber(reuse.repaired),
      hitRate: rate(reuse.hitRate),
    },
    modelCallsSaved: nonNegativeNumber(root.modelCallsSaved),
    windowDays: nonNegativeNumber(root.windowDays) || 30,
  };
}

export function formatRate(value: number | null): string {
  return value == null ? '—' : `${value.toFixed(1)}%`;
}
