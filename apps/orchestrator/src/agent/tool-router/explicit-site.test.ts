import { describe, expect, it } from 'vitest';
import { explicitSiteRequest, explicitSiteRoute } from './explicit-site.js';

describe('explicitSiteRequest (hard rule 2: a named site goes to the browser)', () => {
  it.each([
    ['打开 google.com 搜索 Claude', 'google.com'],
    ['在亚马逊新加坡站搜 usb c cable', '亚马逊新加坡站'],
    ['在京东上看看 iPhone 16 Pro 的价格', '京东'],
    ['打开淘宝，找一下 USB C 线', '淘宝'],
    ['访问 https://example.com/pricing 读一下价格', 'https://example.com/pricing'],
    ['去京东搜 机械键盘', '京东'],
    ['在小红书里找露营笔记', '小红书'],
    ['进入苹果官网看看新款 iPad', '苹果官网'],
    ['在这个网站上帮我登录', '这个网站'],
    ['open bestbuy.com and tell me the first usb c cable', 'bestbuy.com'],
    ['Open YouTube and find the trending video', 'YouTube'],
    ['visit the Apple website and check the iPad price', 'the Apple website'],
    ['usb c cable price on Amazon Singapore', 'Amazon'],
    ['What is the top result for usb c cable on amazon.sg?', 'amazon.sg'],
    ['go to github.com/trending and list the top repo', 'github.com/trending'],
    // Review #1 item 4: 「上百度搜一下」「去 X 上查」 name a site too.
    ['上百度搜一下西湖的面积', '百度'],
    ['去百度上查一下今天的油价', '百度'],
    ['上必应搜一下 Claude 是什么', '必应'],
    ['去 Bing 上查一下 Claude', 'Bing'],
    ['去搜狗搜一下这个词', '搜狗'],
    ['去什么值得买上查一下这款耳机', '什么值得买'],
    ['到百度百科上查西湖的面积', '百度百科'],
    ['去知乎上查一下大家怎么说', '知乎'],
  ])('%s → browser', (intent, site) => {
    expect(explicitSiteRequest(intent)).toBe(site);
  });

  it.each([
    '上证指数现在多少',
    '今天杭州天气怎么样',
    '帮我写一首关于秋天的诗',
    'iPhone 16 Pro 多少钱',
    '京东 618 有什么活动',
    '我在上海站附近，推荐一家酒店',
    '访问量最高的网站有哪些',
    '用浏览器的好处是什么',
    '不要打开淘宝，直接告诉我 USB C 线大概多少钱',
    "Don't open google.com, just explain what Claude is",
    'what is the weather on Monday in Singapore',
    'how much do engineers earn at Google',
    'write an article on the website redesign',
    'open the file and summarise it',
    '把 report.pdf 打开总结一下',
    '去网上查一下今天的油价',
    '上网查一下西湖的面积',
    '到家里查一下水表',
    '去年上半年查到的数据有哪些',
    '不要上百度搜，直接告诉我',
    '百度的市值是多少',
    '',
  ])('%s → not an explicit site', (intent) => {
    expect(explicitSiteRequest(intent)).toBeNull();
  });
});

describe('explicitSiteRoute (a site with an enabled interface)', () => {
  const AMAP = [{ toolId: 'amap_maps', aliases: ['高德地图', '高德', 'amap', 'gaode'] }];

  it.each([
    '在高德地图上查从杭州东站到西湖的路线',
    '用高德查路线',
    '上高德查一下杭州东站去断桥',
    '去高德上查下怎么走',
    '高德地图上搜一下附近的咖啡店',
    '打开高德地图查一下去西湖怎么走',
    'check the route on Amap',
    'use amap to find a coffee shop near West Lake',
  ])('%s → interface', (intent) => {
    expect(explicitSiteRoute(intent, AMAP)).toMatchObject({
      kind: 'interface',
      toolId: 'amap_maps',
    });
  });

  it.each([
    ['打开高德地图网页查路线', '高德地图'],
    ['打开高德地图网站', '高德地图'],
    ['进入高德官网看看', '高德'],
    ['打开 amap.com 看看', 'amap.com'],
    ['在高德地图上登录我的账号', '高德地图'],
    ['用高德地图截图这条路线', '高德地图'],
    ['open the Amap website', 'Amap'],
  ])('%s → browser', (intent, site) => {
    expect(explicitSiteRoute(intent, AMAP)).toEqual({ kind: 'browser', site });
  });

  it('leaves everything else to the old rule or the model', () => {
    expect(explicitSiteRoute('在京东上看看 iPhone 价格', AMAP)).toEqual({
      kind: 'browser',
      site: '京东',
    });
    expect(explicitSiteRoute('高德的股价是多少', AMAP)).toBeNull();
    expect(explicitSiteRoute('不要用高德，直接告诉我大概多远', AMAP)).toBeNull();
    expect(explicitSiteRoute('杭州东站到西湖怎么走', AMAP)).toBeNull();
    // Without an enabled interface, naming 高德 is just an explicit site.
    expect(explicitSiteRoute('在高德地图上查路线')).toEqual({ kind: 'browser', site: '高德地图' });
  });
});
