/**
 * Phase 24 RC follow-up — generate-default intent classifier.
 *
 * Default flipped from 'browser' to 'generate' after RC data showed
 * 72/165 timeouts were pure-generation tasks routed to a 10-slot
 * BrowserPool. Browser is reserved for tasks that genuinely need a
 * live page: explicit URL, browser-action verb, or named site.
 *
 * No Haiku call — keyword rules only (cost saving + determinism).
 * Tests pin every category so a future "default to browser" regression
 * is caught at unit time.
 */

import { describe, expect, it, vi } from 'vitest';
import type { Logger } from 'pino';
import { classifyExecutionMode } from './intent-classifier.js';

function fakeLogger(): Logger {
  const noop = vi.fn();
  return {
    info: noop,
    warn: noop,
    debug: noop,
    error: noop,
    fatal: noop,
    trace: noop,
    child: () => fakeLogger(),
  } as unknown as Logger;
}

describe('classifyExecutionMode — default is generate', () => {
  it('empty intent → generate (was browser, flipped for RC)', async () => {
    const out = await classifyExecutionMode({ intent: '', logger: fakeLogger() });
    expect(out).toBe('generate');
  });

  it('pure translation task → generate', async () => {
    const out = await classifyExecutionMode({
      intent: '帮我把这段话翻译成英文',
      logger: fakeLogger(),
    });
    expect(out).toBe('generate');
  });

  it('plan-writing task → generate', async () => {
    const out = await classifyExecutionMode({
      intent: '写一份产品发布计划',
      logger: fakeLogger(),
    });
    expect(out).toBe('generate');
  });

  it('analysis task → generate', async () => {
    const out = await classifyExecutionMode({
      intent: '分析中国新能源汽车 2026 年的市场格局',
      logger: fakeLogger(),
    });
    expect(out).toBe('generate');
  });

  it('SOP / 术语表 → generate', async () => {
    const out = await classifyExecutionMode({
      intent: '帮我整理一份运维 SOP',
      logger: fakeLogger(),
    });
    expect(out).toBe('generate');
  });

  it('vague short intent → generate (no browser tells)', async () => {
    const out = await classifyExecutionMode({
      intent: '生成一个产品名',
      logger: fakeLogger(),
    });
    expect(out).toBe('generate');
  });
});

describe('classifyExecutionMode — pre-Firecrawl regression suite (site/URL without interaction now scrape)', () => {
  // Phase 24 RC follow-up — the original 2-route classifier sent
  // every URL / site mention to browser. With Firecrawl as a third
  // route, the same intents now route to 'scrape' UNLESS the
  // intent also carries an interaction verb (登录/打开/下单/...).
  // These tests pin the new behaviour so a future "always-browser"
  // regression is caught at unit time.
  it('site name 知乎 (no interaction) → scrape', async () => {
    const out = await classifyExecutionMode({
      intent: '知乎上 AI Agent 的高赞回答',
      logger: fakeLogger(),
    });
    expect(out).toBe('scrape');
  });

  it('site name 微博 (no interaction) → scrape', async () => {
    const out = await classifyExecutionMode({
      intent: '微博热搜榜单',
      logger: fakeLogger(),
    });
    expect(out).toBe('scrape');
  });

  it('English search verb on a site → scrape', async () => {
    const out = await classifyExecutionMode({
      intent: 'find recent stars on github.com/anthropics',
      logger: fakeLogger(),
    });
    expect(out).toBe('scrape');
  });
});

describe('classifyExecutionMode — explicit skill hint short-circuit', () => {
  it('content-creator skill stays generate even with site name in intent', async () => {
    const out = await classifyExecutionMode({
      intent: '为知乎账号写一篇 AI Agent 普及文',
      skillId: 'content-creator',
      logger: fakeLogger(),
    });
    expect(out).toBe('generate');
  });

  it('xiaohongshu skill is browser even on a generate-leaning intent', async () => {
    const out = await classifyExecutionMode({
      intent: '帮我写一段笔记',
      skillId: 'xiaohongshu',
      logger: fakeLogger(),
    });
    expect(out).toBe('browser');
  });

  it('unknown skill falls through to keyword logic', async () => {
    const out = await classifyExecutionMode({
      intent: '写一份方案',
      skillId: 'made-up-role-id',
      logger: fakeLogger(),
    });
    expect(out).toBe('generate');
  });
});

describe('classifyExecutionMode — strong keyword overrides skill hint (Phase 1 follow-up)', () => {
  // Phase 1 follow-up — search verbs / URLs / interaction verbs are
  // STRONG signals that override an installed skill hint. Without
  // this swap, a user with xiaohongshu skill enabled who typed
  // "搜索小红书上露营笔记" routed to browser (skill won) and hit a
  // login wall instead of routing to scrape (Firecrawl /search).
  // These tests pin the precedence so a future "skill always wins"
  // regression is caught at unit time. Each test uses a UNIQUE
  // intent (the prior tests share a module-scope cache keyed only
  // on intent text).

  it('search-verb signal beats xiaohongshu skill hint → scrape', async () => {
    const out = await classifyExecutionMode({
      intent: '搜索小红书上 P1F-A 露营装备笔记',
      skillId: 'xiaohongshu',
      logger: fakeLogger(),
    });
    expect(out).toBe('scrape');
  });

  it('search-verb signal beats douyin skill hint → scrape', async () => {
    const out = await classifyExecutionMode({
      intent: '查找 P1F-B 抖音热门商品趋势',
      skillId: 'douyin',
      logger: fakeLogger(),
    });
    expect(out).toBe('scrape');
  });

  it('English search-pattern signal beats browser skill hints → scrape', async () => {
    for (const [intent, skillId] of [
      ['search P1F-G Xiaohongshu camping notes', 'xiaohongshu'],
      ['look up P1F-H recent posts on Douyin', 'douyin'],
    ] as const) {
      const out = await classifyExecutionMode({
        intent,
        skillId,
        logger: fakeLogger(),
      });
      expect(out).toBe('scrape');
    }
  });

  it('URL signal beats douyin skill hint → scrape', async () => {
    const out = await classifyExecutionMode({
      intent: '看一下 https://example.com/p1f-c-page',
      skillId: 'douyin',
      logger: fakeLogger(),
    });
    expect(out).toBe('scrape');
  });

  it('interaction verb still routes to browser even without skill hint', async () => {
    const out = await classifyExecutionMode({
      intent: '在小红书上点赞 P1F-D 这篇笔记',
      skillId: 'xiaohongshu',
      logger: fakeLogger(),
    });
    expect(out).toBe('browser');
  });

  it('site name alone (kw:site, NOT strong) → skill hint still wins', async () => {
    // "小红书 P1F-E" is just a site mention — kw:site is a weaker
    // signal that defers to the user's explicit skill choice.
    const out = await classifyExecutionMode({
      intent: '看看小红书 P1F-E 的产品页',
      skillId: 'xiaohongshu',
      logger: fakeLogger(),
    });
    expect(out).toBe('browser');
  });

  it('search-verb without skill hint → still scrape (no behaviour change)', async () => {
    const out = await classifyExecutionMode({
      intent: '搜索小红书 P1F-F 露营装备',
      logger: fakeLogger(),
    });
    expect(out).toBe('scrape');
  });
});

describe('classifyExecutionMode — scrape route (Firecrawl path)', () => {
  it('search verb + site name → scrape', async () => {
    const out = await classifyExecutionMode({
      intent: '搜索小红书上露营装备热门笔记',
      logger: fakeLogger(),
    });
    expect(out).toBe('scrape');
  });

  it('查询 verb (info-only) → scrape', async () => {
    const out = await classifyExecutionMode({
      intent: '查询苹果最新财报',
      logger: fakeLogger(),
    });
    expect(out).toBe('scrape');
  });

  it('查 + current info context → scrape', async () => {
    const out = await classifyExecutionMode({
      intent: '帮我查今天特斯拉股价并给出来源链接',
      logger: fakeLogger(),
    });
    expect(out).toBe('scrape');
  });

  it('research / 研究 → scrape', async () => {
    const out = await classifyExecutionMode({
      intent: '研究中国新能源车 2026 年市场格局',
      logger: fakeLogger(),
    });
    expect(out).toBe('scrape');
  });

  it('查找 verb → scrape', async () => {
    const out = await classifyExecutionMode({
      intent: '查找深圳的 PM 岗位',
      logger: fakeLogger(),
    });
    expect(out).toBe('scrape');
  });

  it('搜索 verb alone → scrape', async () => {
    const out = await classifyExecutionMode({
      intent: '搜索 iPhone 16 的价格',
      logger: fakeLogger(),
    });
    expect(out).toBe('scrape');
  });

  it('URL with 分析 verb → scrape', async () => {
    const out = await classifyExecutionMode({
      intent: '总结 https://example.com/article 这篇文章',
      logger: fakeLogger(),
    });
    expect(out).toBe('scrape');
  });

  it('URL beats non-execution platform topic protection → scrape', async () => {
    const out = await classifyExecutionMode({
      intent: '分析 https://linkedin.com/jobs/view/123 的岗位搜索策略',
      logger: fakeLogger(),
    });
    expect(out).toBe('scrape');
  });

  it('URL with 提取 verb → scrape', async () => {
    const out = await classifyExecutionMode({
      intent: '提取 https://blog.example.org 上的关键观点',
      logger: fakeLogger(),
    });
    expect(out).toBe('scrape');
  });

  it('site name only (implicit info lookup) → scrape', async () => {
    const out = await classifyExecutionMode({
      intent: '知乎上 AI Agent 的高赞回答',
      logger: fakeLogger(),
    });
    expect(out).toBe('scrape');
  });

  it('对比 verb → scrape', async () => {
    const out = await classifyExecutionMode({
      intent: '对比拼多多和京东的会员价格',
      logger: fakeLogger(),
    });
    expect(out).toBe('scrape');
  });
});

describe('classifyExecutionMode — browser overrides scrape (interaction verbs)', () => {
  it('ecommerce listing with required links → browser', async () => {
    const out = await classifyExecutionMode({
      intent: '去电商站搜 iPhone 16，按价格排序，给前5结果（名称/价格/链接）',
      logger: fakeLogger(),
    });
    expect(out).toBe('browser');
  });

  it('打开 + site → browser', async () => {
    const out = await classifyExecutionMode({
      intent: '打开京东帮我搜蓝牙耳机',
      logger: fakeLogger(),
    });
    expect(out).toBe('browser');
  });

  it('登录 + site → browser', async () => {
    const out = await classifyExecutionMode({
      intent: '登录淘宝查看我的订单',
      logger: fakeLogger(),
    });
    expect(out).toBe('browser');
  });

  it('下单 → browser', async () => {
    const out = await classifyExecutionMode({
      intent: '帮我下单一杯瑞幸',
      logger: fakeLogger(),
    });
    expect(out).toBe('browser');
  });

  it('booking and appointment verbs → browser', async () => {
    const cases = [
      '帮我预订上海到东京的机票',
      '帮我定明晚的酒店',
      '在携程订酒店',
      '预约明天下午的牙医',
      '帮我挂号皮肤科',
      '报名这个线上活动',
      '帮我投递这个岗位',
    ];
    for (const intent of cases) {
      const out = await classifyExecutionMode({ intent, logger: fakeLogger() });
      expect(out).toBe('browser');
    }
  });

  it('English booking and transactional verbs → browser', async () => {
    const cases = [
      'help me book a flight to Tokyo',
      'reserve a table for tomorrow night',
      'schedule a dentist appointment',
      'make an appointment with a dentist',
      'apply for this job on LinkedIn',
      'send an email in Gmail',
      'add this item to cart',
    ];
    for (const intent of cases) {
      const out = await classifyExecutionMode({ intent, logger: fakeLogger() });
      expect(out).toBe('browser');
    }
  });

  it('message and email send verbs → browser', async () => {
    const cases = [
      '给客户发一封邮件',
      '在 Gmail 给客户发一封邮件',
      '帮我给客户发消息',
      'send a message on LinkedIn',
      'reply to this email',
    ];
    for (const intent of cases) {
      const out = await classifyExecutionMode({ intent, logger: fakeLogger() });
      expect(out).toBe('browser');
    }
  });

  it('email drafting stays generate', async () => {
    const out = await classifyExecutionMode({
      intent: '写一封邮件文案',
      logger: fakeLogger(),
    });
    expect(out).toBe('generate');
  });

  it('cart and checkout verbs → browser', async () => {
    const cases = [
      '把这个商品放进购物车',
      '加入购物车但不要付款',
      '去结算这个订单',
      '帮我付款',
      'place an order for this item',
      'buy this product on Amazon',
    ];
    for (const intent of cases) {
      const out = await classifyExecutionMode({ intent, logger: fakeLogger() });
      expect(out).toBe('browser');
    }
  });

  it('social platform actions → browser', async () => {
    for (const intent of [
      '在小红书评论这篇笔记',
      '给这条微博点赞',
      '关注这个账号',
      'post on LinkedIn',
    ]) {
      const out = await classifyExecutionMode({ intent, logger: fakeLogger() });
      expect(out).toBe('browser');
    }
  });

  it('social engagement metrics stay generate', async () => {
    for (const intent of ['评论区情绪分析', '点赞率优化方案', '关注度趋势报告']) {
      const out = await classifyExecutionMode({ intent, logger: fakeLogger() });
      expect(out).toBe('generate');
    }
  });

  it('checkout and cart as topics do not force browser', async () => {
    for (const intent of ['checkout strategy', '购物车转化率优化方案']) {
      const out = await classifyExecutionMode({ intent, logger: fakeLogger() });
      expect(out).toBe('generate');
    }
  });

  it('English book as a noun does not force browser', async () => {
    const out = await classifyExecutionMode({
      intent: 'give me book recommendations about product strategy',
      logger: fakeLogger(),
    });
    expect(out).toBe('generate');
  });

  it('中文预订 as a topic does not force browser', async () => {
    const out = await classifyExecutionMode({
      intent: '制定一个酒店预订策略',
      logger: fakeLogger(),
    });
    expect(out).toBe('generate');
  });

  it('page control verbs with concrete objects → browser', async () => {
    for (const intent of [
      '点击提交按钮',
      '提交申请表单',
      '填写这个报名表',
      '下载这个文件',
      '访问京东商品页',
      '操作这个后台页面',
      '抓取这个页面的数据',
      '给这个页面截图',
      '取消订阅这个服务',
      '点击取消订阅按钮',
    ]) {
      const out = await classifyExecutionMode({
        intent,
        logger: fakeLogger(),
      });
      expect(out).toBe('browser');
    }
  });

  it('English page control verbs with concrete objects → browser', async () => {
    for (const intent of [
      'open https://example.com',
      'visit the Amazon product page',
      'log in to Gmail',
      'sign into the dashboard',
      'sign up for this webinar',
      'click the submit button',
      'submit the application form',
      'download this PDF',
      'send an email in Gmail',
    ]) {
      const out = await classifyExecutionMode({ intent, logger: fakeLogger() });
      expect(out).toBe('browser');
    }
  });

  it('中文 interaction metrics stay generate', async () => {
    for (const intent of [
      '点击率优化方案',
      '提交率下降原因分析',
      '下载量增长报告',
      '访问量趋势分析',
      '打开率提升策略',
      '操作系统安全报告',
      '登录页转化率优化',
      '登录流程体验分析',
      '下单率提升策略',
      '订票率提升策略',
      'Expedia 订机票转化率分析',
      '订酒店转化率分析',
      '订餐系统设计报告',
      '挂号流程体验分析',
      '挂号率下降原因',
      '加购率提升方案',
      '结账页转化率优化',
      '比价框架怎么写',
      '取消订阅率下降分析',
      '抓取率是什么意思',
      '截图率统计',
      '发送邮件打开率分析',
      '取消订阅按钮文案优化',
    ]) {
      const out = await classifyExecutionMode({ intent, logger: fakeLogger() });
      expect(out).toBe('generate');
    }
  });

  it('English interaction metrics stay generate', async () => {
    for (const intent of [
      'open rate optimization plan',
      'visit volume analysis',
      'click-through rate strategy',
      'sign in page conversion strategy',
      'sign up conversion strategy',
      'log in flow copy review',
      'send email open rate report',
      'submission rate report',
      'download growth report',
      'fill out rate analysis',
      'make a reservation strategy',
      'add to cart conversion strategy',
      'research plan template',
      'compare two onboarding strategies',
    ]) {
      const out = await classifyExecutionMode({ intent, logger: fakeLogger() });
      expect(out).toBe('generate');
    }
  });

  it('比价 → browser (BOSS spec puts comparison shopping on browser path)', async () => {
    const out = await classifyExecutionMode({
      intent: '帮我比价 Bose QC45',
      logger: fakeLogger(),
    });
    expect(out).toBe('browser');
  });

  it('multi-step web execution tasks across travel, forms, drafts, and SaaS apps → browser', async () => {
    const cases = [
      '在携程查询上海到东京机票，筛选直飞并停在付款前',
      '在 Google Flights 查找东京到纽约航班并筛选直飞',
      '用 Google Flights 搜索东京到纽约航班，选择最早出发',
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
      '在飞书创建一个会议纪要文档草稿',
      '在 Slack 给团队频道写一条草稿消息，不要发送',
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
      '在 canva.com 创建一个海报草稿',
      '在 zapier.com 创建一个自动化草稿',
      '在 mailchimp.com 创建一个邮件 campaign 草稿',
      '在 webflow.com 编辑这个 landing page 草稿',
      '在 airtable.com 添加一条记录',
    ];
    for (const intent of cases) {
      const out = await classifyExecutionMode({ intent, logger: fakeLogger() });
      expect(out).toBe('browser');
    }
  });

  it('execution-adjacent strategy, template, and metrics topics stay generate', async () => {
    const cases = [
      '机票预订转化率分析',
      '酒店预订流程优化建议',
      '取消订阅率下降原因',
      '提交率提升策略',
      '发邮件文案模板',
      '表单设计规范',
      'Gmail 邮件草稿模板',
      'LinkedIn 岗位搜索策略',
      'Notion 项目计划页面模板',
      'Google Docs 会议纪要模板',
      'Google Sheets 预算表模板',
      'Google Slides 路演模板',
      'Google Calendar 日程管理策略',
      'HubSpot 客户生命周期邮件模板',
      'Salesforce pipeline 管理策略',
      'Stripe 付款失败率分析',
      'Calendly 预约页转化率优化',
      'Trello 看板模板',
      'Asana 任务拆解方法',
      'Jira bug 模板',
      'Shopify 店铺转化率报告',
      'Zendesk 工单回复模板',
      'Intercom onboarding 消息策略',
      'Linear issue 模板',
      'Monday.com 项目管理分析',
      'canva.com 海报设计策略',
      'zapier 自动化模板',
      'airtable 数据库设计方案',
      'notion 模板',
      'Slack 团队公告文案',
      'GitHub README 模板',
      'GitHub issue 模板',
      'Amazon 商品页优化策略',
      'YouTube 视频脚本模板',
      'Instagram 内容策略',
      'Twitter 发布文案模板',
      'Reddit 社群运营策略',
      'Shopify 店铺转化率报告',
    ];
    for (const intent of cases) {
      const out = await classifyExecutionMode({ intent, logger: fakeLogger() });
      expect(out).toBe('generate');
    }
  });
});

describe('classifyExecutionMode — generate stays generate', () => {
  it('translation → generate (no scrape needed)', async () => {
    const out = await classifyExecutionMode({
      intent: '帮我把这段话翻译成英文',
      logger: fakeLogger(),
    });
    expect(out).toBe('generate');
  });

  it('writing prose → generate', async () => {
    const out = await classifyExecutionMode({
      intent: '写一份产品发布计划',
      logger: fakeLogger(),
    });
    expect(out).toBe('generate');
  });

  it('SOP write → generate', async () => {
    const out = await classifyExecutionMode({
      intent: '帮我整理一份运维 SOP',
      logger: fakeLogger(),
    });
    expect(out).toBe('generate');
  });

  it('analysis WITHOUT search/site/url → generate', async () => {
    const out = await classifyExecutionMode({
      intent: '分析这段商业模式有哪些风险点',
      logger: fakeLogger(),
    });
    expect(out).toBe('generate');
  });
});

describe('classifyExecutionMode — does not call the API', () => {
  it('classifier never invokes the Anthropic client (cost-free)', async () => {
    const create = vi.fn();
    const client = {
      messages: { create },
    } as unknown as import('@anthropic-ai/sdk').default;
    await classifyExecutionMode({
      intent: '写一段产品文案',
      logger: fakeLogger(),
      client,
    });
    await classifyExecutionMode({
      intent: '打开京东搜手机',
      logger: fakeLogger(),
      client,
    });
    await classifyExecutionMode({
      intent: '完全模糊的需求',
      logger: fakeLogger(),
      client,
    });
    expect(create).not.toHaveBeenCalled();
  });
});
