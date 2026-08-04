import type { Logger } from 'pino';
import { describe, expect, it, vi } from 'vitest';
import { AlipayAdapter } from './alipay.js';
import type { Env } from './config/env.js';

function makeAdapter(overrides: Partial<Env> = {}) {
  const env: Env = {
    NODE_ENV: 'test',
    PORT: 4010,
    LOG_LEVEL: 'silent',
    PUBLIC_ORIGIN: 'https://hd-pay.orangebench.tech',
    APP_ORIGIN: 'https://holaday.ai',
    VULTR_INTERNAL_URL: 'https://holaday.ai/api/internal/payment/confirm',
    INTERNAL_SHARED_SECRET: '0123456789abcdef',
    ALIPAY_APPID: 'alipay-app',
    ALIPAY_MODE: 'production',
    VULTR_SYNC_TIMEOUT_MS: 3_500,
    ...overrides,
  };
  const logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  } as unknown as Logger;
  return new AlipayAdapter(env, logger);
}

const validBody = {
  app_id: 'alipay-app',
  seller_id: 'seller-1',
  out_trade_no: 'pay_1',
  trade_no: 'ali_1',
  trade_status: 'TRADE_SUCCESS',
  total_amount: '29.00',
  passback_params: encodeURIComponent('{"kind":"subscription"}'),
};

describe('AlipayAdapter notifications', () => {
  it('parses a callback bound to the configured app and seller', () => {
    const adapter = makeAdapter({ ALIPAY_SELLER_ID: 'seller-1' });
    expect(adapter.parseNotifyBody(validBody)).toEqual({
      outTradeNo: 'pay_1',
      transactionId: 'ali_1',
      tradeStatus: 'TRADE_SUCCESS',
      amountCents: 2900,
      passback: '{"kind":"subscription"}',
    });
  });

  it('rejects callbacks for another Alipay application', () => {
    const adapter = makeAdapter();
    expect(() => adapter.parseNotifyBody({ ...validBody, app_id: 'other-app' })).toThrow(
      /app_id mismatch/,
    );
  });

  it('rejects callbacks for another seller when seller binding is configured', () => {
    const adapter = makeAdapter({ ALIPAY_SELLER_ID: 'seller-1' });
    expect(() => adapter.parseNotifyBody({ ...validBody, seller_id: 'other-seller' })).toThrow(
      /seller_id mismatch/,
    );
  });

  it('rejects malformed amount text instead of partially parsing it', () => {
    const adapter = makeAdapter();
    expect(() => adapter.parseNotifyBody({ ...validBody, total_amount: '29.00CNY' })).toThrow(
      /invalid transaction payload/,
    );
  });
});
