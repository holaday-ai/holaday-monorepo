import { describe, expect, it } from 'vitest';

import {
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
