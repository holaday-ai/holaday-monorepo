import { type Browser, chromium } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { anchoredLogPost, keyedLogCheck } from './cloud-observation.js';
import { createPlaywrightUnifiedExecutor } from './playwright-unified-executor.js';

const XHS = 'https://apm-fe.xiaohongshu.com/api/data';
const AMAP = 'https://collapsar.amap.com/alc/h5/upload';
/** One SDK record of the shape FIX-43 lets through (12 listed keys). */
const record = (extra: Record<string, unknown> = {}, seq = 1) => ({
  clientTime: 1793520000000 + seq,
  context_sdkSessionId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  context_pageSessionId: 'f0e1d2c3-b4a5-6789-0abc-def123456789',
  context_sdkSeqId: seq,
  context_nameTracker: 'wapT',
  context_platform: 'PC',
  context_appVersion: 'discovery-undefined',
  context_osVersion: 'unknown',
  context_deviceModel: 'Mac',
  context_deviceId: '18f3c2a1b0d9e8f7a6b5c4d3e2f1a0b9',
  context_package: 'xhs-pc-web',
  context_networkType: 'unknown',
  ...extra,
});
/** Deploy-45 wall-xhs: `json array 22628B` — a batch of such records. */
const batch = (n: number, extra: (i: number) => Record<string, unknown> = () => ({})) =>
  JSON.stringify(
    Array.from({ length: n }, (_, i) => record({ context_route: '/explore', ...extra(i) }, i)),
  );
const amapBody = (fields: Record<string, string> = {}) =>
  new URLSearchParams({
    adiu: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6',
    buildVersion: '2.3.1',
    channel: 'amap_h5',
    content: 'H4sIAAAAAAAAA'.padEnd(3300, 'Zx9Qv7Lm2Np4Rt6'),
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

describe('FIX-45 #4 · an apm-fe batch: every record has the FIX-43 shape, 32 KB at most', () => {
  it('a 22 KB array of SDK records passes (Deploy-45 wall-xhs size)', () => {
    const body = batch(52);
    expect(body.length).toBeGreaterThan(22_000);
    expect(body.length).toBeLessThan(32_768);
    expect(anchoredLogPost(new URL(XHS), 'POST', body)).toBe(true);
  });

  it.each([
    [
      'one record with a note id',
      batch(10, (i) => (i === 7 ? { context_noteId: '6929ba55000000001e023ef8' } : {})),
      /^record7:/,
    ],
    [
      'one record with an action value',
      batch(10, (i) => (i === 3 ? { context_route: '/like' } : {})),
      /^record3:value:/,
    ],
    [
      'one record nested',
      batch(10, (i) => (i === 0 ? { context_extra: { followUserId: '1' } } : {})),
      /^record0:/,
    ],
    ['an array of arrays', JSON.stringify([[record()]]), /^record0:not-object/],
    ['an empty array', '[]', /^records:0/],
    ['more than 64 records', batch(65), /^records:65/],
    ['over 32 KB', batch(80), /^size:/],
  ])('reverse: %s still pauses', (_label, body, why) => {
    expect(anchoredLogPost(new URL(XHS), 'POST', body)).toBe(false);
    expect(keyedLogCheck(new URL(XHS), body)).toMatch(why);
  });

  it('evidence (local capture 2026-10-28): today’s SDK records still pause, with the reason kept', () => {
    // The key names and value kinds of a record captured locally on the 300031 page (no values).
    const today = record({
      context_matchedPath: '/website-login/error',
      context_userId: '0123456789abcdef0123456789abcdef',
      custom_c1: 'login',
      measurement_name: 'httpRequestTiming',
      measurement_data: { webId: 'x', source: 'web' },
    });
    expect(keyedLogCheck(new URL(XHS), JSON.stringify([today]))).toBe(
      'record0:key:custom_c1+measurement_name+measurement_data',
    );
  });
});

describe('FIX-45 #4 · 高德 collapsar: the check that refused it is named', () => {
  it.each([
    ['a mode value off the list', amapBody({ mode: 'mini' }), 'mode=mini'],
    ['a long mode value, by length only', amapBody({ mode: 'x'.repeat(40) }), 'mode=len40'],
    [
      'a key/value pair in content',
      amapBody({ content: 'phone=13800138000&code=1234' }),
      'content:pair-in-reading0',
    ],
    ['an action word in another field', amapBody({ channel: 'login' }), 'value:channel'],
    ['an off-list field', amapBody({ phone: '13800138000' }), 'key:phone'],
  ])('%s', (_label, body, why) => {
    expect(anchoredLogPost(new URL(AMAP), 'POST', body)).toBe(false);
    expect(keyedLogCheck(new URL(AMAP), body)).toBe(why);
  });
  it('the device log itself passes, no reason', () => {
    expect(keyedLogCheck(new URL(AMAP), amapBody())).toBeNull();
    expect(anchoredLogPost(new URL(AMAP), 'POST', amapBody())).toBe(true);
  });
  it('other endpoints get no reason', () => {
    expect(
      keyedLogCheck(new URL('https://example.org/api/data'), amapBody({ mode: 'mini' })),
    ).toBeNull();
  });
});

describe('FIX-45 #4 · in the executor: the pause names a background request, and the reason is kept', () => {
  let browser: Browser;
  beforeAll(async () => {
    browser = await chromium.launch({ headless: true });
  }, 60_000);
  afterAll(async () => {
    await browser?.close();
  });
  const post = (url: string, body: string, type: string) =>
    `fetch('${url}',{method:'POST',mode:'no-cors',headers:{'Content-Type':'${type}'},body:${JSON.stringify(body)}})`.replace(
      /"/g,
      '&quot;',
    );
  // Deploy-45 b-m01 was an `unknown_post` (the SDK does not send it as a form): text/plain here.
  const PAGES: Record<string, string> = {
    '/xhs-batch': `<button onclick="${post(XHS, batch(52), 'application/json')}">关闭</button>`,
    '/amap-mode': `<button onclick="${post(AMAP, amapBody({ mode: 'mini' }), 'text/plain;charset=UTF-8')}">路线</button>`,
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

  it('a click that sends a 22 KB apm-fe batch does not pause', async () => {
    const r = await click('/xhs-batch', '关闭');
    expect(r.effect?.backgroundRequests?.some((q) => q.url.startsWith(XHS))).toBe(true);
    expect(r.interruption).toBeUndefined();
  }, 30_000);

  it('reverse: a collapsar log with an unknown mode still pauses — as a background request, mode kept', async () => {
    const r = await click('/amap-mode', '路线');
    expect(r.interruption).toMatchObject({
      reason: 'unexpected_effect',
      message: '页面发出了一个无法确认的后台请求，我先停下请你确认；当前任务尚未完成。',
    });
    expect(r.interruption?.message).not.toContain('写请求或交易状态变化');
    expect(r.effect?.triggers?.[0]?.bodyShape).toMatch(/^form\{adiu,.*\} \d+B check:mode=mini$/);
  }, 30_000);
});
