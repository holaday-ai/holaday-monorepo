import { describe, expect, it } from 'vitest';
import { summariseIntent } from './summarise-intent';

/** FIX-57 复审 #1-1d: sidebar rows tell tasks apart, not 「使用云端浏览器」. */
describe('summariseIntent · browser preamble and pasted addresses', () => {
  it.each([
    [
      '请使用云端浏览器，打开 https://item.jd.com/100142621606.html 读商品标题和页面显示的价格',
      '京东商品页 读商品标题和页面显示的价格',
    ],
    [
      '请使用云端浏览器，打开 https://www.zhihu.com/question/22045646 读问题标题和回答数',
      '知乎问题 读问题标题和回答数',
    ],
    [
      '请使用云端浏览器，高德地图查一下杭州东站到西湖断桥怎么走',
      '高德地图查杭州东站到西湖断桥怎么走',
    ],
    ['上证指数现在多少点', '上证指数现在多少点'],
  ])('%s', (intent, title) => {
    expect(summariseIntent(intent, 24)).toBe(title);
    expect(summariseIntent(intent, 24)).not.toContain('浏览器');
  });
});
