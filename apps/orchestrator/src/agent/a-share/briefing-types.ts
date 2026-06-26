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

/** 板块条目（同花顺行业汇总，v2 板块主线）。 */
export interface SectorEntry {
  板块: string;
  涨跌幅: number | null;
  领涨股: string;
  领涨股涨跌幅: number | null;
}

/**
 * 市场温度计 + 板块主线聚合行（v2 盘后，adapters.get_market_pulse 单行）.
 *
 * 逐源容错：某源不可达时对应字段为 null（渲染器降级该项，不拖垮整段）。纯指标，
 * 无周期定性标签。两市成交额为原始「元」；净流入单位「亿元」（同花顺即时口径）。
 */
export interface MarketPulseRow {
  /** 涨停家数 / 上一交易日涨停家数(昨对比) / 最高连板 / 连板梯队(≥2 板) / 涨停行业分布 top3。 */
  zt_count?: number | null;
  zt_count_prev?: number | null;
  max_lianban?: number | null;
  ladder?: Record<string, number>;
  top_industries?: { 行业: string; 家数: number }[];
  /** 跌停家数 / 炸板家数 / 炸板率(%)。 */
  dt_count?: number | null;
  zb_count?: number | null;
  zhaban_rate?: number | null;
  /** 全市场涨/跌家数（同花顺各行业上涨/下跌家数求和）。 */
  up_count?: number | null;
  down_count?: number | null;
  /** 大盘主力净流入（亿元，同花顺各行业净流入求和）。 */
  net_inflow_yi?: number | null;
  /** 板块涨幅前5 / 跌幅前5（含领涨股）。 */
  sectors_up?: SectorEntry[];
  sectors_down?: SectorEntry[];
  /** 两市成交额（原始「元」= 上证综指+深证综指 spot 成交额）。 */
  two_market_amount?: number | null;
  [k: string]: unknown;
}

/** 涨停池聚合行（v2 盘前回顾上一交易日涨停梯队，adapters.get_zt_pool_summary）。 */
export interface ZtReviewRow {
  zt_count?: number | null;
  max_lianban?: number | null;
  ladder?: Record<string, number>;
  top_industries?: { 行业: string; 家数: number }[];
  [k: string]: unknown;
}

/** ④ 基本面行（get_fundamentals；最新报告期 + 近3年趋势，CAS 口径）。 */
export interface FundamentalsRow {
  /** 最新报告期 'YYYY-MM-DD'（时效标注用，如 2026Q1=2026-03-31）。 */
  report_period?: string | null;
  /** 营业总收入（元）/ 同比增速（%）。 */
  revenue?: number | null;
  revenue_yoy?: number | null;
  /** 归母净利润（元）/ 同比增速（%）。 */
  net_profit?: number | null;
  net_profit_yoy?: number | null;
  /** 扣非净利润（元）/ 同比（%）——判断利润是否靠非经常性损益。 */
  deduct_net_profit?: number | null;
  deduct_net_profit_yoy?: number | null;
  /** 净利润 / 营收 季度环比（%，按单季度，看加速/减速）。 */
  net_profit_qoq?: number | null;
  revenue_qoq?: number | null;
  /** 销售毛利率 / 销售净利率 / 净资产收益率(ROE) / 资产负债率（均 %）。 */
  gross_margin?: number | null;
  net_margin?: number | null;
  roe?: number | null;
  debt_ratio?: number | null;
  /** 每股经营现金流（元）——判断利润含金量。 */
  ocf_per_share?: number | null;
  /** 近3年趋势（年度，老→新），每条同上字段子集。 */
  trend3y?: Array<{
    report_period?: string | null;
    revenue?: number | null;
    revenue_yoy?: number | null;
    net_profit?: number | null;
    net_profit_yoy?: number | null;
  }>;
  [k: string]: unknown;
}

/** ⑤ 估值行（get_valuation；PE/PB + 历史分位 + 行业静态PE中位）。 */
export interface ValuationRow {
  /** 市盈率(TTM) / 市净率（当前）。 */
  pe_ttm?: number | null;
  pb?: number | null;
  /** 近五年历史分位（%，越高越贵）。 */
  pe_pctile_5y?: number | null;
  pb_pctile_5y?: number | null;
  /** 估值数据截止日 'YYYY-MM-DD'（时效标注）。 */
  as_of?: string | null;
  /** 总市值（亿元）。 */
  total_mv_yi?: number | null;
  /** 所属行业大类（中上协口径）+ 行业静态PE中位（行业分位对照）。 */
  industry?: string | null;
  industry_pe_median?: number | null;
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
  /** v2: 上一交易日涨停池聚合（盘前回顾「昨日涨停梯队」；date 同 dragonTigerDate）。 */
  ztReview?: AkEnvelope<ZtReviewRow>;
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
  /** v2: 市场温度计 + 板块主线 + 大盘净流入（get_market_pulse 单行聚合）。 */
  marketPulse?: AkEnvelope<MarketPulseRow>;
}

// ===== ④ 风险信号雷达（R1-R5；akshare 按date取全市场→orchestrator 过滤个股 / 按symbol）=====

/** R1 股权质押行（stock_gpzy_pledge_ratio_em，按date全市场，过滤个股）。 */
export interface PledgeRow {
  股票代码?: string;
  股票简称?: string;
  交易日期?: string;
  /** 质押比例（%）。 */
  质押比例?: number;
  质押股数?: number;
  质押市值?: number;
  [k: string]: unknown;
}

/** R2 商誉行（stock_sy_em，按date全市场，过滤个股）。 */
export interface GoodwillRow {
  股票代码?: string;
  股票简称?: string;
  商誉?: number;
  /** 商誉占净资产比例（%）。 */
  商誉占净资产比例?: number;
  上年商誉?: number;
  公告日期?: string;
  [k: string]: unknown;
}

/** R3 业绩预告行（stock_yjyg_em，按date全市场，过滤个股）。 */
export interface ForecastRow {
  股票代码?: string;
  股票简称?: string;
  /** 预告类型：预增/预减/扭亏/首亏/续亏/略增/略减… */
  预告类型?: string;
  /** 业绩变动幅度（%，部分为区间字符串）。 */
  业绩变动幅度?: number | string;
  公告日期?: string;
  [k: string]: unknown;
}

/** R4 董监高持股变动行（stock_share_hold_change_sse/_szse，按symbol）。变动数<0=减持。 */
export interface InsiderChangeRow {
  /** 变动数（股；负=减持）。 */
  变动数?: number;
  变动原因?: string;
  变动日期?: string;
  姓名?: string;
  职务?: string;
  [k: string]: unknown;
}
