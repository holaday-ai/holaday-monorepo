import { describe, expect, it, vi } from 'vitest';
import type {
  AkEnvelope,
  AnnouncementRow,
  ForecastRow,
  GoodwillRow,
  InsiderChangeRow,
  PledgeRow,
} from '../agent/a-share/briefing-types.js';
import { type StockRiskRadarClient, runStockRiskRadar } from './stock-risk-radar-service.js';

const SNAPSHOT_ID = 'stkshot_0123456789abcdef01234567';
const DATA_AS_OF = '2026-08-17';
const FETCHED_AT = '2026-08-17T11:30:00.000Z';

function envelope<T>(
  data: T[],
  source: string,
  options: { error?: string; errorCode?: string } = {},
): AkEnvelope<T> {
  return {
    data,
    count: data.length,
    source,
    fetched_at: FETCHED_AT,
    disclaimer: '数据来源 AkShare 聚合，仅供信息参考，不构成投资建议。',
    ...(options.error ? { error: options.error } : {}),
    ...(options.errorCode ? { error_code: options.errorCode } : {}),
  };
}

function clientWith(overrides: Partial<StockRiskRadarClient> = {}): StockRiskRadarClient {
  return {
    getRiskPledge: vi.fn(async () => envelope<PledgeRow>([], 'akshare:pledge')),
    getRiskGoodwill: vi.fn(async () => envelope<GoodwillRow>([], 'akshare:goodwill')),
    getRiskForecast: vi.fn(async () => envelope<ForecastRow>([], 'akshare:forecast')),
    getRiskInsider: vi.fn(async () => envelope<InsiderChangeRow>([], 'akshare:insider')),
    getStockAnnouncements: vi.fn(async () =>
      envelope<AnnouncementRow>([], 'akshare:announcements'),
    ),
    ...overrides,
  };
}

describe('stock risk radar service', () => {
  it('turns verified raw facts into auditable deterministic signals', async () => {
    const client = clientWith({
      getRiskPledge: vi.fn(async (_date, symbol) =>
        envelope<PledgeRow>(
          symbol === '600001'
            ? [{ 股票代码: symbol, 股票简称: '测试股份', 交易日期: '2026-08-14', 质押比例: 58 }]
            : [],
          'akshare:stock_gpzy_pledge_ratio_em',
        ),
      ),
      getRiskGoodwill: vi.fn(async (_date, symbol) =>
        symbol === '000002'
          ? envelope<GoodwillRow>([], 'akshare:stock_sy_em', {
              error: 'upstream credentials and request details must not escape',
              errorCode: 'UPSTREAM_UNAVAILABLE',
            })
          : envelope<GoodwillRow>([], 'akshare:stock_sy_em'),
      ),
      getRiskForecast: vi.fn(async (_date, symbol) =>
        envelope<ForecastRow>(
          symbol === '600001'
            ? [{ 股票代码: symbol, 预告类型: '预减', 业绩变动幅度: -35, 公告日期: '2026-08-02' }]
            : [{ 股票代码: symbol, 预告类型: '预增', 业绩变动幅度: 20, 公告日期: '2026-08-03' }],
          'akshare:stock_yjyg_em',
        ),
      ),
      getRiskInsider: vi.fn(async (symbol) =>
        envelope<InsiderChangeRow>(
          symbol === '600001'
            ? [{ 变动数: -1_000_000, 变动日期: '2026-08-01', 变动原因: '个人资金安排' }]
            : [],
          'akshare:stock_share_hold_change',
        ),
      ),
      getStockAnnouncements: vi.fn(async (symbol) =>
        envelope<AnnouncementRow>(
          symbol === '600001'
            ? [
                {
                  代码: symbol,
                  简称: '测试股份',
                  公告标题: '关于收到交易所问询函的公告',
                  公告时间: '2026-08-05',
                  公告链接: 'https://example.com/inquiry.pdf',
                },
              ]
            : [],
          'akshare:stock_zh_a_disclosure_report_cninfo',
        ),
      ),
    });

    const result = await runStockRiskRadar({
      client,
      snapshotId: SNAPSHOT_ID,
      dataAsOf: DATA_AS_OF,
      stocks: [
        { symbol: '600001', name: '测试股份', market: 'A' },
        { symbol: '000002', name: '示例科技', market: 'A' },
      ],
      now: new Date('2026-08-17T12:00:00.000Z'),
    });

    expect(result).toMatchObject({
      snapshotId: SNAPSHOT_ID,
      dataAsOf: DATA_AS_OF,
      generatedAt: '2026-08-17T12:00:00.000Z',
      requestedStockCount: 2,
      checkedStockCount: 2,
      truncated: false,
    });
    expect(result.signals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          symbol: '600001',
          key: 'pledge',
          severity: '高风险',
          trigger: '质押比例超过 50%',
          sourceDataAsOf: '2026-08-14',
          source: 'akshare:stock_gpzy_pledge_ratio_em',
        }),
        expect.objectContaining({
          symbol: '600001',
          key: 'forecast',
          severity: '警示',
          trigger: '业绩预告类型属于预减或亏损',
          sourceDataAsOf: '2026-08-02',
        }),
        expect.objectContaining({
          symbol: '600001',
          key: 'inquiry',
          severity: '警示',
          observedAt: '2026-08-05',
          evidenceUrl: 'https://example.com/inquiry.pdf',
        }),
      ]),
    );
    expect(result.signals).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ symbol: '000002', key: 'forecast' })]),
    );
    expect(
      result.signals.every(
        (signal) =>
          /^risk_signal_[a-f0-9]{24}$/.test(signal.signalId) &&
          /^risk:[a-f0-9]{24}$/.test(signal.evidenceId),
      ),
    ).toBe(true);
    expect(result.checks).toHaveLength(10);
    expect(result.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          symbol: '000002',
          key: 'goodwill',
          status: 'unavailable',
          errorCode: 'UPSTREAM_UNAVAILABLE',
        }),
        expect.objectContaining({
          symbol: '000002',
          key: 'pledge',
          status: 'checked',
          sourceDataAsOf: null,
        }),
      ]),
    );
    expect(JSON.stringify(result)).not.toContain('credentials and request details');
    expect(JSON.stringify(result)).not.toMatch(/买入|卖出|持有|目标价|推荐指数|最值得买/);
  });

  it('uses a bounded historical window and does not turn old events into current signals', async () => {
    const client = clientWith({
      getRiskInsider: vi.fn(async () =>
        envelope<InsiderChangeRow>(
          [
            { 变动数: -1_000_000, 变动日期: '2026-01-01' },
            { 变动数: -500_000, 变动日期: '2026-08-18' },
          ],
          'akshare:insider',
        ),
      ),
      getStockAnnouncements: vi.fn(async () =>
        envelope<AnnouncementRow>(
          [
            { 公告标题: '关于收到问询函的公告', 公告时间: '2026-01-10' },
            { 公告标题: '减持计划公告', 公告时间: '2026-08-18' },
          ],
          'akshare:announcements',
        ),
      ),
    });

    const result = await runStockRiskRadar({
      client,
      snapshotId: SNAPSHOT_ID,
      dataAsOf: DATA_AS_OF,
      stocks: [{ symbol: '600001', name: '测试股份', market: 'A' }],
    });

    expect(result.signals.map((signal) => signal.key)).toEqual([]);
    expect(result.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: 'insider', status: 'checked' }),
        expect.objectContaining({ key: 'announcements', status: 'checked' }),
      ]),
    );
  });

  it('deduplicates stocks, excludes non-A shares, and reports eight-stock truncation', async () => {
    const client = clientWith();
    const stocks = [
      ...Array.from({ length: 10 }, (_, index) => ({
        symbol: `6000${String(index).padStart(2, '0')}`,
        name: `测试${index}`,
        market: 'A',
      })),
      { symbol: '600000', name: '重复项', market: 'A' },
      { symbol: '00700', name: '腾讯控股', market: 'HK' },
    ];

    const result = await runStockRiskRadar({
      client,
      snapshotId: SNAPSHOT_ID,
      dataAsOf: DATA_AS_OF,
      stocks,
    });

    expect(result.requestedStockCount).toBe(10);
    expect(result.checkedStockCount).toBe(8);
    expect(result.truncated).toBe(true);
    expect(client.getRiskPledge).toHaveBeenCalledTimes(8);
    expect(result.checks).toHaveLength(40);
  });

  it('keeps identifiers stable for identical evidence and changes them when the fact changes', async () => {
    const pledge = vi.fn(async () =>
      envelope<PledgeRow>(
        [{ 股票代码: '600001', 交易日期: '2026-08-14', 质押比例: 58 }],
        'akshare:pledge',
      ),
    );
    const client = clientWith({ getRiskPledge: pledge });
    const args = {
      client,
      snapshotId: SNAPSHOT_ID,
      dataAsOf: DATA_AS_OF,
      stocks: [{ symbol: '600001', name: '测试股份', market: 'A' }],
      now: new Date('2026-08-17T12:00:00.000Z'),
    };

    const first = await runStockRiskRadar(args);
    const second = await runStockRiskRadar(args);
    pledge.mockResolvedValue(
      envelope<PledgeRow>(
        [{ 股票代码: '600001', 交易日期: '2026-08-14', 质押比例: 65 }],
        'akshare:pledge',
      ),
    );
    const changed = await runStockRiskRadar(args);

    expect(second.signals[0]?.signalId).toBe(first.signals[0]?.signalId);
    expect(second.signals[0]?.evidenceId).toBe(first.signals[0]?.evidenceId);
    expect(changed.signals[0]?.signalId).not.toBe(first.signals[0]?.signalId);
    expect(changed.signals[0]?.evidenceId).not.toBe(first.signals[0]?.evidenceId);
  });

  it('never exposes a non-http announcement link as clickable evidence', async () => {
    const client = clientWith({
      getStockAnnouncements: vi.fn(async () =>
        envelope<AnnouncementRow>(
          [
            {
              公告标题: '关于收到交易所问询函的公告',
              公告时间: '2026-08-05',
              公告链接: 'javascript:alert(document.domain)',
            },
          ],
          'akshare:announcements',
        ),
      ),
    });

    const result = await runStockRiskRadar({
      client,
      snapshotId: SNAPSHOT_ID,
      dataAsOf: DATA_AS_OF,
      stocks: [{ symbol: '600001', name: '测试股份', market: 'A' }],
    });

    expect(result.signals).toEqual(
      expect.arrayContaining([expect.objectContaining({ key: 'inquiry', evidenceUrl: null })]),
    );
    expect(JSON.stringify(result)).not.toContain('javascript:');
  });
});
