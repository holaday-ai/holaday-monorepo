import { describe, expect, it } from 'vitest';
import {
  advancePlannedSchedule,
  composePlannedItemInstruction,
  derivePlannedRunOutcome,
  encodeOccurrenceContent,
  parseOccurrenceContent,
  preparePlannedTaskCreate,
  resolvePlannedRunTitle,
} from './planned-executor.js';

describe('preparePlannedTaskCreate', () => {
  it('creates a single-item plan from the main instruction', () => {
    expect(
      preparePlannedTaskCreate({
        title: '',
        instruction: '  每周总结销售线索  ',
        items: [],
      }),
    ).toEqual({
      title: '每周总结销售线索',
      instruction: '每周总结销售线索',
      scope: 'single',
      items: ['每周总结销售线索'],
    });
  });

  it('keeps shared instructions separate from multiple unique items', () => {
    expect(
      preparePlannedTaskCreate({
        title: '竞品价格巡检',
        instruction: '使用官网价格并附链接',
        items: [' 产品 A ', '产品 B', '产品 A'],
      }),
    ).toEqual({
      title: '竞品价格巡检',
      instruction: '使用官网价格并附链接',
      scope: 'multiple',
      items: ['产品 A', '产品 B'],
    });
  });
});

describe('composePlannedItemInstruction', () => {
  it('combines the item with shared execution requirements', () => {
    expect(
      composePlannedItemInstruction({
        itemInstruction: '查询产品 A',
        sharedInstruction: '使用官网价格并附链接',
        multiple: true,
      }),
    ).toBe('查询产品 A\n\n统一执行要求：\n使用官网价格并附链接');
  });

  it('does not repeat the same instruction for a single-item plan', () => {
    expect(
      composePlannedItemInstruction({
        itemInstruction: '生成日报',
        sharedInstruction: '生成日报',
        multiple: false,
      }),
    ).toBe('生成日报');
  });
});

describe('occurrence content overrides', () => {
  it('round-trips a one-occurrence task edit without confusing plain legacy text', () => {
    const encoded = encodeOccurrenceContent({
      title: '临时改版日报',
      instruction: '仅本次增加渠道分析',
      items: ['检查官网', '检查应用商店'],
    });

    expect(parseOccurrenceContent(encoded)).toEqual({
      title: '临时改版日报',
      instruction: '仅本次增加渠道分析',
      items: ['检查官网', '检查应用商店'],
    });
    expect(parseOccurrenceContent('普通任务说明')).toBeNull();
  });

  it('rejects malformed override payloads', () => {
    expect(parseOccurrenceContent('planned-content:v1:{bad-json')).toBeNull();
  });

  it('snapshots the base or occurrence-specific title for a run', () => {
    expect(resolvePlannedRunTitle('当前系列标题', null)).toBe('当前系列标题');
    expect(
      resolvePlannedRunTitle('当前系列标题', {
        title: '本次标题',
        instruction: '仅本次要求',
        items: ['检查官网'],
      }),
    ).toBe('本次标题');
  });
});

describe('advancePlannedSchedule', () => {
  it('completes a successful one-time plan', () => {
    expect(
      advancePlannedSchedule({
        firedAt: new Date('2026-08-10T09:00:00.000Z'),
        repeatType: 'once',
        rrule: null,
        dispatchSucceeded: true,
      }),
    ).toEqual({ status: 'completed', nextRunAt: null });
  });

  it('keeps a failed one-time plan recoverable', () => {
    expect(
      advancePlannedSchedule({
        firedAt: new Date('2026-08-10T09:00:00.000Z'),
        repeatType: 'once',
        rrule: null,
        dispatchSucceeded: false,
      }),
    ).toEqual({ status: 'failed', nextRunAt: null });
  });

  it('advances a recurring plan even when the current dispatch fails', () => {
    expect(
      advancePlannedSchedule({
        firedAt: new Date('2026-08-10T09:00:00.000Z'),
        repeatType: 'daily',
        rrule: null,
        dispatchSucceeded: false,
      }),
    ).toEqual({
      status: 'active',
      nextRunAt: new Date('2026-08-11T09:00:00.000Z'),
    });
  });
});

describe('derivePlannedRunOutcome', () => {
  it('keeps non-terminal work running', () => {
    expect(derivePlannedRunOutcome({ kind: 'task', status: 'awaiting_user' })).toEqual({
      terminal: false,
      status: 'running',
    });
  });

  it('preserves a task that needs review', () => {
    expect(derivePlannedRunOutcome({ kind: 'task', status: 'partial_success' })).toEqual({
      terminal: true,
      status: 'partial_success',
    });
  });

  it('maps partial batches to partial success', () => {
    expect(derivePlannedRunOutcome({ kind: 'batch', status: 'partial' })).toEqual({
      terminal: true,
      status: 'partial_success',
    });
  });
});
