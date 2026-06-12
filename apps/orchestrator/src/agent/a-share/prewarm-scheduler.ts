/**
 * Phase 1 #2 — 简报缓存预热调度（BOSS 拍板：冷缓存 → 预热，简报 10s 超时规格不动）.
 *
 * 问题：盘前(08:30)/盘后(15:30)简报命中**冷缓存**时，sina 指数 spot 首取可能 >10s
 * 撞上简报客户端的 10s 超时 → 大盘速览段降级「数据暂不可用」。
 *
 * 对策：简报前 5 分钟（08:25 / 15:25 北京）用一个**长超时**(默认 30s) 的预热客户端把
 * 共享市场接口(/index/us·hk·cn)各调一遍，填满 akshare-mcp 的 TTL(600s) 缓存；5 分钟后
 * 简报以原 10s 超时读**暖缓存**即时返回。简报本身的 10s 规格不动。
 *
 * 进程内轻量定时器（与 scheduled-runner 同模式，非 BullMQ / 非 OS cron），每分钟
 * 检查北京 HH:MM，命中即预热；同一分钟只发一次。失败仅记日志，不影响任何任务。
 */

import type { AkshareClient } from './akshare-client.js';

/** 预热时刻（北京 HH:MM），分别比 08:30 / 15:30 简报早 5 分钟。 */
export const PREWARM_TIMES_HM = ['08:25', '15:25'] as const;

/** 北京时区 HH:MM（24h）。 */
export function beijingHm(now: Date): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Shanghai',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(now);
}

interface PrewarmLogger {
  info(obj: Record<string, unknown>, msg: string): void;
  warn(obj: Record<string, unknown>, msg: string): void;
}

export interface PrewarmSchedulerDeps {
  /** 预热动作（命中时调）。 */
  warm: () => Promise<void>;
  logger: PrewarmLogger;
  /** 测试注入「现在」；默认 () => new Date()。 */
  now?: () => Date;
  /** 轮询间隔，默认 60_000ms。 */
  intervalMs?: number;
}

/**
 * 启动预热调度器。返回停止函数（clearInterval）。同一(日期+时刻)只触发一次。
 */
export function startPrewarmScheduler(deps: PrewarmSchedulerDeps): () => void {
  const now = deps.now ?? (() => new Date());
  let lastKey = '';

  const tick = async (): Promise<void> => {
    const d = now();
    const hm = beijingHm(d);
    if (!PREWARM_TIMES_HM.includes(hm as (typeof PREWARM_TIMES_HM)[number])) return;
    const key = `${d.toISOString().slice(0, 10)}#${hm}`; // 同一分钟只发一次
    if (key === lastKey) return;
    lastKey = key;
    deps.logger.info({ hm }, 'prewarm: 触发简报缓存预热');
    try {
      await deps.warm();
      deps.logger.info({ hm }, 'prewarm: 完成');
    } catch (e) {
      deps.logger.warn(
        { hm, err: e instanceof Error ? e.message : String(e) },
        'prewarm: 失败（非阻塞）',
      );
    }
  };

  const id = setInterval(() => void tick(), deps.intervalMs ?? 60_000);
  // 不阻塞 boot；首 tick 交给 interval。
  return () => clearInterval(id);
}

/**
 * 预热共享市场接口：把 /index/us·hk·cn 各调一遍以填 akshare-mcp 缓存。
 * 传入**长超时**客户端（让冷取数有时间完成）。任一失败忽略（Promise.allSettled）。
 */
export async function warmSharedCaches(client: AkshareClient): Promise<void> {
  await Promise.allSettled([
    client.getIndexQuote('us'),
    client.getIndexQuote('hk'),
    client.getIndexQuote('cn'),
  ]);
}

/**
 * 预热全量代码名称表（④ 短名解析，BOSS 要求「开盘前刷新一次」）。POST
 * /symbol-table/warm 同步刷新 ~70s 故**长超时**(默认 120s)。失败不致命——
 * search 冷启会自愈（异步刷新）。用裸 fetch（非 10s 简报客户端）。
 */
export async function warmSymbolTable(baseUrl: string, timeoutMs = 120_000): Promise<void> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    await fetch(`${baseUrl.replace(/\/+$/, '')}/symbol-table/warm`, {
      method: 'POST',
      signal: controller.signal,
    });
  } catch {
    // 预热失败忽略
  } finally {
    clearTimeout(timer);
  }
}
