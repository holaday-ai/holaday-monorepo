import { describe, expect, it, vi } from 'vitest';
import {
  buildLayerCPrompt,
  makeLayerCVeto,
  parseLayerCVerdict,
} from './explorer-layer-c.js';

const input = {
  kind: 'click',
  label: '继续',
  tagName: 'button',
  pageTitle: 'Flight booking — trip',
  pageTxFields: '出行人,证件,价格明细',
};

describe('parseLayerCVerdict — strict + fail-closed', () => {
  it('ALLOW prefix → allow', () => {
    expect(parseLayerCVerdict('ALLOW 只是查看详情').block).toBe(false);
    expect(parseLayerCVerdict('allow, browsing only').block).toBe(false);
  });
  it('BLOCK prefix → block', () => {
    expect(parseLayerCVerdict('BLOCK 推进交易').block).toBe(true);
  });
  it('🔒 ambiguous / empty / non-prefix → fail-closed BLOCK', () => {
    expect(parseLayerCVerdict('我觉得应该 ALLOW').block).toBe(true); // ALLOW not at head → block
    expect(parseLayerCVerdict('').block).toBe(true);
    expect(parseLayerCVerdict('hmm not sure').block).toBe(true);
    expect(parseLayerCVerdict('  \n  ').block).toBe(true);
  });
});

describe('buildLayerCPrompt — redaction contract', () => {
  it('contains the fixed question + ONLY the structural fields (no cookies/values)', () => {
    const p = buildLayerCPrompt(input);
    expect(p).toMatch(/推进交易.*提交订单.*确认支付/);
    expect(p).toContain('BLOCK');
    expect(p).toContain('ALLOW');
    expect(p).toContain('继续'); // control label
    expect(p).toContain('button'); // tag
    expect(p).toContain('出行人,证件,价格明细'); // page tx-field NAMES (not values)
    // never leaks cookie/value-ish keys (we never put them in):
    expect(p.toLowerCase()).not.toContain('cookie');
    expect(p.toLowerCase()).not.toContain('storagestate');
  });
});

describe('makeLayerCVeto — model verdict + fail-closed + quota', () => {
  it('mock ALLOW → block=false (allowed)', async () => {
    const lc = makeLayerCVeto({ callModel: async () => 'ALLOW 只是浏览', maxCalls: 15 });
    expect((await lc.veto(input)).block).toBe(false);
    expect(lc.callsUsed()).toBe(1);
  });
  it('mock BLOCK → block=true (vetoed)', async () => {
    const lc = makeLayerCVeto({ callModel: async () => 'BLOCK 推进预订', maxCalls: 15 });
    expect((await lc.veto(input)).block).toBe(true);
  });
  it('🔒 model THROWS → fail-closed BLOCK', async () => {
    const lc = makeLayerCVeto({
      callModel: async () => {
        throw new Error('api down');
      },
      maxCalls: 15,
    });
    const r = await lc.veto(input);
    expect(r.block).toBe(true);
    expect(r.reason).toMatch(/失败|超时|fail-closed/);
  });
  it('🔒 model TIMEOUT → fail-closed BLOCK', async () => {
    vi.useFakeTimers();
    const lc = makeLayerCVeto({
      callModel: () => new Promise<string>(() => {}), // never resolves
      maxCalls: 15,
      timeoutMs: 50,
    });
    const p = lc.veto(input);
    await vi.advanceTimersByTimeAsync(60);
    const r = await p;
    expect(r.block).toBe(true);
    vi.useRealTimers();
  });
  it('🔒 illegal reply ("maybe") → fail-closed BLOCK', async () => {
    const lc = makeLayerCVeto({ callModel: async () => 'maybe?', maxCalls: 15 });
    expect((await lc.veto(input)).block).toBe(true);
  });
  it('🔒 QUOTA: the (maxCalls+1)-th does NOT call the model and BLOCKs', async () => {
    let calls = 0;
    const lc = makeLayerCVeto({
      callModel: async () => {
        calls += 1;
        return 'ALLOW';
      },
      maxCalls: 3,
    });
    expect((await lc.veto(input)).block).toBe(false); // 1
    expect((await lc.veto(input)).block).toBe(false); // 2
    expect((await lc.veto(input)).block).toBe(false); // 3
    const r4 = await lc.veto(input); // 4 → quota → fail-closed, NO model call
    expect(r4.block).toBe(true);
    expect(r4.reason).toMatch(/限额满/);
    expect(calls).toBe(3); // model called exactly maxCalls times, never the 4th
  });
});
