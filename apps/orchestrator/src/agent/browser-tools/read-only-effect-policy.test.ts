import { describe, expect, it } from 'vitest';
import { refRole } from './effect-pause-copy.js';
import { type EffectAction, readOnlyEffectMayPass } from './read-only-effect-policy.js';

/**
 * FIX-61B P1-4 (Deploy-61 online b-m01 / new-bestbuy): a read-only task's 「后台请求」 pause after an
 * ordinary step passes; anything that may change something still asks.
 */
const BACKGROUND = [{ branch: 'unknown_post' }];
const pass = (
  action: EffectAction | null,
  triggers: ReadonlyArray<{ branch: string }> = BACKGROUND,
  readOnly = true,
  reason = 'unexpected_effect',
) => readOnlyEffectMayPass({ readOnly, reason, action, triggers });

describe('FIX-61B P1-4: read-only background-request pauses', () => {
  it.each<[string, EffectAction]>([
    ['高德: a nameless control clicked (b-m01)', { tool: 'click', label: null, role: 'generic' }],
    ['opening a page', { tool: 'navigate' }],
    ['a plain link', { tool: 'click', label: '公交', role: 'link' }],
    ['closing a popup', { tool: 'click', label: '关闭', role: 'button' }],
    ['「我知道了」', { tool: 'click', label: '我知道了', role: 'button' }],
    [
      'BestBuy: typing a search word, no Enter (new-bestbuy)',
      { tool: 'type', label: 'Search Best Buy', role: 'combobox', submit: false },
    ],
  ])('passes: %s', (_, action) => {
    expect(pass(action)).toBe(true);
  });

  it.each<[string, EffectAction]>([
    ['购买', { tool: 'click', label: '立即购买', role: 'button' }],
    ['add to cart', { tool: 'click', label: 'Add to Cart', role: 'button' }],
    ['订票', { tool: 'click', label: '在线购票', role: 'link' }],
    ['预约', { tool: 'click', label: '确认预约', role: 'button' }],
    ['book', { tool: 'click', label: 'Book now', role: 'button' }],
    ['submit', { tool: 'click', label: 'Submit order', role: 'button' }],
    ['log in', { tool: 'click', label: '登录', role: 'button' }],
    ['send', { tool: 'click', label: '发送', role: 'button' }],
    ['follow', { tool: 'click', label: '关注', role: 'button' }],
    ['a checkbox', { tool: 'click', label: '同意条款', role: 'checkbox' }],
    ['typing then Enter', { tool: 'type', label: 'Search', submit: true }],
    ['a password', { tool: 'type', label: '密码', role: 'textbox' }],
    ['a phone number', { tool: 'type', label: '手机号', role: 'textbox' }],
    ['choosing an option', { tool: 'select', label: '尺寸' }],
  ])('still asks: %s', (_, action) => {
    expect(pass(action)).toBe(false);
  });

  it.each([
    'form_submit',
    'mutation_method',
    'transaction_request',
    'transaction_navigation',
    'transaction_popup',
    'new_transaction_receipt',
    'intercepted_submit',
  ])('still asks when the request is %s (even after a plain link)', (branch) => {
    expect(pass({ tool: 'click', label: '公交', role: 'link' }, [{ branch }])).toBe(false);
    expect(
      pass({ tool: 'click', label: '公交', role: 'link' }, [
        { branch: 'unknown_post' },
        { branch },
      ]),
    ).toBe(false);
  });

  it('still asks in a task that is not read-only, with no action or no trigger, or another reason', () => {
    expect(pass({ tool: 'navigate' }, BACKGROUND, false)).toBe(false);
    expect(pass(null)).toBe(false);
    expect(pass({ tool: 'navigate' }, [])).toBe(false);
    expect(pass({ tool: 'navigate' }, BACKGROUND, true, 'captcha')).toBe(false);
  });

  it('reads a control role from the snapshot', () => {
    const snapshot = '- main [ref=e1]:\n  - link "公交" [ref=e5]\n  - generic [ref=e6]:';
    expect(refRole(snapshot, 'e5')).toBe('link');
    expect(refRole(snapshot, 'e6')).toBe('generic');
    expect(refRole(snapshot, 'e9')).toBeNull();
  });
});
