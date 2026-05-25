import { describe, expect, it } from 'vitest';
import {
  normalizeCnPaymentOptions,
  normalizePaymentOptions,
  planPaymentCtaState,
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
