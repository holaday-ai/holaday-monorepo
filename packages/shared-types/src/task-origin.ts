/**
 * Phase 1 指令 #3 — `tasks.origin` 隔离边界 (Playbook + Evidence Ledger 设计 §5.6).
 *
 * Every row in `tasks` carries an `origin`. It is the hard boundary that
 * keeps user-facing history / quota / KPI queries from mixing with the
 * internal Playbook machinery and the eval harness:
 *
 *   - `user`                 用户在产品中主动创建或回复触发的任务。
 *   - `playbook_canary`      Playbook operation-path 验证任务 (Pack C)。
 *   - `playbook_exploration` Playbook seed/exploration 复用 task 链路时创建的任务 (Pack C)。
 *   - `eval`                 自动评测 / 回归 / internal eval 任务。
 *
 * The column defaults to `'user'` (see `tasks.origin` schema + migration
 * 0033), so every existing row and every untagged insert is a user task.
 * All user-side stats / history / KPI queries MUST filter `origin='user'`;
 * canary / exploration / eval tasks never enter the sidebar, usage page,
 * or product KPIs. See design §5.6 for the per-query checklist.
 */

export const TASK_ORIGINS = ['user', 'playbook_canary', 'playbook_exploration', 'eval'] as const;

export type TaskOrigin = (typeof TASK_ORIGINS)[number];

/** Default origin for any task not explicitly tagged. Matches the DB column default. */
export const DEFAULT_TASK_ORIGIN: TaskOrigin = 'user';

/** True when the origin denotes a real product user task (vs. internal/eval). */
export function isUserOrigin(origin: string | null | undefined): boolean {
  return (origin ?? DEFAULT_TASK_ORIGIN) === 'user';
}
