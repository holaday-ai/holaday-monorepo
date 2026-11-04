import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { listPartialNote, reviewListAnswer } from '../../execution/answer-verifier.js';
import type { ExecutionContract } from '../../execution/execution-contract.js';
import { type BrowserTrace, completionGap } from './browser-completion.js';
import { assessCompletionFacts } from './completion-fields.js';

/** FIX-54: the Deploy-54 rollback items and the FIX-53 leftovers, with the online text as fixtures. */

describe('FIX-54 #1 · core-07: only the tabs still open at delivery are checked for duplicates', () => {
  // Deploy-54 online core-07 (tsk_HgbN4thfUbMxpESXWYpKu): the tab ids are the online ones.
  const INTENT = '请使用云端浏览器，从一个页面打开3个链接到新标签，分别读标题后回到第一个';
  const W = 'https://en.wikipedia.org/wiki/';
  const START = 'tab_73a85896-684d-4bd0-948a-84175225817d';
  const SAFARI = 'tab_a815f948-915e-46d6-a7ac-23a77309d3ce';
  const CHROME = 'tab_faf7524a-23dd-4e53-b2f8-b8084871af21';
  const SAFARI2 = 'tab_a57ff78d-b987-4b68-a3e9-46172e9d1300';
  const EDGE = 'tab_394f0c9c-55a8-4967-a169-4213e50cdce3';
  const open = (tabId: string, page: string): BrowserTrace => ({
    tool: 'click',
    ok: true,
    openedTab: true,
    tabId,
    url: `${W}${page}`,
    fromTabId: START,
  });
  const sw = (tabId: string): BrowserTrace => ({ tool: 'switch_tab', ok: true, tabId });
  const first: BrowserTrace[] = [
    { tool: 'navigate', ok: true, tabId: START, url: `${W}Web_browser` },
    { tool: 'snapshot', ok: true, tabId: START, url: `${W}Web_browser` },
    open(SAFARI, 'Safari_(web_browser)'),
    sw(START),
    open(CHROME, 'Google_Chrome'),
    sw(START),
    open(SAFARI2, 'Safari_(web_browser)'),
    sw(SAFARI),
  ];
  const ANSWER_1 =
    '已从维基百科「Web browser」页面打开3个链接到新标签，分别读取标题后回到第一个新标签。\n\n1. Safari (web browser) - Wikipedia（tab_a815f948-915e-46d6-a7ac-23a77309d3ce）\n2. Google Chrome - Wikipedia（tab_faf7524a-23dd-4e53-b2f8-b8084871af21）\n3. Safari (web browser) - Wikipedia（tab_a57ff78d-b987-4b68-a3e9-46172e9d1300）\n\n当前已切回第一个新打开的标签 tab_a815f948-915e-46d6-a7ac-23a77309d3ce，标题为「Safari (web browser) - Wikipedia」。起始页 tab_73a85896-684d-4bd0-948a-84175225817d 仍保持为「Web browser - Wikipedia」未跳转。';
  const ANSWER_2 =
    '已从维基百科「Web browser」页面打开3个指向不同页面的链接到新标签，分别读取标题后回到第一个新标签。\n\n1. Safari (web browser) - Wikipedia（tab_a815f948-915e-46d6-a7ac-23a77309d3ce）\n2. Google Chrome - Wikipedia（tab_faf7524a-23dd-4e53-b2f8-b8084871af21）\n3. Microsoft Edge - Wikipedia（tab_394f0c9c-55a8-4967-a169-4213e50cdce3）\n\n当前已切回第一个新打开的标签 tab_a815f948-915e-46d6-a7ac-23a77309d3ce，标题为「Safari (web browser) - Wikipedia」。起始页 tab_73a85896-684d-4bd0-948a-84175225817d 保持为「Web browser - Wikipedia」未跳转。原先重复的 Safari 标签已关闭，确保3个新标签分别指向不同页面。';
  const DUP = /打开的链接里有同一页面/;

  it('the first delivery, with Safari open twice, is still sent back', () => {
    const gap = completionGap(INTENT, ANSWER_1, first, true);
    expect(gap).toMatch(DUP);
    expect(gap).toContain(`回到起始标签 ${START}`);
  });

  const second = (last: string): BrowserTrace[] => [
    ...first,
    sw(SAFARI2),
    // The close_tab receipt names the tab left active; closedTabId the one closed.
    { tool: 'close_tab', ok: true, tabId: START, closedTabId: SAFARI2, url: `${W}Web_browser` },
    open(EDGE, 'Microsoft_Edge'),
    sw(last),
  ];

  it('after closing the duplicate and opening Edge, the duplicate check passes', () => {
    // As online, the model then ended on the first new tab, not the start tab: FIX-24's
    // 「回到第一个 = 起始标签」 still sends that back, for its own reason.
    expect(completionGap(INTENT, ANSWER_2, second(SAFARI), true)).toMatch(
      /^switch_tab 回执未证明切回原标签：起始标签是 tab_73a85896/,
    );
  });

  it('the same tabs, ended on the start tab, are complete', () => {
    const answer = ANSWER_2.replace(
      '当前已切回第一个新打开的标签 tab_a815f948-915e-46d6-a7ac-23a77309d3ce，标题为「Safari (web browser) - Wikipedia」。',
      '当前已切回起始标签 tab_73a85896-684d-4bd0-948a-84175225817d。',
    );
    expect(completionGap(INTENT, answer, second(START), true)).toBeNull();
  });

  it('two tabs still open on the same page at delivery are sent back', () => {
    const notClosed: BrowserTrace[] = [...first, open(EDGE, 'Microsoft_Edge'), sw(SAFARI)];
    expect(completionGap(INTENT, ANSWER_2, notClosed, true)).toMatch(DUP);
  });

  it('closing a different tab does not clear the duplicate', () => {
    const wrongClose: BrowserTrace[] = [
      ...first,
      { tool: 'close_tab', ok: true, tabId: START, closedTabId: CHROME },
      open(EDGE, 'Microsoft_Edge'),
      sw(SAFARI),
    ];
    expect(completionGap(INTENT, ANSWER_2, wrongClose, true)).toMatch(DUP);
  });

  it('a failed close_tab does not count', () => {
    const failed: BrowserTrace[] = [
      ...first,
      { tool: 'close_tab', ok: false, closedTabId: SAFARI2 },
      open(EDGE, 'Microsoft_Edge'),
      sw(SAFARI),
    ];
    expect(completionGap(INTENT, ANSWER_2, failed, true)).toMatch(DUP);
  });
});

describe('FIX-54 #3 · amazon 「See options」: the offers price the card lists is a price', () => {
  // amazon.sg 「usb c cable」 as get_page_text read it (local, 2026-11-04; trimmed). The Belkin
  // USB-C 2M card is the one Deploy-54 reg-new-amazon-sg had third: 「See options / No featured
  // offers available / S$9.22(2 new offers)」, the same offer as online.
  const PAGE = readFileSync(new URL('./fixtures/amazon-sg-see-options.txt', import.meta.url), 'utf8');
  const BELKIN =
    'Belkin USB-C to USB-C Cable (2M, 60W) - Soft, Flexible Fast-Charging Cable, Type C Charger Cord for iPhone 16 & 15 Series, Galaxy S25, MacBook, iPad, & More - White (USB 2.0)';
  const UGREEN =
    'UGREEN 2 Pack USB C to USB C Charger Cable, Type C 100W PD Fast Charging Cord Compatible with iPhone 15 Pro Max, MacBook Pro, iPad Pro, Dell, Matebook, Chromebook, Pixel, Samsung S23 S22, Switch';
  const answer = (third: string) =>
    `在亚马逊新加坡站搜索 "usb c cable"，通过 get_page_text 读取搜索结果页正文，前三个商品的名称和价格如下（照页面原样）：\n\n1. 名称：${UGREEN}, 1M\n   价格：S$10.92\n\n2. 名称：${UGREEN}, 2M\n   价格：S$12.45\n\n3. 名称：${BELKIN}\n   价格：${third}`;
  // Deploy-54 online: the second finish (sent back as 「不是已读页面中的原文」) and the one
  // delivered as 部分完成.
  const QUOTED = answer(
    'S$9.22（页面显示为 "No featured offers available / S$9.22(2 new offers)"，取该商品可见的价格文本 S$9.22）',
  );
  const UNREAD = answer(
    '未读到（已截图查看第三个商品所在区域，截图中该商品仅显示标题、评分和 "See options"，价格位置无可见文字；读取正文 两段文本中也未包含该商品价格。按规则写「未读到」）',
  );
  const pages = [{ text: PAGE, sourceURL: 'https://www.amazon.sg/s?k=usb+c+cable' }];
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

  it('two adjacent lines quoted joined by 「 / 」 are the page\'s own text', () => {
    const facts = assessCompletionFacts({ summary: QUOTED, pages, intent: '列出前三个的名称和价格' });
    expect(facts.contradictions.join()).not.toContain('不是已读页面中的原文');
    expect(facts.contradictions).toEqual([]);
  });

  it('…but not lines that are apart on the page, nor a part the page does not have', () => {
    const apart = answer('S$9.22（页面显示为 "No featured offers available / S$19.21"）');
    const made = answer('S$9.22（页面显示为 "No featured offers available / S$8.88(3 new offers)"）');
    for (const summary of [apart, made])
      expect(
        assessCompletionFacts({ summary, pages, intent: '列出前三个的名称和价格' }).contradictions.join(),
      ).toContain('不是已读页面中的原文');
  });

  it('「未读到」 for that row is not an honest 部分完成: the page lists its offers price', () => {
    expect(listPartialNote(contract, UNREAD, PAGE)).toBeNull();
    expect(reviewListAnswer(contract, UNREAD, PAGE)).toBe(
      '第 3 行缺少价格（页面在该商品下列出报价「S$9.22(2 new offers)」：照原样写并注明是报价，或打开该商品详情页读价格）',
    );
    // Written as the offers price, the row is complete.
    expect(reviewListAnswer(contract, QUOTED, PAGE)).toBeNull();
  });

  it('a 「See options」 card with no offers line is still an honest 部分完成 (FIX-32 kept)', () => {
    const bare = PAGE.replace('S$9.22(2 new offers)\n', '');
    expect(reviewListAnswer(contract, UNREAD, bare)).toBeNull();
    expect(listPartialNote(contract, UNREAD, bare)).toBe(
      '部分完成：第 3 条页面未显示价格（答案已如实说明）',
    );
  });
});
