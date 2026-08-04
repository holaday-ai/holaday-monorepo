export interface PaymentOptions {
  readonly paypal: boolean;
  readonly paypalClientId: string | null;
  readonly paypalEnv: 'sandbox' | 'live' | null;
}

export interface CnPaymentOptions {
  readonly enabled: boolean;
  readonly wechat: boolean;
  readonly alipay: boolean;
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
    paypalEnv: value.paypalEnv === 'sandbox' || value.paypalEnv === 'live' ? value.paypalEnv : null,
  };
}

export function normalizeCnPaymentOptions(value: unknown): CnPaymentOptions {
  if (!isRecord(value)) return emptyCnPaymentOptions();
  const wechat = value.wechat === true;
  const alipay = value.alipay === true;
  return {
    enabled: value.enabled === true && (wechat || alipay),
    wechat,
    alipay,
  };
}

export function planPaymentOptionsLoading(input: PaymentOptionsLoadingInput): boolean {
  if (!input.paymentOptionsLoaded) return true;
  return input.zh && !input.cnPaymentOptionsLoaded;
}

export function planAddonPaymentAvailable(input: {
  readonly zh: boolean;
  readonly cnEnabled: boolean;
  readonly paypalEnabled: boolean;
}): boolean {
  return Boolean(input.paypalEnabled) || (input.zh && Boolean(input.cnEnabled));
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
  const hasEnabledProvider = Boolean(input.paypalEnabled) || (input.zh && Boolean(input.cnEnabled));
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
  readonly wechat: boolean;
  readonly alipay: boolean;
  readonly paypalEnabled: boolean;
}): string {
  const cnProvider =
    input.wechat && input.alipay
      ? { zh: '微信支付和支付宝均', en: 'WeChat Pay and Alipay' }
      : input.wechat
        ? { zh: '微信支付', en: 'WeChat Pay' }
        : input.alipay
          ? { zh: '支付宝', en: 'Alipay' }
          : null;

  if (input.zh) {
    if (cnProvider && !input.paypalEnabled) {
      return `${cnProvider.zh}按页面人民币金额结算，实际金额以结账页为准。`;
    }
    if (cnProvider && input.paypalEnabled) {
      return `选择${cnProvider.zh.replace('均', '')}时按页面人民币金额结算；选择 PayPal 时以美元结算，实际金额以结账页为准。`;
    }
    return input.paypalEnabled
      ? '当前在线支付通过 PayPal 以美元结算；人民币价格仅供对照，实际金额以结账页为准。'
      : '当前在线支付暂不可用，恢复后结账页会显示实际结算金额。';
  }
  if (cnProvider && input.paypalEnabled) {
    return `${cnProvider.en} settle in CNY; PayPal settles in USD. Checkout shows the final amount.`;
  }
  if (cnProvider) {
    return `${cnProvider.en} settle in CNY. Checkout shows the final amount.`;
  }
  return input.paypalEnabled
    ? 'PayPal settles in USD. CNY prices are for reference; checkout shows the final amount.'
    : 'Online payment is currently unavailable.';
}

function emptyPaymentOptions(): PaymentOptions {
  return { paypal: false, paypalClientId: null, paypalEnv: null };
}

function emptyCnPaymentOptions(): CnPaymentOptions {
  return { enabled: false, wechat: false, alipay: false };
}

function safeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
