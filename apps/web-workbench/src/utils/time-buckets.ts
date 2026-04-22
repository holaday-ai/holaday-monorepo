import type { UiTask } from '@/types/task';

/**
 * Group tasks into the sidebar's time buckets: 今天 / 本周 / 更早.
 * "本周" is days 1–6 behind today; day 0 is 今天 (not "本周 · 1 天前").
 * Tasks without a usable createdAt fall into 更早 as a conservative
 * default — better than surfacing garbage rows on top.
 *
 * Order within each bucket is preserved from the caller; the sidebar
 * feeds tasks newest-first (tasks.list is DESC id) so we keep that.
 */
export interface TaskBucket {
  key: 'today' | 'thisWeek' | 'earlier';
  title: string;
  tasks: UiTask[];
}

export function bucketByTime(tasks: UiTask[], now: Date = new Date()): TaskBucket[] {
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfWeek = startOfToday - 6 * 86_400_000;
  const today: UiTask[] = [];
  const thisWeek: UiTask[] = [];
  const earlier: UiTask[] = [];
  for (const t of tasks) {
    const ms = t.createdAt instanceof Date ? t.createdAt.getTime() : new Date(t.createdAt).getTime();
    if (Number.isFinite(ms) && ms >= startOfToday) today.push(t);
    else if (Number.isFinite(ms) && ms >= startOfWeek) thisWeek.push(t);
    else earlier.push(t);
  }
  const out: TaskBucket[] = [];
  if (today.length) out.push({ key: 'today', title: '今天', tasks: today });
  if (thisWeek.length) out.push({ key: 'thisWeek', title: '本周', tasks: thisWeek });
  if (earlier.length) out.push({ key: 'earlier', title: '更早', tasks: earlier });
  return out;
}

export function isTaskDeletable(status: UiTask['status']): boolean {
  return status === 'completed' || status === 'failed' || status === 'cancelled';
}
