import { describe, expect, it } from 'vitest';
import { type BrowserTrace, completionGap } from './browser-completion.js';

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
