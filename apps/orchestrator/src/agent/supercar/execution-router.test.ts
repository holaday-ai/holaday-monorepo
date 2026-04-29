import { describe, expect, it } from 'vitest';
import { classifyAsSimpleSearch } from './execution-router.js';

/**
 * Regression guard for the "MacBook false-positive" class of bugs.
 * Before Round-3 hotfix, English action verbs were matched via
 * substring, so "对比一下京东和淘宝上 MacBook Air M4 的价格" was
 * disqualified because 'book' sits inside 'MacBook'. Any future
 * tweak that reintroduces substring-only English matching should
 * fail this suite loudly.
 */
describe('classifyAsSimpleSearch', () => {
  describe('should classify as simple search (web_search short-circuit)', () => {
    it.each([
      '对比一下京东和淘宝上 MacBook Air M4 的价格',
      '京东淘宝 AirPods Pro 2 多少钱',
      '比较一下京东和天猫的 iPhone 价格',
      '帮我查一下淘宝上这个多少钱',
      'MacBook Air M4 现在多少钱',
      '今天上海天气',
      '比特币汇率',
      '明天台北的航班',
    ])('true: %s', (intent) => {
      expect(classifyAsSimpleSearch(intent)).toBe(true);
    });
  });

  describe('should NOT classify as simple search — "打开/访问/前往 X" navigation intents', () => {
    // Phase 14 audit — these should fall through to the agent loop
    // so the model can call the `navigate` tool. If they ever start
    // matching simple-search, the Brave fast lane would intercept
    // and return text search results instead of opening the page,
    // which is precisely the "打开 Google 失败" symptom BOSS hit.
    it.each([
      '打开 Google',
      '打开 google.com',
      '打开 google',
      '打开淘宝',
      '访问 jd.com',
      '前往 boss直聘',
      '进入 GitHub',
      'open google',
      'go to taobao',
    ])('false: %s', (intent) => {
      expect(classifyAsSimpleSearch(intent)).toBe(false);
    });
  });

  describe('should NOT classify as simple search (action verb present)', () => {
    it.each([
      '帮我在京东上买一台 MacBook',
      '请帮我下单 AirPods Pro 2',
      '在 Boss 直聘投递一个 AI 产品经理岗位',
      'help me book a flight to tokyo',
      '帮我注册一个账号',
      'Sign up for OpenAI',
    ])('false: %s', (intent) => {
      expect(classifyAsSimpleSearch(intent)).toBe(false);
    });
  });
});
