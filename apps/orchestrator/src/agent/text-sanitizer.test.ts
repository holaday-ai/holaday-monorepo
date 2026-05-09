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

  it('strips a bare 50+ char base64 run on its own line, keeps paragraph break', () => {
    const blob = 'A'.repeat(80);
    const input = `text before\n${blob}\ntext after`;
    expect(sanitizeFinalText(input)).toBe('text before\n\ntext after');
  });

  it('keeps short alphanumeric-looking strings (not real base64)', () => {
    const input = '调用 ID: abc123def456 完成';
    expect(sanitizeFinalText(input)).toBe('调用 ID: abc123def456 完成');
  });

  it('strips bare JPEG magic-byte base64 anywhere (no whitespace boundary needed)', () => {
    const blob = '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAMCAgMCAgMDAwMEAwMEBQgFBQQE';
    expect(sanitizeFinalText(`截图payload${blob}内容`)).toBe('截图payload内容');
  });

  it('strips bare PNG magic-byte base64', () => {
    const blob = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAA';
    // Non-base64 chars on each side ('!' / '!') so the regex
    // doesn't greedily eat them.
    expect(sanitizeFinalText(`prefix!${blob}!suffix`)).toBe('prefix!!suffix');
  });
});

describe('sanitizeFinalText — tool-response JSON blocks (BOSS fixture)', () => {
  it('strips the BOSS-observed nested JSON pattern', () => {
    // Verbatim shape from tsk_937Rm6oH7dsSB4SXmLw5L (truncated base64
    // for test brevity; the real one was ~10 KB).
    const dirty =
      '抓取到的内容是2022-2024年的行业分析文章，不是小红书平台上的实时笔记数据。我来直接去小红书搜索，给你看真实的热门内容。\n\n让我打开小红书搜索露营装备。\n\n{"status": "success", "content": {"type": "image", "data": "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAMCAgMDA"}}';
    const out = sanitizeFinalText(dirty);
    expect(out).not.toContain('"status"');
    expect(out).not.toContain('"data"');
    expect(out).not.toContain('/9j/');
    expect(out).not.toContain('AAQSkZJRg');
    expect(out).toContain('抓取到的内容是2022-2024年的行业分析文章');
    expect(out).toContain('让我打开小红书搜索露营装备');
  });

  it('strips JSON with "status":"success" + "content" markers', () => {
    const input = 'before {"status":"success","content":"some short text"} after';
    expect(sanitizeFinalText(input)).toBe('before  after');
  });

  it('strips JSON with "type":"image" marker (deeply nested)', () => {
    const input = 'narrative {"a":{"b":{"type":"image","data":"x"}}} more narrative';
    expect(sanitizeFinalText(input)).toBe('narrative  more narrative');
  });

  it('keeps a JSON block that has no tool-response markers', () => {
    const input = '配置示例：{"theme":"dark","fontSize":14}';
    expect(sanitizeFinalText(input)).toBe('配置示例：{"theme":"dark","fontSize":14}');
  });

  it('handles unbalanced braces conservatively (keeps tail intact)', () => {
    const input = 'good text {"status":"success"';
    // Unbalanced — bail out, keep tail. Avoids silently chewing
    // the remainder of the input on a syntax glitch.
    expect(sanitizeFinalText(input)).toBe('good text {"status":"success"');
  });

  it('strips quoted "data":"..." even outside a marker-recognised wrapper', () => {
    const input = 'narrative "data":"/9j/4AAQSkZJRgABAQA" more';
    expect(sanitizeFinalText(input)).toBe('narrative  more');
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
