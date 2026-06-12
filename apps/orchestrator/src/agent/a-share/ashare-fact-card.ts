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
  fmtNum,
  fmtPct,
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
  KlineRow,
  NorthboundRow,
  UnlockRow,
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
    const u = p.unlock.data
      .slice(0, 2)
      .map((r) => `${pick(r, ['解禁时间']) ? shortDate(String(pick(r, ['解禁时间']))) : ''}解禁`)
      .join('；');
    b.push(`- 解禁：${u}`);
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
