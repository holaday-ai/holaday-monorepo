import { hasToolCallMarkup, stripToolCallMarkup } from '@holaday/shared-types';
import { describe, expect, it } from 'vitest';
import { browserCompletionVerdict } from '../execution/execution-pipeline.js';
import { platformFailureReason } from '../quota/platform-failure-refunds.js';
import { passiveTelemetryRequest } from './browser-tools/cloud-observation.js';
import { CORE_QUALITY_FAILURE_COPY } from './core-task-settlement.js';
import {
  TOOL_CALL_TEXT_ONLY,
  answerQualityFailure,
  deliverableAnswer,
} from './generate-answer-guard.js';
import { explainExecutionMode } from './intent-classifier.js';
import { answerNotObtained, timeSensitiveIntent } from './scrape-runner.js';
import { planSearchFallback } from './search-fallback/search-engine-fallback.js';
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

describe('FIX-33 #5 · an answer that says it did not get it is not completed', () => {
  const qq =
    '根据QQ音乐热歌榜（2026-10-22）的数据，第1名的歌手是 **A2O LITE / A2O**，时长 03:28。\n\n但抓取到的页面内容中，第1名的歌曲名称缺失了，只显示了歌手信息。\n\n[QQ音乐热歌榜](https://y.qq.com/n/ryqq/toplist/26)';
  const google =
    '根据系统约束，我本次不执行浏览器操作，只能基于已抓取的材料回答。\n\n已抓取的内容是三个关于 Claude 的文档页面，不是 Google 搜索"Claude"的第一条结果。\n\n基于已抓取的三个来源，关于 Claude 的信息总结如下：…';
  it('new-qq: 「…页面内容中…缺失了」 is not obtained (browser retry)', () => {
    expect(answerNotObtained(qq, '在 QQ 音乐看热歌榜第一名')).toBe(true);
    expect(answerNotObtained('第1名是《晴天》，歌手周杰伦，但时长缺失。', '')).toBe(false);
  });
  it('new-qq rerun: 「歌曲名称：页面未显示…无法确认具体是哪首歌」 is not obtained', () => {
    const answer =
      'QQ音乐热歌榜（2026-10-23）第1名：\n\n- **歌手**：A2O LITE / A2O\n- **时长**：03:28\n- **歌曲名称**：页面未显示\n\n抓取到的热歌榜页面第1名位置只渲染出了歌手和时长，歌曲标题没有加载出来，所以无法确认具体是哪首歌。';
    expect(answerNotObtained(answer, '在 QQ 音乐看热歌榜第一名')).toBe(true);
    expect(answerNotObtained('第1名是《NEON》，歌手 A2O LITE / A2O。确认无误。', '')).toBe(false);
    const bare =
      'QQ音乐热歌榜（2026-10-23）第一名：\n\n- **歌手**：A2O LITE / A2O\n- **时长**：03:28\n- **歌曲名称**：页面未显示\n\n数据来源：[QQ音乐热歌榜](https://y.qq.com/n/ryqq/toplist/26)';
    expect(answerNotObtained(bare, '在 QQ 音乐看热歌榜第一名')).toBe(true);
    // A side field missing is not the answer missing.
    expect(
      answerNotObtained(
        '- 收盘：3690.48 点\n- 涨跌幅：+0.89%\n- 成交额：页面未显示',
        '上证指数现在多少点',
      ),
    ).toBe(false);
  });
  it('new-google: 「不执行浏览器操作…不是 Google 搜索的第一条」 is not obtained', () => {
    expect(answerNotObtained(google, '打开 google.com 搜索 Claude 并总结第一条')).toBe(true);
  });
  it.each([
    ['topic word', '维生素D缺失会导致骨质疏松，建议多晒太阳。', '维生素D缺失有什么症状'],
    ['side field', '上证指数收于 3658 点，涨 0.4%，成交额数据缺失。', '上证指数今天收盘多少'],
    ['plain answer', '热歌榜第 1 名是《晴天》，歌手周杰伦。', '在 QQ 音乐看热歌榜第一名'],
  ])('a real answer stays: %s', (_id, answer, intent) => {
    expect(answerNotObtained(answer, intent)).toBe(false);
  });
  it('charts are time-sensitive (fresh refetch); a plain lookup is not', () => {
    for (const intent of ['在 QQ 音乐看热歌榜第一名', '网易云飙升榜前三', '豆瓣电影排行榜'])
      expect(timeSensitiveIntent(intent)).toBe(true);
    expect(timeSensitiveIntent('RFC 9110 的标题是什么')).toBe(false);
  });
});

describe('FIX-33 #5 · 「打开 google.com 搜索 X 并总结第一条」 searches for X', () => {
  const wall = { url: 'https://www.google.com/sorry/index?continue=x', captcha: true };
  it.each([
    ['打开 google.com 搜索 Claude 并总结第一条', 'Claude'],
    ['Google 搜索 合并PDF 工具并告诉我第一个结果', '合并PDF 工具'],
    ['去 Google 搜索 openai sora 然后打开第一条', 'openai sora'],
    ['search Claude and summarize the first result on google.com', 'Claude'],
    ['Google 搜索 新加坡 天气 返回前5条', '新加坡 天气'],
  ])('%s → %s', (intent, query) => {
    expect(planSearchFallback(intent, wall)?.query).toBe(query);
  });
});

describe('FIX-33 #5 · a browser answer short of the rows asked for is partial', () => {
  const verification = (criterionType: string, detail: string) =>
    ({
      taskId: 't',
      passed: false,
      tier: 'deterministic',
      failureLevel: 'needs_clarification',
      checks: [
        { criterionId: 'c1', criterionType, passed: false, checker: 'deterministic', detail },
      ],
    }) as never;
  const answer = '1. BELKIN … S$8.90\n2. UGREEN … S$17.29\n3. UGREEN … 价格：未获取到';
  it('new-amazon-sg: 「可核验商品只有 2 条，要求至少 3 条」 → partial_success with the note', () => {
    const verdict = browserCompletionVerdict({
      runnerStatus: 'completed',
      verification: verification(
        'ecommerce_rows',
        '第 3 行缺少价格；可核验商品只有 2 条，要求至少 3 条名称/价格完整的结果',
      ),
      verifiedText: answer,
      originalText: answer,
    });
    expect(verdict.status).toBe('partial_success');
    expect(verdict.text).toContain('核验提示：第 3 行缺少价格');
  });
  it('a missing source link alone still only annotates', () => {
    expect(
      browserCompletionVerdict({
        runnerStatus: 'completed',
        verification: verification('url_count', 'only 0 URL(s) found'),
        verifiedText: answer,
        originalText: answer,
      }).status,
    ).toBe('completed');
  });
});

describe('FIX-33 · Amazon regional stores report search metrics, not writes', () => {
  it.each([
    'https://unagi.amazon.sg/1/events/com.amazon.eel.SearchAutocompleteUIServiceMetrics.nexus',
    'https://unagi.amazon.co.jp/1/events/com.amazon.csm.csa.prod',
    'https://unagi-eu.amazon.de/1/events/com.amazon.csm.csa.prod',
  ])('%s is telemetry', (url) => {
    expect(passiveTelemetryRequest(new URL(url), 'fetch')).toBe(true);
  });
  it.each([
    'https://www.amazon.sg/cart/add-to-cart',
    'https://unagi.amazon.evil.com/1/events/x',
    'https://unagi.amazon.sg/cart/add',
  ])('%s is not', (url) => {
    expect(passiveTelemetryRequest(new URL(url), 'fetch')).toBe(false);
  });
});
