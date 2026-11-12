/** FIX-61 复审 #2 顺手记: a login step only for the site that asked for the login. */
import { describe, expect, it } from 'vitest';
import { partialLoginStep } from './assistant-turn';

const IPHONE = 'iPhone 16 Pro Max 256GB 多少钱';
const APPLE =
  'https://www.apple.com.cn/iphone/compare/?modelList=iphone-16-pro-max,iphone-18-pro-max,iphone-18-pro';
// The iPhone task's answer (tsk_Y7s2…, 11-09): rescued from 苹果官网 after 京东 asked for a login.
const RESCUED = `这是从[苹果官网](${APPLE})查到的（京东页面要登录），只拿到了一部分：\n\n在 Apple 中国官网的机型比较页确认 iPhone 16 Pro Max 当前状态为「于授权经销商处有售」，官网不再直接销售，因此没有列出 256GB 的具体售价。京东等电商平台需要登录或验证才能查看价格，无法在未登录状态下获取准确报价。`;

describe('FIX-61 复审 #2: the login step names the site that asked for it', () => {
  it('a rescued answer: 京东 (the page that wanted the login), never 苹果官网', () => {
    const step = partialLoginStep({ text: RESCUED, intent: IPHONE, finalUrl: APPLE });
    expect(step?.label).toBe('你在浏览器里登录京东，我帮你读准确价格');
    expect(step?.label).not.toMatch(/apple|苹果/i);
    expect(step?.prompt).toContain('请打开刚才要登录的京东页面');
  });

  it('the same lead with 「你给的」 reads the same site', () => {
    const text = RESCUED.replace('（京东页面要登录）', '（你给的京东页面要登录）');
    expect(partialLoginStep({ text, intent: IPHONE, finalUrl: APPLE })?.label).toBe(
      '你在浏览器里登录京东，我帮你读准确价格',
    );
  });

  it('no rescue lead and the login sentence is about another site: no login step', () => {
    const text =
      '苹果官网写着「于授权经销商处有售」，没有列出价格。京东等电商平台需要登录或验证才能查看价格。';
    expect(partialLoginStep({ text, intent: IPHONE, finalUrl: APPLE })).toBeNull();
  });

  it('a rescue that was blocked, not asked to log in: no login step from the body', () => {
    const text = `这是从[苹果官网](${APPLE})查到的（京东页面被拦下了），只拿到了一部分：\n\n京东需要登录才能看价格。`;
    expect(partialLoginStep({ text, intent: IPHONE, finalUrl: APPLE })).toBeNull();
  });

  it('a login about the page the task is on still gets its step', () => {
    expect(
      partialLoginStep({
        text: '苹果官网的订单页需要登录后才能查看。',
        intent: '打开 https://www.apple.com.cn/shop/bag 看购物袋',
        finalUrl: 'https://www.apple.com.cn/shop/bag',
      })?.label,
      // FIX-62 P1-11: the site by its name, not its domain.
    ).toBe('你在浏览器里登录苹果官网，我帮你读完整内容');
  });

  it('English rescued lead names its site', () => {
    const text = `I got this from [Apple](${APPLE}) (the JD.com page you gave needs a login), so it's only part of what you asked:\n\nNo price listed.`;
    expect(
      partialLoginStep({ text, intent: 'how much is the iPhone 16 Pro Max 256GB', finalUrl: APPLE })
        ?.label,
    ).toBe("Log in to JD.com in the browser and I'll read the exact price");
  });
});

describe('FIX-62 P1-11: 「无需登录」 is no login wall; sites by name', () => {
  it('an answer that says no login was needed offers no login step', () => {
    for (const text of [
      '苹果官网无需登录即可查看价格，iPhone 16 Pro Max 256GB 起售价为 RMB 9,999。',
      '这个页面不需要登录，价格是 RMB 9,999。',
      'The Apple page shows the price without logging in: $1,199.',
      "The page doesn't require a login; it lists $1,199.",
    ])
      expect(partialLoginStep({ text, intent: IPHONE, finalUrl: APPLE })).toBeNull();
  });
  it('a real login wall on the same page still offers the step, named in words', () => {
    const text = '苹果官网页面要登录才能看价格，只拿到了一部分。';
    expect(partialLoginStep({ text, intent: IPHONE, finalUrl: APPLE })?.label).toBe(
      '你在浏览器里登录苹果官网，我帮你读准确价格',
    );
  });
});
