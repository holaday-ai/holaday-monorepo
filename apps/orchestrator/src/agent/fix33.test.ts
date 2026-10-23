import { hasToolCallMarkup, stripToolCallMarkup } from '@holaday/shared-types';
import { describe, expect, it } from 'vitest';
import { platformFailureReason } from '../quota/platform-failure-refunds.js';
import { CORE_QUALITY_FAILURE_COPY } from './core-task-settlement.js';
import {
  TOOL_CALL_TEXT_ONLY,
  answerQualityFailure,
  deliverableAnswer,
} from './generate-answer-guard.js';
import { explainExecutionMode } from './intent-classifier.js';
import { sanitizeFinalText } from './text-sanitizer.js';

/** Deploy-33 new-bestbuy, verbatim from the task record BOSS saw. */
const BESTBUY =
  '我来帮你在 BestBuy 搜索 usb c cable。\n\n<li_call>\n<function>browser_use</function>\n<arguments>\n{"action": "navigate", "url": ""}</arguments>\n</li_call>\n<li_call>\n<function>browser_use</function>\n<arguments>\n</arguments>\n</li_call>';

describe('FIX-33 #1 · tool-call text is never an answer', () => {
  const none = { readSources: false };
  it.each([
    [
      'namespaced invoke',
      `${'<'}x:invoke name="browser"><x:parameter name="url">https://www.bestbuy.com</x:parameter></x:invoke>`,
    ],
    [
      'function_calls',
      '<function_calls><invoke name="web_search"><parameter name="q">usb c</parameter></invoke></function_calls>',
    ],
    ['tool_name', '<tool_name>screenshot</tool_name>'],
    [
      'computer_use json',
      '<computer_use>{"action":"web_search","query":"python 3.13 new features"}</computer_use>',
    ],
    [
      'multi-line json',
      '让我打开网站看看。\n{\n  "action": "navigate",\n  "url": "https://www.bestbuy.com"\n}',
    ],
    ['fenced json call', '```json\n{"tool": "browser", "action": "open"}\n```'],
    ['bare browser_use', '我来帮你在 Amazon 上搜索。\nbrowser_use'],
    [
      'english opener',
      'I\'ll search Best Buy for that.\n<tool_call>{"name":"browser"}</tool_call>',
    ],
  ])('%s → NON_ANSWER, not deliverable', (_id, answer) => {
    expect(hasToolCallMarkup(answer)).toBe(true);
    expect(answerQualityFailure(answer, none)).toBe('NON_ANSWER');
    expect(deliverableAnswer(answer)).toBeNull();
  });

  it('the sanitised BestBuy text (only an opener left) is still NON_ANSWER', () => {
    const cleaned = sanitizeFinalText(BESTBUY);
    expect(cleaned).toBe('我来帮你在 BestBuy 搜索 usb c cable。');
    expect(answerQualityFailure(cleaned, none)).toBe('NON_ANSWER');
  });

  it.each([
    [
      'function tag how-to',
      '在 XML 里可以这样写 function 标签：\n```xml\n<function>browser_use</function>\n<arguments>{"action": "navigate"}</arguments>\n```\n其中 `<function>` 写函数名，`<arguments>` 写 JSON 参数。',
    ],
    [
      'inline code',
      '工具调用一般写成 `<tool_call>{"name": "search"}</tool_call>`，模型输出后由程序解析执行，用户不会直接看到。',
    ],
    [
      'json example',
      '下面是一个 JSON 示例：\n```json\n{"action": "deploy", "env": "prod"}\n```\n其中 action 表示动作。',
    ],
    [
      'html form',
      '表单可以这样写：<form action="/login"><input name="user"></form>，提交后浏览器会发 POST 请求。',
    ],
    ['plain prose', 'Best Buy 上第一个结果是 Insignia 6ft USB-C to USB-C Cable，售价 $14.99。'],
    ['words only', 'function 和 arguments 是两个英文单词，分别是「函数」和「参数」的意思。'],
  ])('a real answer is untouched: %s', (_id, answer) => {
    expect(answerQualityFailure(answer, none)).toBeNull();
    expect(deliverableAnswer(answer)).toBe(answer);
    expect(sanitizeFinalText(answer)).toBe(answer);
  });

  it('a real answer with stray tool syntax is delivered without it', () => {
    const answer =
      '第一个结果是 Insignia USB-C 线，售价 $14.99。\n<li_call><function>browser_use</function><arguments>{"action":"screenshot"}</arguments></li_call>';
    expect(answerQualityFailure(answer, none)).toBeNull();
    expect(deliverableAnswer(answer)).toBe('第一个结果是 Insignia USB-C 线，售价 $14.99。');
    expect(stripToolCallMarkup(answer)).not.toMatch(/li_call|browser_use|"action"/);
  });

  it('a legacy result that was only tool syntax fails as ours (refunded)', () => {
    expect(
      platformFailureReason({
        status: 'failed',
        errorCode: TOOL_CALL_TEXT_ONLY.code,
        errorMessage: TOOL_CALL_TEXT_ONLY.reason,
      }),
    ).toBe('TOOL_CALL_TEXT_ONLY');
  });
});

const logger = { info() {}, warn() {}, debug() {}, error() {} } as never;
const route = async (intent: string) => (await explainExecutionMode({ intent, logger })).mode;

describe('FIX-33 #2 · a search on a named site goes to the site, never generate', () => {
  it.each([
    ['new-amazon-sg', '在亚马逊新加坡站搜 usb c cable，列出前三个的名称和价格'],
    ['new-bestbuy', '在 BestBuy 搜 usb c cable 告诉我第一个结果'],
    ['new-google', '打开 google.com 搜索 Claude 并总结第一条'],
    ['B 站 with a space', '在 B 站找一个 Python 入门视频'],
    ['regional store', '在 Shopee 马来西亚站搜 iphone case'],
    ['ebay', '在 eBay 上查 Nintendo Switch 价格'],
    ['music', '在 Spotify 搜周杰伦'],
    ['travel', '在 Booking 上找东京的酒店'],
    ['map', '在 Google Maps 查杭州东站到西湖怎么走'],
    ['video + 教程', '在 YouTube 搜 python 教程'],
    ['english', 'search best buy for usb c cable'],
    ['english on-site', 'on Amazon, search for a usb c hub and tell me the first price'],
  ])('%s → browser', async (_id, intent) => {
    expect(await route(intent)).toBe('browser');
  });
  it.each([
    ['QQ 音乐看', '在 QQ 音乐看热歌榜第一名'],
    ['Target 看看', '去 Target 看看有什么新品'],
  ])('reading a named site (%s) is fetched, then the browser', async (_id, intent) => {
    expect(await route(intent)).toBe('scrape');
  });
  it.each([
    '亚马逊雨林有多大',
    '写一篇在亚马逊上开店的经验',
    'Best Buy 的商业模式分析',
    '在亚马逊上搜索商品排名的算法是什么',
    '帮我写 3 条小红书露营文案',
    '在亚马逊上搜东西怎么按销量排序',
  ])('topics about a site stay generate: %s', async (intent) => {
    expect(await route(intent)).toBe('generate');
  });

  const amazonSg =
    '由于我无法实时联网抓取亚马逊新加坡站的动态数据，无法提供今天确切的实时排名和精确价格。但根据该站点的长期热销榜单，排名前列的通常是以下品牌及大致价格（新加坡元 SGD）：\n\n1. **Anker PowerLine+ USB-C to USB-C Cable**（约 SGD 15 - 22）\n2. **UGREEN 100W USB C to USB C Cable**（约 SGD 12 - 18）\n3. **Amazon Basics USB-C to USB-C Cable**（约 SGD 10 - 15）';
  it('new-amazon-sg: prices for a site search nobody read are UNREAD_LISTING (refunded)', () => {
    const intent = '在亚马逊新加坡站搜 usb c cable，列出前三个的名称和价格';
    expect(answerQualityFailure(amazonSg, { readSources: false, intent })).toBe('UNREAD_LISTING');
    expect(answerQualityFailure(amazonSg, { readSources: true, intent })).toBeNull();
    expect(
      platformFailureReason({
        status: 'failed',
        errorCode: 'CORE_EXECUTION_FAILED',
        errorMessage: CORE_QUALITY_FAILURE_COPY.UNREAD_LISTING,
      }),
    ).toBe('CORE_PLATFORM_FAILURE');
  });
  it('a price without a site search, or a site search without prices, is not', () => {
    expect(
      answerQualityFailure('iPhone 16 的起售价大约是 5999 元，具体价格请参考官网。', {
        readSources: false,
        intent: 'iPhone 16 多少钱',
      }),
    ).toBeNull();
    expect(
      answerQualityFailure('可以在亚马逊搜索框输入关键词，再按销量排序。', {
        readSources: false,
        intent: '在亚马逊上搜东西怎么按销量排序',
      }),
    ).toBeNull();
  });
});
