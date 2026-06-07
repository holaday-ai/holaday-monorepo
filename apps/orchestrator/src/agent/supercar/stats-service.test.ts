import { describe, expect, it } from 'vitest';

import { classifyTaskType } from './stats-service.js';

describe('classifyTaskType', () => {
  it.each([
    '在 Google Drive 找到合同 PDF 并分享链接',
    'find a PDF in Google Drive and download it',
    'search Dropbox for contract.pdf and share a link',
    '登录淘宝查看我的订单',
    'export the OneDrive spreadsheet as PDF',
  ])('keeps action-heavy file/account workflows as fill_form: %s', (intent) => {
    expect(classifyTaskType(intent)).toBe('fill_form');
  });

  it.each([
    '今天上海天气',
    '找一下东京明天温度',
    'search current Tesla stock price',
  ])('keeps pure information lookups as search: %s', (intent) => {
    expect(classifyTaskType(intent)).toBe('search');
  });
});
