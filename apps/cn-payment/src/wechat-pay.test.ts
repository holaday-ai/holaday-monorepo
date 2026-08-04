import { createSign, generateKeyPairSync } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Logger } from 'pino';
import { describe, expect, it, vi } from 'vitest';
import type { Env } from './config/env.js';
import { WechatPayAdapter, verifyWechatPaySignature } from './wechat-pay.js';

vi.mock('wechatpay-node-v3', () => ({
  default: class MockWxPay {},
}));

const env: Env = {
  NODE_ENV: 'test',
  PORT: 4010,
  LOG_LEVEL: 'silent',
  PUBLIC_ORIGIN: 'https://hd-pay.orangebench.tech',
  APP_ORIGIN: 'https://holaday.ai',
  VULTR_INTERNAL_URL: 'https://holaday.ai/api/internal/payment/confirm',
  INTERNAL_SHARED_SECRET: '0123456789abcdef',
  WX_APPID: 'wx-app',
  WX_MCHID: 'merchant-1',
  WX_API_V3_KEY: '0123456789abcdef0123456789abcdef',
  ALIPAY_MODE: 'production',
  VULTR_SYNC_TIMEOUT_MS: 3_500,
};

const logger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
} as unknown as Logger;

function adapterWithDecryptedPayload(payload: Record<string, unknown>) {
  const adapter = new WechatPayAdapter(env, logger);
  const verifySign = vi.fn(async () => true);
  const decipherGcm = vi.fn(() => payload);
  (adapter as unknown as { wx: unknown }).wx = {
    verifySign,
    decipher_gcm: decipherGcm,
  };
  return { adapter, decipherGcm, verifySign };
}

const headers = {
  'wechatpay-signature': 'signature',
  'wechatpay-timestamp': '1720000000',
  'wechatpay-nonce': 'nonce',
  'wechatpay-serial': 'platform-serial',
};

const rawBody = JSON.stringify({
  resource: {
    ciphertext: 'ciphertext',
    associated_data: 'transaction',
    nonce: 'resource-nonce',
  },
});

describe('WechatPayAdapter notifications', () => {
  it('fails closed when order credentials exist but no callback verification key is available', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'holaday-wechat-'));
    try {
      const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
      const certPath = join(dir, 'merchant-public.pem');
      const keyPath = join(dir, 'merchant-private.pem');
      await writeFile(certPath, publicKey.export({ type: 'spki', format: 'pem' }));
      await writeFile(keyPath, privateKey.export({ type: 'pkcs8', format: 'pem' }));

      const adapter = new WechatPayAdapter(
        { ...env, WX_CERT_PATH: certPath, WX_KEY_PATH: keyPath },
        logger,
      );
      await adapter.init();

      expect(adapter.isReady()).toBe(false);
      expect(adapter.callbackVerificationMode()).toBe('unavailable');
      expect(adapter.why()).toMatch(/callback verification key/i);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('reports ready only when an explicit WeChat callback public key is loaded', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'holaday-wechat-'));
    try {
      const merchant = generateKeyPairSync('rsa', { modulusLength: 2048 });
      const callback = generateKeyPairSync('rsa', { modulusLength: 2048 });
      const certPath = join(dir, 'merchant-public.pem');
      const keyPath = join(dir, 'merchant-private.pem');
      const callbackPath = join(dir, 'wechat-callback-public.pem');
      await Promise.all([
        writeFile(certPath, merchant.publicKey.export({ type: 'spki', format: 'pem' })),
        writeFile(keyPath, merchant.privateKey.export({ type: 'pkcs8', format: 'pem' })),
        writeFile(callbackPath, callback.publicKey.export({ type: 'spki', format: 'pem' })),
      ]);

      const adapter = new WechatPayAdapter(
        {
          ...env,
          WX_CERT_PATH: certPath,
          WX_KEY_PATH: keyPath,
          WX_PUBLIC_KEY_ID: 'PUB_KEY_ID_01111111111111111111111111111111',
          WX_PUBLIC_KEY_PATH: callbackPath,
        },
        logger,
      );
      await adapter.init();

      expect(adapter.isReady()).toBe(true);
      expect(adapter.callbackVerificationMode()).toBe('public_key');
      expect(adapter.why()).toBeNull();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('verifies a callback signed with a configured WeChat public key', () => {
    const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const timestamp = '1720000000';
    const nonce = 'nonce';
    const body = '{"event_type":"TRANSACTION.SUCCESS"}';
    const signer = createSign('RSA-SHA256');
    signer.update(`${timestamp}\n${nonce}\n${body}\n`);
    const signature = signer.sign(privateKey, 'base64');

    expect(
      verifyWechatPaySignature(
        publicKey.export({ type: 'spki', format: 'pem' }),
        timestamp,
        nonce,
        body,
        signature,
      ),
    ).toBe(true);
    expect(
      verifyWechatPaySignature(
        publicKey.export({ type: 'spki', format: 'pem' }),
        timestamp,
        nonce,
        `${body}tampered`,
        signature,
      ),
    ).toBe(false);
  });

  it('accepts the object returned by wechatpay-node-v3 decipher_gcm', async () => {
    const { adapter } = adapterWithDecryptedPayload({
      appid: 'wx-app',
      mchid: 'merchant-1',
      out_trade_no: 'pay_1',
      transaction_id: 'wx_1',
      trade_state: 'SUCCESS',
      amount: { total: 2900, currency: 'CNY' },
      attach: '{"kind":"subscription"}',
    });

    await expect(adapter.verifyAndDecryptNotify(headers, rawBody)).resolves.toEqual({
      outTradeNo: 'pay_1',
      transactionId: 'wx_1',
      tradeState: 'SUCCESS',
      amountCents: 2900,
      attach: '{"kind":"subscription"}',
    });
  });

  it.each([
    [
      'appid',
      { appid: 'other-app', mchid: 'merchant-1', amount: { total: 2900, currency: 'CNY' } },
    ],
    [
      'mchid',
      { appid: 'wx-app', mchid: 'other-merchant', amount: { total: 2900, currency: 'CNY' } },
    ],
    [
      'currency',
      { appid: 'wx-app', mchid: 'merchant-1', amount: { total: 2900, currency: 'USD' } },
    ],
  ])('rejects a verified callback with a mismatched %s', async (_field, overrides) => {
    const { adapter } = adapterWithDecryptedPayload({
      out_trade_no: 'pay_1',
      transaction_id: 'wx_1',
      trade_state: 'SUCCESS',
      attach: '{}',
      ...overrides,
    });

    await expect(adapter.verifyAndDecryptNotify(headers, rawBody)).rejects.toThrow(
      /callback does not match configured merchant/,
    );
  });
});
