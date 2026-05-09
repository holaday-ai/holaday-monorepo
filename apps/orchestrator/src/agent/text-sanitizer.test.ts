import { describe, expect, it } from 'vitest';

import { humaniseScrapeFailure, sanitizeFinalText } from './text-sanitizer.js';

describe('sanitizeFinalText — paired tool tags', () => {
  it('strips paired <tool_call>...</tool_call>', () => {
    const input = '前缀 <tool_call>{"name":"navigate","arg":"x"}</tool_call> 后缀';
    expect(sanitizeFinalText(input)).toBe('前缀  后缀');
  });

  it('strips paired <tool_response>...</tool_response> across newlines', () => {
    const input = `Result text\n<tool_response>\nlots of\nmulti-line\nstuff\n</tool_response>\nMore result`;
    expect(sanitizeFinalText(input)).toBe('Result text\n\nMore result');
  });

  it('strips multiple paired tags in one string', () => {
    const input = 'a <tool_call>x</tool_call> b <tool_use>y</tool_use> c <function_calls>z</function_calls> d';
    expect(sanitizeFinalText(input)).toBe('a  b  c  d');
  });

  it('handles attributes on the opening tag', () => {
    const input = '<tool_call name="navigate" id="t1">payload</tool_call>visible';
    expect(sanitizeFinalText(input)).toBe('visible');
  });
});

describe('sanitizeFinalText — orphan tags', () => {
  it('strips a lone opening tag with no closer', () => {
    const input = '前缀 <tool_call> 中间 后缀';
    expect(sanitizeFinalText(input)).toBe('前缀  中间 后缀');
  });

  it('strips a lone closing tag', () => {
    const input = 'normal text </tool_response> trailer';
    expect(sanitizeFinalText(input)).toBe('normal text  trailer');
  });

  it('strips self-closing fragments', () => {
    const input = 'before <tool_use/> after';
    expect(sanitizeFinalText(input)).toBe('before  after');
  });
});

describe('sanitizeFinalText — base64 / data URLs', () => {
  it('strips data:image/...;base64,... blobs', () => {
    const input = '截图：data:image/png;base64,iVBORw0KGgoAAAANSUhEU 后续内容';
    expect(sanitizeFinalText(input)).toBe('截图： 后续内容');
  });

  it('strips a bare 200+ char base64 run on its own line, keeps paragraph break', () => {
    const blob = 'A'.repeat(250);
    const input = `text before\n${blob}\ntext after`;
    expect(sanitizeFinalText(input)).toBe('text before\n\ntext after');
  });

  it('keeps short alphanumeric-looking strings (not real base64)', () => {
    const input = '调用 ID: abc123def456 完成';
    expect(sanitizeFinalText(input)).toBe('调用 ID: abc123def456 完成');
  });
});

describe('sanitizeFinalText — stop-reason markers', () => {
  it('strips [STOP_REASON: ...]', () => {
    const input = 'final answer [STOP_REASON: end_turn] done';
    expect(sanitizeFinalText(input)).toBe('final answer  done');
  });

  it('strips [END_TURN] and [MAX_TOKENS]', () => {
    expect(sanitizeFinalText('answer [END_TURN]')).toBe('answer');
    expect(sanitizeFinalText('answer [MAX TOKENS] more')).toBe('answer  more');
  });

  it('strips [AWAITING_USER_INPUT] (mirrors generate-runner stripping)', () => {
    expect(sanitizeFinalText('question [AWAITING_USER_INPUT]')).toBe('question');
  });
});

describe('sanitizeFinalText — whitespace + edge cases', () => {
  it('collapses 3+ consecutive blank lines to 2', () => {
    const input = 'p1\n\n\n\np2\n\n\n\n\np3';
    expect(sanitizeFinalText(input)).toBe('p1\n\np2\n\np3');
  });

  it('null / undefined / empty input → empty string', () => {
    expect(sanitizeFinalText(null)).toBe('');
    expect(sanitizeFinalText(undefined)).toBe('');
    expect(sanitizeFinalText('')).toBe('');
  });

  it('idempotent — sanitising twice gives same result', () => {
    const dirty = 'a <tool_call>x</tool_call> [STOP_REASON: end] b';
    const once = sanitizeFinalText(dirty);
    const twice = sanitizeFinalText(once);
    expect(twice).toBe(once);
  });

  it('passes a clean string through unchanged (modulo trim)', () => {
    const clean = 'Today is a good day for shipping.';
    expect(sanitizeFinalText(clean)).toBe(clean);
  });

  it('trims leading + trailing whitespace', () => {
    expect(sanitizeFinalText('   answer   ')).toBe('answer');
  });
});

describe('humaniseScrapeFailure', () => {
  it('login wall pattern → instructs to switch to browser mode', () => {
    const out = humaniseScrapeFailure('forbidden: 403 — login required');
    expect(out).toContain('登录');
    expect(out).toContain('浏览器模式');
  });

  it('no-results pattern → suggests rewording', () => {
    expect(humaniseScrapeFailure('no results')).toContain('换更通用或更具体的关键词');
    expect(humaniseScrapeFailure('搜索没有结果（no results）')).toContain('换更通用或更具体的关键词');
  });

  it('rate-limit pattern → suggests waiting', () => {
    expect(humaniseScrapeFailure('429 rate limit exceeded')).toContain('限流');
  });

  it('timeout pattern → suggests retry / different source', () => {
    expect(humaniseScrapeFailure('timeout after 30s')).toContain('超时');
  });

  it('404 pattern → URL check', () => {
    expect(humaniseScrapeFailure('not found: 404')).toContain('404');
    expect(humaniseScrapeFailure('not found: 404')).toContain('拼写');
  });

  it('DNS / connection pattern', () => {
    expect(humaniseScrapeFailure('getaddrinfo ENOTFOUND foo.example')).toContain('无法连接');
  });

  it('firecrawl-prefixed reason → quotes + suggests retry', () => {
    expect(humaniseScrapeFailure('firecrawl: API key invalid')).toContain('数据抓取服务');
  });

  it('unmatched reason → echoes raw with prefix', () => {
    expect(humaniseScrapeFailure('mysterious failure')).toBe('抓取失败：mysterious failure');
  });

  it('undefined reason → generic fallback', () => {
    expect(humaniseScrapeFailure(undefined)).toContain('原因未知');
  });
});
