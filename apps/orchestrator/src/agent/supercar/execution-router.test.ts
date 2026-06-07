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

  describe('should NOT classify as simple search — ecommerce listings need source-preserving tools', () => {
    it.each([
      '去电商站搜 iPhone 16，按价格排序，给前5结果（名称/价格/链接）',
      '在京东/天猫找 iPhone 16，给 5 个商品的名称、价格、链接',
      'amazon search mechanical keyboard top 5 products with price and link',
    ])('false: %s', (intent) => {
      expect(classifyAsSimpleSearch(intent)).toBe(false);
    });
  });

  describe('should NOT classify as simple search — live app workflows with filters or drafts', () => {
    it.each([
      '在 Google Flights 查找东京到纽约航班并筛选直飞',
      '用 Google Flights 搜索东京到纽约航班，选择最早出发',
      '在携程查询上海到东京机票，筛选直飞并停在付款前',
      '在 Airbnb 找下周末东京民宿并收藏前两个',
      '用 Airbnb 搜索东京民宿，勾选整租并设置两位住客',
      '在 Google Forms 填写这份报名表但不要提交',
      '在 Gmail 写一封邮件草稿给客户，不要发送',
      '在 LinkedIn 搜索产品经理岗位并保存筛选条件',
      '在 Notion 创建一个项目计划页面草稿',
      '在 Google Docs 新建一个会议纪要文档草稿',
      '在 Google Sheets 创建一个预算表草稿',
      '在 Google Slides 创建一个路演演示文稿草稿',
      '在 Google Calendar 安排一个项目会议但不要发送邀请',
      '在 GitHub 创建一个 issue 草稿',
      'create a draft issue in GitHub',
      'create a budget spreadsheet in Google Sheets',
      'schedule a project meeting in Google Calendar but do not send invites',
      '在 HubSpot 创建一个联系人草稿',
      '在 Salesforce 更新这个客户备注',
      '在 Stripe dashboard 查找这个付款并下载收据',
      '在 Calendly 创建一个会议链接草稿',
      '在 Trello 新建一个项目看板',
      '在 Asana 创建三个任务草稿',
      '在 Jira 创建一个 bug issue 草稿',
      'create a contact draft in HubSpot',
      'update this customer note in Salesforce',
      'download a receipt in Stripe',
      'create a bug issue in Jira',
      '在 Shopify 后台创建一个折扣码草稿',
      '在 Zendesk 回复这张工单草稿',
      '在 Intercom 给这个用户添加一条备注',
      '在 Linear 创建一个 bug issue 草稿',
      '在 Monday.com 新建一个项目任务',
      'create a discount code draft in Shopify',
      'reply to this support ticket in Zendesk',
      'add a user note in Intercom',
      'create a bug issue in Linear',
      'create a project task in Monday.com',
      'In Zendesk, reply to this support ticket but do not send',
      'Use Shopify admin to create a discount code draft',
      'Open Intercom and add a note to this user',
      'In Linear, create a bug issue draft',
      'In Monday.com, create a project task',
      'Use Stripe dashboard to find the payment and download a receipt',
      'Use HubSpot to create a contact draft',
      'Open Salesforce and update this customer note',
      '打开 Zendesk 回复这张工单草稿',
      '进入 Intercom 给这个用户添加备注',
      '在 web2.0calc.com 计算 128*128',
      'use web2.0calc.com to calculate 128*128',
      'use canva.com to create a poster draft',
      'use zapier.com to create an automation draft',
      'use mailchimp.com to create a campaign draft',
      'use webflow.com to edit this landing page draft',
      'use notion.so to create a page draft',
      'On canva.com, create a poster draft',
      'In airtable.com, add a row to the leads table',
      'add a row in airtable.com',
      'edit a design in figma.com',
      'schedule a post in buffer.com',
      'publish a draft on medium.com',
      'make a poster in canva.com',
      'upload an image to cloudinary.com',
      'use framer.site to edit a landing page draft',
      'make a logo in brand.design',
      'create a profile draft in read.cv',
      '在 canva.com 创建一个海报草稿',
      '在 zapier.com 创建一个自动化草稿',
      '在 mailchimp.com 创建一个邮件 campaign 草稿',
      '在 webflow.com 编辑这个 landing page 草稿',
      '在 airtable.com 添加一条记录',
      '在 framer.site 编辑一个 landing page 草稿',
      '在 brand.design 创建一个 logo 草稿',
    ])('false: %s', (intent) => {
      expect(classifyAsSimpleSearch(intent)).toBe(false);
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
