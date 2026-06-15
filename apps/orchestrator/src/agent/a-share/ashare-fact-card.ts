/**
 * Phase 1 #2 ④ — A股即时问答「接地事实卡」（M1，无 LLM）.
 *
 * 给定 matcher 解析出的「个股×日期」，并行取数 → 组装**确定性事实卡**：
 *   ① 盘面事实（当日收盘/涨跌/成交额，溯源）
 *   ② 同期已披露信息（公告近 7 日 / 龙虎榜当日 / 限售解禁 / 北向市场面，逐条溯源）
 * 每条带「来源 + 抓取时间」，缺数诚实「数据暂不可用」，原始异常进 logger 不泄漏
 * （复用 #2 合规底座 ashare-format）。**不含解读/因果**——③ 可能相关因素由 M2 的
 * LLM 层在本事实卡之上生成，再过合规闸门。见 docs/PHASE1_ASHARE_QA_SKILL_ROUTER_DESIGN.md。
 *
 * 纯组合：传输经注入的 AkshareClient → 可用 fake client 完整单测（无需 Vultr）。
 */

import type { AkshareClient } from './akshare-client.js';
import {
  BRIEFING_DISCLAIMER,
  type BriefingMode,
  dateHeader,
  fmtClock,
  fmtMoneyAuto,
  fmtNum,
  fmtPct,
  fmtPctPlain,
  fmtPctile,
  fmtYiUnit,
  fmtYiYuan,
  pick,
  safeLinkUrl,
  shortDate,
  sourceTag,
  stockLabel,
  toNum,
  unavailableLine,
} from './ashare-format.js';
import type { AshareQaMatch, ResolvedStock } from './ashare-qa-types.js';
import type {
  AkEnvelope,
  AnnouncementRow,
  DragonTigerRow,
  FundamentalsRow,
  KlineRow,
  NorthboundRow,
  UnlockRow,
  ValuationRow,
} from './briefing-types.js';

export interface FactCardDeps {
  client: AkshareClient;
  /** dev 保留原始异常；默认 prod（用户版）。 */
  mode?: BriefingMode;
  /** 注入「现在」便于测试；默认 new Date()。 */
  now?: Date;
}

interface PerStock {
  stock: ResolvedStock;
  kline: AkEnvelope<KlineRow>;
  ann: AkEnvelope<AnnouncementRow>;
  unlock: AkEnvelope<UnlockRow>;
}

/** iso('YYYY-MM-DD') ± days → compact 'YYYYMMDD'（正午 UTC，与口径一致）。 */
function shiftCompact(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${y}${m}${dd}`;
}

/** ① 盘面事实：kline 末行=当日。 */
function marketFactLines(p: PerStock, mode: BriefingMode): string[] {
  const last = p.kline.error ? undefined : p.kline.data[p.kline.data.length - 1];
  if (p.kline.error || !last) return [unavailableLine('当日行情', p.kline, mode)];
  return [
    `- 收盘 ${fmtNum(pick(last, ['收盘']))}，涨跌幅 ${fmtPct(pick(last, ['涨跌幅']))}，成交额 ${fmtYiYuan(
      pick(last, ['成交额']),
    )}（${sourceTag(p.kline)}）`,
  ];
}

/** ② 公告（近 7 日窗口由 service 取，此处只展返回）。 */
function announcementLines(p: PerStock, mode: BriefingMode, perStock = 5): string[] {
  if (p.ann.error) return [unavailableLine('公告', p.ann, mode)];
  const rows = p.ann.data.slice(0, perStock);
  if (rows.length === 0) return ['- 公告：近 7 日无新公告'];
  const out = ['- 公告（近 7 日）：'];
  for (const r of rows) {
    const title = String(pick(r, ['公告标题']) ?? '（无标题）');
    const time = pick(r, ['公告时间']);
    const link = pick(r, ['公告链接']);
    const date = time ? `${shortDate(String(time))} ` : '';
    const url = link ? safeLinkUrl(link) : '';
    const linkMd = url ? ` — [巨潮](${url})` : '';
    out.push(`  - ${date}${title}${linkMd}`);
  }
  out.push(`  （${sourceTag(p.ann)}）`);
  return out;
}

/** ② 龙虎榜：全市场榜单按本股过滤。 */
function dragonTigerLines(
  symbol: string,
  dt: AkEnvelope<DragonTigerRow>,
  mode: BriefingMode,
): string[] {
  if (dt.error) return [unavailableLine('龙虎榜', dt, mode)];
  if (dt.data.length === 0) return ['- 龙虎榜：当日无龙虎榜数据（通常收盘后晚间披露）'];
  const hits = dt.data.filter((r) => String(pick(r, ['代码']) ?? '') === symbol);
  if (hits.length === 0) return ['- 龙虎榜：当日未上榜'];
  const out = ['- 龙虎榜（当日上榜）：'];
  for (const r of hits) {
    const reason = String(pick(r, ['上榜原因']) ?? '—');
    const jiedu = pick(r, ['解读']);
    const jieduMd = jiedu ? ` ｜ 解读：${String(jiedu)}` : '';
    out.push(
      `  - ${reason} ｜ 龙虎榜净买额 ${fmtYiYuan(pick(r, ['龙虎榜净买额']), true)}${jieduMd}`,
    );
  }
  out.push(`  （${sourceTag(dt)}）`);
  return out;
}

/** ② 限售解禁（临近）。 */
function unlockLines(p: PerStock): string[] {
  if (p.unlock.error || p.unlock.data.length === 0) return [];
  const out: string[] = ['- 限售解禁：'];
  for (const r of p.unlock.data.slice(0, 3)) {
    const when = pick(r, ['解禁时间']);
    const mv = pick(r, ['解禁股流通市值']);
    const qty = pick(r, ['解禁数量']);
    const detail =
      mv != null ? `流通市值 ${fmtYiYuan(mv)}` : qty != null ? `${fmtNum(qty, 0)} 股` : '';
    out.push(
      `  - ${when ? `${shortDate(String(when))} ` : ''}解禁${detail ? `（${detail}）` : ''}`,
    );
  }
  out.push(`  （${sourceTag(p.unlock)}）`);
  return out;
}

/** ② 北向资金（市场面）：停披露则诚实标注。 */
function northboundLine(nb: AkEnvelope<NorthboundRow>): string[] {
  if (nb.error || nb.data.length === 0) return [];
  const north = nb.data.filter((r) => {
    const dir = String(pick(r, ['资金方向']) ?? '');
    const seg = String(pick(r, ['板块', '类型']) ?? '');
    return dir === '北向' || seg === '沪股通' || seg === '深股通';
  });
  const disclosed = north.some((r) => {
    const n = toNum(pick(r, ['成交净买额']));
    return n !== null && n !== 0;
  });
  if (!disclosed) {
    return ['- 北向资金（市场面）：沪深股通净买额自 2024-08 停披露，暂无可展示口径'];
  }
  const parts = north.map(
    (r) =>
      `${String(pick(r, ['板块', '类型']) ?? '北向')} 净买额 ${fmtYiUnit(pick(r, ['成交净买额']), true)}`,
  );
  return [`- 北向资金（市场面）：${parts.join(' ｜ ')}（${sourceTag(nb)}）`];
}

/** 取数后的结构化事实（display 卡与 LLM 上下文共用一次取数）。 */
export interface FactData {
  perStock: PerStock[];
  dragonTiger: AkEnvelope<DragonTigerRow>;
  northbound: AkEnvelope<NorthboundRow>;
}

/** 一次并行取数（市场级北向/龙虎榜各一次 + 每股 kline/公告/解禁）。 */
export async function fetchFactData(
  client: AkshareClient,
  match: AshareQaMatch,
): Promise<FactData> {
  const annStart = shiftCompact(match.dateIso, -7);
  const [northbound, dragonTiger, ...perStock] = await Promise.all([
    client.getNorthboundFlow(),
    client.getDragonTiger(match.dateCompact),
    ...match.stocks.map(
      async (stock): Promise<PerStock> => ({
        stock,
        kline: await client.getStockKline(stock.symbol),
        ann: await client.getStockAnnouncements(stock.symbol, annStart, match.dateCompact),
        unlock: await client.getShareUnlock(stock.symbol),
      }),
    ),
  ]);
  return { perStock, dragonTiger, northbound };
}

/** 渲染展示用接地事实卡（markdown，①②，无解读）。 */
export function renderFactCard(
  data: FactData,
  match: AshareQaMatch,
  now: Date,
  mode: BriefingMode,
): string {
  const lines: string[] = [
    `# 📈 HOLA DAY · A股个股速览（${dateHeader(match.dateIso)}）`,
    // ①② 客观；③（如有，由 runner 追加）为分析师判断·未经证实——头部口径在有/无 ③ 时都成立（BOSS 文案修）。
    `> 生成于 ${fmtClock(now.toISOString())} ｜ ①② 为公开信息客观聚合，③（如有）为分析师判断·未经证实；**均不构成投资建议**。`,
    '',
  ];
  for (const p of data.perStock) {
    lines.push(`## ${stockLabel(p.stock)}`);
    lines.push('**① 盘面事实**', ...marketFactLines(p, mode), '');
    lines.push('**② 同期已披露信息**');
    lines.push(...announcementLines(p, mode));
    lines.push(...dragonTigerLines(p.stock.symbol, data.dragonTiger, mode));
    lines.push(...unlockLines(p));
    lines.push('');
  }
  lines.push(...northboundLine(data.northbound));
  return lines.join('\n').trimEnd();
}

/** 固定免责尾块（③解读层在 body 与本块之间插入）。 */
export const QA_DISCLAIMER_BLOCK = `---\n> **免责声明**：${BRIEFING_DISCLAIMER}`;

/**
 * 组装接地事实卡（markdown）。无 LLM、无解读，纯客观数据 + 逐条溯源 + 免责。
 * M1 入口（薄封装 fetch + render + 免责尾）。
 */
export async function buildAshareFactCard(
  deps: FactCardDeps,
  match: AshareQaMatch,
): Promise<string> {
  const data = await fetchFactData(deps.client, match);
  const body = renderFactCard(data, match, deps.now ?? new Date(), deps.mode ?? 'prod');
  return `${body}\n\n${QA_DISCLAIMER_BLOCK}`;
}

/**
 * A股三大指数速览卡（E16 指数 lane，确定性无 LLM）.
 *
 * 「查今天A股三大指数收盘 / 大盘怎么样」类**指数/大盘**问句走本卡，不进个股 lane
 * （避免「今天」等普通词被 name-search 误命中成个股，BOSS E16 修）。getIndexQuote('cn')
 * 返上证指数/深证成指/创业板指 spot，逐条溯源 + 免责。纯客观行情，无解读、无闸门。
 */
export async function buildIndexCard(deps: FactCardDeps): Promise<string> {
  const now = deps.now ?? new Date();
  const mode = deps.mode ?? 'prod';
  const iso = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
  const env = await deps.client.getIndexQuote('cn');
  const lines: string[] = [
    `# 📊 HOLA DAY · A股大盘速览（${dateHeader(iso)}）`,
    `> 生成于 ${fmtClock(now.toISOString())} ｜ 三大指数客观行情聚合，**不构成投资建议**。`,
    '',
  ];
  if (env.error || env.data.length === 0) {
    lines.push(unavailableLine('三大指数', env, mode));
  } else {
    for (const r of env.data) {
      const name = String(pick(r, ['名称']) ?? '指数');
      const close = fmtNum(pick(r, ['最新价', '收盘']));
      const pct = fmtPct(pick(r, ['涨跌幅']));
      const amt = pick(r, ['成交额']) != null ? `，成交额 ${fmtYiYuan(pick(r, ['成交额']))}` : '';
      lines.push(`- ${name} ${close}（${pct}）${amt}`);
    }
    lines.push(`  （${sourceTag(env)}）`);
  }
  return `${lines.join('\n').trimEnd()}\n\n${QA_DISCLAIMER_BLOCK}`;
}

/** 一只个股的紧凑上下文块（盘面必留；公告只留前 annCap 条标题）。 */
function contextBlock(p: PerStock, dt: AkEnvelope<DragonTigerRow>, annCap: number): string {
  const b: string[] = [`【${stockLabel(p.stock)}】`];
  const last = p.kline.error ? undefined : p.kline.data[p.kline.data.length - 1];
  b.push(
    last
      ? `- 盘面：收盘 ${fmtNum(pick(last, ['收盘']))} 涨跌幅 ${fmtPct(pick(last, ['涨跌幅']))} 成交额 ${fmtYiYuan(pick(last, ['成交额']))}`
      : '- 盘面：当日行情数据暂不可用',
  );
  if (p.ann.error) b.push('- 公告：数据暂不可用');
  else {
    const titles = p.ann.data.map((r) => String(pick(r, ['公告标题']) ?? '')).filter(Boolean);
    if (titles.length === 0) b.push('- 公告：近 7 日无新公告');
    else {
      const shown = titles.slice(0, annCap);
      const more = titles.length > annCap ? `（另 ${titles.length - annCap} 条略）` : '';
      b.push(`- 公告(近7日)：${shown.join('；')}${more}`);
    }
  }
  if (dt.error) b.push('- 龙虎榜：数据暂不可用');
  else if (dt.data.length === 0) b.push('- 龙虎榜：当日无榜单数据');
  else {
    const hits = dt.data.filter((r) => String(pick(r, ['代码']) ?? '') === p.stock.symbol);
    if (hits.length === 0) b.push('- 龙虎榜：当日未上榜');
    else
      b.push(
        `- 龙虎榜：${hits
          .map(
            (r) =>
              `${String(pick(r, ['上榜原因']) ?? '')}${pick(r, ['解读']) ? `(解读:${String(pick(r, ['解读']))})` : ''}`,
          )
          .join('；')}`,
      );
  }
  if (!p.unlock.error && p.unlock.data.length > 0) {
    // P2：把解禁**股数 + 合计**喂给 ⑦，使其能点出"大额解禁=潜在抛压"，不止罗列。
    const fmtSh = (n: number) =>
      n >= 1e8
        ? `${(n / 1e8).toFixed(2)}亿股`
        : n >= 1e4
          ? `${(n / 1e4).toFixed(0)}万股`
          : `${Math.round(n)}股`;
    const rows = p.unlock.data.slice(0, 5);
    const total = rows.reduce((s, r) => s + (toNum(pick(r, ['解禁数量'])) ?? 0), 0);
    const items = rows
      .map((r) => {
        const when = pick(r, ['解禁时间']) ? shortDate(String(pick(r, ['解禁时间']))) : '';
        const qty = toNum(pick(r, ['解禁数量']));
        return `${when}解禁${qty != null ? fmtSh(qty) : ''}`;
      })
      .join('；');
    b.push(`- 解禁：${items}${total > 0 ? `（合计约${fmtSh(total)}）` : ''}`);
  }
  return b.join('\n');
}

/**
 * 喂 LLM 的紧凑接地上下文（**token 上限保护**，BOSS 要求④）。
 * 策略：①盘面事实**永远保留**；公告**只留标题**（默认前 6 条）；超 maxChars 时
 * 把公告标题压到前 2 条重建；仍超则硬切片并注明。市场级北向附在末尾。
 */
export function buildFactContext(data: FactData, match: AshareQaMatch, maxChars = 3500): string {
  const head = `日期：${dateHeader(match.dateIso)}`;
  const nbLine = northboundContextLine(data.northbound);
  const assemble = (annCap: number): string =>
    [head, ...data.perStock.map((p) => contextBlock(p, data.dragonTiger, annCap)), nbLine]
      .filter(Boolean)
      .join('\n');

  let ctx = assemble(6);
  if (ctx.length > maxChars) ctx = assemble(2); // 超额：公告压到前 2 条（盘面不动）
  if (ctx.length > maxChars) {
    ctx = `${ctx.slice(0, maxChars)}\n…（上下文已截断：盘面事实完整，公告标题部分保留）`;
  }
  return ctx;
}

/** 北向资金上下文行（停披露诚实标注）。 */
function northboundContextLine(nb: AkEnvelope<NorthboundRow>): string {
  if (nb.error || nb.data.length === 0) return '';
  const north = nb.data.filter((r) => {
    const dir = String(pick(r, ['资金方向']) ?? '');
    const seg = String(pick(r, ['板块', '类型']) ?? '');
    return dir === '北向' || seg === '沪股通' || seg === '深股通';
  });
  const disclosed = north.some((r) => {
    const n = toNum(pick(r, ['成交净买额']));
    return n !== null && n !== 0;
  });
  if (!disclosed) return '北向：沪深股通净买额自 2024-08 停披露';
  return `北向：${north
    .map(
      (r) =>
        `${String(pick(r, ['板块', '类型']) ?? '北向')} ${fmtYiUnit(pick(r, ['成交净买额']), true)}`,
    )
    .join('；')}`;
}

// ===== Phase 2 全景速览：④基本面 + ⑤估值 + ⑦分析师视角 ============================
// 设计规范见 docs（workflow 评审定稿）：④⑤ 是**确定性渲染层**——只摆"数字 + 时效标注"，
// 零形容词、零判断（"偏高/承压/不稳"等综合形容统一归 ⑦ 一段，避免确定性层越界成诊断，
// 也让 ④⑤ 永远逐字可溯源）。⑦ 由 runner 的 LLM 层生成并过合规闸门。

/** 报告期 'YYYY-MM-DD' → "2026Q1财报 / 2025年报 / 2026中报"（时效标注）。 */
function reportLabel(iso: string | null | undefined): string {
  const m = String(iso ?? '').match(/(\d{4})-(\d{2})-\d{2}/);
  if (!m) return '最新财报';
  const [, y, mo] = m;
  if (mo === '03') return `${y}Q1财报`;
  if (mo === '06') return `${y}中报`;
  if (mo === '09') return `${y}三季报`;
  if (mo === '12') return `${y}年报`;
  return `${y}-${mo}财报`;
}

/** ④ 基本面段（确定性，纯数字 + 时效；缺指标诚实"—"，无源不臆造）。 */
export function fundamentalsLines(
  env: AkEnvelope<FundamentalsRow> | undefined,
  mode: BriefingMode,
): string[] {
  const f = env?.data[0];
  if (!env || env.error || !f) {
    return ['**④ 基本面**', unavailableLine('基本面', env ?? ({ error: '' } as AkEnvelope), mode)];
  }
  const out: string[] = [`**④ 基本面**（基于 ${reportLabel(f.report_period)}，会计准则 CAS）`];
  const qoq = (v: number | null | undefined) => (v != null ? `，环比 ${fmtPct(v)}` : '');
  out.push(
    `- 营业总收入 ${fmtMoneyAuto(f.revenue)}（同比 ${fmtPct(f.revenue_yoy)}${qoq(f.revenue_qoq)}）`,
  );
  out.push(
    `- 归母净利润 ${fmtMoneyAuto(f.net_profit)}（同比 ${fmtPct(f.net_profit_yoy)}${qoq(f.net_profit_qoq)}）`,
  );
  if (f.deduct_net_profit != null) {
    out.push(
      `- 扣非净利润 ${fmtMoneyAuto(f.deduct_net_profit)}（同比 ${fmtPct(f.deduct_net_profit_yoy)}）`,
    );
  }
  out.push(
    `- 销售毛利率 ${fmtPctPlain(f.gross_margin)} ｜ 净利率 ${fmtPctPlain(f.net_margin)} ｜ ROE ${fmtPctPlain(f.roe)} ｜ 资产负债率 ${fmtPctPlain(f.debt_ratio)}`,
  );
  if (f.ocf_per_share != null) out.push(`- 每股经营现金流 ${fmtNum(f.ocf_per_share)} 元`);
  const t = (f.trend3y ?? []).filter((x) => x.report_period);
  if (t.length) {
    const parts = t.map((x) => {
      const yr = String(x.report_period ?? '').slice(0, 4);
      return `${yr} 净利 ${fmtMoneyAuto(x.net_profit)}`;
    });
    out.push(`- 近 ${t.length} 年净利趋势：${parts.join(' → ')}`);
  }
  out.push(`  （${sourceTag(env)}）`);
  return out;
}

/** ⑤ 估值段（确定性，纯数字 + 时效；分位/行业对比只给数不下"贵/低"判断）。 */
export function valuationLines(
  env: AkEnvelope<ValuationRow> | undefined,
  mode: BriefingMode,
): string[] {
  const v = env?.data[0];
  if (!env || env.error || !v) {
    return ['**⑤ 估值**', unavailableLine('估值', env ?? ({ error: '' } as AkEnvelope), mode)];
  }
  const asOf = v.as_of ? `（估值截至 ${shortDate(v.as_of)}）` : '';
  const out: string[] = [`**⑤ 估值**${asOf}`];
  out.push(`- PE-TTM ${fmtNum(v.pe_ttm)} ｜ PB ${fmtNum(v.pb)}`);
  const pct: string[] = [];
  if (v.pe_pctile_5y != null) pct.push(`PE 近5年分位 ${fmtPctile(v.pe_pctile_5y)}`);
  if (v.pb_pctile_5y != null) pct.push(`PB 近5年分位 ${fmtPctile(v.pb_pctile_5y)}`);
  if (pct.length) out.push(`- ${pct.join(' ｜ ')}`);
  if (v.industry && v.industry_pe_median != null) {
    // 相对行业落地：本股 PE-TTM vs 行业静态PE中位（客观高于/低于，"贵/便宜"判断留 ⑦）。
    const cmp =
      v.pe_ttm != null && v.industry_pe_median
        ? v.pe_ttm > v.industry_pe_median
          ? '高于'
          : v.pe_ttm < v.industry_pe_median
            ? '低于'
            : '接近'
        : '';
    out.push(
      `- 所属${v.industry}，行业静态PE中位 ${fmtNum(v.industry_pe_median)}${cmp ? `（本股 PE-TTM ${cmp}行业中位）` : ''}`,
    );
  }
  if (v.total_mv_yi != null) out.push(`- 总市值 ${fmtNum(v.total_mv_yi)}亿元`);
  out.push(`  （${sourceTag(env)}）`);
  return out;
}

/** ④⑤ 喂 ⑦ LLM 的紧凑上下文（含 PE/PB/分位/行业中位 等原值，供闸门接地校验）。 */
function fundamentalsContext(env: AkEnvelope<FundamentalsRow> | undefined): string {
  const f = env?.data[0];
  if (!env || env.error || !f) return '④基本面：数据暂不可用';
  const t = (f.trend3y ?? [])
    .filter((x) => x.report_period)
    .map((x) => `${String(x.report_period).slice(0, 4)} ${fmtMoneyAuto(x.net_profit)}`)
    .join('→');
  const qoq = (v: number | null | undefined) => (v != null ? `,环比${fmtPct(v)}` : '');
  return [
    `④基本面(基于${reportLabel(f.report_period)},CAS)：`,
    `营收 ${fmtMoneyAuto(f.revenue)}(同比${fmtPct(f.revenue_yoy)}${qoq(f.revenue_qoq)})；`,
    `归母净利 ${fmtMoneyAuto(f.net_profit)}(同比${fmtPct(f.net_profit_yoy)}${qoq(f.net_profit_qoq)})；`,
    f.deduct_net_profit != null ? `扣非净利 ${fmtMoneyAuto(f.deduct_net_profit)}；` : '',
    `毛利率${fmtPctPlain(f.gross_margin)}；净利率${fmtPctPlain(f.net_margin)}；ROE${fmtPctPlain(f.roe)}；资产负债率${fmtPctPlain(f.debt_ratio)}`,
    f.ocf_per_share != null ? `；每股经营现金流${fmtNum(f.ocf_per_share)}元` : '',
    t ? `；近年净利 ${t}` : '',
  ].join('');
}

function valuationContext(env: AkEnvelope<ValuationRow> | undefined): string {
  const v = env?.data[0];
  if (!env || env.error || !v) return '⑤估值：数据暂不可用';
  const parts = [
    `⑤估值(截至${v.as_of ? shortDate(v.as_of) : '近日'})：`,
    `PE-TTM ${fmtNum(v.pe_ttm)}；PB ${fmtNum(v.pb)}`,
  ];
  if (v.pe_pctile_5y != null) parts.push(`；PE近5年分位${fmtPctile(v.pe_pctile_5y)}`);
  if (v.pb_pctile_5y != null) parts.push(`；PB近5年分位${fmtPctile(v.pb_pctile_5y)}`);
  if (v.industry && v.industry_pe_median != null) {
    const cmp =
      v.pe_ttm != null && v.industry_pe_median
        ? v.pe_ttm > v.industry_pe_median
          ? '高于行业中位'
          : '低于行业中位'
        : '';
    parts.push(`；所属${v.industry} 行业静态PE中位${fmtNum(v.industry_pe_median)}(本股${cmp})`);
  }
  if (v.total_mv_yi != null) parts.push(`；总市值${fmtNum(v.total_mv_yi)}亿`);
  return parts.join('');
}

/** 全景取数：①②③（fetchFactData）+ 每股 ④基本面/⑤估值。 */
export interface PanoramaStockData {
  fundamentals: AkEnvelope<FundamentalsRow>;
  valuation: AkEnvelope<ValuationRow>;
}
export interface PanoramaData extends FactData {
  bySymbol: Record<string, PanoramaStockData>;
}

export async function fetchPanoramaData(
  client: AkshareClient,
  match: AshareQaMatch,
): Promise<PanoramaData> {
  const [base, ...pairs] = await Promise.all([
    fetchFactData(client, match),
    ...match.stocks.map(
      async (s): Promise<readonly [string, PanoramaStockData]> =>
        [
          s.symbol,
          {
            fundamentals: await client.getFundamentals(s.symbol),
            valuation: await client.getValuation(s.symbol),
          },
        ] as const,
    ),
  ]);
  return { ...base, bySymbol: Object.fromEntries(pairs) };
}

/** 全景版 ①-⑤ 确定性 body（每股；②资金=龙虎榜+北向，③消息=公告+解禁，④基本面，⑤估值）。 */
export function renderPanoramaBody(
  data: PanoramaData,
  match: AshareQaMatch,
  now: Date,
  mode: BriefingMode,
): string {
  const lines: string[] = [
    `# 📈 HOLA DAY · A股全景速览（${dateHeader(match.dateIso)}）`,
    `> 生成于 ${fmtClock(now.toISOString())} ｜ ①-⑤ 为公开信息客观聚合，⑦ 为分析师判断·未经证实；**均不构成投资建议**。`,
    '',
  ];
  for (const p of data.perStock) {
    const pano = data.bySymbol[p.stock.symbol];
    lines.push(`## ${stockLabel(p.stock)}`, '');
    lines.push('**① 盘面事实**', ...marketFactLines(p, mode), '');
    lines.push('**② 资金面**');
    lines.push(...dragonTigerLines(p.stock.symbol, data.dragonTiger, mode));
    const nb = northboundLine(data.northbound);
    lines.push(
      ...(nb.length ? nb : ['- 北向资金：沪深股通净买额自 2024-08 停披露，暂无可展示口径']),
    );
    lines.push('');
    lines.push('**③ 消息面**');
    lines.push(...announcementLines(p, mode));
    const ul = unlockLines(p);
    lines.push(...(ul.length ? ul : ['- 限售解禁：近期无']));
    lines.push('');
    lines.push(...fundamentalsLines(pano?.fundamentals, mode), '');
    lines.push(...valuationLines(pano?.valuation, mode));
    lines.push('');
  }
  return lines.join('\n').trimEnd();
}

/** ⑦ 上下文（①②③ + ④⑤，单股；token 上限保护沿用 buildFactContext）。 */
export function buildPanoramaContext(data: PanoramaData, match: AshareQaMatch): string {
  const blocks = [buildFactContext(data, match)];
  for (const p of data.perStock) {
    const pano = data.bySymbol[p.stock.symbol];
    blocks.push(`【${stockLabel(p.stock)} · 基本面/估值】`);
    blocks.push(fundamentalsContext(pano?.fundamentals));
    blocks.push(valuationContext(pano?.valuation));
  }
  return blocks.filter(Boolean).join('\n');
}
