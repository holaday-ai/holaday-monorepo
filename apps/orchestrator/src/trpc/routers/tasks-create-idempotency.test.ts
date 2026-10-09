import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { HttpAkshareClient } from '../../agent/a-share/akshare-http-client.js';
import { runAsharePanorama } from '../../agent/a-share/ashare-qa-runner.js';
import { selectStockAnalysisInput } from '../../stocks/stock-analysis-input.js';
import { runTaskCreateIdempotently, stockTaskContextInput } from './tasks.js';

const response = { taskId: 'tsk_once', status: 'executing' };

describe('runTaskCreateIdempotently', () => {
  it('keeps the production task router free of legacy model construction', () => {
    const source = readFileSync(new URL('./tasks.ts', import.meta.url), 'utf8');
    expect(source).not.toMatch(/new\s+Anthropic\s*\(/);
    expect(source).not.toMatch(/new\s+OpenAI\s*\(/);
    expect(source).not.toContain('anthropicForResolver');
  });

  it('runs once and finalizes the claimed response', async () => {
    const run = vi.fn(async () => response);
    const finalize = vi.fn(async () => true);
    await expect(
      runTaskCreateIdempotently({
        clientRequestId: 'local_pending_123',
        claim: async () => ({ kind: 'claimed' }),
        finalize,
        release: async () => true,
        run,
      }),
    ).resolves.toEqual(response);
    expect(run).toHaveBeenCalledTimes(1);
    expect(finalize).toHaveBeenCalledWith('tsk_once', response);
  });

  it('replays the original response without creating another task', async () => {
    const run = vi.fn(async () => response);
    await expect(
      runTaskCreateIdempotently({
        clientRequestId: 'local_pending_123',
        claim: async () => ({
          kind: 'replay',
          conflictsWith: false,
          taskId: 'tsk_once',
          response,
        }),
        finalize: async () => true,
        release: async () => true,
        run,
      }),
    ).resolves.toEqual(response);
    expect(run).not.toHaveBeenCalled();
  });

  it('fails closed while the first request is still creating', async () => {
    await expect(
      runTaskCreateIdempotently({
        clientRequestId: 'local_pending_123',
        claim: async () => ({ kind: 'in_flight', claimedAt: new Date() }),
        finalize: async () => true,
        release: async () => true,
        run: async () => response,
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('releases the claim when task creation fails', async () => {
    const release = vi.fn(async () => true);
    await expect(
      runTaskCreateIdempotently({
        clientRequestId: 'local_pending_123',
        claim: async () => ({ kind: 'claimed' }),
        finalize: async () => true,
        release,
        run: async () => {
          throw new Error('quota failed');
        },
      }),
    ).rejects.toThrow('quota failed');
    expect(release).toHaveBeenCalledTimes(1);
  });
});

describe('stock-dashboard task creation contract', () => {
  it('accepts only a bounded trusted context input', () => {
    expect(
      stockTaskContextInput.parse({
        snapshotId: 'stkshot_0123456789abcdef01234567',
        dataAsOf: '2026-08-11',
        trustMode: 'historical',
        evidenceIds: ['quote:603528:2026-08-11'],
      }),
    ).toMatchObject({ trustMode: 'historical' });
    expect(() =>
      stockTaskContextInput.parse({
        snapshotId: 'stkshot_bad',
        dataAsOf: '08/11',
        trustMode: 'unavailable',
        evidenceIds: [],
      }),
    ).toThrow();
  });

  it('uses fetched quote, financial period, sources and distinct fetch/submission clocks for current context', async () => {
    const { result, modelInput, evidence } = await dashboardReport('current');
    expect(result.answer).toContain('1,377.12');
    expect(result.answer).not.toContain('777.12');
    expect(result.answer).toContain('2026中报');
    expect(result.answer).toContain('2026-10-09 11:36:10');
    expect(result.answer).toContain('11:42');
    expect(result.answer).not.toContain('15:00');
    for (const id of ['d11a', 'd11b', 'd11c']) {
      expect(result.answer).toContain(
        `https://www.cninfo.com.cn/new/disclosure/detail?announcementId=${id}`,
      );
    }
    expect(modelInput).toContain('1,377.12');
    expect(modelInput).toContain('2026中报');
    expect(evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          dimension: 'quote',
          source: 'd11-recorded-provider',
          fetchedAt: '2026-10-09T03:37:00Z',
          unavailable: false,
        }),
        expect.objectContaining({
          dimension: 'fundamentals',
          source: 'd11-recorded-provider',
          fetchedAt: '2026-10-09T03:37:00Z',
          unavailable: false,
        }),
      ]),
    );
  });

  it('degrades missing provider data instead of inventing quote, financial period or sources', async () => {
    const { result, modelInput, evidence } = await dashboardReport('current', true);
    expect(result.answer).toContain('数据暂不可用');
    expect(result.answer).toContain('11:42');
    expect(result.answer).not.toContain('1,377.12');
    expect(result.answer).not.toContain('777.12');
    expect(result.answer).not.toContain('2026中报');
    expect(result.answer).not.toContain('announcementId=');
    expect(modelInput).not.toContain('1,377.12');
    expect(evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ dimension: 'quote', rows: 0, unavailable: true }),
        expect.objectContaining({ dimension: 'fundamentals', rows: 0, unavailable: true }),
      ]),
    );
  });

  it.each(['historical', 'delayed'] as const)(
    'keeps %s evidence inside the admitted snapshot and retains actual submission time',
    async (trustMode) => {
      const { result, evidence, providerCalls } = await dashboardReport(trustMode);
      expect(providerCalls).toEqual([]);
      expect(result.answer).toContain('777.12');
      expect(result.answer).not.toContain('1,377.12');
      expect(result.answer).not.toContain('2026中报');
      expect(result.answer).not.toContain('announcementId=');
      expect(result.answer).toContain('数据暂不可用');
      expect(result.answer).toContain('11:42');
      expect(evidence).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            dimension: 'quote',
            source: 'stock-snapshot:quote:600519',
            fetchedAt: '2026-10-08T07:00:00Z',
            unavailable: false,
          }),
        ]),
      );
    },
  );
});

/** Only the HTTP provider and LLM boundary are fixtures; selection, fetching,
 * provenance and report rendering execute production code. These literals are
 * deliberately different from the snapshot and submission clock.
 */
async function dashboardReport(trustMode: 'current' | 'historical' | 'delayed', missing = false) {
  const providerCalls: string[] = [];
  const live = new HttpAkshareClient({
    baseUrl: `https://d11-${trustMode}-${missing}.invalid`,
    fetchImpl: async (url) => {
      const path = new URL(url).pathname;
      providerCalls.push(path);
      const data =
        path === '/quote/600519'
          ? [{ 代码: '600519', 最新价: 1377.12, 涨跌幅: 1.3, 行情时间: '2026-10-09 11:36:10' }]
          : path === '/fundamentals/600519'
            ? [{ report_period: '2026-06-30', revenue: 81930000000, net_profit: 41600000000 }]
            : path === '/announcements/600519'
              ? ['d11a', 'd11b', 'd11c'].map((id) => ({
                  公告标题: `录制来源 ${id}`,
                  公告时间: '2026-10-09',
                  公告链接: `https://www.cninfo.com.cn/new/disclosure/detail?announcementId=${id}`,
                }))
              : [];
      return new Response(
        JSON.stringify({
          data: missing ? [] : data,
          count: missing ? 0 : data.length,
          source: 'd11-recorded-provider',
          fetched_at: '2026-10-09T03:37:00Z',
          disclaimer: 'fixture only',
          ...(missing
            ? { error: 'recorded source unavailable', error_code: 'UPSTREAM_UNAVAILABLE' }
            : {}),
        }),
      );
    },
  });
  const dataAsOf = trustMode === 'current' ? '2026-10-09' : '2026-10-08';
  const selected = selectStockAnalysisInput(
    {
      snapshotId: 'stkshot_0123456789abcdef01234567',
      dataAsOf,
      trustMode,
      evidenceIds: [`quote:600519:${dataAsOf}`],
      snapshotPayload: {
        dataAsOf,
        generatedAt: '2026-10-08T07:00:00Z',
        watchlistStocks: [{ symbol: '600519', name: '贵州茅台', price: 777.12 }],
        marketIndices: [],
        sectors: [],
        news: [],
      },
    },
    live,
    new Date('2026-10-09T03:42:00Z'),
  );
  let modelInput = '';
  let evidence: unknown[] = [];
  const result = await runAsharePanorama(
    {
      client: selected.client,
      now: selected.submittedAt,
      logger: {
        info: (obj) => {
          evidence = (obj as { dimensions: { sources: unknown[] }[] }).dimensions.flatMap(
            (x) => x.sources,
          );
        },
        warn: () => {},
      },
      interpret: async (input) => {
        modelInput = input.user;
        return '';
      },
    },
    {
      kind: 'anomaly',
      stocks: [{ symbol: '600519', displayName: '贵州茅台' }],
      dateIso: dataAsOf,
      dateCompact: dataAsOf.replaceAll('-', ''),
    },
  );
  return { result, modelInput, evidence, providerCalls };
}
