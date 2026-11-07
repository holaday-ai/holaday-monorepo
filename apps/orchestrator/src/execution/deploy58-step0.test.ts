/** DEPLOY-58 第 0 步 (子代理复审 #3, head cc5a5736): the four items, one block each. */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { sensorsDataBeacon } from '../agent/browser-tools/cloud-observation.js';
import { effectPauseQuestion, looksSubmitted } from '../agent/browser-tools/effect-pause-copy.js';

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
    ['$url phone value', { $url: 'https://www.dpm.org.cn/Visit.html?q=13800138000' }],
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
    ['预约', '预约参观'],
    ['submit', 'Submit'],
    ['place order', 'Place order'],
    ['pay', 'Pay now'],
    ['book', 'Book'],
    ['confirm', 'Confirm'],
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
  it('a transaction request or an order path counts, whatever the label', () => {
    for (const triggers of [
      [{ branch: 'transaction_request', url: 'https://shop.test/x' }],
      [{ branch: 'transaction_navigation', url: 'https://shop.test/x' }],
      [{ branch: 'unknown_post', url: 'https://shop.test/api/order/create' }],
      [{ branch: 'form_submit', url: 'https://shop.test/booking' }],
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
