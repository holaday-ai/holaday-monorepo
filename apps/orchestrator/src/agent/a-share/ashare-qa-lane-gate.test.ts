import { describe, it, expect, vi } from 'vitest';
import type { Logger } from 'pino';
import { classifyExecutionMode } from '../intent-classifier.js';
import { ashareQaHandlesMode } from './ashare-qa-lane-gate.js';

function fakeLogger(): Logger {
  const noop = vi.fn();
  return {
    info: noop, warn: noop, debug: noop, error: noop, fatal: noop, trace: noop,
    child: () => fakeLogger(),
  } as unknown as Logger;
}

// Regression (2026-06-13, cross-session #1↔#2): an a-share-skill-enabled
// account uploaded a docx template and said "按这个周报模板填充…"; the a-share
// QA fork ran BEFORE the template_fill fork and didn't check executionMode, so
// it matched the GMV/环比 prose to stock 600415 and answered with a briefing —
// the template was never filled. ashareQaHandlesMode keeps dedicated lanes
// (template_fill / image / browser) out of the a-share QA lane.
describe('a-share fork must not hijack template_fill (2026-06-13 regression)', () => {
  it("tonight's exact intent classifies as template_fill (not generate/scrape)", async () => {
    const out = await classifyExecutionMode({
      intent:
        '按这个周报模板填充：标题"第24周经营周报"，本周GMV 120万，上周GMV 100万，GMV环比你计算，任务清单：拉新活动已完成、商品上架进行中、月度对账待办，共3个任务',
      logger: fakeLogger(),
    });
    expect(out).toBe('template_fill');
  });

  it('ashareQaHandlesMode: only generate/scrape enter the a-share lane', () => {
    expect(ashareQaHandlesMode('generate')).toBe(true);
    expect(ashareQaHandlesMode('scrape')).toBe(true);
    // dedicated lanes the classifier already chose are excluded → not hijacked
    expect(ashareQaHandlesMode('template_fill')).toBe(false);
    expect(ashareQaHandlesMode('image')).toBe(false);
    expect(ashareQaHandlesMode('browser')).toBe(false);
  });

  it('a genuine a-share question still routes generate/scrape (④ not broken)', async () => {
    const out = await classifyExecutionMode({ intent: '茅台为什么涨', logger: fakeLogger() });
    expect(['generate', 'scrape']).toContain(out);
    expect(ashareQaHandlesMode(out)).toBe(true);
  });
});
