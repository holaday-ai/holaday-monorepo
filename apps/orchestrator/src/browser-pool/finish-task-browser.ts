import type { BrowserPool } from './index.js';

/** Human CAPTCHA timeout/cancel must not enter the terminal review-retention path. */
export async function finishTaskBrowser(
  pool: Pick<BrowserPool, 'retain' | 'release'>,
  taskId: string,
  retentionMs: number,
  retainForReview: boolean,
): Promise<void> {
  if (retainForReview && pool.retain(taskId, retentionMs, 'terminal-review')) return;
  await pool.release(taskId, `task-${taskId}-done`);
}
