import { describe, expect, it } from 'vitest';
import { anchoredLogPost, keyedLogCheck, segmentShape } from './cloud-observation.js';

/**
 * FIX-56: the 高德 collapsar `mode` passes only in the online segment structure
 * (Deploy-55/56 b-m01: `check:mode=seg3=len9:a|.|len2:a0|_|len6:a`), with no action or personal
 * word in any segment.
 */
describe('FIX-56 · 高德 collapsar mode: the online segment structure only', () => {
  const AMAP = new URL('https://collapsar.amap.com/alc/h5/upload');
  // The online body's keys (3414 B); the values are made-up device values of the same kinds.
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
  const ONLINE = 'seg3=len9:a|.|len2:a0|_|len6:a';

  it.each([
    'amapwebsd.h5_engine',
    'webmapsdk.2d_render',
    'routeview.9x_tracer',
    'amapwebsd.42_engine',
  ])('a made-up value of exactly that structure, with no sensitive word, passes: %s', (mode) => {
    expect(segmentShape(mode)).toMatch(/^seg3=len9:a\|\.\|len2:[a0]+\|_\|len6:a$/);
    expect(keyedLogCheck(AMAP, body(mode))).toBeNull();
    expect(anchoredLogPost(AMAP, 'POST', body(mode))).toBe(true);
  });

  it('the online shape itself is that structure', () => {
    expect(segmentShape('amapwebsd.h5_engine')).toBe(ONLINE);
  });

  // DEPLOY-56 第 0 步 (6) + FIX-54/55 复审 (12+): none of them is the structure.
  const REVIEW = [
    'lat39.916_lng116.39',
    'gps.39_9.116_4abcde',
    'sku_123.add_item1ab',
    'cookie_ab1.sessxyz9',
    'wechat.op1_xxxxxxxx',
    'wx_appid.a1b2c3d4ef',
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
  ];
  it.each(REVIEW)('a review value still pauses, with segment evidence only: %s', (mode) => {
    const why = keyedLogCheck(AMAP, body(mode));
    expect(why).toBe(`mode=${segmentShape(mode)}`);
    expect(anchoredLogPost(AMAP, 'POST', body(mode))).toBe(false);
    for (const part of mode.split(/[^A-Za-z0-9]+/).filter((p) => p.length >= 2))
      expect((why ?? '').slice('mode='.length)).not.toContain(part);
  });

  // The same structure with a sensitive word in a segment.
  it.each([
    'useremail.a1_submit',
    'telephone.x9_orders',
    'usernamex.a1_engine',
    'accountid.b2_viewer',
    'amapwebsd.h5_cartxx',
    'amapwebsd.h5_saveit',
    'mobilenum.a1_engine',
    'wechatsdk.a1_engine',
    'amapwebsd.a1_tokens',
    'checkouts.a1_engine',
    'locationx.a1_engine',
    'cookieids.a1_engine',
  ])('the structure with a sensitive word in a segment pauses: %s', (mode) => {
    expect(segmentShape(mode)).toMatch(/^seg3=len9:a\|\.\|len2:[a0]+\|_\|len6:a$/);
    expect(keyedLogCheck(AMAP, body(mode))).toBe(`mode=${segmentShape(mode)}`);
    expect(anchoredLogPost(AMAP, 'POST', body(mode))).toBe(false);
  });

  it.each([
    ['no digit in the middle segment', 'amapwebsd.hx_engine'],
    ['an upper-case letter', 'Amapwebsd.h5_engine'],
    ['one letter more', 'amapwebsdk.h5_engine'],
    ['one letter fewer at the end', 'amapwebsd.h5_engin'],
    ['separators swapped', 'amapwebsd_h5.engine'],
    ['a digit in the first segment', 'amapweb5d.h5_engine'],
    ['a fourth segment', 'amapwebsd.h5_engine.x'],
    ['three digits in the middle', 'amapwebsd.123_engine'],
  ])('any other structure still pauses: %s', (_label, mode) => {
    expect(keyedLogCheck(AMAP, body(mode))).toBe(`mode=${segmentShape(mode)}`);
    expect(anchoredLogPost(AMAP, 'POST', body(mode))).toBe(false);
  });

  it('the allowance is for collapsar only: the other keys keep their checks', () => {
    const ok = 'amapwebsd.h5_engine';
    const withKey = `${body(ok)}&phone=13800138000`;
    expect(keyedLogCheck(AMAP, withKey)).toMatch(/^key:/);
    // A personal word in another key's value still pauses, whatever the mode.
    const worded = new URLSearchParams(body(ok));
    worded.set('channel', 'my phone 13800138000');
    expect(keyedLogCheck(AMAP, worded.toString())).toMatch(/^value:channel:/);
  });

  it('the online set (web|h5|wap|pc|a digit) still passes', () => {
    for (const mode of ['web', 'h5', 'WAP', 'pc', '2'])
      expect(keyedLogCheck(AMAP, body(mode))).toBeNull();
  });
});
