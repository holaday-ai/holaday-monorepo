import { describe, expect, it } from 'vitest';

import { classifyTaskType, filterTools, isToolAllowed } from './tool-registry.js';

describe('tool registry', () => {
  it('keeps scraper tools available for hybrid browser tasks', () => {
    const tools = [
      { name: 'navigate' },
      { name: 'web_search' },
      { name: 'scrape_website' },
      { name: 'search_ecommerce' },
      { name: 'code_execution' },
    ];

    expect(filterTools(tools, 'hybrid').map((tool) => tool.name)).toEqual([
      'navigate',
      'web_search',
      'scrape_website',
      'search_ecommerce',
    ]);
    expect(isToolAllowed('search_ecommerce', 'hybrid')).toBe(true);
    expect(isToolAllowed('scrape_website', 'browser')).toBe(true);
  });

  it('does not expose scraper tools to pure search shortcuts', () => {
    expect(isToolAllowed('search_ecommerce', 'search')).toBe(false);
    expect(isToolAllowed('scrape_website', 'search')).toBe(false);
  });

  it.each([
    '在 Google Flights 查找东京到纽约航班并筛选直飞',
    '用 Google Flights 搜索东京到纽约航班，选择最早出发',
    '在携程查询上海到东京机票，筛选直飞并停在付款前',
    '在 Airbnb 找下周末东京民宿并收藏前两个',
    '用 Airbnb 搜索东京民宿，勾选整租并设置两位住客',
    '在 Gmail 写一封邮件草稿给客户，不要发送',
    '在 Google Docs 新建一个会议纪要文档草稿',
    '在 Google Sheets 创建一个预算表草稿',
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
  ])('keeps live app workflows in the hybrid tool profile: %s', (intent) => {
    expect(classifyTaskType(intent)).toBe('hybrid');
  });

  it.each([
    '今天上海天气',
    'What is the Tesla stock price today?',
  ])('keeps pure fact lookups in the search tool profile: %s', (intent) => {
    expect(classifyTaskType(intent)).toBe('search');
  });
});
