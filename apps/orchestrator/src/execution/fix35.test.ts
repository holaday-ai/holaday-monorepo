import { readFileSync } from 'node:fs';
import {
  MODEL_TOOL_NAMES,
  OBSERVATION_TOOL_NAMES,
  UNIFIED_BROWSER_TOOL_NAMES,
  stripToolCallMarkup,
} from '@holaday/shared-types';
import { describe, expect, it } from 'vitest';
import {
  amazonVerificationUrl,
  verificationPost,
} from '../agent/browser-tools/cloud-observation.js';
import { deliverableAnswer } from '../agent/generate-answer-guard.js';
import { answerNotObtained } from '../agent/scrape-runner.js';
import { friendlyTaskFailureReason } from '../agent/task-failure-copy.js';
import { declaredMissingPriceRows, listPartialNote } from './answer-verifier.js';
import type { ExecutionContract } from './execution-contract.js';
import { browserCompletionVerdict } from './execution-pipeline.js';

/**
 * FIX-35 0a (Deploy-35 b-p02, tsk_ZGVLqFApMegLHbj2tTHpc): item 1 showed only 「See options」
 * and the answer said so honestly; FIX-34 5d35eb89 looked past it to the snapshot's cut
 * marker (items 2–3 and their prices lie between) and sent the honest answer back.
 *
 * The page: a real amazon.com results page read locally (2026-10-24, the same search),
 * item 1's price lines replaced by the 「See options」 link production recorded (ref=e289;
 * production reads amazon.com from Singapore), cut after item 3 as production's was.
 */
const PAGE = readFileSync(
  new URL('./fixtures/amazon-com-see-options.txt', import.meta.url),
  'utf8',
);
// Row 1 verbatim from the production answer that was sent back.
const ANSWER = `已在 amazon.com 搜索 "usb c cable"，读取搜索结果页前3个商品信息如下（价格按页面原样）：

1. Anker USB C to USB C Cable, 60W Fast Charging Cable (2-Pack, 6 ft, Black) — 未获取到（该商品在结果卡片中仅显示“See options”，未直接列出价格）
2. Anker USB C to USB C Cable, 60W Fast Charging Cable (2-Pack, 3.3 ft, Black) — $9.99
3. USB C Cable, LED Light up USB A to C 6A Fast Charging Cord Multicolor 3FT — $9.99`;
const contract = {
  successCriteria: [
    {
      id: 'c1',
      type: 'ecommerce_rows',
      description: '',
      data: { minItems: 3, minUniqueUrls: 0, requireLinks: false },
    },
  ],
} as unknown as ExecutionContract;

describe('FIX-35 0a · an item card showing only 「See options」 is an honest gap', () => {
  it('the row’s own state is read before the snapshot’s cut marker → 部分完成', () => {
    expect(declaredMissingPriceRows(ANSWER, PAGE)).toEqual([1]);
    expect(listPartialNote(contract, ANSWER, PAGE)).toMatch(/^部分完成：第 1 条/);
  });
  it('item 1 showing its price: 「未获取到」 is still sent back', () => {
    const priced = PAGE.replace('See options', 'Price, product page\n$9.99');
    expect(declaredMissingPriceRows(ANSWER, priced)).toEqual([]);
  });
  it('复审 #1: row 2 shares row 1’s title prefix and shows $9.99 — its 「未获取到」 is sent back', () => {
    const row2 = ANSWER.replace(
      '— 未获取到（该商品在结果卡片中仅显示“See options”，未直接列出价格）',
      '— $9.99',
    ).replace('(2-Pack, 3.3 ft, Black) — $9.99', '(2-Pack, 3.3 ft, Black) — 未获取到');
    expect(declaredMissingPriceRows(row2, PAGE)).toEqual([]);
    expect(listPartialNote(contract, row2, PAGE)).toBeNull();
  });
  it('复审 #1: a title shortened with 「…」 still matches its own card', () => {
    const short = ANSWER.replace(
      'Anker USB C to USB C Cable, 60W Fast Charging Cable (2-Pack, 6 ft, Black) —',
      'Anker USB C to USB C Cable, 60W Fast Charging Cable (2-Pack, 6 ft… —',
    );
    expect(declaredMissingPriceRows(short, PAGE)).toEqual([1]);
  });
  it('复审 #1: the title shown again elsewhere with a price → not exempt', () => {
    const again = `${PAGE}\nAnker USB C to USB C Cable, 60W Fast Charging Cable (2-Pack, 6 ft, Black)\n$8.49`;
    expect(declaredMissingPriceRows(ANSWER, again)).toEqual([]);
  });
  it('no 「See options」 and no cut after the item: still sent back', () => {
    const noState = PAGE.replace('See options', '').replace('[快照截断：以下内容未读到]', '');
    expect(declaredMissingPriceRows(ANSWER, noState)).toEqual([]);
  });
});

describe('FIX-35 0a · a post to the site’s own verification page is a wall, handed over', () => {
  it.each([
    'https://www.amazon.com/checkpoint/validate',
    'https://www.amazon.sg/errors/validateCaptcha?amzn=1',
    'https://example.org/captcha/verify',
    'https://www.amazon.cn/ap/cvf/verify',
  ])('%s', (url) => {
    expect(verificationPost(url)).toBe(true);
  });
  it.each([
    ['https://www.amazon.cn/checkpoint/validate', true],
    ['https://www.amazon.com/ap/cvf/approval', true],
    ['https://www.amazon.co.uk/errors/validateCaptcha', true],
    // 复审 #1: a generic path is not amazon's step — a link / GET there is an ordinary page.
    ['https://github.com/topics/challenge', false],
    ['https://example.org/captcha/verify', false],
    ['https://www.amazon.com/s?k=captcha', false],
  ] as const)('amazon host-anchored %s → %s', (url, hit) => {
    expect(amazonVerificationUrl(url)).toBe(hit);
  });
  it.each([
    'https://www.amazon.com/cart/add-to-cart/ref=1',
    'https://www.amazon.com/gp/buy/spc/handlers/display.html',
    'https://www.amazon.com.evil.example/checkpoint/validate',
    'https://www.bestbuy.com/checkpoint-deals',
  ])('%s is not', (url) => {
    expect(verificationPost(url)).toBe(false);
  });
});

describe('FIX-35 #1 · plain JSON in prose is not a tool call', () => {
  it.each([
    '用户数据示例：{"name":"Alice","args":["--verbose"]}，其中 args 是命令行参数。',
    '返回体形如 {"name": "Bob", "input": "hello"}，name 是用户名。',
    // A word that is also a tool name, with no call arguments: data (PR #298 review).
    'Event data: {"name":"click","timestamp":12345}.',
    '埋点：{"name":"browser","version":"118"}，{"name":"finish","at":3}。',
    '{"name":"clickstream","input":1} 是一条埋点。',
  ])('%s stays', (text) => {
    expect(stripToolCallMarkup(text)).toBe(text);
    expect(deliverableAnswer(text)).toBe(text);
  });
  it.each([
    '第一条结果售价 $14.99。\n{"name":"browser_use","input":{"action":"navigate"}}',
    '第一条结果售价 $14.99。\n{"name":"web_search","query":"x"}',
    '第一条结果售价 $14.99。\n{"name":"search","arguments":{"q":"x"}}',
    '第一条结果售价 $14.99。\n{"name":"navigate","input":{"url":"https://x.com"}}',
    '第一条结果售价 $14.99。\n{"name":"click","args":{"ref":"e12"}}',
    '第一条结果售价 $14.99。\n{"name":"read_page"}',
    // 复审 #1 阻塞 1: real calls of the offered tools, each one.
    '第一条结果售价 $14.99。\n{"name":"scroll","input":{"direction":"down"}}',
    '第一条结果售价 $14.99。\n{"name":"type","input":{"ref":"e3","text":"usb"}}',
    '第一条结果售价 $14.99。\n{"name":"switch_tab","input":{"tabId":"t1"}}',
    '第一条结果售价 $14.99。\n{"name":"request_human","input":{"reason":"captcha"}}',
    '第一条结果售价 $14.99。\n{"name":"extract","input":{"query":"价格"}}',
    '第一条结果售价 $14.99。\n{"name":"click_at","input":{"x":10,"y":20}}',
    '第一条结果售价 $14.99。\n{"name":"links","args":{}}',
    '第一条结果售价 $14.99。\n{"name":"request_human"}',
  ])('%s is still removed', (text) => {
    expect(deliverableAnswer(text)).toBe('第一条结果售价 $14.99。');
  });
  it.each(MODEL_TOOL_NAMES)('a %s call with an input object is removed', (name) => {
    const text = `第一条结果售价 $14.99。\n{"name":"${name}","input":{"a":1}}`;
    expect(deliverableAnswer(text)).toBe('第一条结果售价 $14.99。');
    expect(stripToolCallMarkup(text)).toBe('第一条结果售价 $14.99。');
  });
  it('the markup filter knows every tool the model is offered', () => {
    expect(MODEL_TOOL_NAMES).toEqual(
      expect.arrayContaining([
        ...UNIFIED_BROWSER_TOOL_NAMES,
        ...OBSERVATION_TOOL_NAMES,
        'request_human',
        'finish',
        'web_search',
      ]),
    );
  });
});

describe('FIX-35 复审 #1 · 同时修: r06 / internal notes / failure refs', () => {
  it.each([
    // BENCH r06, verbatim opening.
    '提供的 [RFC Editor](https://rfc-editor.org) 抓取内容中只包含首页信息和最新发布的几篇 RFC（如 RFC 10054、10055、10065），没有包含 RFC 9110 的标题和发布时间。',
    '抓到的页面里并未包含该商品的价格。',
  ])('「没有包含」 the asked value is 没拿到: %s', (answer) => {
    expect(answerNotObtained(answer, 'RFC 9110 的标题和发布时间')).toBe(true);
  });
  it.each([
    'RFC 9110 的标题是 HTTP Semantics，2022 年 6 月发布；它没有包含 HTTP/2 的帧格式。',
    'Node.js v24.22.1 的更新没有包含破坏性变更。',
  ])('an answer saying what a thing does not include is an answer: %s', (answer) => {
    expect(answerNotObtained(answer, 'RFC 9110 的标题')).toBe(false);
  });

  const verification = (detail: string) =>
    ({
      taskId: 't',
      passed: false,
      tier: 'deterministic',
      failureLevel: 'needs_clarification',
      checks: [
        {
          criterionId: 'c1',
          criterionType: 'url_count',
          passed: false,
          checker: 'deterministic',
          detail,
        },
      ],
    }) as never;
  const answer = 'BBC News 首页当前头条标题为 Paris police seize gas masks。';
  it('an English internal check detail is kept for operators, not shown to the user', () => {
    const verdict = browserCompletionVerdict({
      runnerStatus: 'completed',
      verification: verification('only 0 URL(s) found (global scan), need at least 1'),
      verifiedText: answer,
      originalText: answer,
    });
    expect(verdict.text).toBe(answer);
    expect(verdict.notes).toEqual(['only 0 URL(s) found (global scan), need at least 1']);
  });
  it('a note written for the user is still shown', () => {
    const verdict = browserCompletionVerdict({
      runnerStatus: 'completed',
      verification: verification('第 2 条缺少独立来源链接（不能用首页或搜索页）'),
      verifiedText: answer,
      originalText: answer,
    });
    expect(verdict.text).toContain('核验提示：第 2 条缺少独立来源链接');
  });

  it('BENCH d03: the failure copy carries no ref=eNN', () => {
    const raw =
      '部分完成：已成功打开指定上传页面 https://the-internet.herokuapp.com/upload 并定位到 "Choose File" 按钮（ref=e11）和 "Upload" 按钮（ref=e12）。';
    const copy = friendlyTaskFailureReason('failed', raw, 'task');
    expect(copy).not.toMatch(/ref=e\d/);
    expect(copy).toContain('"Choose File" 按钮和 "Upload" 按钮');
    expect(copy).toContain('https://the-internet.herokuapp.com/upload');
  });
});
