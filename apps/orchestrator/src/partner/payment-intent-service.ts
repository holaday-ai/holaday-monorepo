import { HOLA_CREDIT_CNY_CENTS } from '@holaday/shared-types';

export type PartnerPaymentIntent =
  | {
      provider: 'wechat';
      mode: 'qr';
      codeUrl: string;
      expiresAt: Date;
      instructions: string;
    }
  | {
      provider: 'alipay';
      mode: 'redirect';
      payUrl: string;
      expiresAt: Date;
      instructions: string;
    }
  | {
      provider: 'manual';
      mode: 'manual';
      expiresAt: null;
      instructions: string;
    };

type OnlinePartnerPaymentProvider = 'wechat' | 'alipay';
type PartnerPaymentOrderKind = 'membership' | 'recharge';
type PartnerGatewayPurchaseKind = 'partner_membership' | 'partner_recharge';

export interface PartnerPaymentGatewayCreatePayload {
  provider: OnlinePartnerPaymentProvider;
  userId: string;
  purchase: {
    kind: PartnerGatewayPurchaseKind;
    partnerOrderExternalId: string;
    amountCnyCents: number;
  };
}

const PAYMENT_INTENT_TTL_MS = 30 * 60 * 1000;
const USER_EXTERNAL_ID_MAX_LENGTH = 64;
const ORDER_EXTERNAL_ID_MAX_LENGTH = 32;

function normalizePartnerPaymentProvider(provider: string): PartnerPaymentIntent['provider'] {
  if (provider === 'wechat' || provider === 'alipay') return provider;
  return 'manual';
}

function normalizeOnlinePartnerPaymentProvider(provider: string): OnlinePartnerPaymentProvider {
  if (provider === 'wechat' || provider === 'alipay') return provider;
  throw new RangeError('provider must be wechat or alipay');
}

function normalizePartnerPaymentOrderKind(orderKind: string): PartnerPaymentOrderKind {
  if (orderKind === 'membership' || orderKind === 'recharge') return orderKind;
  throw new RangeError('orderKind must be membership or recharge');
}

function normalizeBoundedString(value: unknown, fieldName: string, maxLength: number): string {
  if (typeof value !== 'string') {
    throw new RangeError(`${fieldName} must be a non-empty string with length <= ${maxLength}`);
  }
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > maxLength) {
    throw new RangeError(`${fieldName} must be a non-empty string with length <= ${maxLength}`);
  }
  return normalized;
}

function normalizeWholeCnyAmount(value: unknown, fieldName: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${fieldName} must be a positive safe integer`);
  }
  if (value % HOLA_CREDIT_CNY_CENTS !== 0) {
    throw new RangeError(`${fieldName} must be a whole CNY amount`);
  }
  return value;
}

function normalizeCreatedAt(value: Date): Date {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new RangeError('createdAt must be a valid Date');
  }
  return new Date(value.getTime());
}

function intentExpiresAt(createdAt: Date): Date {
  return new Date(normalizeCreatedAt(createdAt).getTime() + PAYMENT_INTENT_TTL_MS);
}

function requireGatewayResponseRecord(response: unknown): Record<string, unknown> {
  if (response === null || typeof response !== 'object' || Array.isArray(response)) {
    throw new RangeError('gateway response must be an object');
  }
  return response as Record<string, unknown>;
}

function paymentIntentUrl(input: {
  provider: 'wechat' | 'alipay';
  orderExternalId: string;
  orderKind: string;
  amountCnyCents: number;
}): string {
  const params = new URLSearchParams({
    orderExternalId: input.orderExternalId,
    orderKind: input.orderKind,
    amountCnyCents: String(input.amountCnyCents),
  });
  return `partner-payment://${input.provider}?${params.toString()}`;
}

export function buildPartnerPaymentGatewayCreatePayload(input: {
  provider: OnlinePartnerPaymentProvider;
  userExternalId: string;
  orderExternalId: string;
  orderKind: string;
  amountCnyCents: number;
}): PartnerPaymentGatewayCreatePayload {
  const provider = normalizeOnlinePartnerPaymentProvider(input.provider);
  const orderKind = normalizePartnerPaymentOrderKind(input.orderKind);
  const orderExternalId = normalizeBoundedString(
    input.orderExternalId,
    'orderExternalId',
    ORDER_EXTERNAL_ID_MAX_LENGTH,
  );

  return {
    provider,
    userId: normalizeBoundedString(input.userExternalId, 'userExternalId', USER_EXTERNAL_ID_MAX_LENGTH),
    purchase: {
      kind: orderKind === 'membership' ? 'partner_membership' : 'partner_recharge',
      partnerOrderExternalId: orderExternalId,
      amountCnyCents: normalizeWholeCnyAmount(input.amountCnyCents, 'amountCnyCents'),
    },
  };
}

export function buildPartnerPaymentIntentFromGatewayResponse(input: {
  provider: OnlinePartnerPaymentProvider;
  orderExternalId: string;
  amountCnyCents: number;
  createdAt: Date;
  response: unknown;
}): PartnerPaymentIntent {
  const provider = normalizeOnlinePartnerPaymentProvider(input.provider);
  const orderExternalId = normalizeBoundedString(
    input.orderExternalId,
    'orderExternalId',
    ORDER_EXTERNAL_ID_MAX_LENGTH,
  );
  const amountCnyCents = normalizeWholeCnyAmount(input.amountCnyCents, 'amountCnyCents');
  const response = requireGatewayResponseRecord(input.response);

  if (response.provider !== provider) {
    throw new RangeError('gateway provider mismatch');
  }
  if (response.outTradeNo !== orderExternalId) {
    throw new RangeError('gateway outTradeNo mismatch');
  }
  if (response.amountCents !== amountCnyCents) {
    throw new RangeError('gateway amount mismatch');
  }

  const expiresAt = intentExpiresAt(input.createdAt);
  if (provider === 'wechat') {
    return {
      provider,
      mode: 'qr',
      codeUrl: normalizeBoundedString(response.codeUrl, 'codeUrl', 2048),
      expiresAt,
      instructions: '支付成功后等待渠道回调确认。',
    };
  }

  return {
    provider,
    mode: 'redirect',
    payUrl: normalizeBoundedString(response.payUrl, 'payUrl', 4096),
    expiresAt,
    instructions: '支付成功后等待渠道回调确认。',
  };
}

export function buildPartnerPaymentIntent(input: {
  orderExternalId: string;
  provider: string;
  orderKind: string;
  amountCnyCents: number;
  createdAt: Date;
}): PartnerPaymentIntent {
  const provider = normalizePartnerPaymentProvider(input.provider);
  if (provider === 'manual') {
    return {
      provider,
      mode: 'manual',
      expiresAt: null,
      instructions: '人工确认通道，后台确认后生效。',
    };
  }

  const expiresAt = intentExpiresAt(input.createdAt);
  const intentUrl = paymentIntentUrl({
    provider,
    orderExternalId: input.orderExternalId,
    orderKind: input.orderKind,
    amountCnyCents: input.amountCnyCents,
  });

  return provider === 'wechat'
    ? {
        provider,
        mode: 'qr',
        codeUrl: intentUrl,
        expiresAt,
        instructions: '支付成功后等待渠道回调确认。',
      }
    : {
        provider,
        mode: 'redirect',
        payUrl: intentUrl,
        expiresAt,
        instructions: '支付成功后等待渠道回调确认。',
      };
}
