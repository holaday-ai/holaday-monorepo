interface PaymentStateInput {
  loading: boolean;
  zh: boolean;
  cnEnabled?: boolean | null;
  paypalEnabled?: boolean | null;
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
