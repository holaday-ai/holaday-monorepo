/**
 * Phase 1 指令 #2 ③ — A股盘前/盘后简报：确定性模板渲染器（选1扩展版）.
 *
 * 设计取向（合规优先）：每个数字都可溯源到某个 AkShare 工具 envelope，
 * 每条带「来源 + 抓取时间」，结尾固定免责声明，**不预测、不给买卖建议**。
 * 渲染器是纯函数（无 LLM、无 IO）—— 取数在 MCP provider 落地后注入，
 * LLM 解读/异动归因属 ④ 即时问答 + 简报 v2（须单独合规评审），不在 v1。
 *
 * dev / prod 双模（BOSS 选1要求）：
 *   - prod（默认，用户版）：剥离所有 [dev] 诊断 / backlog 缺口标注，干净见客。
 *   - dev：保留诊断行，便于评审 + 排查数据质量。
 *
 * 数据覆盖（选1扩展版后）：
 *   G1 隔夜外围：us 工具返标普/道指/纳指 + 末2行算隔夜涨跌幅（已补）。
 *   G2 今日关键事项：个股解禁(get_share_unlock) + 公告关键词；新股/财经日历仍 backlog。
 *   G3 大盘速览：A股三大指数 spot（get_index_quote('cn')，已补）。
 *
 * ⚠️ 北向资金：stock_hsgt_fund_flow_summary_em 在 2024-08 后净买额披露规则
 * 变更。渲染器检测净买额不可得 → 降级为成交额（明确标注），**禁用过期口径**。
 * Vultr 真接时第一件事就是验当天返回字段。
 */

import type {
  AkEnvelope,
  AnnouncementRow,
  DragonTigerRow,
  IndexRow,
  KlineRow,
  NorthboundRow,
  PostmarketBriefingInput,
  PremarketBriefingInput,
  UnlockRow,
  WatchlistEntry,
} from './briefing-types.js';

/** 渲染模式。prod=用户版（剥离诊断）；dev=评审/排查版（含 [dev] 行）。 */
export type BriefingMode = 'dev' | 'prod';

export interface BriefingRenderOptions {
  mode?: BriefingMode;
}

/** 固定免责声明（合规红线：只聚合不荐股、不预测）。 */
export const BRIEFING_DISCLAIMER =
  '本简报仅聚合公开市场信息，不构成任何投资建议，不预测涨跌；数据来源 AkShare（可能延迟或有误），请以交易所及上市公司公告为准。';

/** 命中即视为「疑似关键事项」的公告标题关键词（G2 公告补充）。 */
const EVENT_KEYWORDS = [
  '解禁',
  '限售',
  '分红',
  '权益分派',
  '派息',
  '业绩预告',
  '业绩快报',
  '股东大会',
  '回购',
  '增发',
  '配股',
  '减持',
  '增持',
  '停牌',
  '复牌',
];

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

// --- 取值 / 格式化（容错） ------------------------------------------

/** 取第一个非空字段（akshare 列名随版本变，多 key 兜底）。 */
function pick(row: Record<string, unknown>, keys: string[]): unknown {
  for (const k of keys) {
    const v = row[k];
    if (v !== undefined && v !== null && v !== '') return v;
  }
  return undefined;
}

function toNum(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = Number(v.replace(/,/g, ''));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** 千分位数字；空值→「—」。 */
function fmtNum(v: unknown, digits = 2): string {
  const n = toNum(v);
  if (n === null) return '—';
  return n.toLocaleString('zh-CN', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

/** 涨跌幅（百分比，带正负号）；空值→「—」。akshare 涨跌幅已是百分比单位。 */
function fmtPct(v: unknown): string {
  const n = toNum(v);
  if (n === null) return '—';
  const sign = n > 0 ? '+' : '';
  return `${sign}${n.toFixed(2)}%`;
}

/** 原始「元」金额 → 「X.XX亿元」。signed=true 时正数带 +。空值→「—」。 */
function fmtYiYuan(v: unknown, signed = false): string {
  const n = toNum(v);
  if (n === null) return '—';
  const yi = n / 1e8;
  const sign = signed && yi > 0 ? '+' : '';
  return `${sign}${yi.toFixed(2)}亿元`;
}

/** 已是「亿元」单位的值（如北向汇总）→「±X.XX亿元」。空值→「—」。 */
function fmtYiUnit(v: unknown, signed = false): string {
  const n = toNum(v);
  if (n === null) return '—';
  const sign = signed && n > 0 ? '+' : '';
  return `${sign}${n.toFixed(2)}亿元`;
}

/** ISO-8601 UTC → 北京时间 HH:MM。 */
function fmtClock(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'Asia/Shanghai',
  }).format(d);
}

/** 公告/解禁时间串 → 「MM-DD」。 */
function shortDate(s: string): string {
  const m = s.match(/(\d{4})[-/]?(\d{2})[-/]?(\d{2})/);
  if (m) return `${m[2]}-${m[3]}`;
  return s.slice(0, 10);
}

/** 「2026-06-11（周四）」。 */
function dateHeader(date: string): string {
  const d = new Date(`${date}T00:00:00+08:00`);
  const wd = Number.isNaN(d.getTime()) ? '' : `（${WEEKDAYS[d.getDay()]}）`;
  return `${date}${wd}`;
}

/** 「来源 X · 抓取 HH:MM」。 */
function sourceTag(env: AkEnvelope): string {
  return `来源 ${env.source} · 抓取 ${fmtClock(env.fetched_at)}`;
}

function stockLabel(e: WatchlistEntry): string {
  return e.displayName ? `${e.displayName}（${e.symbol}）` : e.symbol;
}

function disclaimerBlock(): string {
  return `---\n> **免责声明**：${BRIEFING_DISCLAIMER}`;
}

// --- 盘前各段 --------------------------------------------------------

function overseasLines(
  us: AkEnvelope<IndexRow>,
  hk: AkEnvelope<IndexRow>,
  mode: BriefingMode,
): string[] {
  const out: string[] = [];
  // 美股三大指数（G1：标普/道指/纳指 + 隔夜涨跌幅）
  if (us.error) {
    out.push(`- 美股：数据暂不可用（${us.error}）`);
  } else if (us.data.length === 0) {
    out.push('- 美股：暂无数据');
  } else {
    const parts = us.data.map((r) => {
      const name = String(pick(r, ['名称', '代码']) ?? '指数');
      return `${name} ${fmtNum(pick(r, ['收盘', 'close', '最新价']))}（${fmtPct(pick(r, ['涨跌幅']))}）`;
    });
    out.push(`- 美股：${parts.join(' ｜ ')}（${sourceTag(us)}）`);
    if (mode === 'dev') {
      const missing = us.data.filter((r) => toNum(pick(r, ['涨跌幅'])) === null).length;
      if (missing > 0) out.push(`  - [dev] ${missing} 个美股指数涨跌幅缺失（sina 历史不足 2 行）`);
    }
  }
  // 港股恒指
  if (hk.error) {
    out.push(`- 港股：数据暂不可用（${hk.error}）`);
  } else {
    const r =
      hk.data.find((x) => String(pick(x, ['名称']) ?? '').includes('恒生指数')) ?? hk.data[0];
    if (!r) {
      out.push('- 港股（恒生指数）：暂无数据');
    } else {
      const name = String(pick(r, ['名称']) ?? '恒生指数');
      out.push(
        `- ${name}：${fmtNum(pick(r, ['最新价', '收盘', 'close']))}，${fmtPct(pick(r, ['涨跌幅']))}（${sourceTag(hk)}）`,
      );
    }
  }
  return out;
}

function watchlistAnnouncementLines(
  wl: WatchlistEntry[],
  ann: Record<string, AkEnvelope<AnnouncementRow>>,
  perStock = 3,
): string[] {
  if (wl.length === 0) return ['- 自选股清单为空，请先添加关注的股票（自选股 CRUD ②）。'];
  const out: string[] = [];
  for (const e of wl) {
    out.push(`**${stockLabel(e)}**`);
    const env = ann[e.symbol];
    if (!env || env.error) {
      out.push(`- 公告数据暂不可用${env?.error ? `（${env.error}）` : ''}`);
      continue;
    }
    const rows = env.data.slice(0, perStock);
    if (rows.length === 0) {
      out.push('- 近期无新公告');
      continue;
    }
    for (const r of rows) {
      const title = String(pick(r, ['公告标题']) ?? '（无标题）');
      const time = pick(r, ['公告时间']);
      const link = pick(r, ['公告链接']);
      const date = time ? `${shortDate(String(time))} ` : '';
      const linkMd = link ? ` — [巨潮](${String(link)})` : '';
      out.push(`- ${date}${title}${linkMd}`);
    }
    out.push(`  （${sourceTag(env)}）`);
  }
  return out;
}

function keyEventLines(
  wl: WatchlistEntry[],
  ann: Record<string, AkEnvelope<AnnouncementRow>>,
  unlock: Record<string, AkEnvelope<UnlockRow>>,
  mode: BriefingMode,
): string[] {
  const out: string[] = [];
  // G2: 个股限售解禁（真实数据）
  const unlockHits: string[] = [];
  for (const e of wl) {
    const env = unlock[e.symbol];
    if (!env || env.error) continue;
    for (const r of env.data.slice(0, 3)) {
      const when = pick(r, ['解禁时间']);
      const mv = pick(r, ['解禁股流通市值']);
      const qty = pick(r, ['解禁数量']);
      const detail =
        mv != null ? `流通市值 ${fmtYiYuan(mv)}` : qty != null ? `${fmtNum(qty, 0)} 股` : '';
      unlockHits.push(
        `- ${stockLabel(e)}：${when ? `${shortDate(String(when))} ` : ''}解禁${detail ? `（${detail}）` : ''}`,
      );
    }
  }
  if (unlockHits.length > 0) {
    out.push('**限售解禁**', ...unlockHits.slice(0, 10));
  }
  // 公告关键词「疑似」事项（补充）
  const kwHits: string[] = [];
  for (const e of wl) {
    const env = ann[e.symbol];
    if (!env || env.error) continue;
    for (const r of env.data) {
      const title = String(pick(r, ['公告标题']) ?? '');
      const kw = EVENT_KEYWORDS.find((k) => title.includes(k));
      if (kw) kwHits.push(`- ${stockLabel(e)}：${title}（疑似「${kw}」）`);
    }
  }
  if (kwHits.length > 0) {
    out.push('**公告关键词提示**', ...kwHits.slice(0, 10));
  }
  if (unlockHits.length === 0 && kwHits.length === 0) {
    out.push('- 自选股今日无解禁 / 公告关键事项。');
  }
  if (mode === 'dev') {
    out.push('> [dev] G2 覆盖个股解禁 + 公告关键词；新股日历 / 财经数据日历仍 backlog。');
  }
  return out;
}

// --- 盘后各段 --------------------------------------------------------

/** 北向资金行（含 2024-08 净买额口径降级）。 */
function northboundLines(nb: AkEnvelope<NorthboundRow>, mode: BriefingMode): string[] {
  const out: string[] = [];
  if (nb.error) {
    out.push(`- 北向资金：数据暂不可用（${nb.error}）`);
    return out;
  }
  if (nb.data.length === 0) {
    out.push('- 北向资金：暂无数据');
    return out;
  }
  // 净买额口径是否可得？（2024-08 后规则变更，可能整列缺失）
  const hasNet = nb.data.some((r) => toNum(pick(r, ['成交净买额'])) !== null);
  if (hasNet) {
    const parts = nb.data.map((r) => {
      const seg = String(pick(r, ['板块', '类型']) ?? '北向');
      return `${seg} 净买额 ${fmtYiUnit(pick(r, ['成交净买额']), true)}`;
    });
    out.push(`- 北向资金：${parts.join(' ｜ ')}（${sourceTag(nb)}）`);
    return out;
  }
  // 降级：净买额不可得 → 用成交额，明确标注，禁用过期口径
  const parts = nb.data
    .map((r) => {
      const seg = String(pick(r, ['板块', '类型']) ?? '北向');
      const amt = pick(r, ['成交额', '买入成交额']);
      return amt != null ? `${seg} 成交额 ${fmtYiUnit(amt)}` : '';
    })
    .filter(Boolean);
  if (parts.length > 0) {
    out.push(
      `- 北向资金（成交额；净买额口径 2024-08 后已停披露）：${parts.join(' ｜ ')}（${sourceTag(nb)}）`,
    );
  } else {
    out.push('- 北向资金：净买额口径已变更，当前无可用字段。');
  }
  if (mode === 'dev') {
    out.push('  - [dev] 北向净买额缺失→降级成交额；Vultr 真接须先验当天返回字段。');
  }
  return out;
}

/** 大盘速览（G3）：指数 → 成交额 → 北向。 */
function marketOverviewLines(
  cn: AkEnvelope<IndexRow>,
  nb: AkEnvelope<NorthboundRow>,
  mode: BriefingMode,
): string[] {
  const out: string[] = [];
  if (cn.error) {
    out.push(`- A股指数：数据暂不可用（${cn.error}）`);
  } else if (cn.data.length === 0) {
    out.push('- A股指数：暂无数据');
    if (mode === 'dev') out.push('  - [dev] cn 指数为空，核对 stock_zh_index_spot_em 名称过滤');
  } else {
    const idx = cn.data.map(
      (r) =>
        `${String(pick(r, ['名称']) ?? '')} ${fmtNum(pick(r, ['最新价', '收盘']))}（${fmtPct(pick(r, ['涨跌幅']))}）`,
    );
    out.push(`- 指数：${idx.join(' ｜ ')}`);
    const amts = cn.data.map(
      (r) => `${String(pick(r, ['名称']) ?? '')} ${fmtYiYuan(pick(r, ['成交额']))}`,
    );
    out.push(`- 成交额：${amts.join(' ｜ ')}`);
    out.push(`  （${sourceTag(cn)}）`);
  }
  out.push(...northboundLines(nb, mode));
  return out;
}

function watchlistPerformanceLines(
  wl: WatchlistEntry[],
  kl: Record<string, AkEnvelope<KlineRow>>,
): string[] {
  if (wl.length === 0) return ['- 自选股清单为空。'];
  const out: string[] = [
    '| 名称 | 代码 | 收盘 | 涨跌幅 | 成交额 |',
    '| --- | --- | ---: | ---: | ---: |',
  ];
  let anySource: AkEnvelope | null = null;
  for (const e of wl) {
    const env = kl[e.symbol];
    const r = env && !env.error ? env.data[env.data.length - 1] : undefined; // 末行 = 当日
    if (!env || env.error || !r) {
      out.push(`| ${e.displayName ?? '—'} | ${e.symbol} | — | — | — |`);
      continue;
    }
    anySource = env;
    const name = e.displayName ?? String(pick(r, ['名称']) ?? '—');
    out.push(
      `| ${name} | ${e.symbol} | ${fmtNum(pick(r, ['收盘']))} | ${fmtPct(pick(r, ['涨跌幅']))} | ${fmtYiYuan(pick(r, ['成交额']))} |`,
    );
  }
  if (anySource) out.push('', `（${sourceTag(anySource)}）`);
  return out;
}

function dragonTigerLines(wl: WatchlistEntry[], dt: AkEnvelope<DragonTigerRow>): string[] {
  const out: string[] = [];
  if (dt.error) {
    out.push(`- 龙虎榜：数据暂不可用（${dt.error}）`);
    return out;
  }
  const symset = new Set(wl.map((e) => e.symbol));
  const hits = dt.data.filter((r) => symset.has(String(pick(r, ['代码']) ?? '')));
  if (hits.length === 0) {
    out.push('- 龙虎榜：自选股今日无个股上榜。');
    return out;
  }
  for (const r of hits) {
    const name = String(pick(r, ['名称']) ?? '');
    const code = String(pick(r, ['代码']) ?? '');
    const reason = String(pick(r, ['上榜原因']) ?? '—');
    out.push(
      `- ${name}（${code}）：${reason} ｜ 龙虎榜净买额 ${fmtYiYuan(pick(r, ['龙虎榜净买额']), true)}`,
    );
  }
  out.push(`  （${sourceTag(dt)}）`);
  return out;
}

// --- 公开渲染入口 ----------------------------------------------------

/** 盘前简报（隔夜外围 + 自选股公告 + 今日关键事项）。默认 prod。 */
export function renderPremarketBriefing(
  input: PremarketBriefingInput,
  opts: BriefingRenderOptions = {},
): string {
  const mode = opts.mode ?? 'prod';
  return [
    '# 📋 HOLA DAY · A股盘前简报',
    `**${dateHeader(input.date)}** ｜ 生成于 ${fmtClock(input.generatedAt)}`,
    '',
    '## 一、隔夜外围',
    ...overseasLines(input.indexUs, input.indexHk, mode),
    '',
    '## 二、自选股相关公告',
    ...watchlistAnnouncementLines(input.watchlist, input.announcements),
    '',
    '## 三、今日关键事项（解禁 / 公告提示）',
    ...keyEventLines(input.watchlist, input.announcements, input.shareUnlock, mode),
    '',
    disclaimerBlock(),
  ].join('\n');
}

/** 盘后复盘（大盘速览 + 自选股表现 + 龙虎榜 + 新公告）。默认 prod。 */
export function renderPostmarketBriefing(
  input: PostmarketBriefingInput,
  opts: BriefingRenderOptions = {},
): string {
  const mode = opts.mode ?? 'prod';
  return [
    '# 📊 HOLA DAY · A股盘后复盘',
    `**${dateHeader(input.date)}** ｜ 生成于 ${fmtClock(input.generatedAt)}`,
    '',
    '## 一、大盘速览',
    ...marketOverviewLines(input.indexCn, input.northbound, mode),
    '',
    '## 二、自选股当日表现',
    ...watchlistPerformanceLines(input.watchlist, input.dailyKline),
    '',
    '## 三、龙虎榜（自选股上榜）',
    ...dragonTigerLines(input.watchlist, input.dragonTiger),
    '',
    '## 四、自选股新公告',
    ...watchlistAnnouncementLines(input.watchlist, input.announcements),
    '',
    disclaimerBlock(),
  ].join('\n');
}
