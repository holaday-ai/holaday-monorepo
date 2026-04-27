import * as React from 'react';
import { trpc } from '@/lib/trpc';

export interface QuotaSnapshot {
  plan: string;
  period: 'day' | 'month';
  tasksUsed: number;
  tasksLimit: number;
  tasksRemaining: number;
  bonusTasks: number;
  opusUsed: number;
  opusLimit: number | null;
  opusRemaining: number | null;
  bonusOpus: number;
  concurrentCount: number;
  concurrencyLimit: number;
}

interface State {
  snap: QuotaSnapshot | null;
  loading: boolean;
}

/**
 * Plain fetcher for `quota.status` keyed by `refreshKey`. No cache —
 * the earlier stale-while-revalidate version triggered a React
 * useSyncExternalStore stability error in prod (#310) when combined
 * with the workbench's existing zustand subscriptions, since the
 * cached object identity flipped between renders inside the
 * useState initializer. Plain hook keeps the API the same and lets
 * tRPC's batch link dedupe overlapping calls when QuotaIndicator
 * and the input gate refetch on the same task-list change.
 */
export function useQuotaStatus(refreshKey?: number | string): State {
  const [snap, setSnap] = React.useState<QuotaSnapshot | null>(null);
  const [loading, setLoading] = React.useState<boolean>(true);

  React.useEffect(() => {
    let cancelled = false;
    setLoading(true);
    trpc.quota.status.query().then(
      (res) => {
        if (cancelled) return;
        setSnap(res as QuotaSnapshot);
        setLoading(false);
      },
      () => {
        if (cancelled) return;
        setLoading(false);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  return { snap, loading };
}

/**
 * Convenience: did the user run out of standard tasks for the
 * current period? Excludes Opus (which auto-downgrades to Sonnet
 * server-side rather than blocking).
 */
export function isQuotaExhausted(snap: QuotaSnapshot | null): boolean {
  if (!snap) return false;
  return snap.tasksRemaining <= 0;
}
