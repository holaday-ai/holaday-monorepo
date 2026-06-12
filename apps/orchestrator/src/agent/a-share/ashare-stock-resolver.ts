/**
 * Phase 1 #2 ④ — A股个股解析（M1）.
 *
 * 文本 → 个股（代码 / 自选股名）。M1 两策略：
 *   1) 6 位代码（沪 60/68/0xx、深 00/30、北交所 8x/4x/92x；首位 0/3/6/8/9 过滤掉日期/数量误判）。
 *   2) 自选股**全名命中**（用户问句含 watchlist displayName）。
 * ⚠️ 短名/别名（「茅台」→600519）需 akshare `stock_info_a_code_name` 名称搜索 → M2
 * （先验 Vultr 可达性，同 sina 替代经验）。M1 不做，避免引新数据源风险。
 */

import type { ResolvedStock } from './ashare-qa-types.js';

/** 6 位数字 token（前后非数字边界）。 */
const CODE_RE = /(?<!\d)(\d{6})(?!\d)/g;

/** 看着像 A股代码：首位 0/3/6/8/9（排除 1/2/4/5/7 打头的年份/数量误判）。 */
function looksLikeAShareCode(code: string): boolean {
  return /^[03689]/.test(code);
}

/**
 * 从问句解析目标个股（去重，保留出现顺序）。无命中返回 []。
 */
export function resolveStocks(text: string, watchlist: ResolvedStock[]): ResolvedStock[] {
  const out: ResolvedStock[] = [];
  const seen = new Set<string>();
  const wlByName = watchlist.filter((w) => !!w.displayName);

  // 1) 6 位代码
  for (const m of text.matchAll(CODE_RE)) {
    const code = m[1];
    if (!code || !looksLikeAShareCode(code) || seen.has(code)) continue;
    seen.add(code);
    const wl = watchlist.find((w) => w.symbol === code);
    out.push({ symbol: code, displayName: wl?.displayName ?? null });
  }

  // 2) 自选股全名命中
  for (const w of wlByName) {
    if (w.displayName && text.includes(w.displayName) && !seen.has(w.symbol)) {
      seen.add(w.symbol);
      out.push({ symbol: w.symbol, displayName: w.displayName });
    }
  }

  return out;
}
