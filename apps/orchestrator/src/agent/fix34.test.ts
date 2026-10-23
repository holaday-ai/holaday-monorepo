import { stripToolCallMarkup } from '@holaday/shared-types';
import { describe, expect, it } from 'vitest';
import { reviewGenerateOutcome } from '../execution/generate-outcome-review.js';
import { assessCompletionFacts, observedEvidence } from './browser-tools/completion-fields.js';
import { UNIFIED_BROWSER_SYSTEM_PROMPT } from './browser-tools/unified-browser-loop.js';
import {
  answerQualityFailure,
  asksForToolCallExample,
  deliverableAnswer,
} from './generate-answer-guard.js';
import { explainExecutionMode } from './intent-classifier.js';
import { namedSiteSearch } from './named-site-search.js';
import { sanitizeFinalText } from './text-sanitizer.js';

const logger = { info() {}, warn() {}, debug() {}, error() {} } as never;
const route = async (intent: string) => (await explainExecutionMode({ intent, logger })).mode;
const none = { readSources: false };
const lt = '<';

describe('FIX-34 #4a · only tool-call structure is removed, not tag words in prose', () => {
  it.each([
    `HTML 里 ${lt}function> 不是标签；工具调用里 ${lt}parameter> 放参数名。`,
    `在 XML 里用 ${lt}arguments> 包住 JSON，用 ${lt}function> 写名字。`,
  ])('prose naming tags is untouched: %s', (answer) => {
    expect(stripToolCallMarkup(answer)).toBe(answer);
    expect(deliverableAnswer(answer)).toBe(answer);
  });
  it('a tool-call structure in prose is still removed', () => {
    const answer =
      `第一个结果售价 $14.99。\n${lt}invoke name="browser_navigate">\n` +
      `${lt}parameter name="url">https://www.bestbuy.com${lt}/parameter>\n${lt}/invoke>`;
    expect(deliverableAnswer(answer)).toBe('第一个结果售价 $14.99。');
  });
});

describe('FIX-34 #4b · an asked-for tool-call example is the answer', () => {
  const example =
    '```json\n{"name": "browser_use", "arguments": {"action": "navigate", "url": "https://example.com"}}\n```';
  const json = `${lt}tool_call>{"name": "browser_use", "arguments": {"action": "navigate"}}${lt}/tool_call>`;
  it.each([
    '给我一个工具调用 JSON 示例',
    'show me a tool call example in JSON',
    '函数调用的格式怎么写，举个例子',
  ])('%s asks for an example', (intent) => {
    expect(asksForToolCallExample(intent)).toBe(true);
    expect(answerQualityFailure(json, { ...none, intent })).toBeNull();
    expect(answerQualityFailure(example, { ...none, intent })).toBeNull();
  });
  it.each(['在 BestBuy 搜 usb c cable', '帮我查一下今天的天气'])(
    'a bare tool call answering %s is still NON_ANSWER',
    (intent) => {
      expect(asksForToolCallExample(intent)).toBe(false);
      expect(answerQualityFailure(json, { ...none, intent })).toBe('NON_ANSWER');
    },
  );
});

describe('FIX-34 #4c · 「我在抖音上看到…是真的吗」 is checked, not scraped', () => {
  it.each([
    '我在抖音上看到喝柠檬水能减肥，是真的吗',
    '在小红书刷到说隔夜菜致癌，真的假的',
    '微博上看到说明天全国降温十度，靠谱吗',
  ])('%s → generate', async (intent) => {
    expect(await route(intent)).toBe('generate');
  });
  it.each([
    ['a page to read', '打开小红书看看今天的热门笔记'],
    ['a link to check', '我在抖音上看到 https://www.douyin.com/video/123 这个视频，是真的吗'],
  ])('%s is still a page task', async (_id, intent) => {
    expect(await route(intent)).not.toBe('generate');
  });
});

describe('FIX-34 #4d · English "target"/"threads" are words, not sites', () => {
  it.each([
    'search target customers for our new coffee brand',
    'how do I search threads in Slack',
    'search for booking confirmation emails tips',
  ])('%s is not a site search', (text) => {
    expect(namedSiteSearch(text)).toBeNull();
  });
  it.each([
    'search target.com for usb c cable',
    'on Target, search for a usb c hub',
    'search threads.net for claude',
  ])('%s is a site search', (text) => {
    expect(namedSiteSearch(text)).not.toBeNull();
  });
});

describe('FIX-34 #4f · content-topic clarifying questions pass the same filter', () => {
  it('a legacy awaiting_user question carries no tool syntax', async () => {
    const question = `请补充你的账号定位和目标人群。\n${lt}invoke name="ask_user">${lt}parameter name="q">定位${lt}/parameter>${lt}/invoke>`;
    const reviewed = await reviewGenerateOutcome({
      taskId: 'tsk_ct',
      intent: '帮我做一份小红书选题报告',
      outcome: { status: 'awaiting_user', summary: question },
    } as never);
    const summary = reviewed.outcome.status === 'awaiting_user' ? reviewed.outcome.summary : null;
    expect(summary).toBe('请补充你的账号定位和目标人群。');
  });
});

describe('FIX-34 #4h · internal element refs never reach the user', () => {
  it.each([
    [
      '包含 Google Logo（ref=e23）、搜索框（ref=e45）以及按钮。',
      '包含 Google Logo、搜索框以及按钮。',
    ],
    [
      '第1个商品标题 ref=e255 "BELKIN"，价格 ref=e278 "S$8.90"',
      '第1个商品标题 "BELKIN"，价格 "S$8.90"',
    ],
    ['按钮 [ref=e12] 可点击', '按钮 可点击'],
    ['文本块（ref=e12、e13、e19–e23），均为占位', '文本块，均为占位'],
    ['头条区域（h2，ref=e36），链接', '头条区域（h2），链接'],
    ['iframe（ref=e77，frameId 为 F1）', 'iframe（frameId 为 F1）'],
    ['对应 snapshot 中的 ref=e12、e13。未点击', '对应 snapshot 中的相应元素。未点击'],
  ])('%s', (raw, shown) => {
    expect(deliverableAnswer(raw)).toBe(shown);
    expect(sanitizeFinalText(raw)).toBe(shown);
  });
  it.each(['代码里 `ref=e23` 不动', 'preference=e5 不是内部编号', '参考 ref=external 文档'])(
    'not an internal ref: %s',
    (text) => {
      expect(stripToolCallMarkup(text)).toBe(text);
    },
  );
});

describe('FIX-34 #4i · an author the page shows is written plainly', () => {
  const page = (author: boolean) =>
    observedEvidence(
      'x',
      [
        '- heading "第52集 | 柠檬巴巴露亚" [level=1] [ref=e10]',
        ...(author ? ['- link "小喵麻麻" [ref=e31]'] : []),
        '- generic [ref=e90]: 喵妈太厉害了，小喵麻麻的蛋糕最好吃',
        '- text [互动=点赞]: "4740"',
      ].join('\n'),
      'https://www.douyin.com/video/7300000000000000000',
    );
  const hedged =
    '- 作者：页面快照中视频详情区域未直接展示作者名称；评论区高频称呼“喵妈/小喵麻麻”，可推断作者为“小喵麻麻”相关账号\n- 点赞数：4740';
  it('the page shows the author link: the hedge is sent back once to name it', () => {
    const facts = assessCompletionFacts({ summary: hedged, pages: [page(true)] });
    expect(facts.hedgedNames?.map((h) => h.name)).toEqual(['小喵麻麻']);
    expect(facts.contradictions).toEqual([]);
  });
  it('only comments mention the name: the honest hedge stands, with no 未核实 noise', () => {
    const facts = assessCompletionFacts({ summary: hedged, pages: [page(false)] });
    expect(facts.hedgedNames).toBeUndefined();
    expect(facts.unverified.join('；')).not.toContain('作者');
  });
  it('a plain author is checked against the page as before', () => {
    const facts = assessCompletionFacts({ summary: '- 作者：小喵麻麻', pages: [page(true)] });
    expect(facts.hedgedNames).toBeUndefined();
    expect(facts.unverified).toEqual([]);
  });
  it('the browser prompt says to write a visible name directly', () => {
    expect(UNIFIED_BROWSER_SYSTEM_PROMPT).toContain('不写「推断」「相关账号」');
  });
});
