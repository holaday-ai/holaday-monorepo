/**
 * Phase 1 指令 #2 ③ §6c — 简报定时分发.
 *
 * scheduled-runner 的 dispatch 回调识别简报 intent（sentinel）→ 调
 * briefing-service 组装渲染（prod）→ notify() 写 inbox + webhook。非简报
 * intent 返 handled=false，调用方走通用 agent 任务路径。
 *
 * 取数经注入的 AkshareClient（生产为 HttpAkshareClient 直取 akshare-mcp
 * FastAPI；取数失败时 envelope 优雅降级，简报照出不崩）。
 */

import type { NotifyInput } from '../../notifications/notification-service.js';
import type { AkshareClient } from './akshare-client.js';
import type { BriefingMode } from './briefing-renderer.js';
import { buildPostmarketBriefing, buildPremarketBriefing } from './briefing-service.js';

/** scheduled_tasks.intent 哨兵——opt-in 时写入，dispatch 时识别。 */
export const PREMARKET_BRIEFING_INTENT = '__ashare_premarket_briefing__';
export const POSTMARKET_BRIEFING_INTENT = '__ashare_postmarket_briefing__';

export function isBriefingIntent(intent: string): boolean {
  return intent === PREMARKET_BRIEFING_INTENT || intent === POSTMARKET_BRIEFING_INTENT;
}

type Db = typeof import('../../db/client.js').db;

export interface BriefingDispatchDeps {
  db: Db;
  client: AkshareClient;
  /** 预绑定 db(+logger) 的 notify（index.ts 注入）。 */
  notify: (input: NotifyInput) => Promise<unknown>;
  now?: Date;
  mode?: BriefingMode;
}

/** 北京日期 'YYYY-MM-DD'。 */
function cnDateIso(now: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

/**
 * iso('YYYY-MM-DD') 是否 A股交易日。优先查交易日历（akshare-mcp）；日历不可用
 * 时退化到本地周末判断（正午 UTC + getUTCDay，与渲染器星期算法一致）——宁可节假
 * 日多发一次，也不漏发工作日简报。
 */
async function resolveTradingDay(client: AkshareClient, iso: string): Promise<boolean> {
  try {
    const env = await client.getTradingDay(iso);
    const row = env.data[0];
    if (!env.error && row && typeof row.is_trading_day === 'boolean') {
      return row.is_trading_day;
    }
  } catch {
    // 落到周末兜底
  }
  const dow = new Date(`${iso}T12:00:00Z`).getUTCDay();
  return dow !== 0 && dow !== 6;
}

/**
 * 简报哨兵 → 非交易日 skip；交易日组装渲染 + 投递 inbox。返回：
 *   {handled:true, ok:true}                         —— 已投递
 *   {handled:true, ok:true, skipped:true, reason}   —— 非交易日，未投递（调用方记执行记录）
 *   {handled:false, ok:false}                        —— 非简报 intent（调用方走通用路径）
 */
export async function runBriefingDispatch(
  deps: BriefingDispatchDeps,
  args: { scheduledTaskInternalId: number; userInternalId: number; intent: string },
): Promise<{ handled: boolean; ok: boolean; skipped?: boolean; reason?: string }> {
  const isPre = args.intent === PREMARKET_BRIEFING_INTENT;
  const isPost = args.intent === POSTMARKET_BRIEFING_INTENT;
  if (!isPre && !isPost) return { handled: false, ok: false };

  const now = deps.now ?? new Date();
  const iso = cnDateIso(now);
  // P1：非交易日（周末 / 节假日）不投递。
  if (!(await resolveTradingDay(deps.client, iso))) {
    return { handled: true, ok: true, skipped: true, reason: `非交易日 ${iso}，未投递` };
  }

  const svcDeps = { db: deps.db, client: deps.client, now, mode: deps.mode };
  const markdown = isPre
    ? await buildPremarketBriefing(svcDeps, args.userInternalId)
    : await buildPostmarketBriefing(svcDeps, args.userInternalId);
  const title = isPre ? 'A股盘前简报' : 'A股盘后复盘';
  await deps.notify({
    userInternalId: args.userInternalId,
    type: 'task_complete',
    title,
    message: markdown,
    scheduledTaskInternalId: args.scheduledTaskInternalId,
    taskName: title,
  });
  return { handled: true, ok: true };
}
