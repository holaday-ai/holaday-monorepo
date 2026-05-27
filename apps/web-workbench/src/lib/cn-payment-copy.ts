export type CnPaymentProvider = 'wechat' | 'alipay';

export function cnPaymentProviderLabel(provider: CnPaymentProvider): string {
  return provider === 'wechat' ? '微信支付' : '支付宝';
}

export function cnPaymentProviderMark(provider: CnPaymentProvider): string {
  return provider === 'wechat' ? '微' : '支';
}

export function formatCnyFromCents(amountCents: number | null): string | null {
  if (amountCents === null) return null;
  if (!Number.isFinite(amountCents)) return null;
  return `¥${(Math.max(0, amountCents) / 100).toFixed(2)}`;
}

export function compactOutTradeNo(outTradeNo: string | null): string | null {
  const text = outTradeNo?.trim();
  if (!text) return null;
  if (text.length <= 12) return text;
  return `${text.slice(0, 4)}…${text.slice(-6)}`;
}
