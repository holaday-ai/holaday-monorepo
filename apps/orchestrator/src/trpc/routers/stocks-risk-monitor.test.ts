import { describe, expect, it } from 'vitest';
import {
  createStockRiskMonitorInputSchema,
  stockRiskMonitorsInputSchema,
} from './stocks-risk-monitor.js';

const snapshot = {
  snapshotId: 'stkshot_1234567890abcdef12345678',
  dataAsOf: '2026-08-19',
  trustMode: 'current' as const,
};

describe('stock risk monitor route inputs', () => {
  it('accepts only a trusted context and symbol for creation', () => {
    expect(createStockRiskMonitorInputSchema.parse({ ...snapshot, symbol: '603528' })).toEqual({
      ...snapshot,
      symbol: '603528',
    });
    expect(() => createStockRiskMonitorInputSchema.parse({
      ...snapshot,
      trustMode: 'delayed',
      symbol: '603528',
      name: '客户端伪造名称',
    })).toThrow();
  });

  it('allows monitor status lookup for every radar-readable trust mode', () => {
    expect(stockRiskMonitorsInputSchema.parse({ ...snapshot, trustMode: 'historical' }))
      .toMatchObject({ trustMode: 'historical' });
  });
});
