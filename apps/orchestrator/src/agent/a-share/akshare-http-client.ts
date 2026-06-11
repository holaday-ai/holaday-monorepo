/**
 * Phase 1 指令 #2 ③ §6c — HttpAkshareClient：AkshareClient 的真实传输（薄 HTTP）.
 *
 * 同机直取 akshare-mcp 的 FastAPI（http_server.py），确定性简报不走 LLM
 * （orchestrator 无 @modelcontextprotocol/sdk，BOSS 定薄 HTTP）。任何 HTTP /
 * 网络 / 超时错误优雅降级为 error envelope —— 渲染器据此显示「数据暂不可用」，
 * 定时任务不崩。fetch 可注入便于单测。
 */

import type { AkshareClient } from './akshare-client.js';
import type {
  AkEnvelope,
  AnnouncementRow,
  DragonTigerRow,
  IndexRow,
  KlineRow,
  NorthboundRow,
  UnlockRow,
} from './briefing-types.js';

interface FetchResponseLike {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}
type FetchLike = (url: string, init?: { signal?: AbortSignal }) => Promise<FetchResponseLike>;

const DISCLAIMER = '数据来源 AkShare 聚合，仅供信息参考，不构成任何投资建议，不预测股价。';

function errEnvelope<T>(source: string, error: string): AkEnvelope<T> {
  return {
    data: [],
    count: 0,
    source,
    fetched_at: new Date().toISOString(),
    disclaimer: DISCLAIMER,
    error,
  };
}

export interface HttpAkshareClientOptions {
  /** akshare-mcp FastAPI 基址，如 http://127.0.0.1:8848。 */
  baseUrl: string;
  /** 注入便于测试；默认 globalThis.fetch。 */
  fetchImpl?: FetchLike;
  /** 单次请求超时，默认 8000ms。 */
  timeoutMs?: number;
}

export class HttpAkshareClient implements AkshareClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: FetchLike;
  private readonly timeoutMs: number;

  constructor(opts: HttpAkshareClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, '');
    this.fetchImpl = opts.fetchImpl ?? (globalThis.fetch as unknown as FetchLike);
    this.timeoutMs = opts.timeoutMs ?? 8000;
  }

  private async get<T>(path: string): Promise<AkEnvelope<T>> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await this.fetchImpl(`${this.baseUrl}${path}`, { signal: controller.signal });
      if (!res.ok) return errEnvelope<T>(`http:${path}`, `HTTP ${res.status}`);
      return (await res.json()) as AkEnvelope<T>;
    } catch (e) {
      return errEnvelope<T>(`http:${path}`, e instanceof Error ? e.message : String(e));
    } finally {
      clearTimeout(timer);
    }
  }

  getIndexQuote(market: 'hk' | 'us' | 'cn') {
    return this.get<IndexRow>(`/index/${market}`);
  }
  getStockAnnouncements(symbol: string) {
    return this.get<AnnouncementRow>(`/announcements/${encodeURIComponent(symbol)}`);
  }
  getShareUnlock(symbol: string) {
    return this.get<UnlockRow>(`/unlock/${encodeURIComponent(symbol)}`);
  }
  getStockKline(symbol: string) {
    return this.get<KlineRow>(`/kline/${encodeURIComponent(symbol)}`);
  }
  getDragonTiger(startDate: string) {
    return this.get<DragonTigerRow>(`/dragon-tiger/${encodeURIComponent(startDate)}`);
  }
  getNorthboundFlow() {
    return this.get<NorthboundRow>('/northbound');
  }
}
