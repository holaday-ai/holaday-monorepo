import { isTerminalStatus, type UiTask } from '@/types/task';

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
  return isTerminalStatus(status);
}

/**
 * Per-plan history-retention filter. Splits the task list into the
 * tasks the user can still see (within their plan's `historyDays`)
 * and the count of older ones that are hidden (still on the server,
 * just not surfaced — we deliberately do NOT delete data, since BOSS
 * pointed out that real deletion would generate refund + complaint
 * tickets).
 *
 * Hidden count drives the "升级查看更早的任务" hint at the bottom of
 * the sidebar list. Pinned tasks bypass the cutoff so a user can
 * still get back to a task they explicitly marked important even
 * after their plan stops showing it by default.
 */
export interface RetentionResult {
  visible: UiTask[];
  hiddenCount: number;
}

export function applyHistoryRetention(
  tasks: UiTask[],
  historyDays: number,
  pinnedIds?: ReadonlySet<string>,
  now: Date = new Date(),
): RetentionResult {
  const cutoff = now.getTime() - historyDays * 86_400_000;
  const visible: UiTask[] = [];
  let hiddenCount = 0;
  for (const t of tasks) {
    if (pinnedIds && pinnedIds.has(t.taskId)) {
      visible.push(t);
      continue;
    }
    const ms = t.createdAt instanceof Date ? t.createdAt.getTime() : new Date(t.createdAt).getTime();
    // Tasks with unparseable createdAt stay visible — better to show
    // garbage than silently hide a real task on a clock skew.
    if (!Number.isFinite(ms) || ms >= cutoff) {
      visible.push(t);
    } else {
      hiddenCount += 1;
    }
  }
  return { visible, hiddenCount };
}
