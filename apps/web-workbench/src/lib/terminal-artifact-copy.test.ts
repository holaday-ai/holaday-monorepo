import { describe, expect, it } from 'vitest';
import { terminalArtifactFallbackText } from './terminal-artifact-copy';

describe('terminalArtifactFallbackText', () => {
  it('stays empty when the terminal summary has text', () => {
    expect(
      terminalArtifactFallbackText({
        text: '已有总结',
        attachmentCount: 2,
        finalUrl: 'https://example.com',
      }),
    ).toBe('');
  });

  it('describes attachments and final URL for textless artifact-only tasks', () => {
    expect(
      terminalArtifactFallbackText({
        text: '',
        attachmentCount: 2,
        finalUrl: 'https://example.com/result',
      }),
    ).toBe('任务产出了 2 个文件\n最终页面：https://example.com/result');
  });

  it('ignores blank and browser-internal URLs', () => {
    expect(
      terminalArtifactFallbackText({
        text: '',
        attachmentCount: 0,
        finalUrl: 'chrome://new-tab-page',
      }),
    ).toBe('');
  });
});
