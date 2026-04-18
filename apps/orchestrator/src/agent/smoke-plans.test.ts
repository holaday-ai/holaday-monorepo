import { describe, expect, it } from 'vitest';
import { buildBaiduSmokePlan } from './smoke-plans.js';

describe('buildBaiduSmokePlan', () => {
  it('emits the 7 expected steps in order (key-Enter submit, no click)', () => {
    const plan = buildBaiduSmokePlan();
    expect(plan.map((s) => s.kind)).toEqual([
      'goto',
      'wait',
      'type',
      'key',
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

  it('step 3 submits via Enter key on the search input (bypasses brittle button DOM)', () => {
    const plan = buildBaiduSmokePlan();
    const submit = plan[3];
    expect(submit?.kind).toBe('key');
    expect(submit?.payload).toEqual({ key: 'Enter' });
    // Same selector as step 2 (type) so focus is on the same input.
    expect(submit?.selector?.strategies[0]).toEqual({ kind: 'css', value: '#kw' });
  });

  it('results-wait selector covers .c-container (universal) + .result/.result-op (legacy)', () => {
    const plan = buildBaiduSmokePlan();
    const wait = plan[4];
    expect(wait?.kind).toBe('wait');
    const values = (wait?.selector?.strategies ?? []).map((x) => x.value);
    expect(values).toContain('#content_left .c-container');
    expect(values).toContain('#content_left .result');
    expect(values).toContain('#content_left .result-op');
  });

  it('extract targets h3 a first (skips trailer text), falls back to plain h3 + .c-title', () => {
    const plan = buildBaiduSmokePlan();
    const extract = plan[5];
    expect(extract?.kind).toBe('extract');
    const values = (extract?.selector?.strategies ?? []).map((x) => x.value);
    expect(values[0]).toBe('#content_left h3 a');
    expect(values).toContain('#content_left h3');
    expect(values).toContain('#content_left .c-title');
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
