import { describe, expect, it } from 'vitest';
import {
  buildLayeredSystemPrompt,
  classifyRole,
  getTaskBudget,
  selectModelAndEffort,
  ROLE_PROMPTS,
  BASE_PROMPT,
  STYLE_PROMPT,
} from './prompt-layers.js';

describe('classifyRole', () => {
  it('returns "none" for empty or whitespace input', () => {
    expect(classifyRole('')).toBe('none');
    expect(classifyRole('   ')).toBe('none');
  });

  it('returns "none" for unrelated intents', () => {
    expect(classifyRole('查一下今天天气')).toBe('none');
    expect(classifyRole('book a flight to tokyo')).toBe('none');
  });

  it.each([
    ['写一篇小红书种草笔记', 'xiaohongshu-operator'],
    ['抖音短视频脚本', 'douyin-strategist'],
    ['公众号头条选题', 'wechat-operator'],
    ['京东和拼多多店铺运营', 'china-ecommerce'],
    ['亚马逊跨境店铺优化', 'cross-border-ecommerce'],
    ['做一份完整的 PRD', 'product-manager'],
    ['SQL 数据分析报表', 'data-analyst'],
    ['DCF 财务模型估值', 'financial-forecaster'],
    ['HR 招聘 JD 撰写', 'recruiter'],
    ['合同条款审查', 'contract-reviewer'],
    ['制度 SOP 撰写', 'policy-writer'],
    ['供应链采购优化', 'supply-chain'],
    ['中英技术文档翻译', 'tech-translator'],
  ])('routes "%s" to "%s"', (intent, expected) => {
    expect(classifyRole(intent)).toBe(expected);
  });

  it('platform-specific keyword wins over generic role keyword', () => {
    // "小红书产品经理" — platform comes first in ROLE_KEYWORDS so
    // xiaohongshu beats product-manager.
    expect(classifyRole('小红书产品经理招聘')).toBe('xiaohongshu-operator');
  });

  it('every role id in ROLE_PROMPTS map exists (sanity)', () => {
    for (const id of Object.keys(ROLE_PROMPTS)) {
      // Every key must have non-undefined value (or empty string for 'none')
      expect(typeof ROLE_PROMPTS[id]).toBe('string');
    }
    expect(ROLE_PROMPTS.none).toBe('');
  });
});

describe('buildLayeredSystemPrompt', () => {
  it('returns Base + Style for "none" role (no role addon)', () => {
    const out = buildLayeredSystemPrompt('none');
    expect(out).toContain(BASE_PROMPT);
    expect(out).toContain(STYLE_PROMPT);
    // Layout: Base, then Style (no Role between)
    expect(out.indexOf(BASE_PROMPT)).toBeLessThan(out.indexOf(STYLE_PROMPT));
  });

  it('includes the role addon between Base and Style for known role', () => {
    const out = buildLayeredSystemPrompt('xiaohongshu-operator');
    const baseIdx = out.indexOf(BASE_PROMPT);
    const roleIdx = out.indexOf(ROLE_PROMPTS['xiaohongshu-operator']!);
    const styleIdx = out.indexOf(STYLE_PROMPT);
    expect(baseIdx).toBeGreaterThanOrEqual(0);
    expect(roleIdx).toBeGreaterThan(baseIdx);
    expect(styleIdx).toBeGreaterThan(roleIdx);
  });

  it('requires unsourced benchmark numbers to be labelled as assumptions', () => {
    const out = buildLayeredSystemPrompt('growth-hacker');
    expect(out).toContain('没有来源支撑的行业 benchmark');
    expect(out).toContain('经验假设 / 常见区间 / 需要实测确认');
    expect(out).toContain('不要把它当成已验证事实');
  });

  it('adds a decision-ready evidence contract only for forced expert mode', () => {
    const expert = buildLayeredSystemPrompt('none', 'expert');
    const normal = buildLayeredSystemPrompt('none', 'normal');

    expect(expert).toContain('专家模式质量合同');
    expect(expert).toContain('[用户提供]');
    expect(expert).toContain('[外部来源]');
    expect(expert).toContain('[模型假设]');
    expect(expert).toContain('漏斗阶段');
    expect(expert).toContain('验证指标');
    expect(normal).not.toContain('专家模式质量合同');
  });

  it('prevents repeated generic links from posing as per-candidate links', () => {
    const out = buildLayeredSystemPrompt('none');
    expect(out).toContain('多候选结果');
    expect(out).toContain('独立详情页/地点页/预订页');
    expect(out).toContain('不要把同一个搜索页、地图页、方向页、列表页重复贴到多行');
    expect(out).toContain('独立链接未取得');
  });

  it('requires user confirmation before transactional final submits', () => {
    const out = buildLayeredSystemPrompt('none');
    expect(out).toContain('预订 / 预约 / 报名 / 投递 / 加购 / 结账 / 取消订阅 / 退订 / 文件分享或权限变更');
    expect(out).toContain('不要点击最终确认 / 提交预约 / 提交报名 / 提交申请 / 确认预订 / Place order / Share / Change access / Delete / Unsubscribe');
    expect(out).toContain('分享对象/权限');
    expect(out).toContain('关键条款或将要改变的账户状态');
    expect(out).toContain('停在最终确认页，先说明影响');
  });

  it('asks for missing transactional inputs before opening the browser', () => {
    const out = buildLayeredSystemPrompt('none');
    expect(out).toContain('交易/预约类任务的最小信息检查');
    expect(out).toContain('文件操作：至少需要目标平台/文件名或文件位置');
    expect(out).toContain('不要先打开网页乱试');
    expect(out).toContain('一次只问 1-3 个最关键问题');
    expect(out).toContain('[AWAITING_USER_INPUT]');
  });

  it('falls back to Base + Style when role id is unknown', () => {
    const out = buildLayeredSystemPrompt('not-a-real-role');
    expect(out).toContain(BASE_PROMPT);
    expect(out).toContain(STYLE_PROMPT);
    // No mystery role text injected
    expect(out).not.toContain('not-a-real-role');
  });
});

describe('selectModelAndEffort', () => {
  // Phase 24 RC follow-up: assertions updated for the three-tier
  // cost-optimised matrix. simple → Haiku, complex → Sonnet xhigh
  // (NOT Opus), default → Sonnet high. See
  // prompt-layers.model-tier.test.ts for the new tier coverage.
  it('simple-search no-role → Haiku 4.5 medium', () => {
    expect(selectModelAndEffort('对比京东淘宝 MacBook 价格', 'none')).toEqual({
      model: 'claude-haiku-4-5',
      effort: 'medium',
    });
  });

  it('complex specialist role → Sonnet 4.6 xhigh (was Opus)', () => {
    expect(selectModelAndEffort('PRD 文档撰写', 'product-manager')).toEqual({
      model: 'claude-sonnet-4-6',
      effort: 'xhigh',
    });
    expect(selectModelAndEffort('合同审查', 'contract-reviewer')).toEqual({
      model: 'claude-sonnet-4-6',
      effort: 'xhigh',
    });
  });

  it('default — non-simple-search, non-complex role → Sonnet 4.6 high', () => {
    expect(selectModelAndEffort('写一篇小红书笔记', 'xiaohongshu-operator')).toEqual({
      model: 'claude-sonnet-4-6',
      effort: 'high',
    });
  });

  it.each([
    '查上海到东京航班，筛选直飞并选择最早出发',
    '找下周五东京酒店，按评分排序并停在预订确认前',
    'find flights from SFO to Tokyo, filter nonstop, choose the earliest departure',
    'find a restaurant reservation for tomorrow and stop before booking',
    '在 Google Flights 查找东京到纽约航班并筛选直飞',
    '用 Google Flights 搜索东京到纽约航班，选择最早出发',
    '在携程查询上海到东京机票，筛选直飞并停在付款前',
    '在 Airbnb 找下周末东京民宿并收藏前两个',
    '用 Airbnb 搜索东京民宿，勾选整租并设置两位住客',
    '在 Gmail 写一封邮件草稿给客户，不要发送',
    '在 Google Docs 新建一个会议纪要文档草稿',
    '在 Google Sheets 创建一个预算表草稿',
    '在 Google Drive 找到合同 PDF 并分享链接',
    '在 Google Calendar 安排一个项目会议但不要发送邀请',
    '在 GitHub 创建一个 issue 草稿',
    'create a draft issue in GitHub',
    'create a budget spreadsheet in Google Sheets',
    'find a PDF in Google Drive and download it',
    'search Dropbox for contract.pdf and share a link',
    'export the OneDrive spreadsheet as PDF',
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
  ])('live app workflow → Sonnet 4.6 high: %s', (intent) => {
    expect(selectModelAndEffort(intent, 'none')).toEqual({
      model: 'claude-sonnet-4-6',
      effort: 'high',
    });
  });

  it.each([
    '今天上海天气',
    'What is the Tesla stock price today?',
  ])('pure fact lookup still uses Haiku 4.5 medium: %s', (intent) => {
    expect(selectModelAndEffort(intent, 'none')).toEqual({
      model: 'claude-haiku-4-5',
      effort: 'medium',
    });
  });

  it('xhigh is only paired with Sonnet 4.6 (Opus retired from auto-routing)', () => {
    const cases: Array<[string, string]> = [
      ['none', '查天气'],
      ['xiaohongshu-operator', '写小红书笔记'],
      ['content-creator', '写文案'],
      ['product-manager', '深度调研'],
    ];
    for (const [role, intent] of cases) {
      const r = selectModelAndEffort(intent, role);
      if (r.effort === 'xhigh') {
        expect(r.model).toBe('claude-sonnet-4-6');
      }
    }
  });
});

describe('getTaskBudget', () => {
  it('simple-search no-role → 50K', () => {
    expect(getTaskBudget('对比 MacBook 价格', 'none')).toBe(50_000);
  });

  it('content-generation roles → 100K', () => {
    expect(getTaskBudget('write blog', 'content-creator')).toBe(100_000);
    expect(getTaskBudget('客服回复', 'customer-service')).toBe(100_000);
    expect(getTaskBudget('翻译', 'tech-translator')).toBe(100_000);
  });

  it('research / analysis tasks → 200K', () => {
    expect(getTaskBudget('竞品分析', 'trend-researcher')).toBe(200_000);
    expect(getTaskBudget('财报分析', 'financial-forecaster')).toBe(200_000);
  });

  it.each([
    '查上海到东京航班，筛选直飞并选择最早出发',
    '找下周五东京酒店，按评分排序并停在预订确认前',
    'find flights from SFO to Tokyo, filter nonstop, choose the earliest departure',
    'find a restaurant reservation for tomorrow and stop before booking',
    '在 Google Flights 查找东京到纽约航班并筛选直飞',
    '用 Google Flights 搜索东京到纽约航班，选择最早出发',
    '在携程查询上海到东京机票，筛选直飞并停在付款前',
    '在 Airbnb 找下周末东京民宿并收藏前两个',
    '用 Airbnb 搜索东京民宿，勾选整租并设置两位住客',
    '在 Gmail 写一封邮件草稿给客户，不要发送',
    '在 Google Docs 新建一个会议纪要文档草稿',
    '在 Google Sheets 创建一个预算表草稿',
    '在 Google Drive 找到合同 PDF 并分享链接',
    '在 Google Calendar 安排一个项目会议但不要发送邀请',
    '在 GitHub 创建一个 issue 草稿',
    'create a draft issue in GitHub',
    'create a budget spreadsheet in Google Sheets',
    'find a PDF in Google Drive and download it',
    'search Dropbox for contract.pdf and share a link',
    'export the OneDrive spreadsheet as PDF',
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
  ])('live app workflow → 200K budget: %s', (intent) => {
    expect(getTaskBudget(intent, 'none')).toBe(200_000);
  });

  it('budget always meets API minimum (20K)', () => {
    const intents = ['查天气', '写笔记', '财报', '招聘', ''];
    const roles = ['none', 'content-creator', 'product-manager', 'recruiter'];
    for (const i of intents) for (const r of roles) {
      expect(getTaskBudget(i, r)).toBeGreaterThanOrEqual(20_000);
    }
  });
});
