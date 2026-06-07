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
    'draft a Slack message to the team',
    'send a LinkedIn message to this person',
    '在 Google Docs 新建一个会议纪要文档草稿',
    'create a Google Doc from these notes',
    '在 Google Sheets 创建一个预算表草稿',
    '在 Google Calendar 安排一个项目会议但不要发送邀请',
    '在日历里添加明天下午3点会议',
    '创建一个日程邀请',
    '在 Google Drive 找到合同 PDF 并分享链接',
    '打开 Dropbox 查找发票 PDF 并下载',
    '在 OneDrive 搜索预算表并导出 PDF',
    '在 GitHub 创建一个 issue 草稿',
    'create a draft issue in GitHub',
    'create a budget spreadsheet in Google Sheets',
    'schedule a project meeting in Google Calendar but do not send invites',
    'find a PDF in Google Drive and download it',
    'search Dropbox for contract.pdf and share a link',
    'use OneDrive to export the budget spreadsheet as PDF',
    '分享这个文件给客户',
    '上传这份 PDF 到 Google Drive',
    '把这个文件改成任何有链接的人可查看',
    '在 HubSpot 创建一个联系人草稿',
    '在 Salesforce 更新这个客户备注',
    '在 Stripe dashboard 查找这个付款并下载收据',
    '在 Calendly 创建一个会议链接草稿',
    '在 Trello 新建一个项目看板',
    '在 Asana 创建三个任务草稿',
    '在 Jira 创建一个 bug issue 草稿',
    'create a GitHub issue for this bug',
    'create three Asana tasks from this plan',
    'create a Trello card for this bug',
    'reply to this Zendesk ticket draft',
    'create a contact draft in HubSpot',
    'update this customer note in Salesforce',
    'add a HubSpot contact for Yalei',
    'download a receipt in Stripe',
    'create a bug issue in Jira',
    '在 Shopify 后台创建一个折扣码草稿',
    'create a Shopify discount code',
    '在 Zendesk 回复这张工单草稿',
    '回复这个工单',
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
    'find this Stripe payment and refund it',
    'download invoice from Stripe dashboard',
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
    'edit this Notion page',
    'On canva.com, create a poster draft',
    'In airtable.com, add a row to the leads table',
    'add a row to Airtable leads',
    'add a row in airtable.com',
    'edit a design in figma.com',
    'create a Figma design draft',
    'schedule a post in buffer.com',
    'schedule this post in Buffer',
    'publish a draft on medium.com',
    'make a poster in canva.com',
    'upload an image to cloudinary.com',
    'upload this image to Cloudinary',
    'use framer.site to edit a landing page draft',
    'create a Mailchimp campaign draft',
    'make a logo in brand.design',
    'create a profile draft in read.cv',
    '在 canva.com 创建一个海报草稿',
    '在 zapier.com 创建一个自动化草稿',
    '在 mailchimp.com 创建一个邮件 campaign 草稿',
    '在 webflow.com 编辑这个 landing page 草稿',
    '在 airtable.com 添加一条记录',
    '在 framer.site 编辑一个 landing page 草稿',
    '在 brand.design 创建一个 logo 草稿',
  ])('keeps live app workflows in the hybrid tool profile: %s', (intent) => {
    expect(classifyTaskType(intent), intent).toBe('hybrid');
  });

  it.each([
    '今天上海天气',
    'What is the Tesla stock price today?',
  ])('keeps pure fact lookups in the search tool profile: %s', (intent) => {
    expect(classifyTaskType(intent)).toBe('search');
  });
});
