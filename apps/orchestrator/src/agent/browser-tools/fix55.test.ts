import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { anchoredLogPost, keyedLogCheck, valueShape } from './cloud-observation.js';
import { assessCompletionFacts } from './completion-fields.js';
import { userClearClaims } from './unified-browser-loop.js';

/** FIX-55: the Deploy-55 follow-ups. */

describe('FIX-55 #1 · 高德 collapsar mode: only the online shape len19:a0._ passes', () => {
  const AMAP = new URL('https://collapsar.amap.com/alc/h5/upload');
  // The Deploy-55 online body's keys (b-m01, 3415 B, `check:mode=len19:a0._`); the values are
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

  it('a made-up value of exactly that shape passes', () => {
    const mode = 'amap_h5.sdk2.web_v1';
    expect(valueShape(mode)).toBe('len19:a0._');
    expect(keyedLogCheck(AMAP, body(mode))).toBeNull();
    expect(anchoredLogPost(AMAP, 'POST', body(mode))).toBe(true);
  });

  // FIX-54 复审 #1 (`fix-54/review1-fixtures/amode.mjs`): the values the multi-segment rule let
  // through, as written and padded to the online shape — none may pass.
  const REVIEW = [
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
    'addCart',
    'route.save',
    'navi.start',
    'fav.add',
  ];
  const toShape = (v: string) => {
    let out = v.toLowerCase().replace(/[^a-z0-9._]/g, '');
    if (!/_/.test(out)) out += '_';
    if (!/\./.test(out)) out += '.';
    if (!/\d/.test(out)) out += '1';
    return `${out}x2_y3.z4a5b6c7d8e9f`.slice(0, 19);
  };

  it.each(REVIEW)('the review value pauses as written: %s', (mode) => {
    expect(keyedLogCheck(AMAP, body(mode))).toBe(`mode=${valueShape(mode)}`);
    expect(anchoredLogPost(AMAP, 'POST', body(mode))).toBe(false);
  });

  it.each(REVIEW.map(toShape))('…and padded to len19:a0._ it still pauses: %s', (mode) => {
    expect(valueShape(mode)).toBe('len19:a0._');
    expect(keyedLogCheck(AMAP, body(mode))).toBe('mode=len19:a0._');
    expect(anchoredLogPost(AMAP, 'POST', body(mode))).toBe(false);
  });

  it.each([
    ['5 digits in a row', 'amap_h5.web12345_v1'],
    ['an action word', 'amap_h5.submit_v1.a'],
    ['a personal word', 'amap_h5.phone_v1.ab'],
  ])('the online shape with %s pauses', (_label, mode) => {
    expect(valueShape(mode)).toBe('len19:a0._');
    expect(keyedLogCheck(AMAP, body(mode))).toBe('mode=len19:a0._');
  });

  it.each([
    ['one character more', 'amap_h5.sdk2.web_v12', 'mode=len20:a0._'],
    ['an upper-case letter', 'Amap_h5.sdk2.web_v1', 'mode=len19:aA0._'],
    ['a dash in place of a dot', 'amap_h5-sdk2.web_v1', 'mode=len19:a0-._'],
    ['no digit', 'amap_hx.sdkx.web_vx', 'mode=len19:a._'],
    ['no underscore', 'amap.h5.sdk2.web.v1', 'mode=len19:a0.'],
  ])('any other shape still pauses with its evidence: %s', (_label, mode, why) => {
    expect(keyedLogCheck(AMAP, body(mode))).toBe(why);
    expect(anchoredLogPost(AMAP, 'POST', body(mode))).toBe(false);
  });

  it('the online set (web|h5|wap|pc|a digit) still passes', () => {
    for (const mode of ['web', 'h5', 'WAP', 'pc', '2'])
      expect(keyedLogCheck(AMAP, body(mode))).toBeNull();
  });
});

describe('FIX-55 #2 · 「 / 」 joins only lines of the same item card', () => {
  const PAGE = readFileSync(
    new URL('./fixtures/amazon-sg-see-options.txt', import.meta.url),
    'utf8',
  );
  const pages = (text: string) => [{ text, sourceURL: 'https://www.amazon.sg/s?k=usb+c+cable' }];
  // Two cards: Anker (its own price S$9.99), then UGREEN (S$12.45) right after.
  const CARDS = [
    'Anker 2M cable USB C to USB C, 60W Fast Charging Braided Cord',
    'S$9.99',
    'UGREEN USB C to USB C Charger Cable 100W PD Fast Charging 1M',
    'S$12.45',
    'Add to cart',
  ].join('\n');
  const answer = (quote: string) =>
    `在亚马逊新加坡站搜索 usb c cable，第一个商品：\n\n1. 名称：Anker 2M cable USB C to USB C, 60W Fast Charging Braided Cord\n   价格：S$9.99（页面显示为 "${quote}"）`;
  const NOT_PAGE = '不是已读页面中的原文';
  const check = (summary: string, text: string) =>
    assessCompletionFacts({
      summary,
      pages: pages(text),
      intent: '列出第一个的名称和价格',
    }).contradictions.join();

  it("a title of one card joined to the next card's price is not the page's text", () => {
    expect(check(answer('Anker 2M cable / S$12.45'), CARDS)).toContain(NOT_PAGE);
  });

  it("the same card's title and price joined are", () => {
    expect(check(answer('Anker 2M cable / S$9.99'), CARDS)).not.toContain(NOT_PAGE);
  });

  it("FIX-54's real page: the Belkin card's own state and offers line still join", () => {
    const summary =
      '第 3 个商品 Belkin USB-C to USB-C Cable (2M, 60W)，价格：S$9.22（页面显示为 "No featured offers available / S$9.22(2 new offers)"）';
    expect(check(summary, PAGE)).not.toContain(NOT_PAGE);
  });

  it("…but not Belkin's state joined to the next card's offers", () => {
    const moved = PAGE.replace(
      'S$9.22(2 new offers)\n',
      'INIU 240W USB-C Charge Cable 2m 2-Pack, PD Fast Charging\nS$9.22(2 new offers)\n',
    );
    const summary =
      '第 3 个商品 Belkin USB-C to USB-C Cable (2M, 60W)，价格：S$9.22（页面显示为 "No featured offers available / S$9.22(2 new offers)"）';
    expect(check(summary, moved)).toContain(NOT_PAGE);
  });
});

describe('FIX-55 #3 · 「用户完成验证」: the remaining ways of saying it', () => {
  it.each([
    '验证码是用户自己搞定的，随后页面恢复。',
    '用户自己搞定了验证，我继续查询。',
    '滑块验证由您亲手完成后，路线页打开了。',
    '用户亲手完成了人机验证。',
    '用户手动完成滑块后，页面恢复正常。',
    '已手动完成拼图验证，继续查询路线。',
    '用户已完成登录验证，随后读取了页面。',
    '经用户操作，验证已通过。',
    '在用户协助下完成了验证，然后继续搜索。',
    '用户帮忙完成了验证码，页面已打开。',
    '验证码是用户输入的，随后查询成功。',
    'After the human solved it, the captcha page went away and the route loaded.',
  ])('is caught: %s', (sentence) => {
    expect(userClearClaims(`路线如下。\n${sentence}`)).toEqual([sentence]);
  });

  it.each([
    // FIX-54's non-claims stay non-claims.
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
    // New phrasings asked of the person, or denied.
    '需要用户自己搞定验证。',
    '请您亲手完成滑块验证。',
    '如需用户协助完成验证，请在下方浏览器操作。',
    '需要经用户操作才能通过验证。',
    '验证码需由用户输入。',
    '验证不是经用户操作通过的。',
    'After the human solved it, the page loaded.',
  ])('is not a claim: %s', (sentence) => {
    expect(userClearClaims(sentence)).toEqual([]);
  });
});
