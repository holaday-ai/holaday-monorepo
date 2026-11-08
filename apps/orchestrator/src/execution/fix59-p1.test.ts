/** FIX-59 P1: answer and pause-copy follow-ups from Deploy-58 (items 4–7 here; 1–3 and 8 below). */
import { describe, expect, it } from 'vitest';
import { sensorsDataBeacon } from '../agent/browser-tools/cloud-observation.js';
import {
  effectPauseQuestion,
  labelIsPageTitle,
  looksSubmitted,
  refName,
  siteCalled,
} from '../agent/browser-tools/effect-pause-copy.js';

const SA_URL = new URL(
  'https://gugong-pro.datasink.sensorsdata.cn/sa.gif?project=default&token=abc',
);
/** 故宫's nav-click beacon (same stand-in as deploy58-step0.test.ts), `patch` over its properties. */
function beacon(properties: Record<string, unknown> = {}) {
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
  };
  const data = Buffer.from(JSON.stringify(record), 'utf8').toString('base64');
  return `data=${encodeURIComponent(data)}&ext=${encodeURIComponent('crc=-123456')}`;
}
const passes = (body: string) => sensorsDataBeacon(SA_URL, 'POST', body);

describe('P1-4 · a control is named by one short line, never by the page title', () => {
  const AMAP_TITLE = '高德地图 — 在线地图查询与路线规划服务';
  const snapshot = [
    '- banner [ref=e1]:',
    `  - link "${AMAP_TITLE}\\n …" [ref=e2]`,
    '  - textbox "搜索地点、公交、地铁" [ref=e3]',
    '  - button "路线规划及导航服务说明这是一个很长很长的按钮名字" [ref=e4]',
  ].join('\n');
  it('the logo link carrying the title with a literal \\n is cut to one line', () => {
    const name = refName(snapshot, 'e2')!;
    expect(name).not.toContain('\\n');
    expect(name.length).toBeLessThanOrEqual(20);
  });
  it('a long name is cut at about 20 characters', () => {
    const name = refName(snapshot, 'e4')!;
    expect(name.length).toBeLessThanOrEqual(20);
    expect(name.endsWith('…')).toBe(true);
  });
  it('the 高德 pause no longer quotes the page title as the control', () => {
    const before = `${AMAP_TITLE}\\n …`;
    const copy = effectPauseQuestion({
      english: false,
      site: siteCalled(AMAP_TITLE, 'https://www.amap.com/'),
      pageTitle: AMAP_TITLE,
      action: { tool: 'click', label: before },
      readOnly: true,
      background: true,
    });
    expect(copy).not.toContain('\\n');
    expect(copy).not.toContain('在线地图查询');
    expect(copy).toMatch(/^我在高德地图点了一下，/);
  });
  it('a real control keeps its name', () => {
    expect(labelIsPageTitle('导览-故宫博物院', '导览-故宫博物院')).toBe(true);
    expect(
      labelIsPageTitle(
        '高德地图 — 在线地图查询与路线规划…',
        '高德地图 — 在线地图查询与路线规划服务',
      ),
    ).toBe(true);
    // A nav item named like the page's own section is a real control.
    expect(labelIsPageTitle('导览', '导览-故宫博物院')).toBe(false);
    expect(labelIsPageTitle('门票预约', '导览-故宫博物院')).toBe(false);
    const copy = effectPauseQuestion({
      english: false,
      site: '故宫博物院',
      pageTitle: '首页-故宫博物院',
      action: { tool: 'click', label: '导览' },
      readOnly: true,
      background: false,
    });
    expect(copy).toContain('点了「导览」');
  });
});

describe('P1-5 · a button that says only the act is a real submit', () => {
  it.each([
    '购票',
    '预约',
    '预订',
    '订票',
    '结算',
    'Buy tickets',
    'Buy ticket',
    'Reserve',
    'Checkout',
    'Check out',
  ])('「%s」 gets the strong copy', (label) => {
    expect(looksSubmitted({ tool: 'click', label })).toBe(true);
    const copy = effectPauseQuestion({
      english: false,
      site: '故宫博物院',
      action: { tool: 'click', label },
      readOnly: true,
      background: false,
    });
    expect(copy).toContain('可能已经提交成功');
  });
  it.each([
    '购票须知',
    '预约说明',
    'Reservation info',
    'Checkout help',
    '预约参观',
    'Book',
    '导览',
  ])('「%s」 is not', (label) => expect(looksSubmitted({ tool: 'click', label })).toBe(false));
});

describe('P1-6 · an 11-digit ID is a phone only under a phone key', () => {
  it.each([
    ['?item=13912345678', 'https://www.dpm.org.cn/x.html?item=13912345678'],
    ['?id=18800001111', 'https://www.dpm.org.cn/x.html?id=18800001111'],
    ['?sku=… in a longer value', 'https://www.dpm.org.cn/x.html?ref=a_15012345678_b'],
    ['#item=13912345678', 'https://www.dpm.org.cn/x.html#item=13912345678'],
    ['#/detail/13912345678', 'https://www.dpm.org.cn/x.html#/detail/13912345678'],
  ])('passes: %s', (_label, url) => expect(passes(beacon({ $url: url }))).toBe(true));
  it.each([
    ['?phone=', 'https://www.dpm.org.cn/x.html?phone=13912345678'],
    ['?mobile=', 'https://www.dpm.org.cn/x.html?mobile=13912345678'],
    ['?tel=', 'https://www.dpm.org.cn/x.html?tel=13912345678'],
    ['?手机=', 'https://www.dpm.org.cn/x.html?%E6%89%8B%E6%9C%BA=13912345678'],
    ['+86 under any key', 'https://www.dpm.org.cn/x.html?q=%2B86%20139%201234%205678'],
    ['dashes under any key', 'https://www.dpm.org.cn/x.html?q=139-1234-5678'],
    ['#/order?mobile=', 'https://www.dpm.org.cn/x.html#/order?mobile=13912345678'],
    ['#q=139 1234 5678', 'https://www.dpm.org.cn/x.html#q=139%201234%205678'],
    ['#email', 'https://www.dpm.org.cn/x.html#/a?x=a%40b.cn'],
  ])('pauses: %s', (_label, url) => expect(passes(beacon({ $url: url }))).toBe(false));
});

describe('P1-7 · site names', () => {
  it('a Chinese task without a title names the site in Chinese', () => {
    expect(siteCalled('', 'https://www.dpm.org.cn/Visit.html')).toBe('故宫博物院');
    expect(siteCalled(null, 'https://item.jd.com/1.html')).toBe('京东');
    expect(siteCalled('', 'https://www.amazon.sg/s?k=usb+c')).toBe('亚马逊新加坡站');
  });
  it('a search title is never the site name', () => {
    expect(siteCalled('Amazon.sg: usb c', 'https://www.amazon.sg/s?k=usb+c')).toBe(
      '亚马逊新加坡站',
    );
    expect(siteCalled('Amazon.sg: usb c', 'https://www.amazon.sg/s?k=usb+c', true)).toBe(
      'Amazon Singapore',
    );
    expect(siteCalled('Amazon.sg', 'https://www.amazon.sg/')).toBe('亚马逊新加坡站');
  });
  it('a page title site part still wins', () => {
    expect(siteCalled('导览-故宫博物院', 'https://www.dpm.org.cn/Visit.html')).toBe('故宫博物院');
    expect(siteCalled('门票-某某景区', 'https://www.example.cn/a')).toBe('某某景区');
    expect(siteCalled('', 'https://www.example.cn/a')).toBe('example.cn');
  });
});

import { plainAnswer, withoutDanglingLeads } from '../agent/browser-tools/unified-browser-loop.js';

describe('P1-2 · a value taken out leaves no half-said clause, bracket or line', () => {
  it.each([
    [
      'new-amazon-sg (Deploy-58): the bracket that lost its price',
      '3. Belkin Eco USB C to USB C 60W Braided Cable 3.3ft… — S$9.43（有 1 个卖家报价）（该条目显示为 See options / No featured offers available，页面给出的最低报价为）',
      '3. Belkin Eco USB C to USB C 60W Braided Cable 3.3ft… — S$9.43（有 1 个卖家报价）（该条目显示为 See options / No featured offers available）',
    ],
    [
      'fc-jd (Deploy-58): 「只显示 ，」',
      '- 页面显示的价格：¥7??9（价格没登录时被京东打了码，只显示 ，并提示「登录查看价格」）',
      '- 页面显示的价格：¥7??9（价格没登录时被京东打了码，并提示「登录查看价格」）',
    ],
    [
      'core-10 (Deploy-58): 「frameId 为，」',
      '页面包含一个 iframe，其内部为 TinyMCE 富文本编辑区，frameId 为，初始内容为段落 "Your content goes here."。',
      '页面包含一个 iframe，其内部为 TinyMCE 富文本编辑区，初始内容为段落 "Your content goes here."。',
    ],
    [
      'google-direct-1 (Deploy-58): the empty 「- opened url：」 line',
      '已在云端浏览器中成功打开 google.com，页面正常加载并显示 Google 首页。\n\n- opened url：',
      '已在云端浏览器中成功打开 google.com，页面正常加载并显示 Google 首页。',
    ],
    [
      'a bracket left with only its lead-in goes whole',
      '价格 S$9.43（最低报价为）。',
      '价格 S$9.43。',
    ],
    ['an empty field among others', '标题：「春」，作者：，点赞 5', '标题：「春」，点赞 5'],
  ])('%s', (_label, before, after) => expect(withoutDanglingLeads(before)).toBe(after));

  it.each([
    '评论数页面未显示，点赞 12',
    '前三个商品如下：',
    '- 价格：\n  - 现价 S$9\n  - 原价 S$12',
    '我认为，这款更划算。',
    '没有给出，只写了「暂无」。',
    '不当行为，会被处理。',
    '售价为 ¥99，库存 3 件。',
    '时间 14:30，地点北京。',
    '**前三个结果：**\n1. A\n2. B',
  ])('stays as it is: %s', (text) => expect(withoutDanglingLeads(text)).toBe(text));
});

describe('P1-3 · the same price said in other words under item N goes', () => {
  const before = [
    '在亚马逊新加坡站搜索 "usb c cable" 后，前三个商品的名称和价格如下：',
    '',
    '1. UGREEN 2 Pack USB C to USB C Charger Cable, Type C 100W…1M — S$10.92（Was: S$17.42）',
    '2. UGREEN 2 Pack USB C to USB C Charger Cable, Type C 100W…2M — S$12.45（Was: S$21.22）',
    '3. Belkin Eco USB C to USB C 60W Braided Cable 3.3ft… — 该商品详情页未显示主推价，有 1 个卖家报价 S$9.43',
    '',
    '- 商品3价格：这款没有主推价，有 1 个卖家报价 S$9.43',
    '',
    '未核实：以下内容未能在已读页面中逐字找到，请自行确认——商品3价格「这款没有主推价，有 1 个卖家报价 S$9.43」',
  ].join('\n');
  it('reg-new-amazon-sg (Deploy-58): the line and its 未核实 item go', () => {
    const after = plainAnswer(before);
    expect(after).not.toContain('商品3价格');
    expect(after).not.toContain('未核实');
    expect(after).toContain('有 1 个卖家报价 S$9.43');
  });
  it('a different price or a different fact stays', () => {
    const other = before.replace(
      '- 商品3价格：这款没有主推价，有 1 个卖家报价 S$9.43',
      '- 商品3价格：这款没有主推价，有 2 个卖家报价 S$9.43',
    );
    expect(plainAnswer(other)).toContain('- 商品3价格');
    const cheaper = before.replace(
      '- 商品3价格：这款没有主推价，有 1 个卖家报价 S$9.43',
      '- 商品3价格：S$8.10（会员价）',
    );
    expect(plainAnswer(cheaper)).toContain('- 商品3价格');
  });
});

import { readFileSync } from 'node:fs';
import { assessCompletionFacts } from '../agent/browser-tools/completion-fields.js';
import { misattributedPrices, tabSections } from '../agent/browser-tools/section-attribution.js';

/** 故宫 Visit.html as the browser's text gives it (captured live 2026-11-07): the carousel's copy
 * of the halls' list comes first, right under the two tab names. */
const VISIT = readFileSync(new URL('./fixtures/dpm-visit-tickets.txt', import.meta.url), 'utf8');

describe('P1-1 · a price is the tab’s it sits under (故宫 Visit.html)', () => {
  it('the tabs pair with their own lists, the carousel copies dropped', () => {
    const [group] = tabSections(VISIT);
    expect(group?.map((section) => section.title)).toEqual([
      '大门票优惠政策',
      '钟表馆、珍宝馆票价优惠政策',
    ]);
    expect(group?.[0]?.text).toContain('淡旺季均为20元/人');
    expect(group?.[0]?.text).toContain('即旺季30元/人；淡季20元/人');
    expect(group?.[1]?.text).toContain('淡旺季均为5元/人');
    expect(group?.[1]?.keys).toEqual(['钟表馆', '珍宝馆']);
  });

  const G2 = [
    '故宫博物院门票价格如下：',
    '',
    '- 旺季（4月1日—10月31日）：大门票 60 元/人',
    '- 淡季（11月1日—次年3月31日）：大门票 40 元/人',
    '- 珍宝馆、钟表馆：各 10 元/人',
    '',
    '优惠：学生票淡旺季均为 5 元/人；60 周岁以上老年人门票半价优惠（即 5 元/人）。',
  ].join('\n');
  it('local g2 (Deploy-58): the halls’ 5 元 given as the main ticket’s is sent back', () => {
    const said = misattributedPrices(G2, [VISIT]);
    expect(said).toHaveLength(1);
    expect(said[0]).toContain('「5元」在页面上属于「钟表馆、珍宝馆票价优惠政策」');
    const facts = assessCompletionFacts({ summary: G2, pages: [{ text: VISIT }] });
    expect(facts.contradictions.join('\n')).toContain('钟表馆、珍宝馆票价优惠政策');
  });
  it('named as the main ticket’s, it is sent back too', () => {
    const said = misattributedPrices('大门票优惠：学生票 5 元/人', [VISIT]);
    expect(said[0]).toContain('写成了「大门票优惠政策」的');
  });
  it.each([
    [
      'the main ticket’s own discounts',
      '优惠：学生票淡旺季均为 20 元/人；老年人旺季 30 元/人、淡季 20 元/人。',
    ],
    ['the halls’ discounts, named', '钟表馆、珍宝馆的优惠：学生票 5 元/人，老年人 5 元/人。'],
    ['under a heading that names them', '**珍宝馆、钟表馆优惠：**\n- 学生票：5 元/人'],
    ['a price outside the tabs', '旺季大门票 60 元/人，珍宝馆 10 元/人。'],
  ])('stays: %s', (_label, answer) => expect(misattributedPrices(answer, [VISIT])).toEqual([]));
  it('a snapshot showing only the current slide pairs nothing (no guess)', () => {
    const snapshot = [
      '- generic [ref=e40]: 大门票优惠政策',
      '- generic [ref=e41]: 钟表馆、珍宝馆票价优惠政策',
      ...VISIT.split('\n')
        .slice(17, 27)
        .map((line, i) => `- generic [ref=e${50 + i}]: ${line}`),
    ].join('\n');
    expect(tabSections(snapshot)).toEqual([]);
    expect(misattributedPrices(G2, [snapshot])).toEqual([]);
  });
});
