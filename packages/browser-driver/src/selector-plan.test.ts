import { describe, expect, it } from 'vitest';
import { buildSelectorPlan } from './selector-plan.js';

describe('buildSelectorPlan', () => {
  it('translates a multi-strategy selector into ordered LocatorSpec attempts', () => {
    const plan = buildSelectorPlan({
      description: '继续按钮',
      strategies: [
        { kind: 'role', role: 'button', name: '继续' },
        { kind: 'text', value: '继续', exact: true },
        { kind: 'testid', value: 'continue-btn', attr: 'data-testid' },
        { kind: 'css', value: '.continue-btn' },
      ],
      scope: { timeoutMs: 3_000 },
      selfHeal: true,
    });
    expect(plan.description).toBe('继续按钮');
    expect(plan.timeoutMs).toBe(3_000);
    expect(plan.selfHeal).toBe(true);
    expect(plan.attempts).toEqual([
      { how: 'role', role: 'button', name: '继续', exact: false },
      { how: 'text', value: '继续', exact: true },
      { how: 'testid', value: 'continue-btn', attr: 'data-testid' },
      { how: 'css', value: '.continue-btn' },
    ]);
  });

  it('skips malformed strategies instead of throwing (W1 bug #3 regression)', () => {
    const plan = buildSelectorPlan({
      description: '混合了残缺 strategy',
      strategies: [
        { kind: 'role' } as never, // no role name
        { kind: 'css', value: '' } as never, // empty value
        { kind: 'text', value: '只剩下这个好的' },
      ],
      scope: { timeoutMs: 5_000 },
      selfHeal: true,
    });
    expect(plan.attempts).toEqual([{ how: 'text', value: '只剩下这个好的', exact: false }]);
  });

  it('carries scope.within + nth into the plan', () => {
    const plan = buildSelectorPlan({
      description: '在 iframe 内',
      strategies: [{ kind: 'text', value: '登录' }],
      scope: { within: '.panel', nth: 2, timeoutMs: 5_000 },
      selfHeal: false,
    });
    expect(plan.scopeCss).toBe('.panel');
    expect(plan.nth).toBe(2);
    expect(plan.selfHeal).toBe(false);
  });
});
