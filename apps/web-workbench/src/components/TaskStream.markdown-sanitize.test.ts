import { describe, expect, it } from 'vitest';

import {
  liveSubStatusLongRunningHint,
  sanitizeMarkdownBrokenBoldUrls,
  sanitizeMarkdownTrailingPunctuation,
} from './TaskStream';

describe('TaskStream markdown sanitizer', () => {
  it('removes a broken bold marker before bare urls', () => {
    expect(
      sanitizeMarkdownBrokenBoldUrls('页面链接：**https://en.wikipedia.org/wiki/OpenAI'),
    ).toBe('页面链接：https://en.wikipedia.org/wiki/OpenAI');
  });

  it('keeps normal bold text and markdown links intact', () => {
    const markdown = '**OpenAI** [页面](https://en.wikipedia.org/wiki/OpenAI)';
    expect(sanitizeMarkdownBrokenBoldUrls(markdown)).toBe(markdown);
  });

  it('still separates Chinese punctuation from bare urls after repairing markers', () => {
    expect(
      sanitizeMarkdownTrailingPunctuation('页面链接：**https://example.com/path，继续说明'),
    ).toBe('页面链接：https://example.com/path ，继续说明');
  });
});

describe('TaskStream live phase copy', () => {
  it('keeps short-running phases quiet', () => {
    expect(liveSubStatusLongRunningHint('browsing', 119)).toBeNull();
  });

  it('reassures users when browser work runs past two minutes', () => {
    expect(liveSubStatusLongRunningHint('browsing', 120)).toContain('不是卡死');
  });

  it('offers a calmer long-running browser explanation after five minutes', () => {
    expect(liveSubStatusLongRunningHint('browsing', 300)).toContain('稍后回来查看结果');
  });

  it('uses a concise processing hint for extraction and verification phases', () => {
    expect(liveSubStatusLongRunningHint('verifying', 180)).toBe(
      '仍在整理和核对结果，不是卡死。',
    );
  });
});
