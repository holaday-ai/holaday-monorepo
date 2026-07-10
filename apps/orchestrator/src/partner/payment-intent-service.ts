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

const PAYMENT_INTENT_TTL_MS = 30 * 60 * 1000;

function normalizePartnerPaymentProvider(provider: string): PartnerPaymentIntent['provider'] {
  if (provider === 'wechat' || provider === 'alipay') return provider;
  return 'manual';
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

  const expiresAt = new Date(input.createdAt.getTime() + PAYMENT_INTENT_TTL_MS);
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
