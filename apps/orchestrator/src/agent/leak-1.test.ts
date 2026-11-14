import { hasToolCallMarkup, stripToolCallMarkup } from '@holaday/shared-types';
import { describe, expect, it } from 'vitest';
import { answerQualityFailure, deliverableAnswer } from './generate-answer-guard.js';
import { sanitizeFinalText } from './text-sanitizer.js';

/**
 * 61.80 LEAK-1 — s04 「帮我搜一下 2025 年诺贝尔文学奖得主是谁」: the generate lane delivered a tool
 * call written out as text as the completed answer, on production (A) and on the candidate (B).
 * Verbatim from the two task records.
 */
const A = '{"type": "browser_use", "browser_id": "default", "action": "new", "url": ""}';
const B = 'BROWSE:web_search{"query": "2025年诺贝尔文学奖得主", "num_results": 5}';
const INTENT = '帮我搜一下 2025 年诺贝尔文学奖得主是谁';

describe('LEAK-1 · the two s04 forms are tool calls, not answers', () => {
  it.each([
    ['A: a JSON whose type is the tool', A],
    ['B: a channel label + tool name glued to its arguments', B],
    ['B without the label', 'web_search{"query": "2025年诺贝尔文学奖得主"}'],
    ['B with an opener', `我来帮你搜索一下。\n${B}`],
    ['a word tool behind a label', 'BROWSE:click{"ref": "e12"}'],
    ['a *_use name glued to its JSON', 'browser_use{"action":"navigate","url":"https://x.test"}'],
    ['a typed call with web_search', '{"type":"web_search","query":"诺贝尔文学奖"}'],
  ])('%s', (_label, text) => {
    expect(hasToolCallMarkup(text)).toBe(true);
    expect(deliverableAnswer(text)).toBeNull();
    expect(answerQualityFailure(text, { readSources: false, intent: INTENT })).toBe('NON_ANSWER');
  });

  it('the call is cut out of an answer that has content, and the content stays', () => {
    const text = `${B}\n\n2025 年诺贝尔文学奖授予了某位作家（示例）。`;
    const shown = deliverableAnswer(text);
    expect(shown).toBe('2025 年诺贝尔文学奖授予了某位作家（示例）。');
    expect(sanitizeFinalText(text)).not.toContain('web_search');
  });
});

describe('LEAK-1 · prose and data stay', () => {
  it.each([
    [
      'a JSON with a type that is no tool',
      '返回值形如 {"type": "text", "value": "hello"}，其中 type 表示类型。',
    ],
    ['a type that is an ordinary word', '{"type": "book", "title": "百年孤独"}'],
    ['a label that is not followed by a call', 'NOTE: 这里需要注意 {"a": 1} 只是示例数据。'],
    ['a capitalised word then a JSON with a space', 'JSON: {"query": "x"} 是查询参数的样子。'],
    [
      'a function in code the user asked about',
      '可以这样写：`web_search{"query": "x"}`，参数 query 为关键词。',
    ],
    ['a snake_case word in prose', '变量 user_name 用来保存用户名，{"user_name": "张三"} 是示例。'],
  ])('%s', (_label, text) => {
    expect(stripToolCallMarkup(text)).toBe(text);
    expect(deliverableAnswer(text)).toBe(text);
  });
});
