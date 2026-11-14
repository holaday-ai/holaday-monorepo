/** FIX-58 P0 · a live fact about a named site or product never goes to generate. */
import { describe, expect, it } from 'vitest';
import { explainExecutionMode } from './intent-classifier.js';
import { matchLiveFact } from './live-fact.js';

const logger = { info() {}, warn() {}, debug() {}, error() {} } as never;
const route = (intent: string) => explainExecutionMode({ intent, logger } as never);

describe('FIX-58 P0 · live-fact routing', () => {
  it.each([
    '亚马逊新加坡站 USB C 线价格',
    '京东 iPhone 16 Pro 多少钱',
    'USB C cable price on Amazon Singapore',
    'usb c cable prices on amazon.sg',
    'Shopee 马来西亚站 Anker 充电宝有货吗',
    '淘宝上优衣库 T 恤现在卖多少',
    '苹果手机多少钱',
    'how much is an iPhone 16 Pro',
  ])('%s → a live fact, never generate', async (intent) => {
    expect(matchLiveFact(intent)).not.toBeNull();
    expect((await route(intent)).mode).not.toBe('generate');
  });

  it.each([
    ['亚马逊新加坡站 USB C 线价格', 'browser', 'kw:live-fact'],
    ['苹果手机多少钱', 'browser', 'kw:live-fact'],
    ['how much is an iPhone 16 Pro', 'browser', 'kw:live-fact'],
    // Already a lookup: the scrape lane, which hands a failed live lookup to the browser.
    ['京东 iPhone 16 Pro 多少钱', 'scrape', 'kw:site'],
    ['USB C cable price on Amazon Singapore', 'scrape', 'kw:site'],
  ])('%s → %s (%s)', async (intent, mode, source) => {
    expect(await route(intent)).toMatchObject({ mode, source });
  });

  it.each([
    '帮我写一段介绍 USB C 线的文案',
    '解释一下什么是 PD 快充',
    '帮我写一个促销文案，原价 199 现价 99',
    'iPhone 16 价格为什么涨了',
    '单价 20 元买 3 个总价格多少',
    '帮我做一份北京三日游预算',
    'What is the price elasticity of demand',
    '在亚马逊上搜索商品排名的算法是什么',
    '豆瓣电影 TOP250 榜单介绍',
    '总结下面这段最近的新闻：OpenAI 本周发布了新模型，支持更长上下文，价格下调一半，开发者反响积极，多家公司宣布接入。',
  ])('%s → not a live fact (stays out of the browser)', async (intent) => {
    expect(matchLiveFact(intent)).toBeNull();
    expect((await route(intent)).source).not.toBe('kw:live-fact');
  });

  it('index, stock and weather questions keep their own search road', async () => {
    expect(await route('上证指数现在多少点')).toMatchObject({
      mode: 'scrape',
      source: 'kw:live-info',
    });
    expect(await route('新加坡今天天气')).toMatchObject({ mode: 'scrape', source: 'kw:live-info' });
  });

  it('a pasted URL keeps its read-the-page road', async () => {
    expect(
      (await route('打开 https://item.jd.com/100142621606.html 读商品标题和价格')).source,
    ).not.toBe('kw:live-fact');
  });
});
