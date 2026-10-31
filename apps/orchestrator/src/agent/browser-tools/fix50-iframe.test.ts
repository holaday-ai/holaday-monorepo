import { describe, expect, it } from 'vitest';
import type { MessagesAdapter } from '../../llm/messages-adapter.js';
import {
  type FrameRead,
  dropSentences,
  frameReadsOf,
  iframeContentGap,
} from './completion-coverage.js';
import { runUnifiedBrowserLoop } from './unified-browser-loop.js';

const INTENT = '请使用云端浏览器，the-internet.herokuapp.com 的 iframe 与 JavaScript alerts';
/** Deploy-50 core-10 online (tsk_ehBxaHhGWsXWsjnkKMktq), verbatim: the rollback. */
const ONLINE =
  '1. 已访问 https://the-internet.herokuapp.com/iframe，页面加载成功；该页包含一个 iframe，内容为跨源错误页，主页面本身可正常读取。\n2. 已访问 https://the-internet.herokuapp.com/javascript_alerts，点击 "Click for JS Alert" 按钮后浏览器弹出原生 alert 弹窗「I am a JS Alert」并自动关闭；页面 Result 区域显示 "You successfully clicked an alert"，确认 JavaScript alert 可触发并可交互/关闭。';
/** Deploy-50 local B core-10 (857b26c2), verbatim: read and written as read. */
const LOCAL_B =
  '已完成 the-internet.herokuapp.com 的 iframe 与 JavaScript alerts 任务：\n\n1. 访问 https://the-internet.herokuapp.com/iframe，读取 iframe 内嵌框架中的文本内容为 "Your content goes here."。\n2. 访问 https://the-internet.herokuapp.com/javascript_alerts，依次触发并处理三个弹窗：\n   - Click for JS Alert：弹出 "I am a JS Alert"，自动确认后 Result 显示 "You successfully clicked an alert"。';
/** Deploy-50 local A core-10 (390097b1), verbatim: the iframe page opened, its content never given. */
const LOCAL_A =
  '已访问 the-internet.herokuapp.com/iframe 页面（加载成功），并导航至 /javascript_alerts 页面完成 JavaScript Alert 交互：点击 "Click for JS Alert" 按钮触发原生 alert 弹窗，内容为 "I am a JS Alert"，弹窗被自动确认后页面结果区域显示 "You successfully clicked an alert"。两个页面均已成功读取，满足任务要求。';
const TINYMCE: FrameRead = {
  key: 'frame_1',
  sourceURL: 'about:blank',
  text: '- paragraph [ref=f1e3]: Your content goes here.',
};
const BLANK: FrameRead = {
  key: 'frame_1',
  sourceURL: 'about:blank',
  text: '- paragraph [ref=f1e3]',
};
const ALERTS_PAGE =
  'heading "JavaScript Alerts" button "Click for JS Alert" Result: You successfully clicked an alert';

describe('FIX-50 #1 · iframe content only from a frame the run read (Deploy-50 core-10)', () => {
  it('online verbatim: 「内容为跨源错误页」 with no frame read is unread', () => {
    expect(iframeContentGap(INTENT, ONLINE, [], true, [ALERTS_PAGE])).toEqual({ kind: 'unread' });
    // Whether or not a frame was listed: an error said of a frame never read never holds.
    expect(iframeContentGap(INTENT, ONLINE, [], false, [ALERTS_PAGE])).toEqual({ kind: 'unread' });
  });

  it('online verbatim against a read 「Your content goes here.」: mismatch, with what was read', () => {
    expect(iframeContentGap(INTENT, ONLINE, [TINYMCE], true, [ALERTS_PAGE])).toEqual({
      kind: 'mismatch',
      read: 'Your content goes here.',
    });
  });

  it('reverse: 「Your content goes here.」 read and written as read: no gap', () => {
    expect(iframeContentGap(INTENT, LOCAL_B, [TINYMCE], true, [ALERTS_PAGE])).toBeNull();
  });

  it('a blank frame read, written 「iframe 为空」: no gap; written as content: mismatch', () => {
    const empty =
      '1. /iframe 页面已读取，iframe 为空（读到的 iframe 里没有文字）。\n2. alert 已点击。';
    expect(iframeContentGap(INTENT, empty, [BLANK], true)).toBeNull();
    expect(iframeContentGap(INTENT, LOCAL_B, [BLANK], true, [ALERTS_PAGE])).toEqual({
      kind: 'mismatch',
      read: '',
    });
    // Said empty with no frame read at all: nothing to hold it to.
    expect(iframeContentGap(INTENT, empty, [], true)).toEqual({ kind: 'unread' });
    // Said empty while the frame read had text.
    expect(iframeContentGap(INTENT, empty, [TINYMCE], true)).toEqual({
      kind: 'mismatch',
      read: 'Your content goes here.',
    });
  });

  it('the page failed (Application error) and was reopened: the last good read stands', () => {
    const heroku: FrameRead = {
      key: 'frame_0',
      sourceURL: 'https://www.herokucdn.com/error-pages/application-error.html',
      text: '- heading "Application error" - paragraph: An error occurred in the application and your page could not be served.',
    };
    expect(iframeContentGap(INTENT, LOCAL_B, [heroku, TINYMCE], true, [ALERTS_PAGE])).toBeNull();
    // Only the error page read: the iframe was not read.
    expect(iframeContentGap(INTENT, LOCAL_B, [heroku], true, [ALERTS_PAGE])).toEqual({
      kind: 'unread',
    });
  });

  it('local A verbatim: the iframe asked for, its content not written', () => {
    expect(iframeContentGap(INTENT, LOCAL_A, [TINYMCE], true, [ALERTS_PAGE])).toEqual({
      kind: 'unstated',
      read: 'Your content goes here.',
    });
    expect(iframeContentGap(INTENT, LOCAL_A, [], true, [ALERTS_PAGE])).toEqual({ kind: 'unread' });
  });

  it('reverse: 「iframe 内容没有读到」 is honest, but with a read it is written back', () => {
    const honest =
      '部分完成：iframe 内容没有读到。\n2. alert：Result 显示 "You successfully clicked an alert"。';
    expect(iframeContentGap(INTENT, honest, [], true, [ALERTS_PAGE])).toEqual({ kind: 'unread' });
    expect(iframeContentGap(INTENT, honest, [TINYMCE], true, [ALERTS_PAGE])).toEqual({
      kind: 'unstated',
      read: 'Your content goes here.',
    });
  });

  it('reverse: no iframe asked, none listed, none described — no gap', () => {
    expect(
      iframeContentGap('打开 example.com 读标题', '标题：Example Domain。', [], false),
    ).toBeNull();
    // An iframe merely mentioned, nothing said of what it holds.
    expect(
      iframeContentGap(
        '打开 example.com 读标题',
        '标题：Example Domain。页面底部有一个 iframe。',
        [],
        true,
      ),
    ).toBeNull();
  });

  it('reverse: a frame text read into the page itself (no frame records) holds a quote', () => {
    const page =
      'heading "An iFrame containing the TinyMCE WYSIWYG Editor" iframe Rich Text Area Your content goes here.';
    const answer = '1. iframe：编辑器内容为「Your content goes here.」。\n2. alert 已点击。';
    expect(iframeContentGap(INTENT, answer, [], false, [page])).toBeNull();
    expect(
      iframeContentGap(INTENT, '1. iframe：编辑器内容为「Hello world」。', [], false, [page]),
    ).toEqual({ kind: 'unread' });
  });
});

describe('FIX-50 #1 · frame reads from a read result', () => {
  it('a main-frame snapshot: inline same-origin frames are read, limited ones are not', () => {
    const text = JSON.stringify({
      frameId: 'frame_main',
      tree: '- heading "An iFrame containing the TinyMCE WYSIWYG Editor"\n- iframe [ref=e5]',
      frames: [
        {
          frameId: 'frame_1',
          sourceURL: 'about:blank',
          tree: '- paragraph: Your content goes here.',
        },
        { frameId: 'frame_2', sourceURL: 'https://ads.example/x', limitation: '跨源 iframe：…' },
      ],
    });
    expect(frameReadsOf(text, false)).toEqual([
      { key: 'frame_1', sourceURL: 'about:blank', text: '- paragraph: Your content goes here.' },
    ]);
  });
  it('a child frame read by its frameId (read_page / get_page_text)', () => {
    expect(
      frameReadsOf(
        JSON.stringify({ frameId: 'frame_2', sourceURL: 'https://ads.example/x', text: 'Ad text' }),
        true,
      ),
    ).toEqual([{ key: 'frame_2', sourceURL: 'https://ads.example/x', text: 'Ad text' }]);
    expect(frameReadsOf('not json', true)).toEqual([]);
  });
});

describe('FIX-50 #1 · in the loop', () => {
  const IFRAME = 'https://the-internet.herokuapp.com/iframe';
  const BOXES = 'https://the-internet.herokuapp.com/checkboxes';
  // A part that needs no dialog receipts, as FIX-45's loop test: 「iframe 与 checkboxes」.
  const LOOP_INTENT = '请使用云端浏览器，the-internet.herokuapp.com 的 iframe 与 checkboxes';
  const HEADING =
    '- heading "An iFrame containing the TinyMCE WYSIWYG Editor" [level=3]\n- iframe [ref=e5]';
  const BOX_TREE =
    '- heading "Checkboxes"\n- checkbox "checkbox 1"\n- checkbox "checkbox 2" [checked]';
  const run = (
    calls: Array<{ name: string; input: Record<string, unknown> }>,
    inline: string | null,
    child = '- paragraph [ref=f1e3]: Your content goes here.',
  ) => {
    let url = 'about:blank';
    const seen: string[] = [];
    let turn = 0;
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
    return runUnifiedBrowserLoop({
      intent: LOOP_INTENT,
      adapter,
      maxSteps: 14,
      observationV2: true,
      currentPageUrl: () => url,
      execute: (async (action: { tool: string; url?: string; frameId?: string }) => {
        if (action.tool === 'navigate') url = action.url!;
        if (action.frameId === 'frame_1')
          return {
            ok: true,
            url,
            text: JSON.stringify({
              frameId: 'frame_1',
              sourceURL: 'about:blank',
              tree: child,
              frames: [],
            }),
          };
        const frames =
          url !== IFRAME
            ? []
            : inline === null
              ? [
                  {
                    frameId: 'frame_1',
                    sourceURL: 'about:blank',
                    limitation: 'iframe 尚未就绪，请重新读取。',
                  },
                ]
              : [{ frameId: 'frame_1', sourceURL: 'about:blank', tree: inline }];
        return {
          ok: true,
          url,
          text: JSON.stringify({
            frameId: 'frame_main',
            sourceURL: url,
            tree: url === IFRAME ? HEADING : BOX_TREE,
            frames,
          }),
        };
      }) as never,
    }).then((outcome) => ({ outcome, seen: seen.join('\n') }));
  };
  const finish = (summary: string) => ({ name: 'finish', input: { status: 'completed', summary } });
  const visit = [
    { name: 'navigate', input: { url: IFRAME } },
    { name: 'snapshot', input: {} },
    { name: 'navigate', input: { url: BOXES } },
    { name: 'snapshot', input: {} },
  ];
  const WRONG =
    '1. iframe：该页包含一个 iframe，内容为跨源错误页。\n2. checkboxes：checkbox 1 未勾选，checkbox 2 已勾选。';
  const RIGHT =
    '1. iframe：读取 iframe 内嵌框架中的文本内容为 "Your content goes here."。\n2. checkboxes：checkbox 1 未勾选，checkbox 2 已勾选。';

  it('online shape: never read, sent back once; still not read: 部分完成「iframe 内容没有读到」', async () => {
    const { outcome, seen } = await run([...visit, finish(WRONG), finish(WRONG)], null);
    expect(seen).toContain('frames 列表里找到这个 iframe 的 frameId');
    expect(outcome).toMatchObject({ status: 'completed', partial: { missing: 'iframe 内容' } });
    expect(outcome.status === 'completed' && outcome.summary).toMatch(
      /^部分完成：iframe 内容没有读到/,
    );
  });

  it('sent back, it reads the frame by its frameId and writes it: completed', async () => {
    const { outcome } = await run(
      [
        ...visit,
        finish(WRONG),
        { name: 'navigate', input: { url: IFRAME } },
        { name: 'read_page', input: { frameId: 'frame_1' } },
        finish(RIGHT),
      ],
      null,
    );
    expect(outcome.status).toBe('completed');
    expect(outcome).not.toHaveProperty('partial');
  });

  it('read inline by the snapshot, written as read: completed, not sent back', async () => {
    const { outcome, seen } = await run(
      [...visit, finish(RIGHT)],
      '- paragraph [ref=f1e3]: Your content goes here.',
    );
    expect(seen).not.toContain('iframe 的内容和本次读到的不一致');
    expect(outcome.status).toBe('completed');
    expect(outcome).not.toHaveProperty('partial');
  });

  it('read inline, but written as 跨源错误页: sent back with what was read', async () => {
    const { outcome, seen } = await run(
      [...visit, finish(WRONG), finish(WRONG)],
      '- paragraph [ref=f1e3]: Your content goes here.',
    );
    expect(seen).toContain('最近一次读到的 iframe 内容是「Your content goes here.」');
    expect(outcome.status === 'completed' && outcome.summary).toMatch(
      /^部分完成：答案中的 iframe 内容与本次读到的不一致/,
    );
  });

  it('PR #314 review: the frame read by a cloud switch_tab counts (「iframe 为空」 completed)', async () => {
    const empty =
      '1. iframe：已读取 iframe，iframe 为空，里面没有文字。\n2. checkboxes：checkbox 1 未勾选，checkbox 2 已勾选。';
    const { outcome } = await run(
      [
        { name: 'navigate', input: { url: IFRAME } },
        { name: 'navigate', input: { url: BOXES } },
        { name: 'snapshot', input: {} },
        { name: 'navigate', input: { url: IFRAME } },
        { name: 'switch_tab', input: { targetTabId: 'tab_1' } },
        finish(empty),
      ],
      '- paragraph [ref=f1e3]',
    );
    expect(outcome.status).toBe('completed');
    expect(outcome).not.toHaveProperty('partial');
  });

  it('a blank frame, written 「iframe 为空」: completed', async () => {
    const empty =
      '1. iframe：已读取 iframe，iframe 为空，里面没有文字。\n2. checkboxes：checkbox 1 未勾选，checkbox 2 已勾选。';
    const { outcome } = await run([...visit, finish(empty)], '- paragraph [ref=f1e3]');
    expect(outcome.status).toBe('completed');
    expect(outcome).not.toHaveProperty('partial');
  });
});

describe('PR #314 review · each frame by its own read; short text; cloud tab switches', () => {
  const CONTENT: FrameRead = {
    key: 'frame_1',
    sourceURL: 'about:blank',
    text: '- paragraph: Your content goes here.',
  };
  const EMPTY_AFTER: FrameRead = { key: 'frame_2', sourceURL: 'about:blank', text: '- paragraph' };
  it('a content frame followed by an empty one: the quoted content holds', () => {
    const answer = '编辑器 iframe 内容为「Your content goes here.」。';
    expect(iframeContentGap(INTENT, answer, [CONTENT, EMPTY_AFTER], true)).toBeNull();
    // 「为空」 holds for the empty frame too, and the corrective evidence is the filled frame.
    expect(
      iframeContentGap(INTENT, '第二个 iframe 为空。', [CONTENT, EMPTY_AFTER], true),
    ).toBeNull();
    expect(
      iframeContentGap(INTENT, 'iframe 内容为跨源错误页。', [CONTENT, EMPTY_AFTER], true),
    ).toEqual({ kind: 'mismatch', read: 'Your content goes here.' });
  });
  it('reverse: the same frame read again with content — the earlier blank read no longer stands', () => {
    const later: FrameRead = { ...TINYMCE };
    expect(iframeContentGap(INTENT, 'iframe 为空。', [BLANK, later], true)).toEqual({
      kind: 'mismatch',
      read: 'Your content goes here.',
    });
  });
  it('a frame text shorter than four characters, quoted as it stands: no gap', () => {
    const hello: FrameRead = {
      key: 'frame_1',
      sourceURL: 'about:blank',
      text: '- paragraph: 你好',
    };
    expect(iframeContentGap(INTENT, 'iframe 内容为「你好」。', [hello], true)).toBeNull();
    // reverse: not written, or another short quote, still does not hold.
    expect(iframeContentGap(INTENT, 'iframe 已读取。', [hello], true)).toEqual({
      kind: 'unstated',
      read: '你好',
    });
    expect(iframeContentGap(INTENT, 'iframe 内容为「再见」。', [hello], true)).toEqual({
      kind: 'mismatch',
      read: '你好',
    });
  });
});

describe('DEPLOY-51 review #1 · iframe claims (fix-50/review1-fixtures/iframe314.mjs)', () => {
  const I = '请使用云端浏览器，the-internet.herokuapp.com 的 iframe 与 checkboxes';
  const T: FrameRead = {
    key: 'frame_1',
    sourceURL: 'about:blank',
    text: '- paragraph [ref=f1e3]: Your content goes here.',
  };
  const AD: FrameRead = {
    key: 'frame_9',
    sourceURL: 'https://ads.example/x',
    text: '- link "Buy shoes 50% off"',
  };
  const P = ['heading "An iFrame containing the TinyMCE WYSIWYG Editor" iframe'];
  const gap = (intent: string, answer: string, reads: FrameRead[], pages: string[]) =>
    iframeContentGap(intent, answer, reads, true, pages);

  it('#1 red line: words not in any read — a paraphrase, a second iframe made up', () => {
    expect(gap(I, 'iframe 内容为：您的内容放在这里。checkboxes 已读。', [T], P)).toEqual({
      kind: 'mismatch',
      read: 'Your content goes here.',
    });
    expect(
      gap(
        I,
        '第一个 iframe 内容为 "Your content goes here."。第二个 iframe 显示的是一个登录表单，要求输入手机号。',
        [T],
        P,
      ),
    ).toMatchObject({ kind: 'mismatch' });
    expect(
      gap(
        I,
        '第一个 iframe 内容为 "Your content goes here."。第二个 iframe 内容为「请登录」。',
        [T],
        P,
      ),
    ).toMatchObject({ kind: 'mismatch' });
    expect(gap(I, '编辑器里写着：Hello world。checkboxes 已读。iframe 已读取。', [T], P)).toEqual({
      kind: 'unstated',
      read: 'Your content goes here.',
    });
  });

  it('#1 red line: a quote of the page around it, a word picked out, real mixed with made up', () => {
    expect(
      gap(I, 'iframe 内容为「An iFrame containing the TinyMCE WYSIWYG Editor」。', [T], P),
    ).toMatchObject({ kind: 'mismatch' });
    expect(gap(I, 'iframe 内容为「Your」。', [T], P)).toMatchObject({ kind: 'mismatch' });
    expect(gap(I, 'iframe 内容为「Your content goes here. Hello admin」。', [T], P)).toMatchObject({
      kind: 'mismatch',
    });
  });

  it('#1 reverse: words a read has, quoted or not, still hold', () => {
    expect(gap(I, 'iframe 内容为 Your content goes here，checkboxes 已读。', [T], P)).toBeNull();
    expect(gap(I, 'iframe 中显示的是编辑器，内容为 "Your content goes here"。', [T], P)).toBeNull();
    const MCE: FrameRead = {
      key: 'frame_1',
      sourceURL: 'about:blank',
      text: '- application "Rich Text Area. Press ALT-0 for help."\n- paragraph: Your content goes here.',
    };
    expect(
      gap(
        I,
        'TinyMCE 编辑器 iframe 内容为「Rich Text Area. Press ALT-0 for help. Your content goes here.」。',
        [MCE],
        P,
      ),
    ).toBeNull();
  });

  it('#5 a quote of the ad frame said to be the editor: mismatch, with the editor read', () => {
    expect(gap(I, '编辑器 iframe 内容为「Buy shoes 50% off」。', [T, AD], P)).toEqual({
      kind: 'mismatch',
      read: 'Your content goes here.',
    });
    // Reverse: each named by its own text.
    expect(
      gap(
        I,
        '编辑器 iframe 内容为「Your content goes here.」；广告 iframe 内容为「Buy shoes 50% off」。',
        [T, AD],
        P,
      ),
    ).toBeNull();
    // Named by host.
    expect(gap(I, 'ads.example 的 iframe 内容为「Your content goes here.」。', [T, AD], P)).toEqual(
      {
        kind: 'mismatch',
        read: 'Buy shoes 50% off',
      },
    );
  });

  it('#3 not asked: a made-up iframe sentence is dropped, the answer otherwise stands', () => {
    const yt = '标题：X。页面里的 YouTube iframe 显示的是《晴天》MV。';
    expect(gap('读页面标题', yt, [], ['heading "X"'])).toEqual({
      kind: 'drop',
      sentences: ['页面里的 YouTube iframe 显示的是《晴天》MV'],
    });
    expect(
      gap('读页面标题', '标题：X。页面里的 iframe 显示的是一个登录表单。', [AD], ['heading "X"']),
    ).toEqual({
      kind: 'drop',
      sentences: ['页面里的 iframe 显示的是一个登录表单'],
    });
  });

  it('#3 not asked: an iframe mentioned, or what the next clause says, is not checked', () => {
    const cases: Array<[string, string, FrameRead[], string[]]> = [
      [
        '读页面标题',
        '标题：Example。页面右侧有一个广告 iframe，显示一双鞋的广告。',
        [],
        ['heading "Example"'],
      ],
      ['查商品价格', '页面嵌有 iframe，商品价格显示为 99 元。', [], ['price ¥99']],
      [
        'check the cart',
        'There is a tracking iframe; the cart is empty.',
        [],
        ['Your cart is empty'],
      ],
      [
        'check the cart',
        'There is a tracking iframe; the cart is empty.',
        [AD],
        ['Your cart is empty'],
      ],
      ['读页面标题', '标题：Example。页面里有个 iframe。', [], ['heading "Example"']],
      ['登录前看看页面', '页面底部的 reCAPTCHA iframe 无法加载。', [], ['Sign in']],
      ['查商品价格', '商品价格为 99 元，iframe 下方的价格显示为 99 元。', [], ['price ¥99']],
    ];
    for (const [intent, answer, reads, pages] of cases)
      expect(gap(intent, answer, reads, pages), answer).toBeNull();
  });

  it('#4 「框架中」 alone is not an iframe, in the task or the answer', () => {
    expect(
      gap(
        '查欧盟 AI 法案罚款',
        '在欧盟监管框架中，罚款上限显示为全球营业额的7%。',
        [],
        ['fines up to 7% of global turnover'],
      ),
    ).toBeNull();
    expect(
      gap('查一下 Next.js 框架中的路由文档', 'Next.js 使用 app 目录路由。', [], ['App Router']),
    ).toBeNull();
    expect(gap('Rust 嵌入式框架中的中断处理', 'RTIC 使用优先级调度。', [], ['RTIC'])).toBeNull();
    // Reverse: 内嵌 / 嵌入 / 子 next to 框架 still is.
    expect(gap('读页面中嵌入的那个框架里的文字', '页面已读取。', [T], P)).toEqual({
      kind: 'unstated',
      read: 'Your content goes here.',
    });
  });

  it('dropSentences takes out only those sentences', () => {
    expect(
      dropSentences('标题：X。页面里的 YouTube iframe 显示的是《晴天》MV。作者：Y。', [
        '页面里的 YouTube iframe 显示的是《晴天》MV',
      ]),
    ).toBe('标题：X。作者：Y。');
  });
});

describe('DEPLOY-51 review #1 · in the loop', () => {
  const IFRAME = 'https://the-internet.herokuapp.com/iframe';
  const turnOf = (calls: Array<{ name: string; input: Record<string, unknown> }>) => {
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
    return { adapter, seen };
  };
  const finish = (summary: string) => ({ name: 'finish', input: { status: 'completed', summary } });

  it('#2 the page reloaded (new frameId): the old frame read no longer stands', async () => {
    let loads = 0;
    const { adapter, seen } = turnOf([
      { name: 'navigate', input: { url: IFRAME } },
      { name: 'snapshot', input: {} },
      { name: 'read_page', input: { frameId: 'frame_1' } },
      { name: 'navigate', input: { url: IFRAME } },
      { name: 'snapshot', input: {} },
      finish('iframe 内容为「Old text」。'),
      finish('iframe 内容为「Old text」。'),
    ]);
    const outcome = await runUnifiedBrowserLoop({
      intent: '请使用云端浏览器，读 the-internet.herokuapp.com 的 iframe',
      adapter,
      maxSteps: 12,
      observationV2: true,
      currentPageUrl: () => IFRAME,
      execute: (async (action: { tool: string; frameId?: string }) => {
        if (action.tool === 'navigate') loads++;
        if (action.frameId)
          return {
            ok: true,
            url: IFRAME,
            text: JSON.stringify({
              frameId: action.frameId,
              sourceURL: 'about:blank',
              tree: '- paragraph: Old text',
            }),
          };
        return {
          ok: true,
          url: IFRAME,
          text: JSON.stringify({
            frameId: 'frame_main',
            sourceURL: IFRAME,
            tree: '- heading "An iFrame" [level=3]\n- iframe [ref=e5]',
            frames: [
              { frameId: `frame_${loads}`, sourceURL: 'about:blank', limitation: '跨源 iframe' },
            ],
          }),
        };
      }) as never,
    });
    expect(seen.join('\n')).toContain('本次还没有读到这个 iframe 本身');
    expect(outcome).toMatchObject({ status: 'completed', partial: { missing: 'iframe 内容' } });
    expect((outcome as { summary: string }).summary).toMatch(/^部分完成：iframe 内容没有读到/);
  });

  it('#3 not asked: the made-up iframe sentence is taken out, completed, not sent back', async () => {
    const PAGE = 'https://example.com/';
    const { adapter, seen } = turnOf([
      { name: 'navigate', input: { url: PAGE } },
      { name: 'snapshot', input: {} },
      finish('标题：Example Domain。页面里的 YouTube iframe 显示的是《晴天》MV。'),
    ]);
    const outcome = await runUnifiedBrowserLoop({
      intent: '请使用云端浏览器，打开 example.com 读页面标题',
      adapter,
      maxSteps: 8,
      observationV2: true,
      currentPageUrl: () => PAGE,
      execute: (async () => ({
        ok: true,
        url: PAGE,
        text: JSON.stringify({
          frameId: 'frame_main',
          sourceURL: PAGE,
          tree: '- heading "Example Domain" [level=1]',
          frames: [
            {
              frameId: 'frame_1',
              sourceURL: 'https://www.youtube.com/embed/x',
              limitation: '跨源 iframe',
            },
          ],
        }),
      })) as never,
    });
    expect(seen.join('\n')).not.toContain('iframe 本身');
    expect(outcome).toMatchObject({ status: 'completed' });
    expect((outcome as { partial?: unknown }).partial).toBeUndefined();
    expect((outcome as { summary: string }).summary).toContain('标题：Example Domain。');
    expect((outcome as { summary: string }).summary).not.toContain('晴天');
  });
});
