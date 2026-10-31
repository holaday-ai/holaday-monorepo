import { describe, expect, it } from 'vitest';
import type { MessagesAdapter } from '../../llm/messages-adapter.js';
import { type FrameRead, frameReadsOf, iframeContentGap } from './completion-coverage.js';
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

  it('a blank frame, written 「iframe 为空」: completed', async () => {
    const empty =
      '1. iframe：已读取 iframe，iframe 为空，里面没有文字。\n2. checkboxes：checkbox 1 未勾选，checkbox 2 已勾选。';
    const { outcome } = await run([...visit, finish(empty)], '- paragraph [ref=f1e3]');
    expect(outcome.status).toBe('completed');
    expect(outcome).not.toHaveProperty('partial');
  });
});
