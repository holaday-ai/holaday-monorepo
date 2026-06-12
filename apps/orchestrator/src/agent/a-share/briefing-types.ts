/**
 * Phase 1 指令 #2 ③ — A股盘前/盘后简报：数据契约.
 *
 * 这些类型镜像 `apps/akshare-mcp` 6 个工具返回的 envelope 形状
 * （{data, count, source, fetched_at, disclaimer} 或 error 变体）。简报
 * 渲染器 (briefing-renderer.ts) 只消费这些类型，不直接调 AkShare —— 真正
 * 取数在 MCP provider 落地后（交接 §6）注入。
 *
 * akshare 列名随版本变动且多为中文，故每个 Row 只强类型「确实会用到」的
 * 字段并保留 `[k: string]: unknown`，渲染器用 `pick()` 容错读取（真接
 * 时在 Vultr 核对实际列名）。
 */

/** 每个 AkShare MCP 工具的统一返回封装（server.py `_envelope`）。 */
export interface AkEnvelope<T = Record<string, unknown>> {
  data: T[];
  count: number;
  source: string;
  /** ISO-8601 UTC，工具抓取时刻。 */
  fetched_at: string;
  disclaimer: string;
  /** 优雅降级时存在（server.py `_safe`）：接口失败但不抛。 */
  error?: string;
}

/** 个股公告行（巨潮 cninfo，实测列：代码/简称/公告标题/公告时间/公告链接）。 */
export interface AnnouncementRow {
  代码?: string;
  简称?: string;
  公告标题?: string;
  公告时间?: string;
  公告链接?: string;
  [k: string]: unknown;
}

/** 历史 K 线行（stock_zh_a_hist，标准列：日期/开盘/收盘/最高/最低/成交量/成交额/涨跌幅）。 */
export interface KlineRow {
  日期?: string;
  开盘?: number;
  收盘?: number;
  最高?: number;
  最低?: number;
  成交量?: number;
  成交额?: number;
  涨跌幅?: number;
  涨跌额?: number;
  换手率?: number;
  [k: string]: unknown;
}

/** 港/美股指数行。hk: stock_hk_index_spot_em（最新价/涨跌幅）；us: index_us_stock_sina 末行 OHLCV。 */
export interface IndexRow {
  代码?: string;
  名称?: string;
  最新价?: number;
  /** G1 us 适配器算出的隔夜收盘（_us_indices 输出键）。 */
  收盘?: number;
  涨跌幅?: number;
  涨跌额?: number;
  /** G3 cn 指数 spot 的成交额（原始「元」）。 */
  成交额?: number;
  // us sina 历史 OHLCV（小写英文列）
  date?: string;
  open?: number;
  high?: number;
  low?: number;
  close?: number;
  volume?: number;
  [k: string]: unknown;
}

/** 个股限售解禁行（stock_restricted_release_queue_em，G2）。列名待 Vultr 核对。 */
export interface UnlockRow {
  解禁时间?: string;
  解禁数量?: number;
  解禁股流通市值?: number;
  解禁股类型?: string;
  [k: string]: unknown;
}

/** 龙虎榜明细行（stock_lhb_detail_em）。 */
export interface DragonTigerRow {
  代码?: string;
  名称?: string;
  上榜原因?: string;
  /** akshare 自带一行中性解读（如「主力做T」）—— 非我们生成，合规。 */
  解读?: string;
  收盘价?: number;
  涨跌幅?: number;
  龙虎榜净买额?: number;
  龙虎榜买入额?: number;
  龙虎榜卖出额?: number;
  [k: string]: unknown;
}

/** 北向资金汇总行（stock_hsgt_fund_flow_summary_em）。 */
export interface NorthboundRow {
  交易日?: string;
  类型?: string;
  板块?: string;
  资金方向?: string;
  成交净买额?: number;
  买入成交额?: number;
  卖出成交额?: number;
  [k: string]: unknown;
}

/** 用户自选股清单条目（watchlists 表 list 输出的子集）。 */
export interface WatchlistEntry {
  symbol: string;
  market: string;
  displayName: string | null;
}

/** 盘前简报输入（隔夜外围 + 自选股公告）。 */
export interface PremarketBriefingInput {
  /** 交易日 'YYYY-MM-DD'（北京时间）。 */
  date: string;
  /** 简报生成时刻 ISO-8601。 */
  generatedAt: string;
  watchlist: WatchlistEntry[];
  /** get_index_quote('us') —— 标普500(.INX) 隔夜。 */
  indexUs: AkEnvelope<IndexRow>;
  /** get_index_quote('hk') —— 恒生指数等。 */
  indexHk: AkEnvelope<IndexRow>;
  /** 按 symbol 分组的 get_stock_announcements 结果。 */
  announcements: Record<string, AkEnvelope<AnnouncementRow>>;
  /** G2: 按 symbol 分组的 get_share_unlock（个股解禁）结果。 */
  shareUnlock: Record<string, AkEnvelope<UnlockRow>>;
  /**
   * 上一交易日龙虎榜（全市场，渲染器按自选股过滤）。当日龙虎榜收盘后晚间才披露，
   * 15:30 盘后取不到 → 移到次日盘前「回顾」（BOSS 拍板）。
   */
  dragonTiger: AkEnvelope<DragonTigerRow>;
  /** 上一交易日龙虎榜对应日期 'YYYY-MM-DD'（段标题用）。 */
  dragonTigerDate: string;
}

/** 盘后复盘输入（大盘 + 自选股表现 + 龙虎榜/北向 + 新公告）。 */
export interface PostmarketBriefingInput {
  date: string;
  generatedAt: string;
  watchlist: WatchlistEntry[];
  /** G3: get_index_quote('cn') —— A股三大指数 spot（大盘速览）。 */
  indexCn: AkEnvelope<IndexRow>;
  /** get_northbound_flow() —— 北向资金汇总。 */
  northbound: AkEnvelope<NorthboundRow>;
  /** 按 symbol 分组的 get_stock_kline（末行=当日）当日表现。 */
  dailyKline: Record<string, AkEnvelope<KlineRow>>;
  /** 按 symbol 分组的当日新公告。 */
  announcements: Record<string, AkEnvelope<AnnouncementRow>>;
}
