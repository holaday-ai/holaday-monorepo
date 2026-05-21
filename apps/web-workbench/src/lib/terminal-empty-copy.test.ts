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

  it('uses partial-success copy when verification produced no final text', () => {
    expect(terminalEmptyCopy('partial_success')).toEqual({
      title: '部分完成',
      body: '任务只完成了一部分，但没有生成可用的最终回复。可以重试同样的意图继续验证。',
    });
  });
});
