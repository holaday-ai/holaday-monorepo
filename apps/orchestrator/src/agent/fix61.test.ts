// FIX-61 P1: leftovers from DEPLOY-60.
import { instructionPart, requestLanguage, replyPlan } from '@holaday/shared-types';
import { describe, expect, it } from 'vitest';

describe('FIX-61 P1-1: the talk language comes from the instruction, not pasted text', () => {
  it('a pasted paragraph after a colon does not decide the language', () => {
    expect(requestLanguage('Polish this Chinese paragraph: 我们的产品很好用，客户都说方便，价格也合理。')).toBe('en');
    expect(requestLanguage('帮我把这段改得更礼貌：Dear John, send me the file now, I need it today.')).toBe('zh');
    expect(requestLanguage('总结一下这段：The quick brown fox jumps over the lazy dog many times.')).toBe('zh');
    expect(replyPlan('Summarize this for me: 今天开会讨论了第三季度的销售目标和新产品的上市时间。', 'cn').language).toBe('en');
  });

  it('colons in links, e-mail addresses and times are not a pasted-text boundary', () => {
    expect(instructionPart('Open https://example.com/a and tell me the title')).toBe(
      'Open https://example.com/a and tell me the title',
    );
    expect(instructionPart('明天 15:00 开会，帮我写个提醒')).toBe('明天 15:00 开会，帮我写个提醒');
    expect(requestLanguage('Open https://gs.ctrip.com/html5/you/sight/hangzhou14/49894.html and tell me the opening hours')).toBe('en');
  });

  it('a short label before the colon is not an instruction of its own', () => {
    expect(instructionPart('问题：What is the capital of France?')).toBe('问题：What is the capital of France?');
    expect(instructionPart('Q: 故宫门票多少钱')).toBe('Q: 故宫门票多少钱');
  });
});

describe('FIX-61 P1-2: the 未核实 line follows the task language', async () => {
  const { unverifiedNote, UNVERIFIED_LEAD_EN } = await import('./browser-tools/completion-fields.js');
  it('an English task gets an English note; Chinese stays the default', () => {
    const en = unverifiedNote(['Release date「17y ago」', 'Price「S$8.21」'], { english: true });
    expect(en).toBe(`${UNVERIFIED_LEAD_EN}Release date「17y ago」; Price「S$8.21」`);
    expect(en).not.toMatch(/未核实|以下内容/);
    expect(unverifiedNote(['价格「S$8.21」'])).toBe(
      '未核实：以下内容未能在已读页面中逐字找到，请自行确认——价格「S$8.21」',
    );
  });
});
