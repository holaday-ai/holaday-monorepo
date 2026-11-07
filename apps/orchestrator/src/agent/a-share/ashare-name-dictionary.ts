/**
 * 批次 11.2 — 本地 A股名称字典（长句抽股票名的零网络快路径）.
 *
 * 只收常见大盘股，作用是「长句里出现这些名称时不用请求 akshare」；不在字典里的名称照常走
 * akshare 名称表（逐个候选词查，见 ashare-qa-matcher.ts）。前 13 只与 trpc/routers/stocks.ts
 * 的 POPULAR_A_SYMBOLS 一致。
 *
 * 别名（短名）只收**不是常用词**的：「茅台/招行/格力」可以，「美的/平安/长江」这类日常词不收，
 * 防「美的风景」「平安到家」被当成股票。别名只在句子里已有 A股信号时才生效（见 matcher）。
 */

import type { ResolvedStock } from './ashare-qa-types.js';

export interface LocalStockName {
  symbol: string;
  name: string;
  aliases?: readonly string[];
}

export const LOCAL_STOCK_NAMES: readonly LocalStockName[] = [
  { symbol: '600519', name: '贵州茅台', aliases: ['茅台'] },
  { symbol: '300750', name: '宁德时代' },
  { symbol: '000001', name: '平安银行' },
  { symbol: '002594', name: '比亚迪' },
  { symbol: '601318', name: '中国平安' },
  { symbol: '600036', name: '招商银行', aliases: ['招行'] },
  { symbol: '000858', name: '五粮液' },
  { symbol: '601012', name: '隆基绿能' },
  { symbol: '688981', name: '中芯国际' },
  { symbol: '600900', name: '长江电力' },
  { symbol: '000725', name: '京东方A', aliases: ['京东方'] },
  { symbol: '603986', name: '兆易创新' },
  { symbol: '300308', name: '中际旭创' },
  { symbol: '601398', name: '工商银行', aliases: ['工行'] },
  { symbol: '601939', name: '建设银行', aliases: ['建行'] },
  { symbol: '601288', name: '农业银行', aliases: ['农行'] },
  { symbol: '601988', name: '中国银行' },
  { symbol: '601857', name: '中国石油' },
  { symbol: '600028', name: '中国石化' },
  { symbol: '000333', name: '美的集团' },
  { symbol: '000651', name: '格力电器', aliases: ['格力'] },
  { symbol: '002415', name: '海康威视' },
  { symbol: '600276', name: '恒瑞医药' },
  { symbol: '600887', name: '伊利股份' },
  { symbol: '601899', name: '紫金矿业' },
  { symbol: '600030', name: '中信证券' },
  { symbol: '300059', name: '东方财富' },
  { symbol: '300760', name: '迈瑞医疗' },
  { symbol: '000002', name: '万科A' },
  { symbol: '000568', name: '泸州老窖' },
  { symbol: '600809', name: '山西汾酒', aliases: ['汾酒'] },
  { symbol: '002475', name: '立讯精密' },
  { symbol: '603259', name: '药明康德' },
];

/**
 * 在文本里查本地字典：全名总是生效；别名仅 `allowAlias` 时生效（且全名未命中）。
 * 按出现位置排序、去重。
 */
export function lookupLocalNames(text: string, allowAlias: boolean): ResolvedStock[] {
  const hits: { at: number; stock: ResolvedStock }[] = [];
  for (const s of LOCAL_STOCK_NAMES) {
    let at = text.indexOf(s.name);
    if (at < 0 && allowAlias) {
      for (const a of s.aliases ?? []) {
        at = text.indexOf(a);
        if (at >= 0) break;
      }
    }
    if (at >= 0) hits.push({ at, stock: { symbol: s.symbol, displayName: s.name } });
  }
  return hits.sort((a, b) => a.at - b.at).map((h) => h.stock);
}

/** 文本中被字典命中的名称/别名（抽候选词前先挖掉，避免重复查）。 */
export function localNameSpans(text: string, allowAlias: boolean): string[] {
  const out: string[] = [];
  for (const s of LOCAL_STOCK_NAMES) {
    if (text.includes(s.name)) out.push(s.name);
    else if (allowAlias) for (const a of s.aliases ?? []) if (text.includes(a)) out.push(a);
  }
  return out;
}
