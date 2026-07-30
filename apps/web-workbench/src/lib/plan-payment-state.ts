export interface PaymentOptions {
  readonly paypal: boolean;
  readonly paypalClientId: string | null;
  readonly paypalEnv: 'sandbox' | 'live' | null;
}

export interface CnPaymentOptions {
  readonly enabled: boolean;
}

interface PaymentStateInput {
  loading: boolean;
  zh: boolean;
  cnEnabled?: boolean | null;
  paypalEnabled?: boolean | null;
}

interface PaymentOptionsLoadingInput {
  zh: boolean;
  paymentOptionsLoaded: boolean;
  cnPaymentOptionsLoaded: boolean;
}

export interface PlanFirstMonthOfferCopy {
  readonly priceMain: string;
  readonly priceUnit: string;
  readonly hint: string;
}

export function normalizePaymentOptions(value: unknown): PaymentOptions {
  if (!isRecord(value)) return emptyPaymentOptions();
  const paypalClientId = safeText(value.paypalClientId);
  const paypalEnabled = value.paypal === true && paypalClientId.length > 0;
  return {
    paypal: paypalEnabled,
    paypalClientId: paypalEnabled ? paypalClientId : null,
    paypalEnv:
      value.paypalEnv === 'sandbox' || value.paypalEnv === 'live'
        ? value.paypalEnv
        : null,
  };
}

export function normalizeCnPaymentOptions(value: unknown): CnPaymentOptions {
  return {
    enabled: isRecord(value) && value.enabled === true,
  };
}

export function planPaymentOptionsLoading(input: PaymentOptionsLoadingInput): boolean {
  if (!input.paymentOptionsLoaded) return true;
  return input.zh && !input.cnPaymentOptionsLoaded;
}

export function planPaymentCtaState(input: PaymentStateInput): {
  disabled: boolean;
  label: string;
  unavailableMessage: string | null;
} {
  if (input.loading) {
    return {
      disabled: true,
      label: input.zh ? '加载支付方式…' : 'Loading payment options…',
      unavailableMessage: null,
    };
  }
  const hasEnabledProvider =
    Boolean(input.paypalEnabled) || (input.zh && Boolean(input.cnEnabled));
  if (!hasEnabledProvider) {
    return {
      disabled: false,
      label: input.zh ? '联系开通' : 'Contact us',
      unavailableMessage: input.zh
        ? '支付暂未开放，联系 support@holaday.ai'
        : 'Payment not yet enabled, contact support@holaday.ai',
    };
  }
  return {
    disabled: false,
    label: input.zh ? '升级' : 'Upgrade',
    unavailableMessage: null,
  };
}

export function planPaymentErrorMessage(rawMsg: string | null | undefined, zh: boolean): string {
  const message = typeof rawMsg === 'string' ? rawMsg.trim() : '';
  if (!message) return zh ? '支付失败，请重试。' : 'Payment failed. Please try again.';
  if (/timeout|timed out/i.test(message)) {
    return zh
      ? '支付确认超时，刷新页面查看状态。'
      : 'Payment confirmation timed out. Refresh to check status.';
  }
  if (/PRECONDITION/i.test(message) || /not configured/i.test(message)) {
    return zh
      ? '支付暂未开放，请联系 support@holaday.ai。'
      : 'Payment is not enabled yet. Contact support@holaday.ai.';
  }
  return zh
    ? '支付未完成，请稍后重试；如果已经扣款，请联系 support@holaday.ai。'
    : 'Payment was not completed. Please try again later, or contact support@holaday.ai if you were charged.';
}

export function planFirstMonthOfferCopy(input: {
  readonly zh: boolean;
  readonly regularPrice: string;
  readonly promoPrice: string;
}): PlanFirstMonthOfferCopy {
  return input.zh
    ? {
        priceMain: input.regularPrice,
        priceUnit: '/ 月',
        hint: `符合新付费用户优惠条件时，首月 ${input.promoPrice}；实际金额以结账页为准`,
      }
    : {
        priceMain: input.regularPrice,
        priceUnit: '/ month',
        hint: `Eligible new paid users get the first month for ${input.promoPrice}; checkout shows the final amount`,
      };
}

export function planSettlementNotice(input: {
  readonly zh: boolean;
  readonly cnEnabled: boolean;
}): string {
  if (input.zh) {
    return input.cnEnabled
      ? '选择微信或支付宝时按页面人民币金额结算；选择 PayPal 时以美元结算，实际金额以结账页为准。'
      : '当前在线支付通过 PayPal 以美元结算；人民币价格仅供对照，实际金额以结账页为准。';
  }
  return input.cnEnabled
    ? 'WeChat Pay and Alipay settle in CNY; PayPal settles in USD. Checkout shows the final amount.'
    : 'PayPal settles in USD. CNY prices are for reference; checkout shows the final amount.';
}

function emptyPaymentOptions(): PaymentOptions {
  return { paypal: false, paypalClientId: null, paypalEnv: null };
}

function safeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
