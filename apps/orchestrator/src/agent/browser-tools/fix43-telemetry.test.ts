import { type Browser, chromium } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { anchoredLogPost } from './cloud-observation.js';
import { createPlaywrightUnifiedExecutor } from './playwright-unified-executor.js';

/**
 * FIX-43 #1: the acceptance records keep each body's shape (its keys and size), not the body:
 * Deploy-41 xhs-read `json{clientTime,context_sdkSessionId,…,context_networkType} 2158B` and
 * Deploy-43 b-m01 `form{adiu,buildVersion,channel,content,diu,env,h5Version,idfa,imei,md5,
 * miniProgramVersion,mode} 4237B`. These bodies carry exactly those keys at about that size.
 */
const XHS = 'https://apm-fe.xiaohongshu.com/api/data';
const AMAP = 'https://collapsar.amap.com/alc/h5/upload';
const xhsBody = (extra: Record<string, unknown> = {}) =>
  JSON.stringify({
    clientTime: 1793520000000,
    context_sdkSessionId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
    context_pageSessionId: 'f0e1d2c3-b4a5-6789-0abc-def123456789',
    context_sdkSeqId: 42,
    context_nameTracker: 'wapT',
    context_platform: 'PC',
    context_appVersion: 'discovery-undefined',
    context_osVersion: 'unknown',
    context_deviceModel: 'Mac',
    context_deviceId: '18f3c2a1b0d9e8f7a6b5c4d3e2f1a0b9',
    context_package: 'xhs-pc-web',
    context_networkType: 'unknown',
    ...extra,
  }).padEnd(0);
const amapBody = (fields: Record<string, string> = {}) =>
  new URLSearchParams({
    adiu: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6',
    buildVersion: '2.3.1',
    channel: 'amap_h5',
    content: 'H4sIAAAAAAAAA'.padEnd(3900, 'Zx9Qv7Lm2Np4Rt6'),
    diu: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6',
    env: 'production',
    h5Version: '1.0.0',
    idfa: '',
    imei: '',
    md5: '9e107d9d372bb6826bd81d3542a419d6',
    miniProgramVersion: '',
    mode: 'web',
    ...fields,
  }).toString();

describe('FIX-43 #1 · Xiaohongshu apm-fe and 高德 collapsar telemetry are let through, exactly', () => {
  it('Deploy-41 xhs-read shape (12 SDK keys, ~2 KB) passes', () => {
    expect(anchoredLogPost(new URL(XHS), 'POST', xhsBody())).toBe(true);
  });
  it('a few extra context_* keys pass', () => {
    expect(
      anchoredLogPost(
        new URL(XHS),
        'POST',
        xhsBody({ context_userAgent: 'Mozilla', context_route: '/explore' }),
      ),
    ).toBe(true);
  });
  it('Deploy-43 b-m01 shape (12 device-log fields, ~4.2 KB form) passes', () => {
    const body = amapBody();
    expect(body.length).toBeGreaterThan(3800);
    expect(anchoredLogPost(new URL(AMAP), 'POST', body)).toBe(true);
  });

  it.each([
    ['xhs look-alike host', 'https://apm-fe.xiaohongshu.com.evil.io/api/data', xhsBody()],
    ['xhs another subdomain', 'https://apm.xiaohongshu.com/api/data', xhsBody()],
    ['xhs nearby path', 'https://apm-fe.xiaohongshu.com/api/data/note', xhsBody()],
    ['xhs a query', `${XHS}?note_id=1`, xhsBody()],
    ['xhs an off-list key', XHS, xhsBody({ action: 'like' })],
    ['xhs a note id', XHS, xhsBody({ context_noteId: '6929ba55000000001e023ef8' })],
    ['xhs a comment', XHS, xhsBody({ context_comment: 'nice' })],
    ['xhs a nested follow', XHS, xhsBody({ context_extra: { followUserId: '1' } })],
    [
      'xhs too many extra context keys',
      XHS,
      xhsBody({ context_a: 1, context_b: 2, context_c: 3, context_d: 4, context_e: 5 }),
    ],
    ['xhs over 8 KB', XHS, xhsBody({ context_pad: 'x'.repeat(8200) })],
    ['xhs not JSON', XHS, 'clientTime=1&context_platform=PC'],
    [
      'xhs real 收藏 on edith',
      'https://edith.xiaohongshu.com/api/sns/web/v1/note/collect',
      '{"note_id":"1"}',
    ],
    ['amap look-alike host', 'https://collapsar.amap.com.evil.io/alc/h5/upload', amapBody()],
    ['amap nearby path', 'https://collapsar.amap.com/alc/h5/upload2', amapBody()],
    ['amap a query', `${AMAP}?mode=login`, amapBody()],
    ['amap a phone field', AMAP, amapBody({ phone: '13800138000' })],
    ['amap an off-list field', AMAP, amapBody({ action: 'send' })],
    ['amap a code inside content', AMAP, amapBody({ content: 'phone=13800138000&code=1234' })],
    ['amap JSON body', AMAP, JSON.stringify({ adiu: '1', mode: 'web' })],
    ['amap duplicate field', AMAP, `${amapBody()}&mode=login`],
    ['amap over 8 KB', AMAP, amapBody({ content: 'Zx9Q'.repeat(2100) })],
    ['amap login', 'https://passport.amap.com/login', 'phone=13800138000&password=x'],
    ['amap SMS code', 'https://passport.amap.com/sms/send', 'mobile=13800138000'],
  ])('reverse: %s still pauses', (_label, url, body) => {
    expect(anchoredLogPost(new URL(url), 'POST', body)).toBe(false);
  });

  it('reverse: GET is no log post', () => {
    expect(anchoredLogPost(new URL(XHS), 'GET', xhsBody())).toBe(false);
    expect(anchoredLogPost(new URL(AMAP), 'GET', amapBody())).toBe(false);
  });
});

describe('FIX-43 #1 · in the executor: the two telemetry posts no longer pause, writes still do', () => {
  let browser: Browser;
  beforeAll(async () => {
    browser = await chromium.launch({ headless: true });
  }, 60_000);
  afterAll(async () => {
    await browser?.close();
  });
  // The handler sits in a double-quoted attribute: the JS inside is HTML-escaped.
  const post = (url: string, body: string, type: string) =>
    `fetch('${url}',{method:'POST',mode:'no-cors',headers:{'Content-Type':'${type}'},body:${JSON.stringify(body)}})`.replace(
      /"/g,
      '&quot;',
    );
  const PAGES: Record<string, string> = {
    '/xhs': `<button onclick="${post(XHS, xhsBody(), 'application/json')}">关闭</button>`,
    '/amap': `<button onclick="${post(AMAP, amapBody(), 'application/x-www-form-urlencoded')}">路线</button>`,
    '/amap-phone': `<button onclick="${post(AMAP, amapBody({ phone: '13800138000' }), 'application/x-www-form-urlencoded')}">发送</button>`,
    '/xhs-like': `<button onclick="${post(XHS, xhsBody({ context_noteId: '1', action: 'like' }), 'application/json')}">赞</button>`,
  };
  const click = async (path: string, name: string) => {
    const page = await browser.newPage();
    await page.route('https://**/*', (route) =>
      route.request().method() === 'POST'
        ? route.fulfill({ status: 204, body: '' })
        : route.fulfill({
            contentType: 'text/html; charset=utf-8',
            body: `<!doctype html><meta charset="utf-8"><title>fixture</title><body>${PAGES[new URL(route.request().url()).pathname] ?? 'ok'}</body>`,
          }),
    );
    const tools = createPlaywrightUnifiedExecutor(page, { observationV2: true });
    try {
      await tools.execute({
        tool: 'navigate',
        url: `https://${path.startsWith('/xhs') ? 'www.xiaohongshu.com' : 'www.amap.com'}${path}`,
      } as never);
      const state = JSON.parse((await tools.execute({ tool: 'read_page' } as never)).text);
      const ref = state.tree.match(new RegExp(`button "${name}" \\[ref=(e\\d+)\\]`))![1];
      return await tools.execute({
        tool: 'click',
        ref,
        observationRevision: state.observationRevision,
      } as never);
    } finally {
      tools.dispose();
      await page.close();
    }
  };
  it('a click that sends the Xiaohongshu SDK post does not pause', async () => {
    const r = await click('/xhs', '关闭');
    expect(r.effect?.backgroundRequests?.some((q) => q.url.startsWith(XHS))).toBe(true);
    expect(r.interruption).toBeUndefined();
  }, 30_000);
  it('a click that sends the 高德 device log does not pause', async () => {
    const r = await click('/amap', '路线');
    expect(r.effect?.backgroundRequests?.some((q) => q.url.startsWith(AMAP))).toBe(true);
    expect(r.interruption).toBeUndefined();
  }, 30_000);
  it.each([
    ['a 高德 post carrying a phone number', '/amap-phone', '发送'],
    ['a Xiaohongshu post carrying a note id and an action', '/xhs-like', '赞'],
  ])(
    'reverse: %s still pauses',
    async (_label, path, name) => {
      expect((await click(path, name)).interruption?.reason).toBe('unexpected_effect');
    },
    30_000,
  );
});

/** DEPLOY-43 复审 #1: the coordinator's fix-43/review1-fixtures/p306.mjs, case for case. */
describe('DEPLOY-43 复审 #1 · p306 fixture: values, depth, mode and content are checked', () => {
  const base = { clientTime: 1, context_sdkSessionId: 'a', context_platform: 'PC' };
  const ab = (o: Record<string, string> = {}) =>
    new URLSearchParams({ adiu: 'a', content: 'H4sIAAAA', mode: 'web', ...o }).toString();
  it.each([
    ['xhs ok', XHS, JSON.stringify(base), true],
    ['xhs host case (the same host)', XHS.replace('apm-fe', 'APM-FE'), JSON.stringify(base), true],
    ['xhs trailing dot', XHS.replace('.com', '.com.'), JSON.stringify(base), false],
    [
      'xhs userinfo',
      'https://apm-fe.xiaohongshu.com@evil.io/api/data',
      JSON.stringify(base),
      false,
    ],
    ['xhs edith', 'https://edith.xiaohongshu.com/api/data', JSON.stringify(base), false],
    [
      'xhs path /api/data/',
      'https://apm-fe.xiaohongshu.com/api/data/',
      JSON.stringify(base),
      false,
    ],
    [
      'xhs nested action in a listed key',
      XHS,
      JSON.stringify({ ...base, context_nameTracker: { action: 'like_note', target: '6929ba55' } }),
      false,
    ],
    [
      'xhs context_action extra = follow',
      XHS,
      JSON.stringify({ ...base, context_action: 'follow', context_target: 'u123' }),
      false,
    ],
    ['xhs context_like', XHS, JSON.stringify({ ...base, context_like: 1 }), false],
    [
      'xhs nested deeper than the limit',
      XHS,
      JSON.stringify({
        ...base,
        context_nameTracker: { a: { b: { c: { d: { e: { note_id: 1 } } } } } },
      }),
      false,
    ],
    [
      'xhs a value naming a note and a like',
      XHS,
      JSON.stringify({ ...base, context_route: '/explore/6929ba55 note like' }),
      false,
    ],
    ['amap ok', AMAP, ab(), true],
    ['amap content phone', AMAP, ab({ content: 'phone=13800138000' }), false],
    [
      'amap content double-encoded',
      AMAP,
      ab({ content: 'phone%3D13800138000%26code%3D1234' }),
      false,
    ],
    ['amap content json-ish', AMAP, ab({ content: '{"mobile" : "138"}' }), false],
    [
      'amap content base64 phone',
      AMAP,
      ab({ content: Buffer.from('phone=13800138000&code=1234').toString('base64') }),
      false,
    ],
    ['amap mode=login', AMAP, ab({ mode: 'login' }), false],
    ['amap case host (the same host)', AMAP.replace('collapsar', 'COLLAPSAR'), ab(), true],
    // 复审 #1 additions.
    [
      'xhs a listed key holding an array',
      XHS,
      JSON.stringify({ ...base, context_platform: ['PC', 'like'] }),
      false,
    ],
    [
      'xhs a value with login',
      XHS,
      JSON.stringify({ ...base, context_nameTracker: 'loginModal' }),
      false,
    ],
    ['amap content with any key=value', AMAP, ab({ content: 'sku=1&qty=2' }), false],
    ['amap mode an unseen value', AMAP, ab({ mode: 'send_sms' }), false],
    ['amap a device field with an action word', AMAP, ab({ channel: 'login_h5' }), false],
  ])('%s → %s', (_label, url, body, expected) => {
    expect(anchoredLogPost(new URL(url), 'POST', body)).toBe(expected);
  });
  it('the gzip base64 the SDK sends stays opaque (its bytes are not read as pairs)', () => {
    const gzipLike = Buffer.from([
      0x1f,
      0x8b,
      0x08,
      0x00,
      ...Array.from({ length: 2400 }, (_, i) => (i * 37 + 61) % 256),
    ]).toString('base64');
    expect(anchoredLogPost(new URL(AMAP), 'POST', ab({ content: gzipLike }))).toBe(true);
  });
});
