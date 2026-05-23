import { describe, expect, it } from 'vitest';
import { planPaymentCtaState } from './plan-payment-state';

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
