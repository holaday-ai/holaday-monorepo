import { describe, expect, it } from 'vitest';
import { buildBaiduSmokePlan } from './smoke-plans.js';

describe('buildBaiduSmokePlan', () => {
  it('emits the 7 expected steps in order', () => {
    const plan = buildBaiduSmokePlan();
    expect(plan.map((s) => s.kind)).toEqual([
      'goto',
      'wait',
      'type',
      'click',
      'wait',
      'extract',
      'screenshot',
    ]);
  });

  it('assigns unique external ids to every step', () => {
    const plan = buildBaiduSmokePlan();
    const ids = plan.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      expect(id).toMatch(/^stp_/);
    }
  });

  it('step 0 goto points at www.baidu.com', () => {
    const plan = buildBaiduSmokePlan();
    expect(plan[0]?.payload).toEqual({ url: 'https://www.baidu.com' });
  });

  it('step 2 type carries the search keyword', () => {
    const plan = buildBaiduSmokePlan();
    expect(plan[2]?.kind).toBe('type');
    expect(plan[2]?.payload).toEqual({ text: '半导体' });
  });

  it('search-input selector lists #kw first, then stable fallbacks', () => {
    const plan = buildBaiduSmokePlan();
    const wait = plan[1];
    expect(wait?.selector?.strategies[0]).toEqual({ kind: 'css', value: '#kw' });
    expect(wait?.selector?.strategies.length).toBeGreaterThanOrEqual(3);
  });

  it('search-button selector lists #su first', () => {
    const plan = buildBaiduSmokePlan();
    const click = plan[3];
    expect(click?.kind).toBe('click');
    expect(click?.selector?.strategies[0]).toEqual({ kind: 'css', value: '#su' });
  });

  it('all selector-bearing steps disable self-heal (fixed-plan diagnostic)', () => {
    const plan = buildBaiduSmokePlan();
    for (const step of plan) {
      if (step.selector) {
        expect(step.selector.selfHeal).toBe(false);
      }
    }
  });

  it('all steps are risk=low (no confirm friction on smoke run)', () => {
    const plan = buildBaiduSmokePlan();
    for (const step of plan) expect(step.risk).toBe('low');
  });
});
