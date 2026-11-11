import { describe, expect, it } from 'vitest';
import { explicitSiteRequest } from './explicit-site.js';

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
    '',
  ])('%s → not an explicit site', (intent) => {
    expect(explicitSiteRequest(intent)).toBeNull();
  });
});
