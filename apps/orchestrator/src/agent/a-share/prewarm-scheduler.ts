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

import { AsyncLocalStorage } from 'node:async_hooks';
import type { ExecutionAdmission } from '../../execution/execution-admission.js';
import {
  captureOperationScopeVeto,
  currentOperationLifetime,
} from '../../execution/owned-operation.js';
import type { AkshareClient } from './akshare-client.js';
import { readWarmResponse, runMarketRequest } from './market-request-lifetime.js';

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
  executionDrain?: ExecutionAdmission;
  /** 预热动作（命中时调）。 */
  warm: () => Promise<void>;
  logger: PrewarmLogger;
  /** 测试注入「现在」；默认 () => new Date()。 */
  now?: () => Date;
  /** 轮询间隔，默认 60_000ms。 */
  intervalMs?: number;
}

/**
 * 启动预热调度器。停止拒绝新工作并等待原预热Promise；不代表远端取消。
 */
export function startPrewarmScheduler(deps: PrewarmSchedulerDeps): () => Promise<void> {
  const now = deps.now ?? (() => new Date());
  const controller = deps.executionDrain;
  const warm = deps.warm.bind(deps);
  const logger = deps.logger;
  const inside = new AsyncLocalStorage<boolean>();
  let lastKey = '';
  let pending: Promise<void> | undefined;
  let stopping = false;
  let failed = false;
  let stopped: Promise<void> | undefined;

  const tick = (): void => {
    if (stopping || pending || (controller && controller.drain.snapshot().unknown > 0)) return;
    const d = now();
    const hm = beijingHm(d);
    if (!PREWARM_TIMES_HM.includes(hm as (typeof PREWARM_TIMES_HM)[number])) return;
    const key = `${d.toISOString().slice(0, 10)}#${hm}`; // 同一分钟只发一次
    if (key === lastKey || stopping) return;
    const invoke = async () => {
      // Register the original promise before application callbacks may reenter.
      await Promise.resolve();
      if (stopping) return;
      await inside.run(true, async () => {
        const lifetime = currentOperationLifetime();
        const veto = lifetime ? captureOperationScopeVeto() : undefined;
        logger.info({ hm }, 'prewarm: 触发简报缓存预热');
        if (controller) {
          if (lifetime?.drain !== controller.drain) throw new Error('PREWARM_SCOPE_MISSING');
          controller.drain.assertDispatch(lifetime.owner);
          veto?.();
        }
        if (stopping) return;
        lastKey = key;
        await warm();
        logger.info({ hm }, 'prewarm: 完成');
      });
    };
    // Publish acquisition before runRoot: its synchronous persistence/guards
    // can reenter stop before it returns the original owned promise.
    let settle!: () => void;
    pending = new Promise<void>((resolve) => {
      settle = resolve;
    });
    const finish = () => {
      pending = undefined;
      settle();
    };
    try {
      const original = controller ? controller.runRoot(invoke).result : invoke();
      void original.then(finish, () => {
        failed = true;
        finish();
        try {
          logger.warn({ hm, errorCode: 'PREWARM_FAILED' }, 'prewarm: 失败（非阻塞）');
        } catch {
          // Logging cannot erase the original failed operation or strand stop.
        }
      });
    } catch {
      // Closed admission is not a dispatched operation. Never open it here.
      finish();
    }
  };

  const id = setInterval(tick, deps.intervalMs ?? 60_000);
  // 不阻塞 boot；首 tick 交给 interval。
  return () => {
    if (inside.getStore()) throw new Error('PREWARM_STOP_REENTRY');
    if (stopped) return stopped;
    stopping = true;
    clearInterval(id);
    stopped = Promise.allSettled(pending ? [pending] : []).then(() => {
      if (failed) throw new Error('PREWARM_OUTCOME_UNKNOWN');
    });
    return stopped;
  };
}

/**
 * 预热共享市场接口：把 /index/us·hk·cn 各调一遍以填 akshare-mcp 缓存。
 * 传入**长超时**客户端（让冷取数有时间完成）。任一失败忽略（Promise.allSettled）。
 */
export async function warmSharedCaches(client: AkshareClient): Promise<void> {
  await Promise.allSettled(
    (['us', 'hk', 'cn'] as const).map((market) =>
      runMarketRequest(async (beforeDispatch) => {
        const quote = client.getIndexQuote.bind(client);
        beforeDispatch();
        const result = await quote(market);
        if (result.error) throw new Error('PREWARM_UPSTREAM_FAILED');
      }),
    ),
  );
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
    const url = `${baseUrl.replace(/\/+$/, '')}/symbol-table/warm`;
    const transport = globalThis.fetch;
    await runMarketRequest(async (beforeDispatch) => {
      beforeDispatch();
      const response = await transport(url, { method: 'POST', signal: controller.signal });
      await readWarmResponse(response);
    });
  } catch {
    // 预热失败忽略
  } finally {
    clearTimeout(timer);
  }
}
