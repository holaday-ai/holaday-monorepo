import { describe, expect, it } from 'vitest';
import { quotaExhaustedCopy } from './quota-exhausted-copy.js';

describe('quota exhausted copy', () => {
  it('routes free users to a plan upgrade only', () => {
    const copy = quotaExhaustedCopy('free');
    expect(copy.headline).toBe('今日额度已用完');
    expect(copy.badge).toBe('体验版');
    expect(copy.actions).toEqual([
      {
        kind: 'upgrade',
        label: '升级基础版',
        path: '/plan',
        primary: true,
      },
    ]);
  });

  it('offers basic users both top-up and pro upgrade paths', () => {
    const copy = quotaExhaustedCopy('basic');
    expect(copy.headline).toBe('本月额度已用完');
    expect(copy.badge).toBe('基础版');
    expect(copy.actions.map((action) => action.path)).toEqual([
      '/plan#addons',
      '/plan',
    ]);
  });

  it('keeps pro users focused on top-ups', () => {
    const copy = quotaExhaustedCopy('pro');
    expect(copy.badge).toBe('专业版');
    expect(copy.actions).toEqual([
      {
        kind: 'addon',
        label: '购买加量包',
        path: '/plan#addons',
        primary: true,
      },
    ]);
  });
});
