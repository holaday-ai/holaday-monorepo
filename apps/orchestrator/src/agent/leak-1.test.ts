import { hasToolCallMarkup, stripToolCallMarkup } from '@holaday/shared-types';
import { stripToolCallBlocks } from '@holaday/shared-types';
import { describe, expect, it } from 'vitest';
import { answerQualityFailure, deliverableAnswer } from './generate-answer-guard.js';
import { explainExecutionMode } from './intent-classifier.js';
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
    ['复审 P1-3: a full-width colon', 'BROWSE：web_search{"query": "x"}'],
    ['复审 P1-3: a lowercase label', 'browse:web_search{"query": "x"}'],
    ['复审 P2: arguments in parentheses', 'web_search({"query": "x"})'],
    ['复审 P2: a label and parentheses', 'BROWSE: web_search({"query": "x"})'],
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
    [
      '复审 P1-1: a phone-call record',
      '客户记录：{"type": "phone_call", "duration": 30, "note": "已回访"}',
    ],
    ['复审 P1-1: fair use', '版权类型 {"type": "fair_use", "source": "x"} 表示合理使用。'],
    ['复审 P2: a log line', '日志示例：\nINFO: user.login{"uid": 1}'],
    ['复审 P2: an error log', 'ERROR: request_failed{"code":500,"msg":"timeout"} 表示请求超时。'],
    ['复审 P2: a config note', 'NOTE: config{"debug": true} 打开调试。'],
    ['复审 P2: no label across lines', 'NOTE\n:\nfoo\n{"a": 1}\n正文'],
  ])('%s', (_label, text) => {
    expect(stripToolCallMarkup(text)).toBe(text);
    expect(deliverableAnswer(text)).toBe(text);
  });
});

describe('LEAK-1 复审 P1-2 · fenced data with a type field stays', () => {
  it.each([
    ['a device list', '```json\n[{"id":1,"type":"computer","brand":"Dell"}]\n```\n这是设备清单。'],
    ['a browser share', '```json\n{"type":"browser","name":"Chrome","share":0.65}\n```'],
    ['a callback', '```json\n{"type":"user_callback","id":2}\n```'],
  ])('%s', (_label, text) => {
    expect(stripToolCallBlocks(text)).toBe(text);
  });
  it('a fenced browser_use call still goes', () => {
    expect(stripToolCallBlocks(`前文\n\n\`\`\`json\n${A}\n\`\`\``)).toBe('前文');
  });
});

describe('LEAK-1 · the bracketed pseudo-tool of s04 run 2', () => {
  const RUN2 =
    '让我搜索一下2025年诺贝尔文学奖的相关信息。\n\n[SEARCH]\nquery: "2025年诺贝尔文学奖得主"\n[/SEARCH] 我需要等待搜索结果。';
  it('is tool syntax and no answer', () => {
    expect(hasToolCallMarkup(RUN2)).toBe(true);
    expect(deliverableAnswer(RUN2)).toBeNull();
  });
  it('a bracketed word in prose stays', () => {
    const text = '按 [SEARCH] 键打开搜索框，再输入关键词。';
    expect(stripToolCallMarkup(text)).toBe(text);
  });
});

describe('LEAK-1 · 「搜一下」 is a search, not writing from memory', () => {
  const logger = { info() {}, warn() {}, debug() {}, error() {} } as never;
  const route = async (intent: string) => (await explainExecutionMode({ intent, logger })).mode;
  it.each([
    INTENT,
    '搜一下 OpenAI 最新发布了什么',
    '帮我百度一下 2026 年春节放假安排',
    '上网查一下特斯拉 Model Y 的续航',
  ])('%s', async (intent) => {
    expect(await route(intent)).toBe('scrape');
  });
  it.each(['帮我写一段关于搜索引擎的介绍', '把这段话翻译成英文：今天天气很好'])(
    'writing stays in generate: %s',
    async (intent) => {
      expect(await route(intent)).toBe('generate');
    },
  );
});
