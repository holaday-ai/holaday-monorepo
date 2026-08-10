import { describe, expect, it } from 'vitest';
import {
  firstPlannedEditorError,
  plannedEditorFingerprint,
  plannedSaveFeedback,
  validatePlannedEditor,
} from './planned-editor-state';

interface TestDraft {
  title: string;
  instruction: string;
  multiple: boolean;
  items: string[];
  repeatType: 'once' | 'daily' | 'weekly' | 'monthly' | 'custom';
  customDays: string[];
  date: string;
  time: string;
  timezone: string;
  reminderMinutes: string;
  endsOn: string | null;
}

function draft(overrides: Partial<TestDraft> = {}): TestDraft {
  return {
    title: '每日巡检',
    instruction: '检查一次',
    multiple: false,
    items: [''],
    repeatType: 'once',
    customDays: [],
    date: '2026-08-11',
    time: '09:00',
    timezone: 'Asia/Shanghai',
    reminderMinutes: '',
    endsOn: null,
    ...overrides,
  };
}

describe('planned editor schedule feedback', () => {
  it('names the effective time when a recurring schedule is advanced', () => {
    expect(
      plannedSaveFeedback({
        action: 'create',
        adjusted: true,
        nextRunAt: '2026-08-11T01:00:00.000Z',
        timezone: 'Asia/Shanghai',
      }),
    ).toBe('规划已创建，首次执行已调整为 08月11日 09:00');
  });

  it('keeps the existing quiet success copy when no adjustment occurred', () => {
    expect(
      plannedSaveFeedback({
        action: 'series',
        adjusted: false,
        nextRunAt: '2026-08-11T01:00:00.000Z',
        timezone: 'Asia/Shanghai',
      }),
    ).toBe('整个规划已保存');
  });
});

describe('planned editor validation', () => {
  it('returns field-owned errors for each invalid editor mode', () => {
    expect(validatePlannedEditor(draft({ instruction: '   ' }))).toEqual({
      instruction: '请填写任务内容',
    });
    expect(
      validatePlannedEditor(draft({ multiple: true, instruction: '', items: [' ', ''] })),
    ).toEqual({ items: '请填写至少一个任务' });
    expect(validatePlannedEditor(draft({ date: '2026-02-30' }))).toEqual({
      scheduledAt: '请选择有效的执行日期和时间',
    });
    expect(validatePlannedEditor(draft({ repeatType: 'custom', customDays: [] }))).toEqual({
      customDays: '请选择至少一个执行日',
    });
  });

  it('focuses content before schedule and recurrence errors', () => {
    expect(
      firstPlannedEditorError({
        customDays: '请选择至少一个执行日',
        scheduledAt: '请选择有效的执行日期和时间',
        instruction: '请填写任务内容',
      }),
    ).toBe('instruction');
  });

  it('accepts a syntactically valid recurring anchor even when it may be in the past', () => {
    expect(
      validatePlannedEditor(draft({ repeatType: 'daily', date: '2020-01-01', time: '09:00' })),
    ).toEqual({});
  });
});

describe('planned editor dirty fingerprint', () => {
  it('normalizes API-trimmed whitespace and custom-day ordering', () => {
    expect(
      plannedEditorFingerprint(
        draft({ title: ' 每日巡检 ', instruction: ' 检查一次 ', customDays: ['WE', 'MO'] }),
      ),
    ).toBe(
      plannedEditorFingerprint(
        draft({ title: '每日巡检', instruction: '检查一次', customDays: ['MO', 'WE'] }),
      ),
    );
  });

  it('changes when any meaningful editable field changes', () => {
    const baseline = plannedEditorFingerprint(draft());
    expect(plannedEditorFingerprint(draft({ time: '10:00' }))).not.toBe(baseline);
    expect(plannedEditorFingerprint(draft({ reminderMinutes: '30' }))).not.toBe(
      baseline,
    );
    expect(plannedEditorFingerprint(draft({ items: ['新任务'] }))).not.toBe(baseline);
  });
});
