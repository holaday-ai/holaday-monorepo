/** FIX-58 复审 #2 + 协调方第 2 次代体验: the four must-fix items, one block each. */
import { describe, expect, it } from 'vitest';
import {
  passiveTelemetryRequest,
  sensorsDataBeacon,
} from '../agent/browser-tools/cloud-observation.js';
import { assessCompletionFacts, includesWhole } from '../agent/browser-tools/completion-fields.js';
import {
  effectPauseQuestion,
  refName,
  siteCalled,
} from '../agent/browser-tools/effect-pause-copy.js';
import { fieldLines, plainAnswer } from '../agent/browser-tools/unified-browser-loop.js';
import { explainExecutionMode } from '../agent/intent-classifier.js';
import { matchLiveFact } from '../agent/live-fact.js';
import { EvidenceLedger } from './evidence-ledger.js';
import { checkUngroundedLiveClaims } from './ungrounded-live-claims.js';

const logger = { info() {}, warn() {}, debug() {}, error() {} } as never;
const route = (intent: string) => explainExecutionMode({ intent, logger } as never);

function ledger(intent: string): EvidenceLedger {
  const l = new EvidenceLedger('tsk_review2');
  l.add({ fact: intent, sourceType: 'user_input', sourceDetail: 'intent', confidence: 'observed' });
  return l;
}
const check = (answerText: string, intent: string) =>
  checkUngroundedLiveClaims({ answerText, ledger: ledger(intent) });

describe('必须修 1 · a budget does not make a price lookup the user’s sum', () => {
  it.each([
    '亚马逊新加坡站 USB C 线价格，我预算 S$15',
    '我有 100 元预算，京东上 USB C 线多少钱',
    '京东 iPhone 16 Pro 多少钱，预算 8000 元以内',
    'USB C cable price on Amazon Singapore, my budget is $15',
    '亚马逊新加坡站 USB C 线价格，不超过 S$20，一共买 3 根',
  ])('%s → still a live fact, never generate', async (intent) => {
    expect(matchLiveFact(intent)).not.toBeNull();
    expect((await route(intent)).mode).not.toBe('generate');
  });
  it('a unit price or itemised list being summed is the user’s own sum', () => {
    for (const intent of [
      '单价 99 元，买 3 个一共多少',
      '苹果 5 元、香蕉 3 元，各买 2 个一共多少钱',
      'each costs $12, what is the total for 4',
    ])
      expect(matchLiveFact(intent), intent).toBeNull();
    expect(check('一共 297 元。', '单价 99 元，买 3 个一共多少')).toBeNull();
  });
  it('invented prices under a budget fail; only the user’s own number is exempt', () => {
    const intent = '亚马逊新加坡站 USB C 线价格，我预算 S$15';
    const result = check('推荐 Anker S$15，UGREEN S$12.9。', intent);
    expect(result?.severity).toBe('hard_fail');
    expect(result?.criterionId).toBe('generic.ungrounded_live_values');
    expect(result?.detail).toContain('S$12.9');
    expect(result?.detail).not.toContain('S$15');
    const cny = check('京东上 USB C 线大概 39 元。', '我有 100 元预算，京东上 USB C 线多少钱');
    expect(cny?.severity).toBe('hard_fail');
  });
});

describe('必须修 2 · a story’s characters may open pages', () => {
  it.each([
    ['写一个小说片段，主角深夜查机票', '他已经打开了网页，页面已加载，屏幕上跳出一串价格。'],
    ['写一个短剧剧本，讲程序员抢票', '小李：我已经打开了购票页面！'],
    ['写一首关于上网冲浪的诗', '我打开了网页，看见整个世界'],
    ['Write a short story about a hacker', 'I opened the page and the screen went dark.'],
    ['write a poem about the internet', 'The page has been loaded, and so has my heart.'],
    ['帮我写一段淘宝店铺的促销文案', '页面已加载，爆款直降！'],
  ])('%s', (intent, answer) => {
    expect(check(answer, intent)).toBeNull();
  });
  it('a lookup that says it operated a page still fails', () => {
    expect(check('页面已加载，数据已提取。', '亚马逊新加坡站 USB C 线价格')?.criterionId).toBe(
      'generic.pretended_operation',
    );
    expect(
      check('I opened the page and checked.', 'copy the prices from Amazon')?.criterionId,
    ).toBe('generic.pretended_operation');
  });
});

describe('必须修 3 · a list goes only when every number is the same, with its heading', () => {
  it('numbers are equal whole, never by prefix', () => {
    expect(includesWhole('s$12.99', 's$12.9')).toBe(false);
    expect(includesWhole('19起', '9起')).toBe(false);
    expect(includesWhole('rmb9999起', 'rmb9999起')).toBe(true);
    expect(includesWhole('a: s$12.9, b', 's$12.9')).toBe(true);
    expect(includesWhole('s$12.9.', 's$12.9')).toBe(true);
    expect(includesWhole('s$12.90', 's$12.9')).toBe(true);
    expect(includesWhole('s$12.00 ', 's$12')).toBe(true);
    expect(includesWhole('s$12.901', 's$12.9')).toBe(false);
  });
  it('S$12.99 and S$12.9 are different prices: the second list stays', () => {
    const text =
      '找到这些：\n\n- Anker 线：S$12.99\n- UGREEN 线：S$15.9\n\n更便宜的：\n\n- Anker 线：S$12.9\n- UGREEN 线：S$15.9';
    expect(plainAnswer(text)).toBe(text);
  });
  it('a removed list takes its colon heading with it (「总结：」)', () => {
    const text =
      '苹果手机价格如下：\n\n1. iPhone Duo：RMB 15,999 起\n2. iPhone Air：RMB 8,799 起\n\n总结：\n\n- iPhone Duo：RMB 15999起\n- iPhone Air：RMB 8799起';
    expect(plainAnswer(text)).toBe(
      '苹果手机价格如下：\n\n1. iPhone Duo：RMB 15,999 起\n2. iPhone Air：RMB 8,799 起',
    );
    const bold = text.replace('总结：', '**更便宜的：**');
    expect(plainAnswer(bold)).not.toContain('更便宜的');
  });
  it('prose ending in a colon above a new list stays', () => {
    const text = '价格如下：\n\n- A：S$12.99\n- B：S$15.9\n\n另外两款：\n\n- C：S$9.9\n- D：S$7.5';
    expect(plainAnswer(text)).toBe(text);
  });
  it('a field 「S$12.9」 is not said by 「S$12.99」, and the page’s 「S$12.99」 grounds no 「S$12.9」', () => {
    expect(fieldLines([{ name: 'UGREEN', value: 'S$12.9' }], 'Anker：S$12.99')).toContain('S$12.9');
    const facts = assessCompletionFacts({
      summary: 'UGREEN 线 S$12.9',
      fields: [{ name: 'UGREEN 线', value: 'S$12.9' }],
      pages: [{ text: 'UGREEN USB C cable S$12.99' }],
    });
    expect([...facts.unverified, ...facts.contradictions].join('')).toContain('S$12.9');
  });
});

/** The beacon 故宫官网 sent on the 「导览」 click, rebuilt with stand-in values (shape as observed). */
function sensorsBody(
  record: Record<string, unknown> = {
    distinct_id: 'x1',
    anonymous_id: 'x1',
    identities: { $identity_cookie_id: 'x1' },
    lib: { $lib: 'js', $lib_method: 'code', $lib_version: '1.0.0' },
    properties: {
      $url: 'https://www.dpm.org.cn/Visit.html',
      $title: '导览',
      business_line: 'web',
      current_url: 'https://www.dpm.org.cn/Visit.html',
      language_type: 'zh',
      platform_type: 'pc',
      product_version: '1',
      referrer: '',
      navigation_name: '导览',
      second_navigation_name: '',
    },
    type: 'track',
    event: 'ggzwwz_TopNavigationBarClick',
    time: 1,
    _track_id: 1,
    _flush_time: 1,
  },
  ext = 'crc=-123456',
): string {
  const data = Buffer.from(JSON.stringify(record), 'utf8').toString('base64');
  return `data=${encodeURIComponent(data)}&ext=${encodeURIComponent(ext)}`;
}
const SA_URL = new URL(
  'https://gugong-pro.datasink.sensorsdata.cn/sa.gif?project=default&token=abc',
);

describe('必须修 4 · 故宫门票: the 神策 beacon is let through by its exact shape, nothing wider', () => {
  it('the observed beacon is telemetry', () => {
    expect(sensorsDataBeacon(SA_URL, 'POST', sensorsBody())).toBe(true);
    // Before this fix the generic beacon rule did not know `/sa.gif`.
    expect(passiveTelemetryRequest(SA_URL, 'ping')).toBe(false);
  });
  it('a different host, path, query, body key, event or property still pauses', () => {
    const base = sensorsBody();
    const cases: Array<[URL, string, string]> = [
      [new URL('https://www.dpm.org.cn/sa.gif?project=default'), 'POST', base],
      [new URL('https://evil.datasink.sensorsdata.cn/sa.gif'), 'POST', base],
      [new URL('https://gugong-pro.datasink.sensorsdata.cn/order'), 'POST', base],
      [new URL('https://gugong-pro.datasink.sensorsdata.cn/sa.gif?action=submit'), 'POST', base],
      [SA_URL, 'PUT', base],
      [SA_URL, 'POST', `${base}&phone=1`],
      [SA_URL, 'POST', base.replace(/ext=[^&]+/, 'ext=hello')],
      [SA_URL, 'POST', '{"data":"x","ext":"crc=1"}'],
      [SA_URL, 'POST', `data=${'A'.repeat(9000)}&ext=crc%3D1`],
    ];
    for (const [url, method, body] of cases)
      expect(sensorsDataBeacon(url, method, body), `${method} ${url.href}`).toBe(false);
    const record = (patch: Record<string, unknown>) =>
      sensorsBody({ type: 'track', event: '$pageview', properties: {}, ...patch });
    expect(sensorsDataBeacon(SA_URL, 'POST', record({}))).toBe(true);
    expect(sensorsDataBeacon(SA_URL, 'POST', record({ event: 'ggzwwz_BuyTicketClick' }))).toBe(
      false,
    );
    expect(sensorsDataBeacon(SA_URL, 'POST', record({ type: 'profile_set' }))).toBe(false);
    expect(sensorsDataBeacon(SA_URL, 'POST', record({ login_id: 'u1' }))).toBe(false);
    expect(sensorsDataBeacon(SA_URL, 'POST', record({ properties: { phone: '1380000' } }))).toBe(
      false,
    );
    expect(sensorsDataBeacon(SA_URL, 'POST', record({ properties: { form: { name: 'x' } } }))).toBe(
      false,
    );
  });
  it('the pause is said in plain words: what happened, then what to do', () => {
    const snapshot =
      '- navigation [ref=e3]:\n  - generic [ref=e5]:\n    - text: 导览\n  - link "开放时间" [ref=e6]';
    expect(refName(snapshot, 'e5')).toBe('导览');
    expect(refName(snapshot, 'e6')).toBe('开放时间');
    expect(refName('- generic [ref=e9]: 参观须知', 'e9')).toBe('参观须知');
    expect(siteCalled('导览-故宫博物院', 'https://www.dpm.org.cn/Visit.html')).toBe('故宫博物院');
    // FIX-59 P1-7: a Chinese task without a title names the site in Chinese.
    expect(siteCalled('', 'https://www.dpm.org.cn/Visit.html')).toBe('故宫博物院');
    const zh = effectPauseQuestion({
      english: false,
      site: '故宫博物院',
      action: { tool: 'click', label: '导览' },
      readOnly: true,
      background: false,
    });
    expect(zh).toBe(
      '我在故宫博物院点了「导览」，页面像是提交了一个请求，我先停下了。你看一下右侧画面有没有生成预约或订单；没有的话回复「继续」，我接着只读查看。',
    );
    const en = effectPauseQuestion({
      english: true,
      site: 'bestbuy.com',
      action: { tool: 'click', label: 'Add to Cart' },
      readOnly: true,
      background: false,
    });
    expect(en).toContain('I clicked “Add to Cart” on bestbuy.com');
    expect(en).toContain('reply “continue”');
    for (const text of [zh, en]) expect(text).not.toMatch(/副作用|写请求|交易状态|side effect/i);
  });
});
