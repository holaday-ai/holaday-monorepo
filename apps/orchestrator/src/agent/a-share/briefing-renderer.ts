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
  MarketPulseRow,
  NorthboundRow,
  PostmarketBriefingInput,
  PremarketBriefingInput,
  SectorEntry,
  UnlockRow,
  WatchlistEntry,
  ZtReviewRow,
} from './briefing-types.js';

import {
  BRIEFING_DISCLAIMER,
  type BriefingMode,
  dateHeader,
  fmtClock,
  fmtNum,
  fmtPct,
  fmtWanYi,
  fmtYiCompact,
  fmtYiUnit,
  fmtYiYuan,
  pick,
  safeLinkUrl,
  shortDate,
  sourceTag,
  sourceTagShort,
  stockLabel,
  toNum,
  unavailableLine,
} from './ashare-format.js';

// 兼容既有引用：briefing-service / briefing-dispatch / 测试仍从本模块取这两个。
export { BRIEFING_DISCLAIMER };
export type { BriefingMode };

export interface BriefingRenderOptions {
  mode?: BriefingMode;
}

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

function disclaimerBlock(): string {
  return `---\n> **免责声明**：${BRIEFING_DISCLAIMER}`;
}

/** 段尾来源：prod 用短标（减噪，原则3），dev 保留完整 fn 名便于溯源。 */
function srcTag(env: AkEnvelope, mode: BriefingMode): string {
  return mode === 'prod' ? sourceTagShort(env) : sourceTag(env);
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
    out.push(unavailableLine('美股', us, mode));
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
    out.push(unavailableLine('港股', hk, mode));
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

/**
 * 自选股公告段。窗口由 service 服务端按日期取（盘前近 24h / 盘后当日），渲染器
 * 只展返回行；无行时显示 `emptyLabel`（「今日无新公告」/「近24小时无新公告」）。
 * 只输出有内容（命中或数据不可用）的个股，避免整段满屏「无公告」噪声——全员空时
 * 收敛成一行 emptyLabel。链接经 safeLinkUrl 修正（含空格的 cninfo 链接会断链）。
 */
function watchlistAnnouncementLines(
  wl: WatchlistEntry[],
  ann: Record<string, AkEnvelope<AnnouncementRow>>,
  opts: { mode: BriefingMode; emptyLabel: string; perStock?: number },
): string[] {
  if (wl.length === 0) return ['- 自选股清单为空，请先添加关注的股票（自选股 CRUD ②）。'];
  const perStock = opts.perStock ?? 5;
  const out: string[] = [];
  let anyContent = false;
  for (const e of wl) {
    const env = ann[e.symbol];
    if (!env || env.error) {
      out.push(
        `**${stockLabel(e)}**`,
        unavailableLine('公告', env ?? ({ error: '' } as AkEnvelope), opts.mode),
      );
      anyContent = true;
      continue;
    }
    const rows = env.data.slice(0, perStock);
    if (rows.length === 0) continue; // 该股窗口内无新公告 → 不单列，由整段兜底
    anyContent = true;
    out.push(`**${stockLabel(e)}**`);
    for (const r of rows) {
      const title = String(pick(r, ['公告标题']) ?? '（无标题）');
      const time = pick(r, ['公告时间']);
      const link = pick(r, ['公告链接']);
      const date = time ? `${shortDate(String(time))} ` : '';
      const url = link ? safeLinkUrl(link) : '';
      const linkMd = url ? ` — [巨潮](${url})` : '';
      out.push(`- ${date}${title}${linkMd}`);
    }
    out.push(`  （${sourceTag(env)}）`);
  }
  if (!anyContent) return [`- ${opts.emptyLabel}`];
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

/**
 * 北向资金行。2024-08 起交易所停披露北向(沪/深股通)实时净买额，实测恒为
 * 0.0（Vultr 核对）。0.0 不是真零是「停披露」→ 整行省略（禁用过期口径，
 * BOSS 红线）。若日后恢复披露(非 0)，自动恢复展示。
 */
function northboundLines(nb: AkEnvelope<NorthboundRow>, mode: BriefingMode): string[] {
  const out: string[] = [];
  if (nb.error || nb.data.length === 0) {
    if (mode === 'dev') {
      out.push(`  - [dev] 北向资金不可用${nb.error ? `（${nb.error}）` : '（空）'}`);
    }
    return out;
  }
  // 只取北向行（沪股通/深股通）；南向港股通不属「北向资金」。
  const north = nb.data.filter((r) => {
    const dir = String(pick(r, ['资金方向']) ?? '');
    const seg = String(pick(r, ['板块', '类型']) ?? '');
    return dir === '北向' || seg === '沪股通' || seg === '深股通';
  });
  // 净买额是否仍在披露？停披露时北向行净买额恒 0/null。
  const disclosed = north.some((r) => {
    const n = toNum(pick(r, ['成交净买额']));
    return n !== null && n !== 0;
  });
  if (!disclosed) {
    if (mode === 'dev') {
      out.push('  - [dev] 北向净买额停披露(2024-08,实测 0.0)→ 整行省略');
    }
    return out; // prod：整行省略，不显示「+0.00亿元」
  }
  const parts = north.map((r) => {
    const seg = String(pick(r, ['板块', '类型']) ?? '北向');
    return `${seg} 净买额 ${fmtYiUnit(pick(r, ['成交净买额']), true)}`;
  });
  out.push(`- 北向资金：${parts.join(' ｜ ')}（${sourceTag(nb)}）`);
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
    out.push(unavailableLine('A股指数', cn, mode));
  } else if (cn.data.length === 0) {
    out.push('- A股指数：暂无数据');
    if (mode === 'dev') out.push('  - [dev] cn 指数为空，核对 stock_zh_index_spot_sina 代码过滤');
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

function dragonTigerLines(
  wl: WatchlistEntry[],
  dt: AkEnvelope<DragonTigerRow>,
  mode: BriefingMode,
): string[] {
  const out: string[] = [];
  if (dt.error) {
    out.push(unavailableLine('龙虎榜', dt, mode));
    return out;
  }
  // 全市场榜单空（dt.data 是当日全市场龙虎榜）：当日尚未发布 / 该日无榜单。
  // adapter 已把「当日未发布」当常态返空集（非异常），这里据 count=0 友好提示。
  if (dt.data.length === 0) {
    out.push('- 当日无龙虎榜数据（通常为尚未发布或无个股上榜）。');
    return out;
  }
  const symset = new Set(wl.map((e) => e.symbol));
  const hits = dt.data.filter((r) => symset.has(String(pick(r, ['代码']) ?? '')));
  if (hits.length === 0) {
    out.push('- 自选股无个股上榜。');
    return out;
  }
  for (const r of hits) {
    const name = String(pick(r, ['名称']) ?? '');
    const code = String(pick(r, ['代码']) ?? '');
    const reason = String(pick(r, ['上榜原因']) ?? '—');
    // akshare 自带「解读」列（一行中性解读，如「主力做T」）—— 非我们生成，合规。
    const jiedu = pick(r, ['解读']);
    const jieduMd = jiedu ? ` ｜ 解读：${String(jiedu)}` : '';
    out.push(
      `- ${name}（${code}）：${reason} ｜ 龙虎榜净买额 ${fmtYiYuan(pick(r, ['龙虎榜净买额']), true)}${jieduMd}`,
    );
  }
  out.push(`  （${sourceTag(dt)}）`);
  return out;
}

// --- v2 盘后：速读 / 市场温度计 / 板块主线（金字塔结构 + 行内化，BOSS 四原则）---

/** 上证指数涨跌幅（速读行用）。 */
function shanghaiPct(cn: AkEnvelope<IndexRow>): string {
  if (cn.error) return '—';
  const r = cn.data.find((x) => String(pick(x, ['名称']) ?? '').includes('上证'));
  return r ? fmtPct(pick(r, ['涨跌幅'])) : '—';
}

/**
 * 顶部「今日速读」一行（原则1 金字塔，5 秒看完）：沪指±% ｜ 涨跌家数 ｜ 涨停(炸板率) ｜
 * 主力净流 ｜ 主线板块。某指标不可得则**跳过该项**（不堆「—」）。纯指标，无周期定性标签。
 */
function quickReadLine(input: PostmarketBriefingInput): string {
  const p = input.marketPulse?.data[0];
  const parts: string[] = [`沪指 ${shanghaiPct(input.indexCn)}`];
  if (p && !input.marketPulse?.error) {
    if (typeof p.up_count === 'number' && typeof p.down_count === 'number')
      parts.push(`涨${p.up_count}/跌${p.down_count}`);
    if (typeof p.zt_count === 'number') {
      const zb = typeof p.zhaban_rate === 'number' ? `(炸板${p.zhaban_rate}%)` : '';
      parts.push(`涨停${p.zt_count}${zb}`);
    }
    if (typeof p.net_inflow_yi === 'number')
      parts.push(`主力净流入${fmtYiCompact(p.net_inflow_yi)}`);
    const lead = p.sectors_up?.[0];
    if (lead?.板块) parts.push(`主线:${lead.板块}`);
  }
  return `📊 **今日速读**：${parts.join('｜')}`;
}

/** 市场温度计（原则3 行内化，2 行；纯指标无定性标签；逐项不可得则跳过）。 */
function thermometerLines(
  env: AkEnvelope<MarketPulseRow> | undefined,
  mode: BriefingMode,
): string[] {
  const p = env?.data[0];
  if (!env || env.error || !p) {
    return [unavailableLine('市场温度', env ?? ({ error: '' } as AkEnvelope), mode)];
  }
  const out: string[] = [];
  const seg1: string[] = [];
  if (typeof p.zt_count === 'number') {
    const lb =
      typeof p.max_lianban === 'number' && p.max_lianban >= 2 ? `，最高 ${p.max_lianban} 连板` : '';
    seg1.push(`涨停 ${p.zt_count} 家${lb}`);
  }
  if (typeof p.dt_count === 'number') seg1.push(`跌停 ${p.dt_count} 家`);
  if (typeof p.zb_count === 'number') {
    const rate = typeof p.zhaban_rate === 'number' ? `（炸板率 ${p.zhaban_rate}%）` : '';
    seg1.push(`炸板 ${p.zb_count} 家${rate}`);
  }
  if (seg1.length) out.push(`- ${seg1.join('，')}。`);
  const seg2: string[] = [];
  if (typeof p.up_count === 'number' && typeof p.down_count === 'number')
    seg2.push(`涨跌家数 ${p.up_count}/${p.down_count}`);
  if (typeof p.two_market_amount === 'number')
    seg2.push(`两市成交额 ${fmtWanYi(p.two_market_amount)}`);
  if (typeof p.net_inflow_yi === 'number')
    seg2.push(`主力净流入 ${fmtYiUnit(p.net_inflow_yi, true)}`);
  if (seg2.length) out.push(`- ${seg2.join('；')}。`);
  if (out.length === 0) return [unavailableLine('市场温度', env, mode)];
  out.push(`  （${srcTag(env, mode)}）`);
  return out;
}

/** 板块主线（涨幅前5+跌幅前5；行内；领涨股=龙头）。纯指标，无定性标签。 */
function sectorLines(env: AkEnvelope<MarketPulseRow> | undefined, mode: BriefingMode): string[] {
  const p = env?.data[0];
  if (!env || env.error || !p) {
    return [unavailableLine('板块', env ?? ({ error: '' } as AkEnvelope), mode)];
  }
  const up = p.sectors_up ?? [];
  const down = p.sectors_down ?? [];
  if (up.length === 0 && down.length === 0) return ['- 板块数据暂不可用。'];
  const fmtUp = (s: SectorEntry) =>
    `${s.板块} ${fmtPct(s.涨跌幅)}${s.领涨股 ? `（${s.领涨股}）` : ''}`;
  const out: string[] = [];
  if (up.length) out.push(`- 涨幅前${up.length}：${up.map(fmtUp).join('、')}`);
  if (down.length)
    out.push(
      `- 跌幅前${down.length}：${down.map((s) => `${s.板块} ${fmtPct(s.涨跌幅)}`).join('、')}`,
    );
  out.push(`  （${srcTag(env, mode)}）`);
  return out;
}

/** 盘前回顾段：上一交易日涨停梯队（昨日涨停回顾，纯指标；缺数据 prod 静默）。 */
function ztReviewLines(env: AkEnvelope<ZtReviewRow> | undefined, mode: BriefingMode): string[] {
  const z = env?.data[0];
  if (!env || env.error || !z || typeof z.zt_count !== 'number') {
    return mode === 'dev' ? ['  - [dev] 昨日涨停回顾数据暂不可用'] : [];
  }
  const lb =
    typeof z.max_lianban === 'number' && z.max_lianban >= 2 ? `，最高 ${z.max_lianban} 连板` : '';
  const inds = (z.top_industries ?? []).filter((i) => i.行业).slice(0, 3);
  const indStr = inds.length
    ? `；活跃行业 ${inds.map((i) => `${i.行业}(${i.家数})`).join('、')}`
    : '';
  return [
    '**昨日涨停回顾**',
    `- 上一交易日涨停 ${z.zt_count} 家${lb}${indStr}。`,
    `  （${srcTag(env, mode)}）`,
  ];
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
    '## 二、自选股相关公告（近 24 小时）',
    ...watchlistAnnouncementLines(input.watchlist, input.announcements, {
      mode,
      emptyLabel: '近 24 小时无新公告',
    }),
    '',
    '## 三、今日关键事项（解禁 / 公告提示）',
    ...keyEventLines(input.watchlist, input.announcements, input.shareUnlock, mode),
    '',
    `## 四、上一交易日龙虎榜回顾（${dateHeader(input.dragonTigerDate)}）`,
    '> A股龙虎榜与涨停榜于收盘后晚间披露，故在次日盘前回顾上一交易日。',
    ...ztReviewLines(input.ztReview, mode),
    ...dragonTigerLines(input.watchlist, input.dragonTiger, mode),
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
    // 原则1 金字塔：顶部一行速读（5 秒看完）。
    quickReadLine(input),
    '',
    // 原则2 固定段序：速读 → 大盘速览 → 温度计 → 板块主线 → 自选股 → 公告。
    '## 一、大盘速览',
    ...marketOverviewLines(input.indexCn, input.northbound, mode),
    '',
    '## 二、市场温度计',
    ...thermometerLines(input.marketPulse, mode),
    '',
    '## 三、板块主线',
    ...sectorLines(input.marketPulse, mode),
    '',
    // 原则3 表格只留自选股（市场级数据已全部行内化于温度计/板块主线）。
    '## 四、自选股当日表现',
    ...watchlistPerformanceLines(input.watchlist, input.dailyKline),
    '',
    // 龙虎榜不在盘后（当日榜单晚间才披露）→ 已移到次日盘前「回顾」段（BOSS 拍板）。
    '## 五、自选股新公告（当日）',
    ...watchlistAnnouncementLines(input.watchlist, input.announcements, {
      mode,
      emptyLabel: '今日无新公告',
    }),
    '',
    disclaimerBlock(),
  ].join('\n');
}
