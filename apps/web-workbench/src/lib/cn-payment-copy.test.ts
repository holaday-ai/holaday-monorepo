import { describe, expect, it } from 'vitest';
import {
  cnPaymentProviderLabel,
  cnPaymentProviderMark,
  compactOutTradeNo,
  formatCnyFromCents,
} from './cn-payment-copy.js';

describe('cn payment copy helpers', () => {
  it('names CN payment providers', () => {
    expect(cnPaymentProviderLabel('wechat')).toBe('微信支付');
    expect(cnPaymentProviderLabel('alipay')).toBe('支付宝');
    expect(cnPaymentProviderMark('wechat')).toBe('微');
    expect(cnPaymentProviderMark('alipay')).toBe('支');
  });

  it('formats cents as CNY and clamps malformed amounts', () => {
    expect(formatCnyFromCents(1299)).toBe('¥12.99');
    expect(formatCnyFromCents(0)).toBe('¥0.00');
    expect(formatCnyFromCents(-500)).toBe('¥0.00');
    expect(formatCnyFromCents(null)).toBeNull();
    expect(formatCnyFromCents(Number.NaN)).toBeNull();
  });

  it('compacts long order numbers without hiding short ones', () => {
    expect(compactOutTradeNo('HDPAY2026052700012345')).toBe('HDPA…012345');
    expect(compactOutTradeNo('ORDER123')).toBe('ORDER123');
    expect(compactOutTradeNo('   ')).toBeNull();
    expect(compactOutTradeNo(null)).toBeNull();
  });
});
