/** DEPLOY-58 第 0 步 (子代理复审 #3, head cc5a5736): the four items, one block each. */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { sensorsDataBeacon } from '../agent/browser-tools/cloud-observation.js';
import {
  effectPauseQuestion,
  looksSubmitted,
  siteCalled,
} from '../agent/browser-tools/effect-pause-copy.js';

const SA_URL = new URL(
  'https://gugong-pro.datasink.sensorsdata.cn/sa.gif?project=default&token=abc',
);
/** 故宫's nav-click beacon as observed (stand-in values), with `patch` over its properties. */
function beacon(properties: Record<string, unknown> = {}, top: Record<string, unknown> = {}) {
  const record = {
    distinct_id: '19a5c2d1e3f-0b3d4e5f6a7b8-26011d51-1296000-19a5c2d1e3f',
    anonymous_id: '19a5c2d1e3f-0b3d4e5f6a7b8-26011d51-1296000-19a5c2d1e3f',
    identities: { $identity_cookie_id: '19a5c2d1e3f-0b3d4e5f6a7b8' },
    lib: { $lib: 'js', $lib_method: 'code', $lib_version: '1.25.4' },
    properties: {
      $url: 'https://www.dpm.org.cn/Visit.html',
      $title: '导览',
      $element_content: '导览',
      $screen_width: 1280,
      business_line: 'web',
      current_url: 'https://www.dpm.org.cn/Visit.html',
      language_type: 'zh',
      platform_type: 'pc',
      product_version: '1',
      referrer: 'https://www.dpm.org.cn/',
      navigation_name: '导览',
      second_navigation_name: '',
      page_name: '导览',
      ...properties,
    },
    type: 'track',
    event: 'ggzwwz_TopNavigationBarClick',
    time: 1794060930158,
    _track_id: 543210987,
    _flush_time: 1794060930160,
    ...top,
  };
  const data = Buffer.from(JSON.stringify(record), 'utf8').toString('base64');
  return `data=${encodeURIComponent(data)}&ext=${encodeURIComponent('crc=-123456')}`;
}
const passes = (body: string) => sensorsDataBeacon(SA_URL, 'POST', body);

describe('第 0 步 1 · a 神策 beacon carrying a person’s data pauses', () => {
  it('the observed beacon (page and nav names, ids, times) still passes', () => {
    expect(passes(beacon())).toBe(true);
  });
  it.each([
    ['contact (phone)', { contact: '13800138000' }],
    ['contact (number)', { contact: 13800138000 }],
    ['email key', { email: 'a@b.cn' }],
    ['mail key', { user_mail: 'x' }],
    ['real_name', { real_name: '张三' }],
    ['user_name', { user_name: 'x' }],
    ['name', { name: 'x' }],
    ['id_card', { id_card: 'x' }],
    ['idcard', { idcard: 'x' }],
    ['address', { address: '北京市东城区' }],
    ['addr', { home_addr: 'x' }],
    ['phone key', { phone: 'x' }],
    ['tel key', { tel: 'x' }],
    ['$element_content phone', { $element_content: '13800138000' }],
    ['$element_content +86 phone', { $element_content: '+86 138-0013-8000'.replace(/-/g, '') }],
    ['$title email', { $title: '联系 someone@example.com' }],
    ['$element_content ID number', { $element_content: '11010519491231002X' }],
    ['$url ?phone=', { $url: 'https://www.dpm.org.cn/Visit.html?phone=x' }],
    ['$url ?email=', { $url: 'https://www.dpm.org.cn/Visit.html?email=x' }],
    // FIX-59 P1-6: a plain 11-digit value counts under a phone key; a written phone under any key.
    ['$url phone value', { $url: 'https://www.dpm.org.cn/Visit.html?mobile=13800138000' }],
    ['$url +86 phone value', { $url: 'https://www.dpm.org.cn/Visit.html?q=%2B8613800138000' }],
    ['$url encoded email', { $url: 'https://www.dpm.org.cn/?q=a%40b.cn' }],
    ['$referrer ?real_name=', { $referrer: 'https://www.dpm.org.cn/?real_name=x' }],
  ])('%s', (_label, patch) => {
    expect(passes(beacon(patch))).toBe(false);
  });
  it('the SDK’s own ids carrying a phone number pause too', () => {
    expect(passes(beacon({}, { distinct_id: '13800138000' }))).toBe(false);
    expect(passes(beacon({}, { identities: { $identity_login_id: 'a@b.cn' } }))).toBe(false);
  });
});

describe('第 0 步 2 · a real submit is not said lightly', () => {
  const base = { site: 'bestbuy.com', readOnly: false, background: false };
  it.each([
    ['下单', '提交订单'],
    ['支付', '立即支付'],
    ['预约', '确认预约'],
    ['购票', '立即购票'],
    ['submit', 'Submit'],
    ['place order', 'Place order'],
    ['pay', 'Pay now'],
    ['book', 'Book now'],
    ['confirm', 'Confirm and pay'],
  ])('%s', (_k, label) => {
    expect(looksSubmitted({ tool: 'click', label })).toBe(true);
  });
  it('Chinese: may already have gone through, check and cancel; no 「继续」', () => {
    const text = effectPauseQuestion({
      ...base,
      english: false,
      site: '故宫博物院',
      action: { tool: 'click', label: '提交订单' },
    });
    expect(text).toBe(
      '我在故宫博物院点了「提交订单」，这一步可能已经提交成功了（可能已经生成订单或预约）。请先在右侧画面核对，需要的话去取消。',
    );
    expect(text).not.toContain('继续');
  });
  it('English: the same, in English; no “continue”', () => {
    const text = effectPauseQuestion({
      ...base,
      english: true,
      action: { tool: 'click', label: 'Place order' },
    });
    expect(text).toBe(
      'I clicked “Place order” on bestbuy.com. This step may already have gone through (an order or booking may have been created). Please check the screen on the right first, and cancel it if needed.',
    );
    expect(text).not.toMatch(/continue/i);
  });
  it('a transaction trigger counts, whatever the label', () => {
    for (const triggers of [
      [{ branch: 'transaction_request', url: 'https://shop.test/x' }],
      [{ branch: 'transaction_navigation', url: 'https://shop.test/x' }],
      [{ branch: 'transaction_popup', url: '[task popup]' }],
      [{ branch: 'new_transaction_receipt', url: 'https://shop.test/x' }],
    ])
      expect(
        effectPauseQuestion({
          ...base,
          english: false,
          action: { tool: 'click', label: '下一步' },
          triggers,
        }),
      ).toContain('可能已经提交成功了');
  });
  it('a read-only task clicking navigation keeps the light wording', () => {
    const triggers = [
      { branch: 'unknown_post', url: 'https://gugong-pro.datasink.sensorsdata.cn/sa.gif' },
    ];
    const zh = effectPauseQuestion({
      english: false,
      site: '故宫博物院',
      action: { tool: 'click', label: '导览' },
      readOnly: true,
      background: false,
      triggers,
    });
    expect(zh).toContain('没有的话回复「继续」，我接着只读查看');
    expect(zh).not.toContain('提交成功');
    const en = effectPauseQuestion({
      english: true,
      site: 'dpm.org.cn',
      action: { tool: 'click', label: 'Visit' },
      readOnly: true,
      background: false,
      triggers,
    });
    expect(en).toContain('reply “continue”');
    expect(en).not.toContain('gone through');
  });
});

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

describe('第 0 步 3 / 4 · prompts', () => {
  it('generate: budget recommendations say prices as estimates', () => {
    expect(read('../agent/generate-runner.ts')).toContain(
      '按预算或「X 元以内」推荐商品时，每款的价格都写成「约 X 元（以官网为准）」，不要说成确定的现价。',
    );
  });
  it('next steps: never contradict the facts in the result', () => {
    expect(read('../agent/next-steps-generator.ts')).toContain('提议不能和结果里写的事实矛盾');
  });
});

/** 协调方核对第 0 步 (16:50 UTC, head d1246a90): read-only navigation is not a real submit. */
describe('协调方核对 · reading and navigation are never said to have placed an order', () => {
  const zh = (label: string, triggers: Array<{ branch: string; url: string }> = []) =>
    effectPauseQuestion({
      english: false,
      site: '故宫博物院',
      action: { tool: 'click', label },
      readOnly: true,
      background: false,
      triggers,
    });
  it.each([
    '预约须知',
    '门票预订说明',
    '购票须知',
    '预约参观',
    '确定',
    '确认',
    '注册',
    '导览',
    'Booking info',
    'Booking policy',
    'Ticket FAQ',
    'Reservation guide',
    'Register',
    'Book',
    'Confirm',
    '提交订单说明',
  ])('「%s」 alone is not a submit', (label) => {
    expect(looksSubmitted({ tool: 'click', label })).toBe(false);
    expect(zh(label)).not.toContain('提交成功');
  });
  it.each([
    '立即购票',
    '提交订单',
    '确认支付',
    '确认预约',
    '立即预约',
    '去支付',
    '提交',
    // FIX-59 P1-5: a button that says only the act is the act.
    '购票',
    '预约',
    'Buy tickets',
    'Reserve',
    'Checkout',
    'Place order',
    'Place your order',
    'Pay now',
    'Pay S$12.90',
    'Book now',
    'Submit',
    'Submit order',
    'Complete purchase',
  ])('「%s」 is a submit', (label) => {
    expect(looksSubmitted({ tool: 'click', label })).toBe(true);
  });
  it('an ordinary unexpected POST never counts by its path alone', () => {
    for (const url of [
      'https://www.dpm.org.cn/ticket/list',
      'https://www.dpm.org.cn/api/register',
      'https://shop.test/api/order/create',
      'https://shop.test/booking/submit',
    ])
      for (const branch of ['unknown_post', 'form_submit', 'mutation_method']) {
        expect(looksSubmitted({ tool: 'click', label: '导览' }, [{ branch, url }]), url).toBe(
          false,
        );
        expect(zh('导览', [{ branch, url }])).toContain('没有的话回复「继续」');
      }
  });
  it('English names the site in English, else by its address', () => {
    expect(siteCalled('导览-故宫博物院', 'https://www.dpm.org.cn/Visit.html', true)).toBe(
      'the Palace Museum website',
    );
    expect(siteCalled('故宫博物院 | The Palace Museum', 'https://en.dpm.org.cn/', true)).toBe(
      'The Palace Museum',
    );
    expect(siteCalled('某某景区官网', 'https://www.example.cn/a', true)).toBe('example.cn');
    expect(siteCalled('导览-故宫博物院', 'https://www.dpm.org.cn/Visit.html')).toBe('故宫博物院');
    const en = effectPauseQuestion({
      english: true,
      site: siteCalled('导览-故宫博物院', 'https://www.dpm.org.cn/Visit.html', true),
      action: { tool: 'click', label: 'Visit' },
      readOnly: true,
      background: false,
    });
    expect(en).toContain('on the Palace Museum website');
    expect(en).not.toMatch(/[㐀-鿿]/);
  });
  it('a page address is checked by its query values, not its path', () => {
    expect(passes(beacon({ $url: 'https://www.dpm.org.cn/13812345678.html' }))).toBe(true);
    expect(passes(beacon({ $referrer: 'https://www.dpm.org.cn/a/a@b.cn/x' }))).toBe(true);
    expect(passes(beacon({ $url: 'https://www.dpm.org.cn/x.html?tel=13812345678' }))).toBe(false);
    expect(passes(beacon({ $url: 'https://www.dpm.org.cn/x.html?q=a%40b.cn' }))).toBe(false);
  });
  it.each([
    '+86 138 0013 8000',
    '138 0013 8000',
    '138-0013-8000',
    '+86-138-0013-8000',
    '+8613800138000',
  ])('a phone written 「%s」 is recognised', (phone) => {
    expect(passes(beacon({ $element_content: `联系 ${phone}` }))).toBe(false);
  });
  it('a 13-digit time and the observed ids still pass', () => {
    expect(passes(beacon({ $element_content: '1794060930158' }))).toBe(true);
    expect(passes(beacon())).toBe(true);
  });
});
