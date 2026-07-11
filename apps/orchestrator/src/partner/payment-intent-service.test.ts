import { describe, expect, it } from 'vitest';
import {
  buildPartnerPaymentGatewayCreatePayload,
  buildPartnerPaymentIntentFromGatewayResponse,
} from './payment-intent-service.js';

describe('partner payment gateway contract', () => {
  it('builds a cn-payment create payload for partner membership orders', () => {
    expect(
      buildPartnerPaymentGatewayCreatePayload({
        provider: 'wechat',
        userExternalId: 'usr_partner',
        orderExternalId: 'pay_partner_membership',
        orderKind: 'membership',
        amountCnyCents: 999_00,
      }),
    ).toEqual({
      provider: 'wechat',
      userId: 'usr_partner',
      purchase: {
        kind: 'partner_membership',
        partnerOrderExternalId: 'pay_partner_membership',
        amountCnyCents: 999_00,
      },
    });
  });

  it('builds a cn-payment create payload for partner recharge orders', () => {
    expect(
      buildPartnerPaymentGatewayCreatePayload({
        provider: 'alipay',
        userExternalId: 'usr_partner',
        orderExternalId: 'pay_partner_recharge',
        orderKind: 'recharge',
        amountCnyCents: 10_000_00,
      }),
    ).toEqual({
      provider: 'alipay',
      userId: 'usr_partner',
      purchase: {
        kind: 'partner_recharge',
        partnerOrderExternalId: 'pay_partner_recharge',
        amountCnyCents: 10_000_00,
      },
    });
  });

  it('normalizes a verified WeChat gateway response into a QR intent', () => {
    expect(
      buildPartnerPaymentIntentFromGatewayResponse({
        provider: 'wechat',
        orderExternalId: 'pay_partner_recharge',
        amountCnyCents: 10_000_00,
        createdAt: new Date('2026-07-10T10:00:00.000Z'),
        response: {
          provider: 'wechat',
          outTradeNo: 'pay_partner_recharge',
          codeUrl: 'weixin://wxpay/bizpayurl?pr=abc',
          amountCents: 10_000_00,
          description: 'HOLA DAY 合伙人充值',
        },
      }),
    ).toEqual({
      provider: 'wechat',
      mode: 'qr',
      codeUrl: 'weixin://wxpay/bizpayurl?pr=abc',
      expiresAt: new Date('2026-07-10T10:30:00.000Z'),
      instructions: '支付成功后等待渠道回调确认。',
    });
  });

  it('normalizes a verified Alipay gateway response into a redirect intent', () => {
    expect(
      buildPartnerPaymentIntentFromGatewayResponse({
        provider: 'alipay',
        orderExternalId: 'pay_partner_recharge',
        amountCnyCents: 10_000_00,
        createdAt: new Date('2026-07-10T10:00:00.000Z'),
        response: {
          provider: 'alipay',
          outTradeNo: 'pay_partner_recharge',
          payUrl: 'https://openapi.alipay.com/gateway.do?biz_content=abc',
          amountCents: 10_000_00,
          description: 'HOLA DAY 合伙人充值',
        },
      }),
    ).toEqual({
      provider: 'alipay',
      mode: 'redirect',
      payUrl: 'https://openapi.alipay.com/gateway.do?biz_content=abc',
      expiresAt: new Date('2026-07-10T10:30:00.000Z'),
      instructions: '支付成功后等待渠道回调确认。',
    });
  });

  it('rejects mismatched gateway responses before exposing payment instructions', () => {
    expect(() =>
      buildPartnerPaymentIntentFromGatewayResponse({
        provider: 'wechat',
        orderExternalId: 'pay_partner_recharge',
        amountCnyCents: 10_000_00,
        createdAt: new Date('2026-07-10T10:00:00.000Z'),
        response: {
          provider: 'wechat',
          outTradeNo: 'pay_other_order',
          codeUrl: 'weixin://wxpay/bizpayurl?pr=abc',
          amountCents: 10_000_00,
        },
      }),
    ).toThrow(RangeError);
  });
});
