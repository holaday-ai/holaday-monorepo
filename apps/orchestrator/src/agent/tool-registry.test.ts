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
    '在携程查询上海到东京机票，筛选直飞并停在付款前',
    '在 Airbnb 找下周末东京民宿并收藏前两个',
    '在 Gmail 写一封邮件草稿给客户，不要发送',
    '在 GitHub 创建一个 issue 草稿',
    'create a draft issue in GitHub',
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
