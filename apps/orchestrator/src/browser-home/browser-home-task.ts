/**
 * BROWSER-HOME-1 step 4 — a task sent from the「云浏览器」floating input runs IN the person's open
 * cloud browser, from the page it shows, and the browser goes back to the session afterwards.
 *
 * tasks.create({ browserHomeSession: true }):
 *   1. assertBrowserHomeTaskAllowed — refuses (FORBIDDEN) when the entry is off for the user, when
 *      combined with a follow-up / retry / local Chrome / public-cloud continuation / media or stock
 *      input, or when the user has no open cloud browser.
 *   2. claimBrowserHomeTaskOrThrow — one task at a time (PRECONDITION_FAILED while one runs or is
 *      being sent: a definite refusal, so the web composer keeps the draft and may resend).
 *   3. The task always runs in the browser lane (the agent loop); its dispatch lends the browser
 *      (BrowserPool.lendBrowserHome) and, on every terminal path, finishBrowserHomeTask gives it
 *      back (BrowserPool.returnBrowserHome) with the session's idle and review control.
 */

import { TRPCError } from '@trpc/server';
import { browserControlSessions } from '../agent/supercar/browser-control-sessions.js';
import type { BrowserPool } from '../browser-pool/browser-pool.js';
import { finishTaskBrowser } from '../browser-pool/finish-task-browser.js';
import { isBrowserHomeEnabledFor } from './browser-home-access.js';
import {
  type BrowserHomeSessions,
  type BrowserHomeTaskClaim,
  browserHomeSessions,
} from './browser-home-session.js';

export const BROWSER_HOME_TASK_COPY = {
  disabled: '云浏览器暂未开放，任务没有发送。',
  combined:
    '在云浏览器里发送的任务只能在当前浏览器里新建执行，不能同时追问、重试、使用本地 Chrome 或转到公开云端。',
  closed: '云浏览器还没有打开，请先打开云浏览器再发送任务。',
  busy: '云浏览器里已有一个任务在执行，请等它结束后再发送。',
  lendFailed: '云浏览器已关闭或正被另一个任务使用，任务没有执行。请重新打开云浏览器后再发送。',
  personBusy: '你在云浏览器里的操作还没有完成，任务没有执行。请稍后再发送。',
} as const;

/** P2-6: how long a task waits for the person's own action in the browser to finish. */
export const BROWSER_HOME_PERSON_SETTLE_MS = 5_000;

export interface BrowserHomeTaskRequest {
  browserHomeSession?: boolean;
  browserPreference?: unknown;
  replyToTaskId?: string;
  retryOfTaskId?: string;
  localChrome?: unknown;
  publicCloudContinuationOf?: string;
  imageOptions?: unknown;
  videoOptions?: unknown;
  taskSource?: unknown;
  stockContext?: unknown;
}

type LocatePool = Pick<BrowserPool, 'peek' | 'browserHomeHolder' | 'peekBrowserHome'>;

/** Throws FORBIDDEN (with the Chinese reason) unless this request may run in the cloud browser. */
export function assertBrowserHomeTaskAllowed(args: {
  userId: string;
  input: BrowserHomeTaskRequest;
  pool: LocatePool | null | undefined;
  allowed?: (userId: string) => boolean;
  sessions?: BrowserHomeSessions;
}): void {
  const { input } = args;
  if (!input.browserHomeSession) return;
  if (!(args.allowed ?? isBrowserHomeEnabledFor)(args.userId))
    throw new TRPCError({ code: 'FORBIDDEN', message: BROWSER_HOME_TASK_COPY.disabled });
  if (
    input.replyToTaskId ||
    input.browserPreference !== undefined ||
    input.retryOfTaskId ||
    input.localChrome ||
    input.publicCloudContinuationOf ||
    input.imageOptions ||
    input.videoOptions ||
    input.taskSource ||
    input.stockContext
  )
    throw new TRPCError({ code: 'FORBIDDEN', message: BROWSER_HOME_TASK_COPY.combined });
  const sessions = args.sessions ?? browserHomeSessions;
  if (!args.pool || !sessions.locate(args.pool, args.userId))
    throw new TRPCError({ code: 'FORBIDDEN', message: BROWSER_HOME_TASK_COPY.closed });
}

/** Reserve the browser for this one task, or throw (PRECONDITION_FAILED busy / FORBIDDEN closed). */
export function claimBrowserHomeTaskOrThrow(args: {
  userId: string;
  pool: Pick<BrowserPool, 'peek' | 'browserHomeHolder'> | null | undefined;
  sessions?: BrowserHomeSessions;
}): BrowserHomeTaskClaim {
  if (!args.pool)
    throw new TRPCError({ code: 'FORBIDDEN', message: BROWSER_HOME_TASK_COPY.closed });
  const result = (args.sessions ?? browserHomeSessions).claimTask(args.pool, args.userId);
  if (result.kind === 'busy')
    throw new TRPCError({ code: 'PRECONDITION_FAILED', message: BROWSER_HOME_TASK_COPY.busy });
  if (result.kind === 'closed')
    throw new TRPCError({ code: 'FORBIDDEN', message: BROWSER_HOME_TASK_COPY.closed });
  return result.claim;
}

/**
 * The task's dispatch: lend the user's browser to the task (keeping its page). Always drops the
 * claim — from here the pool's loan is what keeps a second task out. Throws the Chinese reason
 * when there is nothing to lend (the person closed it meanwhile, or it stopped), or when the
 * person's own action in it (a navigation, a click) has not finished within a few seconds: the
 * run's control cannot start beside an input still in flight.
 */
export async function lendBrowserHomeToTask(args: {
  pool: Pick<BrowserPool, 'lendBrowserHome' | 'peek'>;
  userId: string;
  taskId: string;
  claim: BrowserHomeTaskClaim | null | undefined;
  settleMs?: number;
  sessions?: BrowserHomeSessions;
}) {
  try {
    const sessions = args.sessions ?? browserHomeSessions;
    const home = sessions.instanceFor(args.pool, args.userId);
    const current = () =>
      home &&
      args.claim?.instance === home &&
      args.claim.isCurrent() &&
      sessions.instanceFor(args.pool, args.userId) === home;
    if (!current() || !home) throw new Error(BROWSER_HOME_TASK_COPY.lendFailed);
    const settled = await browserControlSessions.inputSettledWithin(
      home,
      args.settleMs ?? BROWSER_HOME_PERSON_SETTLE_MS,
    );
    if (!current()) throw new Error(BROWSER_HOME_TASK_COPY.lendFailed);
    if (!settled) throw new Error(BROWSER_HOME_TASK_COPY.personBusy);
    if (home.sessionPolicy !== 'personal_home') throw new Error(BROWSER_HOME_TASK_COPY.lendFailed);
    const instance = args.pool.lendBrowserHome(args.userId, args.taskId, 'personal_home');
    if (instance !== home) throw new Error(BROWSER_HOME_TASK_COPY.lendFailed);
    return instance;
  } finally {
    args.claim?.release();
  }
}

/**
 * Every terminal path of a cloud-browser task (completed / partial / failed / cancelled / timeout /
 * awaiting-reply expiry / a thrown runner / the watchdog) ends here. The browser goes back to the
 * session; when it cannot (the person closed the session meanwhile, or the browser stopped), the
 * task's browser is finished the normal way.
 */
export async function finishBrowserHomeTask(args: {
  pool: Pick<BrowserPool, 'returnBrowserHome' | 'retain' | 'release'>;
  taskId: string;
  userId: string;
  retentionMs: number;
  retainForReview: boolean;
  sessions?: BrowserHomeSessions;
}): Promise<'returned' | 'finished'> {
  if ((args.sessions ?? browserHomeSessions).giveBack(args.pool, args.taskId, args.userId))
    return 'returned';
  await finishTaskBrowser(args.pool, args.taskId, args.retentionMs, args.retainForReview);
  return 'finished';
}
