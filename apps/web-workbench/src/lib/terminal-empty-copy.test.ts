import { describe, expect, it } from 'vitest';
import { terminalEmptyCopy, terminalInsufficientCopy } from './terminal-empty-copy';

describe('terminalEmptyCopy', () => {
  it('uses explicit cancellation copy for cancelled tasks with no final text', () => {
    expect(terminalEmptyCopy('cancelled')).toEqual({
      title: '已取消',
      body: '任务已取消，没有生成最终回复。已完成的步骤仍保留在详情里。',
    });
  });

  it('keeps failed empty-output copy action-oriented', () => {
    expect(terminalEmptyCopy('failed')).toEqual({
      title: '任务未能完成',
      body: '这个任务已经结束，但没有收到可用回复。已完成的步骤和浏览器记录会保留；重新执行会新建一次尝试，不会覆盖当前记录。',
    });
  });

  it('uses partial-success copy when verification produced no final text', () => {
    expect(terminalEmptyCopy('partial_success')).toEqual({
      title: '部分完成',
      body: '任务只完成了一部分，但没有生成可用的最终回复。已完成的步骤和浏览器记录会保留；重新执行会新建一次尝试继续验证。',
    });
  });

  it('uses rerun copy for unexpected terminal empty states', () => {
    expect(terminalEmptyCopy('completed')).toEqual({
      title: '没有回复内容',
      body: '这个任务已经结束，但没有收到回复内容。可以重新执行当前任务；原记录会保留。',
    });
  });

  it('keeps insufficient-result copy consistent with empty terminal states', () => {
    expect(terminalInsufficientCopy()).toEqual({
      title: '结果内容不足',
      body: '这次输出几乎没有有效内容。已完成的步骤和浏览器记录会保留；可以重新执行，或换一种更具体的描述后再试。',
    });
  });
});
