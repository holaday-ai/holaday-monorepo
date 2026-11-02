import { afterEach, describe, expect, it, vi } from 'vitest';
import { logger } from '../../config/logger.js';
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

/** Real core-10 answers, verbatim (fix-51/review3-fixtures/c10.json): held wrongly by review #2's code. */
const C10: Record<string, string> = {
  '/browser-autopilot-3/eval/f1/items-f1-core-10-b.log':
    '已成功完成两项验证：\n1. Iframe：在 https://the-internet.herokuapp.com/iframe 页面中，通过 frameId frame_5d4b5c94-ee4f-4e4f-9c5e-7e89929712dd 读取到 iframe 内部文本为 "Your content goes here."。\n2. JavaScript Alerts：在 https://the-internet.herokuapp.com/javascript_alerts 页面点击 "Click for JS Alert" 按钮（ref e12），浏览器自动接受了弹出的 JS Alert 对话框，页面 Result 区域更新显示 "You successfully clicked an alert"。\n\n两项任务均按预期成功执行并验证。',
  '/browser-autopilot-3/eval/f1/items-f1-core-10-a.log':
    '已成功在云端浏览器中完成 the-internet.herokuapp.com 的 iframe 与 JavaScript alerts 任务：\n\n1. **Iframe 处理**：导航至 /iframe 页面，成功读取嵌套 iframe 内的文本内容为 "Your content goes here."，确认已进入并读取了 iframe 上下文。\n\n2. **JavaScript Alerts 处理**：导航至 /javascript_alerts 页面，依次点击了三个按钮（JS Alert、JS Confirm、JS Prompt）。由于弹窗由环境自动处理，每次点击后 Result 区域会被最新操作的结果覆盖。最终一次 snapshot 捕获到的 Result 文本为 "You successfully clicked an alert"（对应最后一次点击的 JS Alert 按钮）。\n\n   - Confirm 和 Prompt 按钮均已成功点击且页面无报错，但由于弹窗自动处理后页面状态更新较快，未能在单次 snapshot 中同时捕获到三者的独立结果原文。根据页面设计，每个按钮点击后都会在 Result 区域显示对应反馈，已验证 Alert 类型的反馈文本准确无误。\n\n所有操作均通过云端浏览器真实执行，iframe 内容和 JS Alert 结果已从页面原样提取验证。',
  '/integrate-281/eval/r4-run2-archive/f3/items-f3-core-10-a.log':
    '已成功在云端浏览器中验证 the-internet.herokuapp.com 的 IFrames 与 JavaScript Alerts 功能：\n\n1. **IFrames 页面**（https://the-internet.herokuapp.com/iframe）：页面正确加载了一个 iframe，其内部嵌套了 TinyMCE WYSIWYG 编辑器，初始内容为 "Your content goes here."，确认 iframe 渲染正常。\n\n2. **JavaScript Alerts 页面**（https://the-internet.herokuapp.com/javascript_alerts）：依次点击三个按钮触发原生 JS 对话框：\n   - 点击 "Click for JS Alert" → 弹出 alert「I am a JS Alert」，自动确认后页面显示 "You successfully clicked an alert"\n   - 点击 "Click for JS Confirm" → 弹出 confirm「I am a JS Confirm」，自动取消后页面显示 "You clicked: Cancel"\n   - 点击 "Click for JS Prompt" → 弹出 prompt「I am a JS prompt」，未输入内容自动关闭后页面显示 "You entered:"\n\n所有弹窗均被浏览器正确拦截并处理，页面反馈结果符合预期，两项测试模块功能验证通过。',
  '/browser-autopilot-1/round5/items-round5-core-10-b.log':
    '已在云端浏览器中完成 the-internet.herokuapp.com 的 JavaScript Alerts 与 iframe 演示页面的只读验证：\n\n1. **JavaScript Alerts (`/javascript_alerts`)**\n   - 依次点击了 "Click for JS Alert"、"Click for JS Confirm"、"Click for JS Prompt" 三个按钮。\n   - 系统原生对话框由浏览器自动处理（接受/取消/未输入），页面反馈文本分别为：\n     * Alert → "You clicked: Ok"\n     * Confirm → "You clicked: Cancel"\n     * Prompt → "You entered: null"\n   - 说明当前自动化环境对 JS 弹窗采用默认响应，无法通过 DOM 操作绕过，符合安全要求。\n\n2. **IFrame (`/iframe`)**\n   - 成功识别并进入 TinyMCE 编辑器所在的 iframe（frameId: `frame_2544eb86-b246-4068-98a2-31d73e814cff`）。\n   - 在 iframe 上下文中读取到正文段落内容："Your content goes here."，证明可正常访问 iframe 内部元素。\n   - 主页面同时显示 TinyMCE 只读提示："TinyMCE is in read-only mode because you have no more editor loads available this month."，表明编辑器处于受限状态，未执行任何写入或提交操作。\n\n所有交互均为只读验证，未触发表单提交、登录或支付流程，符合安全原则。硬事实值已按页面原样提取至 fields。\n\n未核实：以下内容未能在已读页面中逐字找到，请自行确认——js_alert_result「You clicked: Ok」',
  '/browser-autopilot-1/round5/items-round5-core-10-a.log':
    '已完成 the-internet.herokuapp.com 的 JavaScript Alerts 与 Iframe 验证：\n\n1. **JavaScript Alert**：在 /javascript_alerts 页面点击 "Click for JS Alert"，浏览器弹出原生 alert 并自动接受，页面 Result 区域显示 "You successfully clicked an alert"（注意：该站点实际文案为此，而非规划建议中的 "You accepted a JS Alert!"）。\n\n2. **Iframe 交互**：在 /iframe 页面成功识别 TinyMCE 编辑器所在的 iframe（frameId: frame_bc300b8a-94a2-4dbd-acce-c432f89d1804），读取到内部段落内容为 "Your content goes here."，并可点击聚焦该元素，证明 iframe 上下文切换与元素定位正常。\n\n3. **限制说明**：当前 TinyMCE 编辑器处于只读/禁用状态（工具栏按钮均标记为 disabled），因此无法通过自动化向编辑器内写入新文本。这是站点本身配置所致，并非跨域或元素未找到错误。若需写入测试，需站点启用编辑器可编辑模式。\n\n4. **截图留证**：已对 alert 结果页和 iframe 编辑器页面分别截图，确认操作状态符合预期。\n\n无控制台致命错误，任务目标在站点允许范围内已完成。',
};

describe('FIX-51 复审 #3 #1: what is said ahead of the real frame text is held too (review3-fixtures/t9.mjs)', () => {
  const I = '请使用云端浏览器，the-internet.herokuapp.com 的 iframe 与 JavaScript alerts';
  const FRAME = {
    key: 'frame_1',
    sourceURL: 'about:blank',
    text: '- paragraph [ref=f1e3]: Your content goes here.',
  };
  const PAGES = [
    'https://the-internet.herokuapp.com/iframe heading "An iFrame containing the TinyMCE WYSIWYG Editor" button "Bold" button "Italic" link "Elemental Selenium"',
    'https://the-internet.herokuapp.com/javascript_alerts heading "JavaScript Alerts" button "Click for JS Alert" button "Click for JS Confirm" button "Click for JS Prompt" Result: You successfully clicked an alert',
  ];
  const gap = (answer: string) => iframeContentGap(I, answer, [FRAME], true, PAGES)?.kind ?? null;

  it.each([
    '已读取 iframe，管理员链接很明显。iframe 内容为 "Your content goes here."。',
    '已读取 iframe，里面有一个管理员登录链接。正文为 "Your content goes here."。',
    '管理员登录链接位于 iframe 中，iframe 内容为 "Your content goes here."。',
    'iframe 中可见管理员登录链接，文本为 "Your content goes here."。',
    'iframe 里有一个管理员登录链接；内容为 "Your content goes here."。',
    'Your content goes here.（iframe 内），另有管理员登录链接。',
    '已读取 iframe，管理员链接很明显，内容为 "Your content goes here."。',
    '已读取 iframe。其中有一个管理员登录链接。正文为 "Your content goes here."。',
    'iframe 里管理员链接很明显，内容为 "Your content goes here."。',
    '管理员入口所在的 iframe 内容为 "Your content goes here."。',
    'iframe 内容为 "Your content goes here."，确认管理员链接可见。',
    'iframe 内容为 "Your content goes here."，证明可进入管理员后台。',
    'iframe 内容为 "Your content goes here."，并可点击管理员登录链接。',
    'iframe 内容为 "Your content goes here."。\n\n管理员链接很明显。',
    'iframe 内容为 "Your content goes here."。\n- 页面还有一个管理员入口。',
    '登录表单位于该 iframe 内，其内容为 "Your content goes here."。',
    'The iframe was read and the admin panel is visible. Its text is "Your content goes here.".',
    'Admin login link is inside the iframe, whose text is "Your content goes here.".',
  ])('sent back: %s', (answer) => {
    expect(gap(answer)).toBe('mismatch');
  });

  it.each([
    '1. Iframe：在 https://the-internet.herokuapp.com/iframe 页面中，通过 frameId frame_5d4b 读取到 iframe 内部文本为 "Your content goes here."。',
    '1. **Iframe 处理**：导航至 /iframe 页面，成功读取嵌套 iframe 内的文本内容为 "Your content goes here."，确认已进入并读取了 iframe 上下文。',
    'iframe 内容为 "Your content goes here."，确认 iframe 渲染正常。',
    'iframe 内部段落内容为 "Your content goes here."，并可点击聚焦该元素，证明 iframe 上下文切换与元素定位正常。',
    'iframe 内容为 "Your content goes here."。\n\n所有交互均为只读验证，未触发表单提交，符合安全原则。',
    'iframe 内容可见，文本为 "Your content goes here."。',
    'The iframe text is "Your content goes here.", which confirms the frame was reached.',
    'The iframe was read. Its text is "Your content goes here.".',
  ])('as read: %s', (answer) => {
    expect(gap(answer)).toBeNull();
  });

  it('Iframe：<another address> is held to the reads', () => {
    expect(
      gap(
        'Iframe：在 https://evil.example/admin 页面中，iframe 文本为 "Your content goes here."。',
      ),
    ).toBe('mismatch');
  });

  it('the 5 real core-10 answers review #3 names are not sent back (review3-fixtures/c10.json)', () => {
    const named = [
      'f1/items-f1-core-10-b',
      'f1/items-f1-core-10-a',
      'r4-run2-archive/f3/items-f3-core-10-a',
      'round5/items-round5-core-10-b',
      'round5/items-round5-core-10-a',
    ];
    for (const [src, answer] of Object.entries(C10)) {
      expect(named.some((item) => src.includes(item))).toBe(true);
      expect(gap(answer)).toBeNull();
    }
  });
});

describe('FIX-51 复审 #3 #3: a tab closed unread is not asked for', () => {
  afterEach(() => vi.restoreAllMocks());
  const OPEN3 = '请使用云端浏览器，从一个页面打开3个链接到新标签，分别读标题后回到第一个';
  const TITLES: Record<string, string> = {
    source: 'Web browser',
    tab_aaaaaaaa1: 'Safari',
    tab_bbbbbbbb2: 'MacBook',
    tab_cccccccc3: 'Wikipedia',
    tab_dddddddd4: 'Firefox',
  };
  const run = async (script: Array<{ name: string; input: Record<string, unknown> }>) => {
    let active = 'source';
    let next = 0;
    const open = ['tab_aaaaaaaa1', 'tab_bbbbbbbb2', 'tab_cccccccc3', 'tab_dddddddd4'];
    let turn = 0;
    const adapter: MessagesAdapter = {
      metadata: { provider: 'anthropic', model: 'fixture' },
      async create() {
        const call = script[Math.min(turn++, script.length - 1)]!;
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
    return runUnifiedBrowserLoop({
      intent: OPEN3,
      adapter,
      maxSteps: 30,
      observationV2: true,
      supportedTools: { download: false, upload: false, tabs: true },
      execute: (async (action: { tool: string; targetTabId?: string }) => {
        if (action.tool === 'click') {
          active = open[next++]!;
          return { ok: true, text: `已打开新标签 ${active}`, tabId: active, openedTab: true };
        }
        if (action.tool === 'list_tabs')
          return {
            ok: true,
            text: JSON.stringify({
              tabs: Object.entries(TITLES).map(([tabId, title]) => ({ tabId, title })),
            }),
          };
        if (action.tool === 'close_tab') {
          active = 'source';
          return { ok: true, text: '{"status":"close_tab"}', tabId: active };
        }
        if (action.tool === 'switch_tab') active = action.targetTabId!;
        return {
          ok: true,
          tabId: active,
          text: JSON.stringify({
            tabId: active,
            headings: [{ level: 1, text: TITLES[active] }],
            tree: `heading "${TITLES[active]}" [level=1]`,
          }),
        };
      }) as never,
    });
  };
  const click = (n: number) => ({ name: 'click', input: { ref: `e${n}`, newTab: true } });
  const read = { name: 'read_page', input: {} };
  const to = (tab: string) => ({ name: 'switch_tab', input: { targetTabId: tab } });
  const done = (summary: string) => ({ name: 'finish', input: { status: 'completed', summary } });
  const ALL = '已打开3个链接到新标签，分别读取标题后切回第一个：Safari、MacBook、Wikipedia。';

  it('4 opened, the 4th closed unread, the other 3 read: completed', async () => {
    const outcome = await run([
      read,
      click(1),
      read,
      to('source'),
      click(2),
      read,
      to('source'),
      click(3),
      read,
      to('source'),
      click(4),
      { name: 'close_tab', input: { targetTabId: 'tab_dddddddd4' } },
      to('source'),
      done(ALL),
    ]);
    expect(outcome).toMatchObject({ status: 'completed' });
  });

  it('reverse: 4 opened, the 4th neither closed nor read: sent back, then failed', async () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => logger);
    const outcome = await run([
      read,
      click(1),
      read,
      to('source'),
      click(2),
      read,
      to('source'),
      click(3),
      read,
      to('source'),
      click(4),
      to('source'),
      done(ALL),
      done(ALL),
    ]);
    expect(outcome).toMatchObject({ status: 'failed' });
    const reason = (outcome as { reason: string }).reason;
    expect(reason).toContain('还没有读取');
    // The steps go to the log, with the start of the tab ids, and not into the reason.
    const logged = warn.mock.calls.find(
      (call) => call[1] === 'browser loop failed',
    )?.[0] as unknown as {
      steps: string[];
    };
    expect(logged.steps).toContain('click:dddddddd+');
    expect(logged.steps).toContain('switch_tab:source');
    expect(reason).not.toContain('click:');
    expect(JSON.stringify(logged)).not.toContain('tab_dddddddd4');
  });

  it('reverse: 3 opened, one closed unread, 2 read: one short, sent back', async () => {
    vi.spyOn(logger, 'warn').mockImplementation(() => logger);
    const outcome = await run([
      read,
      click(1),
      read,
      to('source'),
      click(2),
      read,
      to('source'),
      click(3),
      { name: 'close_tab', input: { targetTabId: 'tab_cccccccc3' } },
      to('source'),
      done('已打开3个链接到新标签，分别读取标题后切回第一个：Safari、MacBook。'),
      done('已打开3个链接到新标签，分别读取标题后切回第一个：Safari、MacBook。'),
    ]);
    expect(outcome).toMatchObject({ status: 'failed' });
    expect((outcome as { reason: string }).reason).toContain('还差 1 个');
  });

  it('a closed tab that was read still has its title asked for', async () => {
    vi.spyOn(logger, 'warn').mockImplementation(() => logger);
    const outcome = await run([
      read,
      click(1),
      read,
      to('source'),
      click(2),
      read,
      to('source'),
      click(3),
      read,
      { name: 'close_tab', input: { targetTabId: 'tab_cccccccc3' } },
      to('source'),
      done('已打开3个链接到新标签，分别读取标题后切回第一个：Safari、MacBook。'),
      done('已打开3个链接到新标签，分别读取标题后切回第一个：Safari、MacBook。'),
    ]);
    expect(outcome).toMatchObject({ status: 'failed' });
    expect((outcome as { reason: string }).reason).toContain('Wikipedia');
  });
});
