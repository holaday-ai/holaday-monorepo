/**
 * Phase 1 指令 #2 ③ §6 — AkshareClient：取数传输层「契约」.
 *
 * briefing-service 只依赖这个接口（transport-agnostic），不关心底层是
 * MCP-stdio 子进程还是薄 HTTP 包装。这样：
 *   - 组装/渲染逻辑可用 fake client 完整单测（无需 Vultr / 实时行情）。
 *   - 真实传输实现是 Vultr 落地决策（见 docs/PHASE1_ASHARE_HANDOFF.md §6）：
 *     orchestrator 当前**无** @modelcontextprotocol/sdk，且确定性简报不应让
 *     LLM 代调工具 —— 候选：(a) 引入 MCP SDK + 子进程 stdio；(b) akshare-mcp
 *     之上加薄 FastAPI，orchestrator HTTP 直取。两者均须 Vultr 实跑核对
 *     （push2.eastmoney 仅 Vultr 可达）。
 *
 * 方法名 / 参数与 `apps/akshare-mcp/akshare_mcp/server.py` 的 6+1 工具一一对应。
 */

import type {
  AkEnvelope,
  AnnouncementRow,
  DragonTigerRow,
  IndexRow,
  KlineRow,
  NorthboundRow,
  UnlockRow,
} from './briefing-types.js';

export interface AkshareClient {
  /** get_index_quote(market) — 'hk' 恒指 / 'us' 标普道指纳指 / 'cn' 上证深证创业板。 */
  getIndexQuote(market: 'hk' | 'us' | 'cn'): Promise<AkEnvelope<IndexRow>>;
  /** get_stock_announcements(symbol) — 个股公告（巨潮）。 */
  getStockAnnouncements(symbol: string): Promise<AkEnvelope<AnnouncementRow>>;
  /** get_share_unlock(symbol) — 个股限售解禁（G2）。 */
  getShareUnlock(symbol: string): Promise<AkEnvelope<UnlockRow>>;
  /** get_stock_kline(symbol) — 历史 K 线（末行=当日表现）。 */
  getStockKline(symbol: string): Promise<AkEnvelope<KlineRow>>;
  /** get_dragon_tiger(startDate) — 龙虎榜明细（startDate 'YYYYMMDD'）。 */
  getDragonTiger(startDate: string): Promise<AkEnvelope<DragonTigerRow>>;
  /** get_northbound_flow() — 北向资金汇总。 */
  getNorthboundFlow(): Promise<AkEnvelope<NorthboundRow>>;
}

const STUB_DISCLAIMER = '数据来源 AkShare 聚合，仅供信息参考，不构成任何投资建议，不预测股价。';

/**
 * 传输未接入时的占位实现：每个工具返回 error envelope。简报渲染器对
 * error envelope 优雅降级（显示「数据暂不可用」），所以即便 MCP/HTTP
 * 还没接好，定时任务也不会崩，只会产出空壳简报 —— 用于 §6 接好前的
 * 端到端走查 + 单测基线。
 */
export class StubAkshareClient implements AkshareClient {
  private err<T>(tool: string, nowIso: string): AkEnvelope<T> {
    return {
      data: [],
      count: 0,
      source: tool,
      fetched_at: nowIso,
      disclaimer: STUB_DISCLAIMER,
      error: 'akshare-mcp 传输未接入（stub）',
    };
  }

  // new Date() 在普通 orchestrator 代码可用（非 Workflow 脚本）。
  private now(): string {
    return new Date().toISOString();
  }

  getIndexQuote(market: 'hk' | 'us' | 'cn') {
    return Promise.resolve(this.err<IndexRow>(`akshare:index(${market})`, this.now()));
  }
  getStockAnnouncements(symbol: string) {
    return Promise.resolve(
      this.err<AnnouncementRow>(`akshare:announcements(${symbol})`, this.now()),
    );
  }
  getShareUnlock(symbol: string) {
    return Promise.resolve(this.err<UnlockRow>(`akshare:share_unlock(${symbol})`, this.now()));
  }
  getStockKline(symbol: string) {
    return Promise.resolve(this.err<KlineRow>(`akshare:kline(${symbol})`, this.now()));
  }
  getDragonTiger(startDate: string) {
    return Promise.resolve(
      this.err<DragonTigerRow>(`akshare:dragon_tiger(${startDate})`, this.now()),
    );
  }
  getNorthboundFlow() {
    return Promise.resolve(this.err<NorthboundRow>('akshare:northbound', this.now()));
  }
}
