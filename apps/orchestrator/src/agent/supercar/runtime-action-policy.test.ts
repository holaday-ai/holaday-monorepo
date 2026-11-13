import { describe, expect, it } from 'vitest';

import { classifyRuntimeAction, isAffirmativeActionConfirmation } from './runtime-action-policy.js';

describe('classifyRuntimeAction', () => {
  it('allows ordinary browsing and search controls', () => {
    expect(classifyRuntimeAction({ kind: 'click', label: '搜索' })).toEqual({
      allowed: true,
    });
    expect(
      classifyRuntimeAction({ kind: 'navigate', url: 'https://example.com/products' }),
    ).toEqual({ allowed: true });
  });

  it.each(['确认付款', '提交订单', '永久删除', '发送消息', '公开分享'])(
    'requires a fresh confirmation before clicking %s',
    (label) => {
      const verdict = classifyRuntimeAction({ kind: 'click', label });
      expect(verdict.allowed).toBe(false);
      expect(verdict.requiresConfirmation).toBe(true);
      expect(verdict.question).toContain(label);
    },
  );

  it('requires confirmation for a neutral submit button on a checkout page', () => {
    const verdict = classifyRuntimeAction({
      kind: 'click',
      label: '继续',
      tagName: 'button',
      pageUrl: 'https://shop.example.com/checkout',
    });

    expect(verdict.allowed).toBe(false);
    expect(verdict.requiresConfirmation).toBe(true);
  });

  it('requires confirmation for a neutral submit button when transaction fields identify the page', () => {
    const verdict = classifyRuntimeAction({
      kind: 'click',
      label: '继续',
      tagName: 'button',
      pageUrl: 'https://shop.example.com/step/3',
      pageTitle: '确认订单',
      pageTxSignal: '收货地址 支付方式 银行卡号',
    });

    expect(verdict.allowed).toBe(false);
    expect(verdict.requiresConfirmation).toBe(true);
  });

  it('never lets the agent type into a password field', () => {
    const verdict = classifyRuntimeAction({
      kind: 'type',
      inputType: 'password',
      placeholder: '密码',
    });

    expect(verdict.allowed).toBe(false);
    expect(verdict.requiresConfirmation).not.toBe(true);
    expect(verdict.requiresTakeover).toBe(true);
    expect(verdict.awaitingKind).toBe('login');
    expect(verdict.reason).toContain('这一步需要你来');
    expect(verdict.reason).not.toContain('接管');
  });
});

describe('isAffirmativeActionConfirmation', () => {
  it.each(['确认执行', '同意', '批准下单', '继续支付', 'yes', 'confirm'])(
    'accepts an explicit confirmation: %s',
    (message) => expect(isAffirmativeActionConfirmation(message)).toBe(true),
  );

  it.each(['看看', '考虑一下', '不要执行', '取消', '先等等'])(
    'does not treat an ambiguous or negative reply as confirmation: %s',
    (message) => expect(isAffirmativeActionConfirmation(message)).toBe(false),
  );
});

describe('FIX-62 P1-7: a link named by its whole search card is judged by its title', () => {
  const card =
    'Weather https://www.nea.gov.sg/corporate-functions/weather  Government officials will NEVER ask you to transfer money or disclose bank log-in details over a phone call · Visit ScamShield or call the 24/7 ScamShield Helpline';
  it('core-02: the NEA weather link is clicked without asking', () => {
    expect(
      classifyRuntimeAction({
        kind: 'click',
        label: card,
        tagName: 'a',
        href: 'https://www.nea.gov.sg/corporate-functions/weather',
      }).allowed,
    ).toBe(true);
  });
  it('a link whose title itself is an act still asks', () => {
    expect(
      classifyRuntimeAction({
        kind: 'click',
        label: 'Transfer money  to another account now',
        tagName: 'a',
        href: 'https://bank.example/transfer',
      }).requiresConfirmation,
    ).toBe(true);
  });
  it('a button with the same text still asks (only links to web pages are judged by title)', () => {
    expect(
      classifyRuntimeAction({ kind: 'click', label: card, tagName: 'button' }).requiresConfirmation,
    ).toBe(true);
  });
});
