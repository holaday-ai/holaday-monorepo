import { describe, expect, it } from 'vitest';

import {
  taskCancelStateChangedMessage,
  terminalResultContentInsufficient,
} from './terminal-result-state';

describe('terminalResultContentInsufficient', () => {
  it('allows concise single-fact browser answers such as page titles', () => {
    expect(
      terminalResultContentInsufficient({
        status: 'completed',
        displayText: '**Example Domain**',
        revealedText: '**Example Domain**',
        intent:
          '请打开 https://example.com，读取页面标题，并只回复标题是什么。',
        attachmentCount: 0,
      }),
    ).toBe(false);
  });

  it('still flags generic short stubs', () => {
    expect(
      terminalResultContentInsufficient({
        status: 'completed',
        displayText: '搜索完成',
        revealedText: '搜索完成',
        intent: '请打开 https://example.com 并查看页面。',
        attachmentCount: 0,
      }),
    ).toBe(true);
  });

  it('keeps long structured markdown reports visible', () => {
    const longReport = [
      '## 报告',
      '',
      '1. 网站访问量增长了 30%，用户留存稳定在 80%。',
      '2. 渠道转化明显改善，建议继续跟踪核心漏斗。',
      '3. 下一步可以补充来源截图和关键指标复核。',
    ].join('\n');
    expect(
      terminalResultContentInsufficient({
        status: 'completed',
        displayText: longReport + 'x'.repeat(220),
        revealedText: longReport,
        intent: '写一份分析报告',
        attachmentCount: 0,
      }),
    ).toBe(false);
  });

  it('does not replace short artifact-only results when attachments exist', () => {
    expect(
      terminalResultContentInsufficient({
        status: 'completed',
        displayText: '',
        revealedText: '',
        intent: '下载文件',
        attachmentCount: 1,
      }),
    ).toBe(false);
  });

  it('hides raw task states in cancel failure copy', () => {
    expect(taskCancelStateChangedMessage('completed')).toBe('任务已经结束，当前详情已保留。');
    expect(taskCancelStateChangedMessage('awaiting_user')).toBe(
      '任务状态刚刚变化，请刷新后再确认是否需要取消。',
    );
    expect(taskCancelStateChangedMessage('unknown')).toBe('任务状态已变化，请刷新后查看最新进度。');
  });
});

describe('terminalResultContentInsufficient — lightweight Q&A', () => {
  it('does NOT flag a concise arithmetic answer', () => {
    expect(
      terminalResultContentInsufficient({
        status: 'completed',
        displayText: '1 + 1 = 2',
        revealedText: '1 + 1 = 2',
        intent: '1 加 1 等于几？',
        attachmentCount: 0,
      }),
    ).toBe(false);
  });

  it('does NOT flag a short greeting reply', () => {
    expect(
      terminalResultContentInsufficient({
        status: 'completed',
        displayText: '你好！有什么可以帮你的吗？',
        revealedText: '你好！有什么可以帮你的吗？',
        intent: '你好',
        attachmentCount: 0,
      }),
    ).toBe(false);
  });

  it('still flags a near-empty answer for a real report task', () => {
    expect(
      terminalResultContentInsufficient({
        status: 'completed',
        displayText: '完成',
        revealedText: '完成',
        intent: '写一份季度营销复盘报告，含数据与建议',
        attachmentCount: 0,
      }),
    ).toBe(true);
  });
});
