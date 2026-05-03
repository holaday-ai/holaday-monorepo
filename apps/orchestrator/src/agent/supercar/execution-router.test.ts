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
    // matching simple-search, tasks.ts would skip the planner step
    // (skipPlan = isSimpleSearchIntent || ...) and the agent could
    // misroute to web_search instead of opening the page, which is
    // precisely the "打开 Google 失败" symptom BOSS hit.
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

  describe('Phase 22a regression: nav-prefix MUST beat PRICE / FACT positive markers', () => {
    // Pre-22a-fix: "打开 amazon.com 找产品告诉我价格和评分" returned true
    // because "价格" sits in PRICE_HINTS, firing the early positive return
    // before the (then-absent) nav-prefix disqualifier. Same for "天气"
    // / "汇率" / "新闻" via FACT_NOUNS. These intents must route to the
    // browser because the user is naming the SITE they want (amazon.com,
    // weather.com), not asking for a generic fact lookup. web_search has
    // no way to honor the site requirement.
    it.each([
      // PRICE_HINTS that used to false-positive after a nav-prefix
      '打开 amazon.com 搜索 mechanical keyboard 找销量最高的 3 个产品 告诉我名称、价格和评分',
      '打开 jd.com 看看这款手机的价格',
      '访问 taobao.com 比较价格',
      // FACT_NOUNS that used to false-positive after a nav-prefix
      '打开 weather.com 查询今天洛杉矶的天气',
      '访问 xe.com 查一下今天美元汇率',
      '前往 finance.sina.com 看股价',
      '进入 12306.cn 查明天上海到北京的航班',
      // English variants
      'open amazon.com and check the price of mechanical keyboards',
      'visit weather.com and tell me today temperature in tokyo',
      'go to github.com and look at my profile',
      // Lead honorifics
      '帮我打开 jd.com 比一下价格',
      '请打开 weather.com 看看天气',
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
