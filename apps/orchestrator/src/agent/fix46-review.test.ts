import { readLoginContext } from '@holaday/shared-types';
import { type Browser, chromium } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { declaredAbsentFields } from './browser-tools/completion-fields.js';
import { answerNotObtained } from './scrape-answer-check.js';

/** DEPLOY-46 复审 #1: the coordinator's fix-45/review1-fixtures/fa.mjs, case for case. */
describe('DEPLOY-46 复审 #1 · fa.mjs: only a real value of the same item, shown on a read page, fills a gap', () => {
  const PAGES = [
    'Anker USB C to USB C Cable, 60W (2-Pack, 3.3 ft, Black) S$12.80',
    '推荐视频 作者 张三',
  ];
  it('b-p02 verbatim still fills the gap', () => {
    expect(
      declaredAbsentFields(
        '请使用云端浏览器，amazon.com 搜 usb c cable 前3个商品名和价格',
        '第3条商品在搜索结果页快照中未显示价格，已打开其详情页读取到价格为 S$12.80。',
        undefined,
        PAGES,
      ),
    ).toEqual([]);
  });
  it.each([
    ['页面未显示作者，作者为：推测是张三。', '作者'],
    ['页面未显示作者，作者可能是张三。', '作者'],
    ['页面未显示作者，作者为待确认。', '作者'],
    ['页面未显示作者，作者是谁不清楚。', '作者'],
    ['第一个视频未显示作者，第二个视频的作者为张三。', '作者'],
    ['视频未显示作者。推荐视频的作者为张三。', '作者'],
    ['页面未显示价格，价格为？', '价格'],
    ['页面未显示价格，价格为 —', '价格'],
  ])('「%s」 → %s still absent (部分完成)', (text, name) => {
    expect(declaredAbsentFields(`读取视频的${name}`, text, undefined, PAGES)).toEqual([name]);
  });
  it('a value no read page shows fills nothing', () => {
    expect(
      declaredAbsentFields(
        '读取视频的作者',
        '页面未显示作者，打开详情页读到作者为李四。',
        undefined,
        PAGES,
      ),
    ).toEqual(['作者']);
  });
  it('with no pages to check against, nothing is filled', () => {
    expect(
      declaredAbsentFields('读取商品价格', '第3条未显示价格，已打开其详情页读取到价格为 S$12.80。'),
    ).toEqual(['价格']);
  });
});

/** DEPLOY-46 复审 #2 #3: the coordinator's fix-45/review1-fixtures/lc_test5.py. */
describe('DEPLOY-46 复审 #2 #3 · lc_test5: code popups and 实名 popups', () => {
  let browser: Browser;
  beforeAll(async () => {
    browser = await chromium.launch({ headless: true });
  });
  afterAll(async () => {
    await browser?.close();
  });
  const MASK = (inner: string) =>
    `<main>x</main><div style="position:fixed;inset:0;display:flex;align-items:center;justify-content:center"><div style="width:360px">${inner}</div></div>`;
  const digits = (t: string) =>
    Array.from(
      { length: 6 },
      (_, i) => `<input id="d${i}" type="${t}" maxlength="1" inputmode="numeric">`,
    ).join('');
  const read = async (html: string, css: string) => {
    const page = await browser.newPage();
    try {
      await page.setContent(html);
      return await page.locator(css).evaluate(readLoginContext, false);
    } finally {
      await page.close();
    }
  };
  it.each([
    [
      'OTP6 text, 请输入验证码',
      MASK(
        `<p>请输入短信验证码</p><p>已发送至 138****0000</p>${digits('text')}<span id="rs">60秒后重新获取</span>`,
      ),
    ],
    [
      'OTP6 number, 请输入验证码',
      MASK(`<p>请输入短信验证码</p>${digits('number')}<button id="go">登录</button>`),
    ],
    ['OTP6 text, no 验证码 word', MASK(`<p>输入发送到手机的数字</p>${digits('text')}`)],
    [
      'OTP6 in dialog, english',
      `<div role="dialog"><p>Enter the code we sent</p>${digits('text')}<button id="go">Verify</button></div>`,
    ],
  ])('%s: the boxes are refused', async (_name, html) => {
    expect((await read(html, '#d0')).loginField).toBe(true);
    expect((await read(html, '#d3')).loginField).toBe(true);
  });
  it.each([
    [
      'a ZIP code dialog',
      '<div role="dialog"><p>Enter ZIP code</p><input id="x" name="postal_code"><button>Save</button></div>',
    ],
    [
      'a coupon code dialog',
      '<div role="dialog"><p>Have a coupon code?</p><input id="x" name="coupon"><button>Apply</button></div>',
    ],
    [
      'a promo popup',
      MASK('<p>Enter your promo code at checkout</p><input id="x" placeholder="Address">'),
    ],
  ])('PR #309 review · reverse: %s is no code block', async (_name, html) => {
    expect((await read(html, '#x')).loginField).toBe(false);
  });
  it('the English code dialog’s Verify is a login control', async () => {
    const html = `<div role="dialog"><p>Enter the code we sent</p>${digits('text')}<button id="go">Verify</button></div>`;
    expect((await read(html, '#go')).loginControl).toBe(true);
  });
  it('实名认证: 真实姓名 and 身份证号 are refused', async () => {
    const html = MASK(
      '<p>实名认证</p><input id="nm" placeholder="真实姓名"><input id="idc" placeholder="身份证号"><input type="password" placeholder="支付密码"><button id="go">确认</button>',
    );
    expect((await read(html, '#nm')).loginField).toBe(true);
    expect((await read(html, '#idc')).loginField).toBe(true);
  });
  it.each([
    [
      'a sign-up popup’s name box',
      MASK(
        '<p>注册</p><input id="x" placeholder="你的名字"><input placeholder="请输入"><input type="password"><button>注册</button>',
      ),
    ],
    [
      'a sign-up popup’s address box',
      MASK(
        '<p>注册</p><input id="x" placeholder="收货地址"><input placeholder="请输入手机号"><input placeholder="验证码">',
      ),
    ],
    [
      'a login popup’s box named 年龄',
      MASK('<p>登录</p><input id="x" type="number" placeholder="年龄"><input type="password">'),
    ],
  ])('reverse: %s stays fillable', async (_name, html) => {
    expect((await read(html, '#x')).loginField).toBe(false);
  });
});

describe('DEPLOY-46 local A/B · b-v06 / new-qq: a scrape without the song name is not obtained', () => {
  it.each([
    // B b-v06 (tsk_v6L5e6S9E27HM9kFJgwmU)
    [
      'QQ音乐热歌榜第一名是啥',
      '根据抓取的 QQ音乐热歌榜 数据（2026-10-28），第一名是**薛之谦**的歌曲，时长 04:39。\n\n不过抓取内容中歌曲名称未完整显示，只看到了歌手信息。',
    ],
    // A new-qq (tsk_wgNi4tgY7oDKDiGKeSCdF)
    [
      '在 QQ 音乐看热歌榜第一名',
      '根据 QQ音乐热歌榜（2026-10-28 更新）的抓取数据：\n\n**第1名**：歌手是**薛之谦**，时长 04:39\n\n不过页面抓取时歌曲名部分未能显示，只拿到了歌手和时长信息。',
    ],
    // B new-qq (tsk_pKgmpCbwLRLzVVNDBAwuf)
    [
      '在 QQ 音乐看热歌榜第一名',
      '根据 QQ 音乐热歌榜（2026-10-28 数据）：\n\n**第1名**：薛之谦，时长 **04:39**\n\n具体歌曲名页面未渲染出来，只抓到歌手和时长。需要的话可以告诉我歌名我帮你查。',
    ],
  ])('%s — verbatim → not obtained (the browser gets its try)', (q, answer) => {
    expect(answerNotObtained(answer, q)).toBe(true);
  });
  it.each([
    'QQ音乐热歌榜第一名是《我好像在哪见过你》，歌手薛之谦，专辑名称未完整显示。',
    'QQ音乐热歌榜第一名是《我好像在哪见过你》，歌手薛之谦，时长 04:39。',
  ])('reverse: 「%s」 is an answer', (answer) => {
    expect(answerNotObtained(answer, 'QQ音乐热歌榜第一名是啥')).toBe(false);
  });
});
