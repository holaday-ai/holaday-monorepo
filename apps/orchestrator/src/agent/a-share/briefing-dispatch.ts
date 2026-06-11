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

/**
 * 若 intent 是简报哨兵 → 组装渲染 + 投递 inbox，返回 {handled:true}。
 * 否则 {handled:false}（非简报，调用方继续通用路径）。
 */
export async function runBriefingDispatch(
  deps: BriefingDispatchDeps,
  args: { scheduledTaskInternalId: number; userInternalId: number; intent: string },
): Promise<{ handled: boolean; ok: boolean }> {
  const svcDeps = { db: deps.db, client: deps.client, now: deps.now, mode: deps.mode };
  let markdown: string;
  let title: string;
  if (args.intent === PREMARKET_BRIEFING_INTENT) {
    markdown = await buildPremarketBriefing(svcDeps, args.userInternalId);
    title = 'A股盘前简报';
  } else if (args.intent === POSTMARKET_BRIEFING_INTENT) {
    markdown = await buildPostmarketBriefing(svcDeps, args.userInternalId);
    title = 'A股盘后复盘';
  } else {
    return { handled: false, ok: false };
  }
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
