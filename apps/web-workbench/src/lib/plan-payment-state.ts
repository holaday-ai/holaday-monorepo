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

function emptyPaymentOptions(): PaymentOptions {
  return { paypal: false, paypalClientId: null, paypalEnv: null };
}

function safeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
