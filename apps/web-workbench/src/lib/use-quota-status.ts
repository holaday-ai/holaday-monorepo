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
 * Lightweight cached fetcher for `quota.status`. Multiple components
 * (QuotaIndicator, InputArea, future: addon buy buttons) all need the
 * same numbers, and tRPC's batch link only dedupes concurrent calls
 * inside the same tick. This hook caches the last response in a
 * module-level ref keyed by `refreshKey`, so a sidebar + composer
 * mount on the same trigger only burn one round-trip.
 *
 * Stale-while-revalidate: the cache is returned immediately on
 * subsequent calls with the same refreshKey, and refetched on key
 * change. Keeps the input transition smooth (no flicker between
 * "loading" and "exhausted") when a task creation flips the gate.
 */
const cache = new Map<string, QuotaSnapshot>();

export function useQuotaStatus(refreshKey?: number | string): State {
  const cacheKey = String(refreshKey ?? 'default');
  const initial = cache.get(cacheKey) ?? null;
  const [snap, setSnap] = React.useState<QuotaSnapshot | null>(initial);
  const [loading, setLoading] = React.useState<boolean>(initial == null);

  React.useEffect(() => {
    let cancelled = false;
    setLoading((prev) => prev || snap == null);
    trpc.quota.status.query().then(
      (res) => {
        if (cancelled) return;
        const next = res as QuotaSnapshot;
        cache.set(cacheKey, next);
        setSnap(next);
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
  // intentionally only refetch on cacheKey changes
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cacheKey]);

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
