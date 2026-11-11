import { describe, expect, it } from 'vitest';
import { isPriceTask } from './price-task.js';

describe('REBUILD-3 isPriceTask', () => {
  it.each([
    '在亚马逊新加坡站搜 usb c cable，列出前三个的名称和价格',
    '打开 https://item.jd.com/100142621606.html 读商品标题和页面显示的价格',
    'iPhone 16 Pro 在苹果官网卖多少钱',
    '京东上 AirPods Pro 2 现在多少钱',
    '比价：淘宝和京东哪个便宜',
    '找三款最便宜的 type-c 数据线，给出售价和链接',
    'What is the price of the Kindle Paperwhite on amazon.sg?',
    'How much does a Nintendo Switch OLED cost on Best Buy?',
    'Find the cheapest USB-C cable on Amazon and give its price',
  ])('positive: %s', (intent) => {
    expect(isPriceTask(intent)).toBe(true);
  });

  it.each([
    '今天上证指数收盘多少点',
    '贵州茅台股价是多少',
    'What is the stock price of Apple today?',
    '帮我写一篇关于手机价格战的公众号文章',
    '写一段推广这款耳机的文案，突出价格优势',
    'Write an ad copy about our new pricing',
    '单价 30 元，买 3 个一共多少钱',
    '打开维基百科读「万维网」的第一段',
    '总结这个视频的评论区观点',
    '这家餐厅的评价怎么样',
    '列出京东前三款耳机的价格和评分',
    'Give the price and rating of the top 3 USB-C cables on amazon.sg',
  ])('negative: %s', (intent) => {
    expect(isPriceTask(intent)).toBe(false);
  });
});
