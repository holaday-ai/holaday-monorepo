import { describe, expect, it } from 'vitest';

import {
  humaniseScrapeFailure,
  sanitizeFinalText,
  stripStopReasonMarkers,
} from './text-sanitizer.js';

describe('stripStopReasonMarkers — P2-A awaiting sentinel in step labels', () => {
  it('strips the [AWAITING_USER_INPUT] sentinel + collapses the gap', () => {
    expect(stripStopReasonMarkers('你想查哪天从北京出发？ [AWAITING_USER_INPUT]')).toBe(
      '你想查哪天从北京出发？',
    );
    expect(stripStopReasonMarkers('问题？ [AWAITING_USER_INPUT] 正在思考')).toBe('问题？ 正在思考');
  });

  it('handles space/underscore + case variants', () => {
    expect(stripStopReasonMarkers('q [AWAITING USER INPUT]')).toBe('q');
    expect(stripStopReasonMarkers('q [awaiting_user_input]')).toBe('q');
  });

  it('strips other machine markers too', () => {
    expect(stripStopReasonMarkers('done [END_TURN]')).toBe('done');
    expect(stripStopReasonMarkers('done [MAX_TOKENS]')).toBe('done');
    expect(stripStopReasonMarkers('done [STOP_REASON: end_turn]')).toBe('done');
  });

  it('leaves normal prose untouched', () => {
    expect(stripStopReasonMarkers('查北京到上海的机票，给最便宜的 3 个')).toBe(
      '查北京到上海的机票，给最便宜的 3 个',
    );
    expect(stripStopReasonMarkers('一个数组 [1, 2, 3] 的元素')).toBe('一个数组 [1, 2, 3] 的元素');
  });

  it('null / empty → empty string', () => {
    expect(stripStopReasonMarkers(null)).toBe('');
    expect(stripStopReasonMarkers(undefined)).toBe('');
    expect(stripStopReasonMarkers('')).toBe('');
  });

  it('sanitizeFinalText still strips it on the final summary path', () => {
    expect(sanitizeFinalText('最终答案 [AWAITING_USER_INPUT]')).not.toContain('AWAITING_USER_INPUT');
  });
});

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

describe('sanitizeFinalText — orphan JSON fragment lines (BOSS sweep)', () => {
  // BOSS Phase 1 follow-up: after the brace-counted scanner bails
  // out on unbalanced braces (conservative), a line like
  // `{"image": "` survives unchanged. The post-pass line-strip
  // handles it.

  it('BOSS exact pattern: 人话\\n{"image": "\\n更多人话 → cleaned', () => {
    const input = '人话\n{"image": "\n更多人话';
    expect(sanitizeFinalText(input)).toBe('人话\n\n更多人话');
  });

  it('orphan {"status": " line (no closing brace) → dropped', () => {
    const input = 'A\n{"status": "still typing\nB';
    expect(sanitizeFinalText(input)).toBe('A\n\nB');
  });

  it('orphan {"data": " line gets removed', () => {
    const input = 'before\n  {"data": "/9j/abcdef\nafter';
    expect(sanitizeFinalText(input)).toBe('before\n\nafter');
  });

  it('balanced inline JSON with strong marker on the same line → swept by stripToolJsonBlocks', () => {
    // The marker set is keyed on tool-response signatures
    // ("status"/"content"/"screenshot"/"base64", or "type":"image",
    // or "data":"/9j/..."). A balanced block carrying any of those
    // gets dropped by step 2.
    const input = 'before {"status":"success","x":1} after';
    expect(sanitizeFinalText(input)).toBe('before  after');
  });

  it('balanced inline JSON whose marker is "image" key alone → KEPT (could be legit)', () => {
    // {"image":"logo.png"} could be a valid config snippet — the
    // `"image"` key alone isn't a strong tool-response signal. The
    // pollution pattern is `"type":"image"` (with that exact value)
    // or `"data":"/9j/..."` which is unambiguous.
    const input = 'before {"image":"logo.png"} after';
    expect(sanitizeFinalText(input)).toBe('before {"image":"logo.png"} after');
  });

  it('balanced JSON without markers (e.g. config example) is NOT touched', () => {
    const input = '配置示例：\n{"theme":"dark"}\n说明完毕';
    expect(sanitizeFinalText(input)).toBe('配置示例：\n{"theme":"dark"}\n说明完毕');
  });

  it('stray brace-only lines get cleaned up', () => {
    const input = 'header\n}\nbody';
    expect(sanitizeFinalText(input)).toBe('header\n\nbody');
  });

  it('ordinary text containing a curly brace token (no key pattern) → kept', () => {
    const input = '在公式中 f(x) = {x : x ∈ N} 的写法';
    expect(sanitizeFinalText(input)).toBe('在公式中 f(x) = {x : x ∈ N} 的写法');
  });
});

describe('sanitizeFinalText — internal terminal metadata JSON', () => {
  it('strips browser result metadata appended after the user-facing answer', () => {
    const input = [
      '结果已显示：',
      '',
      '页面上清楚呈现了 **(128 + 256) / 3 = 128**',
      JSON.stringify({
        model: 'claude-sonnet-4-6',
        finalUrl: 'https://web2.0calc.com/',
        elapsedMs: 35631,
        toolsUsed: ['navigate', 'computer'],
        expertMode: 'auto',
        iterations: 6,
        attachments: [
          {
            kind: 'screenshot',
            fileId: 'file_123',
            filename: 'screenshot.jpg',
            downloadUrl: '/files/file_123/download',
          },
        ],
        selectedRole: null,
        executionMode: 'browser',
        fallbackChain: ['browser'],
        modelFinalText: '结果已显示：页面上清楚呈现了...',
        expertWorkflowId: null,
        awaitingUserCount: 0,
        finalExecutionMode: 'browser',
        hasFinalScreenshot: true,
      }),
    ].join('\n');

    const out = sanitizeFinalText(input);

    expect(out).toBe('结果已显示：\n\n页面上清楚呈现了 **(128 + 256) / 3 = 128**');
    expect(out).not.toContain('"model"');
    expect(out).not.toContain('"finalUrl"');
    expect(out).not.toContain('"attachments"');
  });

  it('keeps ordinary JSON examples with a model field but no terminal metadata shape', () => {
    const input = '配置示例：{"model":"gpt-5","temperature":0.2,"format":"json"}';
    expect(sanitizeFinalText(input)).toBe(input);
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

describe('sanitizeFinalText — Phase 4 R1 Claude self-signatures', () => {
  it('strips trailing model-ID footer (dash + Sonnet)', () => {
    expect(sanitizeFinalText('Generated by the agent.\n— Claude Sonnet 4.6')).toBe(
      'Generated by the agent.',
    );
  });

  it('strips bare model identifier (Opus + version), leaves single-space gap', () => {
    expect(sanitizeFinalText('Result done.\nClaude Opus 4.7 ready.')).toBe(
      'Result done.\n ready.',
    );
  });

  it('strips inline model identifier (Haiku, no version)', () => {
    // The inline-with-leading-dash pattern eats both dash and the
    // model name, so "Hi — Claude Haiku here." → "Hi here." after
    // the second whitespace gap collapses on trim/join. Validate
    // shape rather than exact whitespace.
    const out = sanitizeFinalText('Hi — Claude Haiku here.');
    expect(out).not.toContain('Claude');
    expect(out).not.toContain('Haiku');
    expect(out).toContain('Hi');
    expect(out).toContain('here.');
  });

  it('strips model identifier with parenthetical', () => {
    const dirty = 'Done. Claude Sonnet 4.6 (1M context) signing off.';
    const out = sanitizeFinalText(dirty);
    expect(out).not.toContain('Claude Sonnet');
    expect(out).not.toContain('1M context');
  });

  it('strips English self-introduction "I\'m Claude,"', () => {
    expect(sanitizeFinalText("I'm Claude, the answer is 42.")).not.toContain(
      "I'm Claude",
    );
  });

  it('strips English self-introduction "I am Claude."', () => {
    expect(sanitizeFinalText('I am Claude. Here is the report.')).not.toContain(
      'I am Claude',
    );
  });

  it('strips "Generated by Claude"', () => {
    expect(sanitizeFinalText('Report attached.\nGenerated by Claude.')).not.toMatch(
      /Generated by Claude/,
    );
  });

  it('strips Chinese self-introduction', () => {
    const out = sanitizeFinalText('我是 Claude，可以帮你分析这份报告。继续。');
    expect(out).not.toContain('我是 Claude');
    expect(out).toContain('继续');
  });

  it('strips provenance attribution "由 Claude 生成"', () => {
    const out = sanitizeFinalText('结论：销售下降 12%。由 Claude Sonnet 生成。');
    expect(out).toContain('销售下降 12%');
    expect(out).not.toMatch(/由\s*Claude/);
  });

  it('strips trailing footer-line signature', () => {
    const out = sanitizeFinalText('Report body.\n— Claude, Anthropic AI assistant');
    expect(out).toContain('Report body.');
    expect(out).not.toContain('Anthropic');
    expect(out).not.toMatch(/Claude/);
  });

  it('strips trailing en-dash footer', () => {
    const out = sanitizeFinalText('Body text.\n–Sonnet 4.6');
    expect(out).toBe('Body text.');
  });

  it('preserves legitimate Claude references in user content', () => {
    // "Claude Shannon" + "Apple vs Claude" are NOT self-signatures —
    // sanitiser should leave them untouched. The patterns target
    // "Claude Sonnet/Opus/Haiku" (model family) and self-intro
    // openers, not every word "Claude".
    const text =
      'Claude Shannon founded information theory in 1948. Apple and Claude are different products.';
    expect(sanitizeFinalText(text)).toBe(text);
  });

  it('Phase 4 Codex follow-up — preserves Chinese mentions of Claude Shannon / Monet', () => {
    // Original Chinese patterns over-matched: "我为 Claude Shannon",
    // "由 Claude Shannon 提出", "作为 Claude Monet 的同事" all hit
    // the `Claude` token without a Claude-self anchor. After the
    // tightening (require Sonnet/Opus/Haiku/Anthropic/AI/助手/模型
    // OR provenance verb), these stay intact.
    const cases = [
      '我读了 Claude Shannon 1948 年的论文，关于信息熵的理论。',
      '由 Claude Shannon 提出的香农熵公式至今仍在使用。',
      '作为 Claude Monet 的同事，他亲眼见证了印象派的兴起。',
      'Claude Monet 是法国印象派画家，代表作有《睡莲》。',
    ];
    for (const text of cases) {
      expect(sanitizeFinalText(text)).toBe(text);
    }
  });

  it('Phase 4 Codex follow-up — still strips real Chinese self-intro with model-family anchor', () => {
    expect(sanitizeFinalText('我是 Claude Sonnet 4.6，可以帮你分析。继续。')).not.toContain(
      '我是 Claude',
    );
    expect(sanitizeFinalText('我是 Claude，Anthropic 的 AI 助手。开始任务。')).not.toContain(
      '我是 Claude',
    );
    expect(sanitizeFinalText('作为 Claude AI 助手，我可以帮你处理这件事。')).not.toContain(
      '作为 Claude',
    );
  });

  it('Phase 4 Codex follow-up — still strips Chinese provenance with verb anchor', () => {
    expect(sanitizeFinalText('结论：销售下降 12%。由 Claude 生成。')).not.toMatch(
      /由\s*Claude\s*生成/,
    );
    expect(sanitizeFinalText('报告来自 Claude Opus 提供。')).not.toMatch(
      /来自\s*Claude\s*Opus/,
    );
  });

  it('idempotent — Claude pattern sweep is stable on second pass', () => {
    const dirty = '结论：12%。我是 Claude Sonnet 4.6，由 Claude Opus 提供。';
    const once = sanitizeFinalText(dirty);
    const twice = sanitizeFinalText(once);
    expect(twice).toBe(once);
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
