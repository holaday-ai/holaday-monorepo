/**
 * Phase 1 指令 #2 ③ §6 — briefing 服务单测.
 *
 * fake AkshareClient（喂 fixtures envelope）+ fake db（自选股 select）→
 * 验组装：盘前/盘后 markdown 含自选股 + 北京日期 + 龙虎榜命中 + 单只取数
 * 用 compact 日期；Stub client → 优雅降级（数据暂不可用）不崩。
 */

import { describe, expect, it } from 'vitest';
import { type AkshareClient, StubAkshareClient } from './akshare-client.js';
import { POSTMARKET_SAMPLE, PREMARKET_SAMPLE } from './briefing-fixtures.js';
import {
  type BriefingServiceDeps,
  buildPostmarketBriefing,
  buildPremarketBriefing,
} from './briefing-service.js';
import type { AkEnvelope } from './briefing-types.js';

const WL = [
  { symbol: '600519', market: 'A', displayName: '贵州茅台' },
  { symbol: '300750', market: 'A', displayName: '宁德时代' },
  { symbol: '000001', market: 'A', displayName: '平安银行' },
];

function emptyEnv<T>(source: string): AkEnvelope<T> {
  return { data: [], count: 0, source, fetched_at: '2026-06-11T00:00:00Z', disclaimer: 'x' };
}

/** 最小 fake db：listWatchlistForUser 只走一条 select→from→where→orderBy。 */
function fakeDb(rows: typeof WL): BriefingServiceDeps['db'] {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return {
    select: () => ({
      from: () => ({ where: () => ({ orderBy: () => Promise.resolve(rows) }) }),
    }),
  } as unknown as BriefingServiceDeps['db'];
}

/** fake client：从 fixtures 取，缺则空 envelope。dragonTiger 记录入参。 */
function fakeClient(dtSpy?: (d: string) => void): AkshareClient {
  return {
    getIndexQuote: (m) =>
      Promise.resolve(
        m === 'us'
          ? PREMARKET_SAMPLE.indexUs
          : m === 'hk'
            ? PREMARKET_SAMPLE.indexHk
            : POSTMARKET_SAMPLE.indexCn,
      ),
    getStockAnnouncements: (s) =>
      Promise.resolve(PREMARKET_SAMPLE.announcements[s] ?? emptyEnv('ann')),
    getShareUnlock: (s) => Promise.resolve(PREMARKET_SAMPLE.shareUnlock[s] ?? emptyEnv('unlock')),
    getStockKline: (s) => Promise.resolve(POSTMARKET_SAMPLE.dailyKline[s] ?? emptyEnv('kline')),
    getDragonTiger: (d) => {
      dtSpy?.(d);
      return Promise.resolve(PREMARKET_SAMPLE.dragonTiger);
    },
    getNorthboundFlow: () => Promise.resolve(POSTMARKET_SAMPLE.northbound),
    getTradingDay: (date: string) =>
      Promise.resolve({
        data: [{ date, is_trading_day: true }],
        count: 1,
        source: 'fake:trading_day',
        fetched_at: '2026-06-11T00:00:00Z',
        disclaimer: 'x',
      }),
    searchSymbol: () => Promise.resolve(emptyEnv('symbol')),
    getMarketPulse: () =>
      Promise.resolve(POSTMARKET_SAMPLE.marketPulse ?? emptyEnv('market_pulse')),
    getZtPoolSummary: () => Promise.resolve(PREMARKET_SAMPLE.ztReview ?? emptyEnv('zt_summary')),
    getFundamentals: () => Promise.resolve(emptyEnv('fundamentals')),
    getValuation: () => Promise.resolve(emptyEnv('valuation')),
  };
}

const NOW = new Date('2026-06-11T01:00:00Z'); // 北京 09:00

describe('buildPremarketBriefing', () => {
  it('组装含外围/公告/解禁 + 北京日期 + 上一交易日龙虎榜回顾（compact 日期）', async () => {
    const seen: string[] = [];
    const md = await buildPremarketBriefing(
      { db: fakeDb(WL), client: fakeClient((d) => seen.push(d)), now: NOW },
      42,
    );
    expect(md).toContain('# 📋 HOLA DAY · A股盘前简报');
    expect(md).toContain('2026-06-11（周四）');
    expect(md).toContain('标普500 5,433.21（+0.62%）');
    expect(md).toContain('**贵州茅台（600519）**');
    expect(md).toContain('06-20 解禁（流通市值 18.96亿元）');
    // 龙虎榜移到盘前「回顾」：取上一交易日(2026-06-10 周三)榜单。
    expect(md).toContain('上一交易日龙虎榜回顾（2026-06-10（周三））');
    expect(md).toContain('宁德时代（300750）：日跌幅偏离值达7%的证券');
    expect(seen).toEqual(['20260610']); // getDragonTiger 收到上一交易日 compact
    expect(md).not.toContain('[dev]'); // 默认 prod
  });
});

describe('buildPostmarketBriefing', () => {
  it('组装大盘速览/表现表；龙虎榜已移盘前，不再出现在盘后', async () => {
    const md = await buildPostmarketBriefing(
      { db: fakeDb(WL), client: fakeClient(), now: NOW },
      42,
    );
    expect(md).toContain('# 📊 HOLA DAY · A股盘后复盘');
    expect(md).toContain('## 一、大盘速览');
    expect(md).toContain('上证指数 3,125.40（+0.42%）');
    expect(md).toContain('| 贵州茅台 | 600519 | 1,580.00 | +1.23% | 38.20亿元 |');
    expect(md).not.toContain('龙虎榜'); // 已移到盘前回顾
  });
});

describe('降级 / 边界', () => {
  it('StubAkshareClient → 优雅降级（数据暂不可用），不崩，免责仍在', async () => {
    const md = await buildPremarketBriefing(
      { db: fakeDb(WL), client: new StubAkshareClient(), now: NOW },
      42,
    );
    expect(md).toContain('# 📋 HOLA DAY · A股盘前简报');
    expect(md).toContain('数据暂不可用');
    expect(md).toContain('不构成任何投资建议'); // 免责
  });

  it('空自选股 → 仍出简报骨架（外围在，自选段提示空）', async () => {
    const md = await buildPremarketBriefing({ db: fakeDb([]), client: fakeClient(), now: NOW }, 42);
    expect(md).toContain('标普500'); // 外围与自选股无关，仍在
    expect(md).toContain('自选股清单为空');
  });

  it('mode=dev 透传到渲染器', async () => {
    const deps: BriefingServiceDeps = {
      db: fakeDb(WL),
      client: fakeClient(),
      now: NOW,
      mode: 'dev',
    };
    const md = await buildPremarketBriefing(deps, 42);
    expect(md).toContain('[dev]');
  });

  it('未注入 now 时用 new Date()（默认分支不抛）', async () => {
    const md = await buildPremarketBriefing({ db: fakeDb(WL), client: fakeClient() }, 42);
    expect(md).toContain('A股盘前简报');
  });
});
