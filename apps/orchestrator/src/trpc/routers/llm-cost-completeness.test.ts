import { describe, expect, it } from 'vitest';
import type { Context } from '../context.js';
import { adminFinanceRouter } from './admin-finance.js';
import { llmCallsRouter } from './llm-calls.js';

function context(results: unknown[][]): Context {
  return {
    userId: 'usr_test',
    req: {},
    db: {
      select() {
        const rows = results.shift();
        if (!rows) throw new Error('Unexpected query');
        const query = {
          from: () => query,
          where: () => query,
          leftJoin: () => query,
          groupBy: () => query,
          orderBy: () => query,
          limit: () => query,
          // biome-ignore lint/suspicious/noThenProperty: awaitable Drizzle boundary fixture
          then: (resolve: (rows: unknown) => unknown) => Promise.resolve(rows).then(resolve),
        };
        return query;
      },
    },
  } as unknown as Context;
}
const admin = [{ role: 'admin', status: 'active' }];

describe('unknown cost never becomes a complete zero/partial total', () => {
  it('user detail preserves NULL and totals expose known subtotal plus missing count', async () => {
    const result = await llmCallsRouter
      .createCaller(
        context([
          [{ id: 1 }],
          [{ id: 1, costUsd: null, promptTokens: 10, completionTokens: null }],
          [
            {
              totalCalls: 2,
              totalCostUsd: '1.5',
              unknownCostCalls: 1,
              incompleteUsageCalls: 1,
              unknownOutputCalls: 1,
              totalOutputTokens: '100',
            },
          ],
        ]),
      )
      .list({});
    expect(result.rows[0]?.costUsd).toBeNull();
    expect(result.totals).toMatchObject({
      totalCostUsd: null,
      knownCostUsd: 1.5,
      unknownCostCalls: 1,
      incompleteUsageCalls: 1,
      totalOutputTokens: null,
    });
  });
  it('no calls has a legitimate complete zero', async () => {
    const result = await llmCallsRouter
      .createCaller(context([[{ id: 1 }], [], [{ totalCalls: 0 }]]))
      .list({});
    expect(result.totals).toMatchObject({ totalCostUsd: 0, knownCostUsd: 0, unknownCostCalls: 0 });
  });
  it('monthly profit is withheld instead of overestimated', async () => {
    const result = await adminFinanceRouter
      .createCaller(
        context([
          admin,
          [{ currency: 'CNY', sumCents: 10000 }],
          [{ sumUsd: '1', unknownCostCalls: 1 }],
        ]),
      )
      .summary();
    expect(result).toMatchObject({
      monthCostCnyCents: null,
      monthLlmCostCnyCents: null,
      monthProfitCnyCents: null,
      monthKnownLlmCostCnyCents: 720,
      unknownCostCalls: 1,
    });
  });
  it('unpriced model stays visible without a fabricated amount', async () => {
    const result = await adminFinanceRouter
      .createCaller(
        context([
          admin,
          [
            {
              model: 'qwen-test',
              provider: 'alibaba-model-studio',
              callCount: 1,
              costUsd: '0',
              unknownCostCalls: 1,
              promptTokens: 10,
              completionTokens: 5,
              cacheReadTokens: 0,
              cacheWriteTokens: 0,
            },
          ],
        ]),
      )
      .costBreakdown();
    expect(result.models[0]).toMatchObject({
      costUsd: null,
      costCnyCents: null,
      knownCostUsd: 0,
      unknownCostCalls: 1,
    });
  });
  it('day series keeps incomplete days as gaps, empty days as zero', async () => {
    const day = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
    const result = await adminFinanceRouter
      .createCaller(context([admin, [{ day, callCount: 1, costUsd: '0', unknownCostCalls: 1 }]]))
      .costByDay({ days: 7 });
    expect(result.series.at(-1)).toMatchObject({ costCnyCents: null, unknownCostCalls: 1 });
    expect(result.series[0]).toMatchObject({ costCnyCents: 0, unknownCostCalls: 0 });
  });
});
