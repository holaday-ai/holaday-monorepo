import { describe, expect, it } from 'vitest';

import { terminalResultContentInsufficient } from './terminal-result-state';

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
});
