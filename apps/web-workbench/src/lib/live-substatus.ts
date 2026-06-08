/**
 * Whether the live sub-status chip ("正在操作浏览器 / 仍在执行网页操作 /
 * 你可以继续等待" + elapsed timer) should render for a task.
 *
 * It must NOT show once the task parks in `awaiting_user`: the
 * 需要登录 / 需要你回复 banner is the authoritative state, and a stale
 * "browsing" chip plus the "复杂站点可能需要几分钟，你可以继续等待"
 * long-running hint directly contradicts it — the user is told to wait
 * while actually being asked to log in, and the still-growing elapsed
 * timer makes the contradiction worse, so people wait instead of taking
 * the required action and the task sits until AWAITING_USER_TIMEOUT.
 *
 * Terminal tasks never show it either (the result card is the surface).
 */
export function shouldRenderLiveSubStatus(
  status: string,
  terminal: boolean,
): boolean {
  if (terminal) return false;
  if (status === 'awaiting_user') return false;
  return true;
}
