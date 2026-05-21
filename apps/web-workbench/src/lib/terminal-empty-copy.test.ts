import { describe, expect, it } from 'vitest';
import { terminalEmptyCopy } from './terminal-empty-copy';

describe('terminalEmptyCopy', () => {
  it('uses explicit cancellation copy for cancelled tasks with no final text', () => {
    expect(terminalEmptyCopy('cancelled')).toEqual({
      title: '已取消',
      body: '任务已取消，没有生成最终回复。已完成的步骤仍保留在详情里。',
    });
  });

  it('keeps failed empty-output copy action-oriented', () => {
    expect(terminalEmptyCopy('failed').title).toBe('任务未能完成');
    expect(terminalEmptyCopy('failed').body).toContain('没有收到可用回复');
  });
});
