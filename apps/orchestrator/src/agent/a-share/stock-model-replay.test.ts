import { afterEach, expect, it, vi } from 'vitest';
import { selectStockAnalysisInput } from '../../stocks/stock-analysis-input.js';
import { HttpAkshareClient, resetAkshareCircuitBreakersForTests } from './akshare-http-client.js';
import { runAsharePanorama } from './ashare-qa-runner.js';
import recording from './fixtures/600519-20261009.json' with { type: 'json' };
const now = new Date('2026-10-09T04:35:00Z');
const match = {
  kind: 'info' as const,
  deep: true,
  stocks: [{ symbol: '600519', displayName: '贵州茅台' }],
  dateIso: '2026-10-09',
  dateCompact: '20261009',
};
const logger = { info: vi.fn(), warn: vi.fn() };
afterEach(() => resetAkshareCircuitBreakersForTests());
function replay(allFailed = false) {
  const paths: string[] = [];
  const fetchImpl = async (url: string) => {
    const path = new URL(url).pathname;
    paths.push(path);
    const stored = recording.responses.find(
      (r) => new URL(r.path, 'http://fixture.test').pathname === path,
    );
    const envelope =
      !allFailed && stored
        ? stored.envelope
        : {
            data: [],
            count: 0,
            source: 'fixture:unavailable',
            fetched_at: now.toISOString(),
            disclaimer: 'fixture',
            error: 'unavailable',
            error_code: 'UPSTREAM_TIMEOUT',
          };
    return { ok: true, status: 200, json: async () => envelope };
  };
  return { client: new HttpAkshareClient({ baseUrl: 'http://fixture.test', fetchImpl }), paths };
}
it('replays recorded 600519 public data through whole-market selection, fetch, context and report', async () => {
  const f = replay();
  let context = '';
  const selected = selectStockAnalysisInput(
    {
      snapshotId: 'stkshot_fixture',
      dataAsOf: '2026-10-09',
      trustMode: 'current',
      evidenceIds: [],
      snapshotPayload: {
        generatedAt: '2026-10-09T04:30:00Z',
        dataAsOf: '2026-10-09',
        watchlistStocks: [],
        marketIndices: [],
        sectors: [],
        news: [],
      },
    },
    f.client,
    now,
  );
  const r = await runAsharePanorama(
    {
      client: selected.client,
      now: selected.submittedAt,
      riskRadar: true,
      logger,
      interpret: async (x) => {
        context = x.user;
        return '';
      },
    },
    match,
  );
  expect(f.paths).toContain('/quote/600519');
  expect(f.paths).toContain('/fundamentals/600519');
  expect(r.answer).toContain('1,272.08');
  expect(r.answer).toContain('2026中报');
  expect(r.answer).toContain('12:35');
  expect(r.answer).toContain('2026-10-09 11:30:00');
  expect(r.answer).toContain('最近收盘（2026-10-08）');
  expect(r.answer.match(/\]\(https?:\/\//g)?.length).toBeGreaterThanOrEqual(3);
  expect(context).toContain('1,272.08');
  expect(context).toContain('2026中报');
  expect(r.answer).toContain('风险数据暂不可用');
});
it('all sources fail: report degrades truthfully and never invents a price, period or sources', async () => {
  const f = replay(true);
  const r = await runAsharePanorama(
    { client: f.client, now, riskRadar: true, logger, interpret: async () => '' },
    match,
  );
  expect(r.answer).toContain('数据暂不可用');
  expect(r.answer).not.toContain('1,272.08');
  expect(r.answer).not.toContain('2026中报');
  expect(r.answer).not.toMatch(/\]\(https?:\/\//);
  expect(r.answer).not.toContain('未检测到上述风险信号');
  expect(r.answer).toContain('限售解禁：数据暂不可用');
  expect(r.answer).toContain('北向资金：数据暂不可用');
});
