import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import {
  AwaitingMarkdown,
  liveSubStatusLongRunningHint,
  sanitizeMarkdownBrokenBoldUrls,
  sanitizeMarkdownTrailingPunctuation,
  shouldRenderTaskTrustSummary,
  taskStreamHasAnyActivity,
  taskStreamLiveActivityKey,
  webSearchLinePrefix,
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

  it('renders clarification markdown instead of showing raw markers', () => {
    const html = renderToStaticMarkup(
      createElement(AwaitingMarkdown, {
        text: '**商品型号**\n\n- iPhone 16 Pro\n- 上海当天送达',
      }),
    );

    expect(html).toContain('<strong>商品型号</strong>');
    expect(html).toContain('<li>iPhone 16 Pro</li>');
    expect(html).not.toContain('**商品型号**');
  });
});

describe('TaskStream trust surface', () => {
  it('does not duplicate the awaiting-user card with a result-review card', () => {
    expect(
      shouldRenderTaskTrustSummary({
        terminal: false,
        task: {
          taskId: 'tsk_wait',
          intent: '帮我购买商品',
          title: null,
          status: 'awaiting_user',
          tickCount: 1,
          createdAt: new Date('2026-08-06T00:00:00.000Z'),
        },
      }),
    ).toBe(false);
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

  it('uses completed wording for terminal web search evidence', () => {
    expect(webSearchLinePrefix(false)).toBe('正在联网搜索');
    expect(webSearchLinePrefix(true)).toBe('已联网搜索');
  });

  it('treats live thinking, progress, and streaming output as activity', () => {
    expect(taskStreamHasAnyActivity({ thinking: '正在分析' })).toBe(true);
    expect(taskStreamHasAnyActivity({ progressMessage: '正在读取页面' })).toBe(true);
    expect(taskStreamHasAnyActivity({ streamingText: '已经找到一条结果' })).toBe(true);
  });

  it('changes live activity key when streaming, progress, or thinking changes', () => {
    expect(
      taskStreamLiveActivityKey({ streamingText: 'abc' }),
    ).not.toBe(taskStreamLiveActivityKey({ streamingText: 'abcd' }));
    expect(
      taskStreamLiveActivityKey({ progressMessage: '正在读取页面' }),
    ).not.toBe(taskStreamLiveActivityKey({ progressMessage: '正在整理结果' }));
    expect(
      taskStreamLiveActivityKey({ thinking: '先搜索' }),
    ).not.toBe(taskStreamLiveActivityKey({ thinking: '再验证' }));
  });
});
