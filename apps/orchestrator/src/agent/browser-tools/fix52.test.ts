import { describe, expect, it } from 'vitest';
import { anchoredLogPost, bestBuySensorShape, keyedLogCheck } from './cloud-observation.js';
import { iframeContentGap } from './completion-coverage.js';
import { SNAPSHOT_TRUNCATED, assessCompletionFacts } from './completion-fields.js';

const INTENT = '请使用云端浏览器，the-internet.herokuapp.com 的 iframe 与 JavaScript alerts';
const FRAME = {
  key: 'frame_1',
  sourceURL: 'about:srcdoc',
  text: '- generic "Rich Text Area. Press ALT-0 for help." [active] [ref=f1e1]:\n  - paragraph [ref=f1e2]: Your content goes here.',
};
// As the real /iframe page reads (2026-11-02): the toolbar above the frame's line, the links below.
const PARENT = `https://the-internet.herokuapp.com/iframe
- heading "An iFrame containing the TinyMCE WYSIWYG Editor" [level=3] [ref=e8]
- menubar [ref=e12]:
  - menuitem "File" [ref=e13]
  - menuitem "Edit" [ref=e15]
- toolbar "history" [ref=e25]:
  - button "Undo" [disabled] [ref=e26]
  - button "Redo" [disabled] [ref=e30]
- toolbar "styles" [ref=e34]:
  - button "Format Paragraph" [ref=e35]
- toolbar "formatting" [ref=e40]:
  - button "Bold" [ref=e41]
  - button "Italic" [ref=e45]
- iframe [ref=e77]:
- button "Close" [ref=e90]
- link "Elemental Selenium" [ref=e99]`;
const ALERTS =
  'https://the-internet.herokuapp.com/javascript_alerts heading "JavaScript Alerts" button "Click for JS Alert" button "Click for JS Confirm" Result: You successfully clicked an alert\nI am a JS Alert';
const PAGES = [PARENT, ALERTS];
const QUOTED = 'iframe 内容为 "Your content goes here."';
const kind = (answer: string, pages: readonly string[] = PAGES, intent = INTENT) =>
  iframeContentGap(intent, answer, [FRAME], true, pages)?.kind;

describe('FIX-52 #1 · core-04: what the answer says it left out is not a video it claims', () => {
  const VIDEO_INTENT = '请使用云端浏览器，在 YouTube 搜索 Playwright tutorial，给出前 5 个视频标题';
  const SEARCH = 'https://www.youtube.com/results?search_query=Playwright+tutorial';
  const pages = [
    {
      text: 'What is Playwright? Playwright Beginner Tutorials playlist',
      sourceURL: SEARCH,
      links: [
        {
          text: 'What is Playwright?',
          url: 'https://www.youtube.com/watch?v=wGr5rz8WGCE',
          kind: 'video',
        },
        {
          text: 'Playwright Beginner Tutorials',
          url: 'https://www.youtube.com/playlist?list=1',
          kind: 'playlist',
        },
        { text: 'playlist', url: 'https://www.youtube.com/playlist?list=2', kind: 'playlist' },
      ],
    },
  ];
  const check = (summary: string) =>
    assessCompletionFacts({ summary, pages, intent: VIDEO_INTENT }).contradictions;

  it('the online answers (Deploy-52 core-04, attempts 2 and 3) pass', () => {
    expect(
      check(
        '前5个视频如下：\n\n1. What is Playwright?\n\n说明：搜索结果中大量条目为播放列表/课程（如 "Playwright Beginner Tutorials"），已按要求剔除；上述5条均为 links 返回的 kind="video" 项。',
      ),
    ).toEqual([]);
    expect(
      check(
        '前5个视频如下：\n\n1. What is Playwright?\n\n说明：搜索结果中大量条目为播放列表/课程/频道（例如 links 返回 kind="playlist" 或 kind="channel" 的项），已按要求剔除。',
      ),
    ).toEqual([]);
  });

  it.each([
    '1. "Playwright Beginner Tutorials"',
    '1. "Playwright Beginner Tutorials"（已排除广告）',
    '前 5 个视频包括 "Playwright Beginner Tutorials"。',
    '"Playwright Beginner Tutorials" 是第一个视频；另外已排除 "Playwright Beginner Tutorials" 的广告。',
  ])('a playlist given as a video is still caught: %s', (summary) => {
    expect(check(summary).join()).toContain('播放列表/频道');
  });
});

describe('FIX-52 #2 · reg-new-amazon-sg: a price not read at a cut read gets one more look', () => {
  const ROWS =
    '1. 名称：UGREEN 2M；价格：未获取到（快照中该商品的价格区域被截断，未显示具体价格文本）';
  const assess = (text: string) =>
    assessCompletionFacts({
      summary: ROWS,
      pages: [{ text, sourceURL: 'https://www.amazon.sg/s?k=usb+c+cable' }],
      intent: '在亚马逊新加坡站搜索 usb c cable，给出前三个商品的名称和价格',
    });

  it('the online row, on a read cut at its budget', () => {
    expect(assess(`UGREEN 2M\n${SNAPSHOT_TRUNCATED}`).cutPrices?.join()).toContain('未获取到');
  });
  it('the answer itself says the read was cut', () => {
    expect(assess('UGREEN 2M').cutPrices?.join()).toContain('截断');
  });
  it('未获取到 with no cut anywhere is the page truth', () => {
    const facts = assessCompletionFacts({
      summary: '1. 名称：UGREEN 2M；价格：未获取到',
      pages: [{ text: 'UGREEN 2M', sourceURL: 'https://www.amazon.sg/s?k=usb+c+cable' }],
    });
    expect(facts.cutPrices).toBeUndefined();
  });
});

describe('FIX-52 #3 · 「并有」: what names nothing, and what the page calls otherwise', () => {
  it.each([
    '，并有 File、Edit 菜单。',
    '，并有菜单栏。',
    '，并有样式按钮。',
    '，并有段落样式下拉框。',
    '，并有明确反馈。',
    '，并有光标闪烁。',
  ])('passes: %s', (rest) => {
    expect(kind(QUOTED + rest)).toBeUndefined();
  });
  it.each([
    '，并有一个计数器。',
    '，并有计数器。',
    '，并有一段使用说明。',
    '，并有管理员入口。',
    '，并有保存按钮。',
    '，并有支付下拉框。',
    '，并有一个登录菜单。',
    '，并有 "Admin login here" 提示。',
  ])('sent back: %s', (rest) => {
    expect(kind(QUOTED + rest)).toBe('mismatch');
  });
});

describe('FIX-52 #4 · an iframe nobody asked about, in a bracket', () => {
  const SHOP = '请使用云端浏览器，查门店地址';
  const ANSWER = '门店位于北京朝阳区建国路 88 号（页面里的地图 iframe 显示正常）。';
  const page = ['门店 北京朝阳区建国路 88 号'];
  it('frame read: nothing is said of what it holds', () => {
    expect(iframeContentGap(SHOP, ANSWER, [FRAME], true, page)).toBeNull();
  });
  it('frame not read: only the bracket goes, the address stands', () => {
    expect(iframeContentGap(SHOP, ANSWER, [], true, page)).toEqual({
      kind: 'drop',
      clauses: ['（页面里的地图 iframe 显示正常）'],
    });
  });
  it('made up in a bracket: the bracket goes', () => {
    expect(
      iframeContentGap(
        '读 shop.example 的商品价格',
        '商品价格为 99 元（广告 iframe 显示的是一双鞋）。',
        [FRAME],
        true,
        page,
      ),
    ).toEqual({ kind: 'drop', clauses: ['（广告 iframe 显示的是一双鞋）'] });
  });
});

describe('FIX-52 #5 · 「关闭按钮可用」 when the read lacks what the page calls it', () => {
  const noClose = [PARENT.replace('button "Close" [ref=e90]', ''), ALERTS];
  it('sent back without, passes with the control names', () => {
    expect(kind(`${QUOTED}，关闭按钮可用。`, noClose)).toBe('mismatch');
    expect(kind(`${QUOTED}，关闭按钮可用。`, [...noClose, 'Close'])).toBeUndefined();
    expect(kind(`${QUOTED}，关闭按钮可用。`, [...noClose, '关闭'])).toBeUndefined();
  });
  it('other control names do not help', () => {
    expect(kind(`${QUOTED}，关闭按钮可用。`, [...noClose, 'Undo Redo'])).toBe('mismatch');
  });
});

describe('FIX-52 #6 · 高德 collapsar with tid, timestamp, uid', () => {
  const AMAP = new URL('https://collapsar.amap.com/alc/h5/upload');
  const form = (over: Record<string, string> = {}) =>
    new URLSearchParams({
      adiu: 'a1b2c3d4',
      buildVersion: '1.0.0',
      channel: 'amap',
      content: 'H4sIAAAAAAAA',
      diu: 'x1',
      env: 'prod',
      h5Version: '2',
      idfa: '',
      imei: '',
      md5: 'abcdef',
      miniProgramVersion: '',
      mode: 'h5',
      tid: 'Xy12-ab',
      timestamp: '1793632376000',
      uid: '',
      ...over,
    }).toString();
  it('the Deploy-52 shape is the device log', () => {
    expect(keyedLogCheck(AMAP, form())).toBeNull();
    expect(anchoredLogPost(AMAP, 'POST', form())).toBe(true);
  });
  it.each([
    ['timestamp text', { timestamp: 'order=1' }, 'timestamp:not-a-number'],
    ['uid text', { uid: '张三 13800000000' }, 'uid:not-an-id'],
    ['tid a url', { tid: 'https://x.io/?a=1' }, 'tid:not-an-id'],
    ['a key off the list', { phone: '13800000000' }, 'key:phone'],
  ])('%s still pauses', (_label, over, why) => {
    expect(keyedLogCheck(AMAP, form(over))).toBe(why);
    expect(anchoredLogPost(AMAP, 'POST', form(over))).toBe(false);
  });
});

describe('FIX-52 #7 · the BestBuy sensor shapes of Deploy-51 and Deploy-52', () => {
  const OPAQUE = 'a1B2'.repeat(980);
  const sensor = `{"sensor_data":"${OPAQUE}"}`;
  const body = `{"body":"${OPAQUE}"}`;
  it.each([
    ['/ZbNw/sBB0/d/H/CUq4bgxg/1LfENmG7YhO9wcartY/U3FqJk0lAg/aQ/ZnF3sdSAU', sensor],
    ['/ZbNw/sBB0/d/H/CUq4bgxg/hLfENmG7YhO9/EGpxJk0lAg/Yn/kNaxoZYkcb', sensor],
    ['/3Xje-E/v6Ja/7kNf/77_x/iOIAs2/XLE3JS9puu/C2QjSzUB/PVtVd2oI/aBcb', body],
    ['/xUJwkAxLQZzw9WGzcA08/QVbE2G9J/XEtocQ/ExkWbCU/YJCMb', body],
  ])('%s is the sensor', (path, payload) => {
    expect(bestBuySensorShape(new URL(`https://www.bestbuy.com${path}`), 'POST', payload)).toBe(
      true,
    );
  });
  it.each([
    ['a CamelCase write', '/site/CustomerService/AbC1/AddToCart/SubmitOrder/x9Y', body],
    ['a word in one case', '/addtocart/AbC1/DeF2/GhI3/JkL4', body],
    ['delimited words', '/add_to_cart/AbC1/DeF2/GhI3/JkL4', body],
    ['a version', '/v2/AbC1/DeF2/GhI3/JkL4', body],
    ['many one-letter segments', '/a/b/c/AbC1/DeF2/GhI3/JkL4', body],
    ['one segment with a digit', '/AbCd/EfGh/IjKl/MnOp/Qr1t', body],
    [
      'a real body',
      '/ZbNw/sBB0/d/H/CUq4bgxg/hLfENmG7YhO9/EGpxJk0lAg/Yn/kNaxoZYkcb',
      '{"sensor_data":"sku=1&qty=2"}',
    ],
    [
      'json inside',
      '/ZbNw/sBB0/d/H/CUq4bgxg/hLfENmG7YhO9/EGpxJk0lAg/Yn/kNaxoZYkcb',
      `{"body":"{\\"action\\":\\"addToCart\\",\\"pad\\":\\"${'x'.repeat(1200)}\\"}"}`,
    ],
  ])('%s still pauses', (_label, path, payload) => {
    expect(bestBuySensorShape(new URL(`https://www.bestbuy.com${path}`), 'POST', payload)).toBe(
      false,
    );
  });
});

describe("FIX-52 #9 · the task's other parts, after the iframe (t8 B 组)", () => {
  it.each([
    '；alert 弹窗旁是管理员链接。',
    '；JS Alert 页面右侧是管理员面板。',
    '；点击 Click for JS Alert 后弹出 "Admin login required"。',
    '；Result 显示 "You successfully clicked an alert"，下面是管理员链接。',
    '。alert 下方是登录按钮。',
  ])('sent back: %s', (rest) => {
    const gap = iframeContentGap(INTENT, QUOTED + rest, [FRAME], true, PAGES);
    expect(gap?.kind).toBe('mismatch');
  });
  it.each([
    '；点击 Click for JS Alert 后弹出 "I am a JS Alert"。',
    '；Result 显示 "You successfully clicked an alert"。',
    '；JS Alert 页面有 Click for JS Alert 按钮。',
    '。\n\n2. JavaScript Alerts：点击「Click for JS Alert」按钮后弹窗消息原文为「I am a JS Alert」。',
    '；未执行登录，也没有点击管理员链接。',
    '；并导航至 /javascript_alerts 完成 alert。',
    '。\n\n2. JavaScript Alerts：浏览器自动选择"取消"。',
    '。\n\n未核实：以下内容未能在已读页面中逐字找到——"Admin thing"',
  ])('passes: %s', (rest) => {
    expect(kind(QUOTED + rest)).toBeUndefined();
  });
  it('names the clause that does not hold, not the iframe', () => {
    const gap = iframeContentGap(
      INTENT,
      `${QUOTED}；alert 弹窗旁是管理员链接。`,
      [FRAME],
      true,
      PAGES,
    );
    expect(gap).toMatchObject({ kind: 'mismatch', other: 'alert 弹窗旁是管理员链接' });
  });
});

describe('FIX-52 #10 · which one, written apart from the thing', () => {
  it.each([
    '，页面上还有名为提交的按钮。',
    '，页面上还有按钮：提交。',
    '，页面上还有按钮名为提交。',
    '，页面上还有名为 Save 的按钮。',
    '，页面上还有按钮：Save。',
    '，下方还有 Bold 按钮。',
    '，下方还有加粗按钮。',
    '，上方还有 Elemental Selenium 链接。',
  ])('sent back: %s', (rest) => {
    expect(kind(QUOTED + rest)).toBe('mismatch');
  });
  it.each([
    '，页面上还有名为 Bold 的按钮。',
    '，页面上还有按钮：Bold。',
    '，页面上还有名为加粗的按钮。',
    '，下方还有 Elemental Selenium 链接。',
    '，底部有 Elemental Selenium 链接。',
    '，上方有 Bold 按钮。',
  ])('passes: %s', (rest) => {
    expect(kind(QUOTED + rest)).toBeUndefined();
  });
  it('a read that does not show the frame says nothing of the order', () => {
    expect(
      kind(`${QUOTED}，下方还有 Bold 按钮。`, [PARENT.replace('- iframe [ref=e77]:', ''), ALERTS]),
    ).toBeUndefined();
  });
});

describe('FIX-52 #11 · a negation does not reach what is said to be there', () => {
  it.each([
    '，未执行登录和管理员链接很明显。',
    '，未见异常管理员后台。',
    '，无报错管理员入口。',
    '，未执行登录与 Admin 链接可见。',
  ])('sent back: %s', (rest) => {
    expect(kind(QUOTED + rest)).toBe('mismatch');
  });
  it.each([
    '，未执行登录，也没有点击任何链接。',
    '，未触发表单提交、登录或支付。',
    '，未见管理员链接。',
    '，没有管理员入口。',
    '，未见异常。',
    '，未发现登录按钮。',
    '，未执行登录和注册。',
  ])('passes: %s', (rest) => {
    expect(kind(QUOTED + rest)).toBeUndefined();
  });
});

describe('FIX-52 #12 · made-up text ahead of the real quote, with other verbs', () => {
  it.each([
    'iframe 显示欢迎来到我们的网站，正文为 "Your content goes here."。',
    'iframe 写着管理员请登录，正文为 "Your content goes here."。',
    'iframe 里是假内容，正文为 "Your content goes here."。',
    'iframe 中是欢迎页面，内容为 "Your content goes here."。',
    'iframe 显示 welcome aboard，文本为 "Your content goes here."。',
  ])('sent back: %s', (answer) => {
    expect(kind(answer)).toBe('mismatch');
  });
  it.each([
    'iframe 显示 "Your content goes here."。',
    'iframe 显示正常，内容为 "Your content goes here."。',
    'iframe 显示的文本为 "Your content goes here."。',
    'iframe 里是一段默认文本，内容为 "Your content goes here."。',
    'iframe 显示 Your content goes here.',
    'iframe 显示编辑器默认内容，正文为 "Your content goes here."。',
  ])('passes: %s', (answer) => {
    expect(kind(answer)).toBeUndefined();
  });
});
