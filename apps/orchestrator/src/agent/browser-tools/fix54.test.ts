import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  listPartialNote,
  reviewListAnswer,
  rowOfferPrice,
} from '../../execution/answer-verifier.js';
import type { ExecutionContract } from '../../execution/execution-contract.js';
import type { MessagesAdapter } from '../../llm/messages-adapter.js';
import { type BrowserTrace, completionGap } from './browser-completion.js';
import { anchoredLogPost, keyedLogCheck, valueShape } from './cloud-observation.js';
import { iframeContentGap } from './completion-coverage.js';
import { assessCompletionFacts } from './completion-fields.js';
import { runUnifiedBrowserLoop, userClearClaims } from './unified-browser-loop.js';

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
  const PAGE = readFileSync(
    new URL('./fixtures/amazon-sg-see-options.txt', import.meta.url),
    'utf8',
  );
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

  it("two adjacent lines quoted joined by 「 / 」 are the page's own text", () => {
    const facts = assessCompletionFacts({
      summary: QUOTED,
      pages,
      intent: '列出前三个的名称和价格',
    });
    expect(facts.contradictions.join()).not.toContain('不是已读页面中的原文');
    expect(facts.contradictions).toEqual([]);
  });

  it('…but not lines that are apart on the page, nor a part the page does not have', () => {
    const apart = answer('S$9.22（页面显示为 "No featured offers available / S$19.21"）');
    const made = answer(
      'S$9.22（页面显示为 "No featured offers available / S$8.88(3 new offers)"）',
    );
    for (const summary of [apart, made])
      expect(
        assessCompletionFacts({
          summary,
          pages,
          intent: '列出前三个的名称和价格',
        }).contradictions.join(),
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

  // DEPLOY-55 第 0 步 (复审 #1, 红线): an offers line under the NEXT card is not this card's.
  it.each([
    [
      'the next title, then its rating, then its offers',
      'INIU 240W USB-C Cable 2m 2-Pack\n4.7\n4.7 out of 5 stars\n (1.2K)\nS$9.22(2 new offers)\n',
    ],
    ['the next title right before the offers', 'INIU 240W USB-C Cable 2m\nS$9.22(2 new offers)\n'],
    ['a rating block before the offers', '4.7 out of 5 stars\nS$9.22(2 new offers)\n'],
    ['a price block before the offers', 'Price, product page\nS$6.62\nS$9.22(2 new offers)\n'],
  ])("an offers line past the card's end is not its price: %s", (_label, next) => {
    const page = PAGE.replace('S$9.22(2 new offers)\n', next);
    expect(page).not.toBe(PAGE);
    expect(rowOfferPrice(BELKIN, page)).toBeNull();
    // Still the honest 部分完成 of FIX-32, and the retreat names no offer to copy.
    expect(reviewListAnswer(contract, UNREAD, page)).toBeNull();
    expect(listPartialNote(contract, UNREAD, page)).toBe(
      '部分完成：第 3 条页面未显示价格（答案已如实说明）',
    );
  });

  it("the card's own offers line, right under its state, is still found (CC's real page)", () => {
    expect(rowOfferPrice(BELKIN, PAGE)).toBe('S$9.22(2 new offers)');
    // Between the state lines and the offers only the card's own state words may lie.
    const spaced = PAGE.replace(
      'See options\nNo featured offers available\nS$9.22',
      'See options\n\nNo featured offers available\n  S$9.22',
    );
    expect(rowOfferPrice(BELKIN, spaced)).toBe('S$9.22(2 new offers)');
  });

  it('a 「See options」 card with no offers line is still an honest 部分完成 (FIX-32 kept)', () => {
    const bare = PAGE.replace('S$9.22(2 new offers)\n', '');
    expect(reviewListAnswer(contract, UNREAD, bare)).toBeNull();
    expect(listPartialNote(contract, UNREAD, bare)).toBe(
      '部分完成：第 3 条页面未显示价格（答案已如实说明）',
    );
  });
});

describe('FIX-54 #4 · 高德 collapsar: mode stays the online set; evidence is shapes', () => {
  const AMAP = new URL('https://collapsar.amap.com/alc/h5/upload');
  // The Deploy-54 online body's keys (b-m01, 3415 B, `check:mode=len19`); the values are
  // made-up device values of the same kinds — the evidence keeps no values.
  const body = (mode: string) =>
    new URLSearchParams({
      adiu: 'a1b2c3d4e5f6a7b8c9d0',
      buildVersion: '20261101',
      channel: 'amap_h5',
      content: 'H4sIAAAAAAAAA'.padEnd(2400, 'Zx9Qv7Lm2Np4Rt6'),
      diu: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6',
      env: 'production',
      h5Version: '1.0.0',
      idfa: '',
      imei: '',
      md5: '9e107d9d372bb6826bd81d3542a419d6',
      miniProgramVersion: '',
      mode,
    }).toString();

  // DEPLOY-55 第 0 步 (复审 #1, 协调方决定): no shape-based allowance — the set stays the online
  // one (web|h5|wap|pc|a digit). The review's values (`fix-54/review1-fixtures/amode.mjs`) and the
  // identifiers FIX-54 had let through all pause.
  it.each([
    'user.email.xxx',
    'user.email.a1',
    'user.name.zhang',
    'user.addr.beijing',
    'user.mail',
    'account.id',
    'idCard.no',
    'wx.openid',
    'tel.13800138000',
    'loc.39_9.116_4',
    'addToCart',
    'route.save',
    'navi.start',
    'fav.add',
    'routePlanH5',
    'amapWebSdkV2',
    'amapH5WebSdkLogger',
    'ai_pc_search_result',
    'web.search.result',
    'pc-poi-detail-v2',
  ])('a mode outside the online set pauses, with only its shape as evidence: %s', (mode) => {
    const why = keyedLogCheck(AMAP, body(mode));
    expect(why).toBe(`mode=${valueShape(mode)}`);
    expect(why).toMatch(/^mode=len\d+:[aA0._-]*$/);
    // No part of the value is in the evidence.
    for (const part of mode.split(/[._-]/).filter((p) => p.length >= 2))
      expect(why?.slice('mode='.length)).not.toContain(part);
    expect(anchoredLogPost(AMAP, 'POST', body(mode))).toBe(false);
  });

  it.each(['web', 'h5', 'WAP', 'pc', '2'])('the online set still passes: %s', (mode) => {
    expect(keyedLogCheck(AMAP, body(mode))).toBeNull();
    expect(anchoredLogPost(AMAP, 'POST', body(mode))).toBe(true);
  });

  it('the shape keeps the length and the kinds of character, never the value', () => {
    expect(valueShape('aiPc_search')).toBe('len11:aA_');
    expect(valueShape('13800138000')).toBe('len11:0');
    expect(valueShape('张三 x')).toBe('len4:a汉␣');
    expect(valueShape('')).toBe('len0:');
  });
});

describe('FIX-54 #6 · 「用户完成验证」: the other ways of saying it', () => {
  it.each([
    '验证码已被用户解决，随后继续搜索。',
    '人机验证由人工完成后，页面恢复正常。',
    '滑块验证已由真人手动完成。',
    '已等待用户完成验证，随后重新读取了页面。',
    '用户已经解决了验证码，我继续查询路线。',
    'After the user completed the CAPTCHA, the results loaded.',
    'The verification was completed by the user.',
    'The user resolved the security check and I continued.',
    'You solved the captcha, so the page opened.',
  ])('is caught: %s', (sentence) => {
    expect(userClearClaims(`路线如下。\n${sentence}`)).toEqual([sentence]);
  });

  it.each([
    '需要用户完成验证后才能继续。',
    '等待用户完成验证码已超时，任务未完成。',
    '正在等待用户完成验证。',
    '在等待用户完成验证后，再继续查询。',
    '请您完成验证后回复我。',
    '验证页已经不在了，但不是用户完成的。',
    '验证页自行消失，并非由人工完成。',
    '如需用户解决验证码，请在面板里操作。',
    'If the user completes the CAPTCHA, I can continue.',
    'Waiting for the user to complete the verification.',
    'The challenge went away; it was not solved by the user.',
    '用户已解决的问题：路线查询。',
  ])('is not a claim: %s', (sentence) => {
    expect(userClearClaims(sentence)).toEqual([]);
  });
});

describe('FIX-54 #7 · a turn cut off at the output cap is never acted on', () => {
  // FIX-53 local b-m01 w / w2: the route page was read, the finish turn hit 4096 output tokens,
  // and the cut-off finish ended the task as 「任务未完成」.
  type Turn = { name: string; input: Record<string, unknown>; stop?: 'max_tokens' };
  const scripted = (turns: Turn[]) => {
    let n = 0;
    const requests: Array<{ maxTokens: number; tools: string[]; last: string }> = [];
    const adapter: MessagesAdapter = {
      metadata: { provider: 'anthropic', model: 'fixture' },
      async create(request) {
        requests.push({
          maxTokens: request.maxTokens,
          tools: (request.tools ?? []).map((t) => t.name),
          last: JSON.stringify(request.messages.at(-1)),
        });
        const turn = turns[Math.min(n++, turns.length - 1)]!;
        return {
          id: String(n),
          metadata: { provider: 'anthropic', model: 'fixture' },
          content: [{ type: 'tool_use', id: String(n), name: turn.name, input: turn.input }],
          stopReason: turn.stop ?? 'tool_use',
          usage: {
            inputTokens: 1,
            outputTokens: turn.stop ? 4096 : 1,
            cacheReadInputTokens: null,
            cacheCreationInputTokens: null,
            complete: true,
          },
        };
      },
    };
    return { adapter, requests };
  };
  const ROUTE = '方案1 约32分钟 9.8公里';
  const run = (turns: Turn[]) => {
    const { adapter, requests } = scripted(turns);
    const executed: string[] = [];
    return runUnifiedBrowserLoop({
      intent: '高德地图查一下杭州东站到西湖断桥怎么走，大概多久',
      adapter,
      maxSteps: 8,
      execute: async (action) => {
        executed.push(action.tool);
        return {
          ok: true,
          text: `heading "路线" [level=1]\n- text: ${ROUTE}`,
          url: 'https://ditu.amap.com/dir',
        };
      },
    }).then((outcome) => ({ outcome, requests, executed }));
  };
  const nav = { name: 'navigate', input: { url: 'https://ditu.amap.com/dir' } };
  const snap = { name: 'snapshot', input: {} };
  // As the provider hands back a cut-off finish: no status, the answer stops mid-way.
  const cut: Turn = {
    name: 'finish',
    input: { summary: '路线：方案1 约32分钟 9.8公里。详细步骤：1. 从杭州东站' },
    stop: 'max_tokens',
  };
  const done = {
    name: 'finish',
    input: { status: 'completed', summary: `杭州东站到西湖断桥：${ROUTE}。` },
  };

  it('retries once with finish only and more room, and delivers the full answer', async () => {
    const { outcome, requests } = await run([nav, snap, cut, done]);
    expect(outcome).toMatchObject({ status: 'completed' });
    expect((outcome as { summary?: string }).summary).toContain(ROUTE);
    expect(requests[2]!.maxTokens).toBe(4096);
    expect(requests[3]).toMatchObject({ maxTokens: 8192, tools: ['finish'] });
    expect(requests[3]!.last).toContain('超过长度上限被截断');
  });

  it('a cut-off action call is not run either', async () => {
    const cutClick: Turn = { name: 'click', input: { ref: 'e1' }, stop: 'max_tokens' };
    const { executed } = await run([nav, snap, cutClick, done]);
    expect(executed).toEqual(['navigate', 'snapshot']);
  });

  it('cut off twice: fails honestly, and the cut-off answer is not delivered as completed', async () => {
    const cutDone: Turn = { ...done, stop: 'max_tokens' };
    const { outcome } = await run([nav, snap, cutDone, cutDone]);
    expect(outcome).toMatchObject({
      status: 'failed',
      reason: '模型输出过长被截断，未能给出完整答案，任务未完成。',
    });
  });
});

describe('FIX-54 #10 · iframe: the old holes, by how a name and a side are said', () => {
  const INTENT = '请使用云端浏览器，the-internet.herokuapp.com 的 iframe 与 JavaScript alerts';
  const FRAME = {
    key: 'frame_1',
    sourceURL: 'about:srcdoc',
    text: '- generic "Rich Text Area. Press ALT-0 for help." [active] [ref=f1e1]:\n  - paragraph [ref=f1e2]: Your content goes here.',
  };
  const PARENT = `https://the-internet.herokuapp.com/iframe
- heading "An iFrame containing the TinyMCE WYSIWYG Editor" [level=3] [ref=e8]
- menubar [ref=e12]:
  - menuitem "File" [ref=e13]
  - menuitem "Edit" [ref=e15]
- toolbar "formatting" [ref=e40]:
  - button "Bold" [ref=e41]
- iframe [ref=e77]:
- button "Close" [ref=e90]
- link "Elemental Selenium" [ref=e99]`;
  const ALERTS =
    'https://the-internet.herokuapp.com/javascript_alerts heading "JavaScript Alerts" button "Click for JS Alert" Result: You successfully clicked an alert\nI am a JS Alert';
  const kind = (answer: string) =>
    iframeContentGap(INTENT, answer, [FRAME], true, [PARENT, ALERTS])?.kind ?? null;
  const Q = 'iframe 内容为 "Your content goes here."';

  it.each([
    ['无须 (as 无需)', `${Q}，无须登录管理员后台可见`],
    ['across sentences', `${Q}。页面上还有管理员登录链接。`],
    ['部分完成说明 on its own line', `${Q}\n部分完成说明：iframe 下方还有管理员后台入口。`],
    ['部分完成说明 with a half-width colon', `${Q}。部分完成说明: 页面还有管理员登录链接`],
    ['按钮名称：', `${Q}，下方按钮名称：提交订单`],
    ['按钮的文字是', `${Q}，下方按钮的文字是提交订单`],
    ['页面最上方', `${Q}，页面最上方有 Elemental Selenium 链接`],
    ['页面最顶端', `${Q}，页面最顶端有 Elemental Selenium 链接`],
    ['正上方', `${Q}，正上方有 Elemental Selenium 链接`],
  ])('%s is caught', (_label, answer) => {
    expect(kind(answer)).toBe('mismatch');
  });

  it.each([
    ['无须 with nothing claimed', `${Q}，无须登录即可查看`],
    ['页面最上方, where the page has it', `${Q}，页面最上方有 File、Edit 菜单`],
    ['最下方, where the page has it', `${Q}，页面最下方有 Elemental Selenium 链接`],
    ['按钮名称 the page has', `${Q}，下方按钮名称：Close`],
    [
      'the heading above',
      `${Q}。页面上方的标题是 An iFrame containing the TinyMCE WYSIWYG Editor。`,
    ],
  ])('%s passes', (_label, answer) => {
    expect(kind(answer)).toBeNull();
  });
});
