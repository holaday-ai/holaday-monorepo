import { describe, expect, it } from 'vitest';
import type { MessagesAdapter } from '../../llm/messages-adapter.js';
import { hasInternalRef, stripInternalRefs } from '../internal-refs.js';
import { iframeContentGap } from './completion-coverage.js';
import { assessCompletionFacts, declaredAbsentFields } from './completion-fields.js';
import {
  listedTabTitles,
  listedTabUrls,
  readTabTitles,
  runUnifiedBrowserLoop,
} from './unified-browser-loop.js';

describe('FIX-51 #4 · core-07: a tab bound by both tabId and sourceURL (Deploy-51 online)', () => {
  const TAB = 'tab_f0057b0d-3fca-4223-adb7-6467406b6a04';
  const OTHER = 'tab_58f1c8fb-f559-4e7b-9f5f-d6ccde28b11c';
  const CHROME = 'https://en.wikipedia.org/wiki/Google_Chrome';
  const SAFARI = 'https://en.wikipedia.org/wiki/Safari_(web_browser)';
  const INTENT = '请使用云端浏览器，从一个页面打开3个链接到新标签，分别读标题后回到第一个';
  const pages = [
    { text: '- heading "Google Chrome" [level=1]', tabId: TAB, sourceURL: CHROME },
    { text: '- heading "Safari (web browser)" [level=1]', tabId: OTHER, sourceURL: SAFARI },
    // The tab's listed document title, with the address it was listed at (read there).
    { text: 'Google Chrome - Wikipedia', tabId: TAB, sourceURL: CHROME },
    { text: 'Safari (web browser) - Wikipedia', tabId: OTHER, sourceURL: SAFARI },
  ];
  const check = (fact: { tabId?: string; sourceURL?: string }) =>
    assessCompletionFacts({
      summary: '1. Google Chrome - Wikipedia',
      fields: [{ name: '新标签1标题', value: 'Google Chrome - Wikipedia', ...fact }],
      pages,
      intent: INTENT,
    }).contradictions;

  it('its own title holds, bound by tab, by URL, or by both', () => {
    expect(check({ tabId: TAB, sourceURL: CHROME })).toEqual([]);
    expect(check({ tabId: TAB })).toEqual([]);
    expect(check({ sourceURL: CHROME })).toEqual([]);
  });

  it("reverse: another tab's title, by tab, by URL, or by both, is still another page's", () => {
    for (const fact of [
      { tabId: OTHER, sourceURL: SAFARI },
      { tabId: OTHER },
      { sourceURL: SAFARI },
    ])
      expect(check(fact).join(), JSON.stringify(fact)).toContain('来自其他页面');
    // Its tab with the URL of a page that tab never read.
    expect(check({ tabId: TAB, sourceURL: SAFARI }).join()).toContain('未成功读取');
  });

  it('复审 #1: a tab that went on from CHROME to FIREFOX does not give CHROME that title', () => {
    const FIREFOX = 'https://en.wikipedia.org/wiki/Firefox';
    const facts = (sourceURL: string) =>
      assessCompletionFacts({
        summary: 'Firefox - Wikipedia',
        fields: [{ name: '标题', value: 'Firefox - Wikipedia', tabId: TAB, sourceURL }],
        pages: [
          { text: '- heading "Google Chrome" [level=1]', tabId: TAB, sourceURL: CHROME },
          { text: 'Firefox - Wikipedia', tabId: TAB },
        ],
        intent: INTENT,
      }).contradictions.join();
    expect(facts(CHROME)).toContain('来自其他页面');
    expect(facts(FIREFOX)).toContain('未成功读取');
  });

  it('复审 #1: a listed title has the address only when the tab was read there', () => {
    const FIREFOX = 'https://en.wikipedia.org/wiki/Firefox';
    const listing = JSON.stringify({
      tabs: [
        { tabId: TAB, url: FIREFOX, title: 'Firefox - Wikipedia' },
        { tabId: OTHER, sourceURL: SAFARI, title: 'Safari (web browser) - Wikipedia' },
      ],
    });
    const titles = listedTabTitles(listing);
    const urls = listedTabUrls(listing);
    const tabs = new Set([TAB, OTHER]);
    // TAB was read at CHROME and listed at FIREFOX; OTHER was read where it was listed.
    expect(readTabTitles(titles, tabs, urls, pages.slice(0, 2))).toEqual([
      { text: 'Firefox - Wikipedia', tabId: TAB },
      { text: 'Safari (web browser) - Wikipedia', tabId: OTHER, sourceURL: SAFARI },
    ]);
  });

  it('in the loop: completed at once, and no tab id reaches the answer', async () => {
    const START = 'https://en.wikipedia.org/wiki/Web_browser';
    const START_TAB = 'tab_7c4c5f16-cf69-40af-85a5-8eb012a2e7bc';
    const summary = `读到的标题：\n1. Google Chrome - Wikipedia（${TAB}）\n\n起始页面是 Web browser - Wikipedia（${START_TAB}）。`;
    const calls = [
      { name: 'navigate', input: { url: START } },
      { name: 'snapshot', input: {} },
      { name: 'read_page', input: { tabId: TAB } },
      { name: 'list_tabs', input: {} },
      {
        name: 'finish',
        input: {
          status: 'completed',
          summary,
          fields: [
            {
              name: '新标签1标题',
              value: 'Google Chrome - Wikipedia',
              tabId: TAB,
              sourceURL: CHROME,
            },
          ],
        },
      },
    ];
    let turn = 0;
    const seen: string[] = [];
    const adapter: MessagesAdapter = {
      metadata: { provider: 'anthropic', model: 'fixture' },
      async create(request) {
        seen.push(JSON.stringify(request.messages.at(-1)));
        const call = calls[Math.min(turn++, calls.length - 1)]!;
        return {
          id: String(turn),
          metadata: { provider: 'anthropic', model: 'fixture' },
          content: [{ type: 'tool_use', id: String(turn), ...call }],
          stopReason: 'tool_use',
          usage: {
            inputTokens: 1,
            outputTokens: 1,
            cacheReadInputTokens: null,
            cacheCreationInputTokens: null,
            complete: true,
          },
        };
      },
    };
    const outcome = await runUnifiedBrowserLoop({
      intent: '读这个新标签的标题',
      adapter,
      maxSteps: 8,
      observationV2: true,
      currentPageUrl: () => START,
      execute: (async (action: { tool: string; tabId?: string }) => {
        if (action.tool === 'list_tabs')
          return {
            ok: true,
            url: START,
            text: JSON.stringify({
              tabs: [
                { tabId: START_TAB, url: START, title: 'Web browser - Wikipedia' },
                { tabId: TAB, url: CHROME, title: 'Google Chrome - Wikipedia' },
              ],
            }),
          };
        const tab = action.tabId === TAB;
        return {
          ok: true,
          url: tab ? CHROME : START,
          tabId: tab ? TAB : START_TAB,
          text: JSON.stringify({
            tabId: tab ? TAB : START_TAB,
            frameId: 'frame_main',
            sourceURL: tab ? CHROME : START,
            tree: tab ? '- heading "Google Chrome" [level=1]' : '- heading "Web browser" [level=1]',
            frames: [],
          }),
        };
      }) as never,
    });
    expect(seen.join('\n')).not.toContain('来自其他页面');
    expect(outcome).toMatchObject({ status: 'completed' });
    expect((outcome as { summary: string }).summary).toContain('Google Chrome - Wikipedia');
    expect((outcome as { summary: string }).summary).not.toMatch(/tab_[0-9a-f]/);
  });
});

describe('FIX-51 #5 · b-p02: 「未显示价格」 of the results page, the price read on the details page', () => {
  const INTENT = '请使用云端浏览器，amazon.com 搜 usb c cable 前3个商品名和价格';
  const ITEM = 'Anker USB C to USB C Cable, 60W Fast Charging Cable (2-Pack, 3.3 ft, Black)';
  const PAGES = ['SGD 12.77 SGD 11.47', `- heading "${ITEM}"\n- text: S$12.77`];
  const list = `1. Anker — SGD 12.77\n2. LISEN — SGD 11.47\n3. ${ITEM} — S$12.77`;
  /** Deploy-51 online (tsk_6m3k87uEezdLUazHMhtHs), verbatim: the last two finishes. */
  const FINAL = `已在 amazon.com 搜索 "usb c cable"，前3个商品名称和价格（照页面原样）：\n\n${list}\n\n说明：第3条在搜索结果页快照被截断未显示价格，已打开其详情页并通过 get_page_text 读取到价格文本 "S$12.77"。用户未要求链接，故不提供。`;
  const THIRD = `${list}\n\n说明：第3条在搜索结果页快照被截断未显示价格，已打开其详情页读取到价格 S$12.77（来自详情页 ref=e240）。用户未要求链接，故不提供。`;

  it('online verbatim: the gap is filled in the same sentence, not absent', () => {
    expect(declaredAbsentFields(INTENT, FINAL, undefined, PAGES)).toEqual([]);
    expect(declaredAbsentFields(INTENT, THIRD, undefined, PAGES)).toEqual([]);
  });

  it('reverse: still absent when the value is not read, not on a page, or of another item', () => {
    for (const tail of [
      // 复审 #1: a note that doubts the value, or points at another item, is not 出处.
      '第3条未显示价格，读取到价格 S$12.77（推测）。',
      '第3条未显示价格，读取到价格 S$12.77（可能不准确，未核实）。',
      '第3条未显示价格，读取到价格 S$12.77（第1条的价格）。',
      '第3条未显示价格，读取到价格 S$12.77（来自详情页，可能不准确）。',
      '第3条未显示价格，读取到价格 S$12.77（来自第1条的详情页）。',
      '第3条未显示价格，读取到价格 S$12.77（来自详情页）（推测）。',
      '第3条未显示价格，读取到价格 S$12.77（含税）。',
      '第3条未显示价格，读取到价格 S$12.77，可能不准确。',
      '第3条未显示价格。',
      '第3条未显示价格，已打开详情页，读取到价格 S$99.99。',
      '第3条未显示价格，第2条读取到价格 S$12.77。',
      '第3条未显示价格，读取到价格未显示。',
      '第3条未显示价格，读取到价格信息不完整。',
      '第3条未显示价格，读取到价格 推测是 S$12.77。',
    ])
      expect(declaredAbsentFields(INTENT, `${list}\n${tail}`, undefined, PAGES), tail).toEqual([
        '价格',
      ]);
  });
});

describe('FIX-51 复审 #1 #4: handles in inline code never reach the user', () => {
  /** Deploy-51 A core-10, verbatim. */
  const LINE =
    '成功加载，包含 TinyMCE WYSIWYG 编辑器的 iFrame。通过 frameId `frame_4c3d2bdc-d519-4b0e-beec-cd2d76508ff0` 读取 iframe 内部内容，原文为：';

  it('online verbatim: goes, with its label; the scans see it', () => {
    expect(stripInternalRefs(LINE)).toBe(
      '成功加载，包含 TinyMCE WYSIWYG 编辑器的 iFrame。通过读取 iframe 内部内容，原文为：',
    );
    expect(hasInternalRef(LINE)).toBe(true);
  });

  it.each([
    ['读取了 `tab_9eff90a8-0b49-437e-a972-79de6d3ef019` 的标题', '读取了的标题'],
    ['读取 `frame_4c3d2bdc-…` 完成', '读取完成'],
    ['读取 `frame_4c3d2bdc` 完成', '读取完成'],
    ['调用 `read_page(frameId="frame_4c3d2bdc-d519-4b0e-beec-cd2d76508ff0")` 完成', '调用完成'],
    ['点击 `ref=e12` 后跳转', '点击后跳转'],
    ['点击 `[ref=e12]` 后跳转', '点击后跳转'],
    ['```\nframe_4c3d2bdc-d519-4b0e-beec-cd2d76508ff0\n```', '```\n```'],
  ])('%s', (text, want) => {
    expect(stripInternalRefs(text)).toBe(want);
    expect(hasInternalRef(text)).toBe(true);
  });

  it('a bare id in code goes only when the browser gave it out in this run', () => {
    expect(stripInternalRefs('点击 `e12` 后', new Set(['e12']))).toBe('点击后');
    expect(stripInternalRefs('矩阵 `e12` 的值')).toBe('矩阵 `e12` 的值');
  });

  it.each([
    '弹出 `alert("I am a JS Alert")`，页面显示 `"You entered: null"`',
    '运行 `if (value === "") reset();`',
    '配置 `tab_size = 4` 和 `frame_rate`，文件 `frame_deadbeef12`',
    '地址 `https://x.test/?tab_9eff90a8-0b49-437e-a972-79de6d3ef019=1`',
    '```\nconst tab_size = 4;\n```',
  ])('reverse: 「%s」 is left as written', (text) => {
    expect(stripInternalRefs(text)).toBe(text);
    expect(hasInternalRef(text)).toBe(false);
  });
});

describe('FIX-51 复审 #1 #1: what follows a real frame text is held to the frame read', () => {
  const I = '请使用云端浏览器，the-internet.herokuapp.com 的 iframe 与 JavaScript alerts';
  const IL = '请使用云端浏览器，读 the-internet.herokuapp.com 的 iframe 里的登录链接';
  const T = {
    key: 'frame_1',
    sourceURL: 'about:blank',
    text: '- paragraph [ref=f1e3]: Your content goes here.',
  };
  const MCE = {
    key: 'frame_1',
    sourceURL: 'about:blank',
    text: '- application "Rich Text Area. Press ALT-0 for help."\n- paragraph: Your content goes here.',
  };
  const PARENT = [
    'heading "An iFrame containing the TinyMCE WYSIWYG Editor" button "Bold" button "Italic"',
  ];
  const gap = (answer: string, intent = I, frame = T) =>
    iframeContentGap(intent, answer, [frame], true, PARENT);
  const TEXT = '"Your content goes here."';

  // 协调方夹具 fix-51/review1-fixtures/t5.mjs, then the variants around it.
  it.each([
    ['The iframe contains "Your content goes here." and also an admin login link.'],
    ['The iframe shows the text: Your content goes here, and also an admin login link.'],
    ['The iframe contains the text "Your content goes here.", plus a Submit button.'],
    ['The iframe has the text "Your content goes here." with a Submit button.'],
    ['The iframe contains "Your content goes here.". Below it there is a Submit button.'],
    [`iframe 内容为 ${TEXT}。下方还有一个管理员登录链接。`],
    [`iframe 内容为 ${TEXT}。旁边是一个提交按钮。`],
    [`iframe 内容为 ${TEXT}。另外，下方还有提交按钮。`],
    [`iframe 内容为 ${TEXT}。还能看到一个提交按钮。`],
    [`iframe 内容为 ${TEXT}。一个提交按钮也在。`],
    [`iframe 内容为 ${TEXT}。提交按钮在下方。`],
    [`iframe 内容为 ${TEXT}。The editor has an admin link.`],
    ['The iframe text "Your content goes here." and an admin link.'],
    [`iframe 内容为 ${TEXT}，有一个登录链接。`, IL],
    [`iframe 内容为 ${TEXT}，登录链接为 https://evil.example/login。`, IL],
    [`iframe 内容为 ${TEXT}，有一个登录链接。`, '读 iframe 和登录链接'],
    [`iframe 内容为 ${TEXT}（还有一个管理员登录链接）。`],
    [`iframe 内容为 ${TEXT}（另含管理员入口 /admin）。`],
    [`iframe 内容为 ${TEXT}（默认文本，含管理员登录链接）。`],
    [`iframe 内容为 ${TEXT}，checkboxes 已读，iframe 里还有管理员链接。`],
    [`iframe 内容为 ${TEXT}，并成功在该 iframe 内看到管理员登录链接。`],
    [`iframe 内容为 ${TEXT}，页面标题为 An iFrame，编辑器底部有管理员登录链接。`],
    [`iframe 内容为 ${TEXT}\n编辑器下方还有一个管理员登录链接。`],
    ['1. iframe：Your content goes here.\n2. iframe 底部显示版权 © 2026 Admin Corp。'],
    ['iframe 内容为 Your content goes here and an admin login link.'],
    // The toolbar leaves the iframe only for what the page's read has.
    [`iframe 内容为 ${TEXT}，编辑器工具栏有管理员登录链接。`],
    [`iframe 内容为 ${TEXT}。编辑器工具栏有管理员登录链接。`],
    [`iframe 内容为 ${TEXT}，编辑器工具栏（Bold、Admin）均可用。`],
  ])('%s', (answer, intent = I) => {
    expect(gap(answer, intent)).toMatchObject({ kind: 'mismatch' });
  });

  it.each([
    [`iframe 内容为 ${TEXT}（TinyMCE 默认文本）。`, MCE],
    [`iframe 内容为 ${TEXT}（读取自 frame_1）。`, T],
    [`iframe 内容为 ${TEXT}（读取自 frame_1，默认文本）。`, T],
    ['The iframe contains the text "Your content goes here." (TinyMCE default).', MCE],
    [`iframe 内容为 ${TEXT}，并导航至 /javascript_alerts 完成 alert。`, T],
    [`iframe 内容为 ${TEXT} 并导航至 /javascript_alerts。`, T],
    [`iframe 内容为 ${TEXT}，页面标题为 An iFrame containing the TinyMCE WYSIWYG Editor。`, MCE],
    [`iframe 内容为 ${TEXT}；JS Alert 弹出 "I am a JS Alert"。`, T],
    ['The iframe contains "Your content goes here." and I navigated to /javascript_alerts.', T],
    ['The iframe contains "Your content goes here.". The page title is An iFrame.', T],
    [`iframe 内容为 ${TEXT}。JS Alert 弹出后已确认。`, T],
    // f24-ha: said of the page around the frame, and the page's read has it.
    [
      `包含一个 iframe，内部段落文本为 ${TEXT}，编辑器工具栏（Bold、Italic、下划线）均可用，无报错。`,
      MCE,
    ],
    // 「…/iframe，read_page 返回的列表包含…」 is the page's address, not the iframe.
    [`打开 /iframe，read_page 返回的 frames 列表包含 f1。iframe 内容为 ${TEXT}`, T],
    // Quoted frame text with its own punctuation stays whole.
    ['iframe 内容为 "Hello, world。Bye."', { ...T, text: '- paragraph: Hello, world。Bye.' }],
    // A frame text of several sentences, not quoted.
    [
      'The iframe shows Hello there. Welcome back.',
      { ...T, text: '- paragraph: Hello there. Welcome back.' },
    ],
  ])('legit: %s', (answer, frame) => {
    expect(gap(answer, I, frame)).toBeNull();
  });

  it('the asked-for word in a clause is not 「the other part」 when the task asks it of the iframe', () => {
    const LINK = { ...T, text: '- link "登录链接": 登录' };
    expect(gap('iframe 内容为 "登录链接"。', IL, LINK)).toBeNull();
  });
});

describe('FIX-51 复审 #2: 「left the iframe」 is no way past the reads (fix-51/review2-fixtures/t7.mjs)', () => {
  const I = '请使用云端浏览器，the-internet.herokuapp.com 的 iframe 与 JavaScript alerts';
  const IL = '请使用云端浏览器，读 the-internet.herokuapp.com 的 iframe 里的登录链接';
  const T = {
    key: 'frame_1',
    sourceURL: 'about:blank',
    text: '- paragraph [ref=f1e3]: Your content goes here.',
  };
  const AL = [
    'https://the-internet.herokuapp.com/iframe heading "An iFrame containing the TinyMCE WYSIWYG Editor" button "Bold" button "Italic" link "Elemental Selenium"',
    'heading "JavaScript Alerts" button "Click for JS Alert" Result: You successfully clicked an alert',
  ];
  const Q = 'iframe 内容为 "Your content goes here."';
  const gap = (answer: string, intent = I, pages = AL) =>
    iframeContentGap(intent, answer, [T], true, pages);

  it.each([
    [`${Q}，页面上还有管理员登录链接。`, I],
    [`${Q}，页面上还有管理员登录链接。`, IL],
    [`${Q}，页面中的登录链接为 https://evil.example/login。`, IL],
    [`${Q}。登录链接为 https://evil.example/login。`, IL],
    [`${Q}，标题为管理员后台。`, I],
    [`${Q}，页面显示该编辑器内还有一个管理员链接。`, I],
    [`${Q}。管理员链接很明显。`, I],
    [`${Q}，网页底部（iframe 内）有管理员登录链接。`, I],
    [
      'The iframe contains "Your content goes here.". The page also has an admin login link inside the editor.',
      I,
    ],
    [`${Q}，该页面在 iframe 下方还嵌着一个管理员登录表单。`, I],
    [`${Q}，主页面上的 iframe 区域还显示了管理员入口。`, I],
    [`${Q}，页面其余部分：管理员登录链接、提交按钮。`, I],
    // Probed beyond the fixture.
    [`${Q}。\n\n管理员链接很明显。`, I],
    [`${Q}。任务完成。管理员链接很明显。`, I],
    [`${Q}，页面上还有一个表单。`, I],
    [`${Q}，页面上 JavaScript alerts 按钮旁还有管理员登录链接。`, I],
    [`${Q}，页面链接为 https://the-internet.herokuapp.com.evil.example/。`, I],
    [`${Q}，页面标题为 "管理员后台"。`, I],
    [`${Q}，页面标题为 An iFrame，下方还有管理员按钮。`, I],
    [`${Q}，页面上的编辑器工具栏有管理员登录链接。`, I],
    ['The iframe contains "Your content goes here.". The page title is Admin Console.', I],
    [`${Q}，and the page also has an admin login link.`, I],
  ])('made up: %s', (answer, intent) => {
    expect(gap(answer, intent)).toMatchObject({ kind: 'mismatch' });
  });

  it('a place word holds a clause to the frame alone, though the parent has the word', () => {
    expect(
      gap('The iframe contains "Your content goes here.". The page has Bold inside the editor.'),
    ).toMatchObject({
      kind: 'mismatch',
    });
    expect(gap(`${Q}。The page also has a Bold button.`)).toBeNull();
  });

  it.each([
    `${Q}，页面标题为 An iFrame containing the TinyMCE WYSIWYG Editor。`,
    `${Q}，页面上方是标题 An iFrame containing the TinyMCE WYSIWYG Editor。`,
    `${Q}，标题为 "An iFrame containing the TinyMCE WYSIWYG Editor"。`,
    `${Q}，编辑器工具栏有 Bold、Italic 按钮。`,
    `${Q}，并导航至 /javascript_alerts 完成 alert。`,
    `${Q}；JS Alert 弹出 "I am a JS Alert"。`,
    `${Q}，页面显示正常。`,
    `${Q}。页面加载完成。`,
    `${Q}。任务已完成。`,
    `${Q}。两部分均已实际打开、读取并验证，无未完成项。\n\n未核实：以下内容未能在已读页面中逐字找到，请自行确认——alert_text「I am a JS Alert」`,
    `${Q}，页面底部有 Elemental Selenium 链接。`,
    `${Q}，页面地址为 https://the-internet.herokuapp.com/iframe。`,
    `${Q}。\n2) 点击 Click for JS Alert，结果为 You successfully clicked an alert。`,
    `${Q}。The page title is An iFrame containing the TinyMCE WYSIWYG Editor.`,
  ])('as read, or nothing named: %s', (answer) => {
    expect(gap(answer)).toBeNull();
  });

  it('a mention with nothing said of the iframe holds nothing to the reads', () => {
    expect(gap(`打开 /iframe，read_page 返回的 frames 列表包含 f1。${Q}`)).toBeNull();
    expect(gap(`已读取 iframe，确认页面存在可访问的 iframe。${Q}`)).toBeNull();
  });

  it('no page read recorded: nothing to hold the clause to', () => {
    expect(gap(`${Q}，页面标题为管理员后台。`, I, [])).toBeNull();
  });
});
