import { describe, expect, it } from 'vitest';
import {
  normalizeCnPaymentOptions,
  normalizePaymentOptions,
  planPaymentCtaState,
  planPaymentErrorMessage,
  planPaymentOptionsLoading,
} from './plan-payment-state';

describe('normalizePaymentOptions', () => {
  it('keeps PayPal enabled only with a usable client id', () => {
    expect(
      normalizePaymentOptions({
        paypal: true,
        paypalClientId: ' client-id ',
        paypalEnv: 'live',
      }),
    ).toEqual({
      paypal: true,
      paypalClientId: 'client-id',
      paypalEnv: 'live',
    });

    expect(
      normalizePaymentOptions({
        paypal: true,
        paypalClientId: { unsafe: true },
        paypalEnv: 'sandbox',
      }),
    ).toEqual({
      paypal: false,
      paypalClientId: null,
      paypalEnv: 'sandbox',
    });
  });

  it('falls back to unavailable payment options for malformed payloads', () => {
    expect(normalizePaymentOptions(null)).toEqual({
      paypal: false,
      paypalClientId: null,
      paypalEnv: null,
    });
    expect(
      normalizePaymentOptions({
        paypal: 'true',
        paypalClientId: 'client-id',
        paypalEnv: 'production',
      }),
    ).toEqual({
      paypal: false,
      paypalClientId: null,
      paypalEnv: null,
    });
  });
});

describe('planPaymentErrorMessage', () => {
  it('keeps payment errors user-facing without leaking raw gateway text', () => {
    expect(planPaymentErrorMessage('', true)).toBe('支付失败，请重试。');
    expect(planPaymentErrorMessage('paypal timeout waiting for capture', true)).toBe(
      '支付确认超时，刷新页面查看状态。',
    );
    expect(planPaymentErrorMessage('PRECONDITION_FAILED paypal not configured', true)).toBe(
      '支付暂未开放，请联系 support@holaday.ai。',
    );
    expect(planPaymentErrorMessage('INTERNAL_SERVER_ERROR stack=payment_gateway', true)).toBe(
      '支付未完成，请稍后重试；如果已经扣款，请联系 support@holaday.ai。',
    );
  });

  it('returns English payment guidance for non-Chinese locales', () => {
    expect(planPaymentErrorMessage(null, false)).toBe('Payment failed. Please try again.');
    expect(planPaymentErrorMessage('timed out', false)).toBe(
      'Payment confirmation timed out. Refresh to check status.',
    );
    expect(planPaymentErrorMessage('not configured', false)).toBe(
      'Payment is not enabled yet. Contact support@holaday.ai.',
    );
    expect(planPaymentErrorMessage('gateway raw failure', false)).toBe(
      'Payment was not completed. Please try again later, or contact support@holaday.ai if you were charged.',
    );
  });
});

describe('normalizeCnPaymentOptions', () => {
  it('enables local payment only when explicitly true', () => {
    expect(normalizeCnPaymentOptions({ enabled: true })).toEqual({ enabled: true });
    expect(normalizeCnPaymentOptions({ enabled: 'true' })).toEqual({ enabled: false });
    expect(normalizeCnPaymentOptions(null)).toEqual({ enabled: false });
  });
});

describe('planPaymentCtaState', () => {
  it('disables the upgrade CTA while payment options load', () => {
    expect(planPaymentCtaState({ loading: true, zh: true })).toEqual({
      disabled: true,
      label: '加载支付方式…',
      unavailableMessage: null,
    });
  });

  it('surfaces a contact CTA when no provider is available', () => {
    expect(
      planPaymentCtaState({
        loading: false,
        zh: false,
        cnEnabled: true,
        paypalEnabled: false,
      }),
    ).toEqual({
      disabled: false,
      label: 'Contact us',
      unavailableMessage: 'Payment not yet enabled, contact support@holaday.ai',
    });
  });

  it('allows upgrade when any locale-appropriate provider is available', () => {
    expect(
      planPaymentCtaState({
        loading: false,
        zh: true,
        cnEnabled: true,
        paypalEnabled: false,
      }),
    ).toMatchObject({ disabled: false, label: '升级', unavailableMessage: null });
    expect(
      planPaymentCtaState({
        loading: false,
        zh: false,
        cnEnabled: false,
        paypalEnabled: true,
      }),
    ).toMatchObject({ disabled: false, label: 'Upgrade', unavailableMessage: null });
  });
});

describe('planPaymentOptionsLoading', () => {
  it('waits for PayPal options for every locale', () => {
    expect(
      planPaymentOptionsLoading({
        zh: false,
        paymentOptionsLoaded: false,
        cnPaymentOptionsLoaded: true,
      }),
    ).toBe(true);
    expect(
      planPaymentOptionsLoading({
        zh: true,
        paymentOptionsLoaded: false,
        cnPaymentOptionsLoaded: true,
      }),
    ).toBe(true);
  });

  it('waits for local payment options only for Chinese locales', () => {
    expect(
      planPaymentOptionsLoading({
        zh: true,
        paymentOptionsLoaded: true,
        cnPaymentOptionsLoaded: false,
      }),
    ).toBe(true);
    expect(
      planPaymentOptionsLoading({
        zh: false,
        paymentOptionsLoaded: true,
        cnPaymentOptionsLoaded: false,
      }),
    ).toBe(false);
  });

  it('finishes loading once the required payment options are known', () => {
    expect(
      planPaymentOptionsLoading({
        zh: true,
        paymentOptionsLoaded: true,
        cnPaymentOptionsLoaded: true,
      }),
    ).toBe(false);
  });
});
