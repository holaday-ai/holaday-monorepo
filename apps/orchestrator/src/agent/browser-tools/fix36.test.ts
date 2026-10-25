import { stripToolCallMarkup } from '@holaday/shared-types';
import { describe, expect, it } from 'vitest';
import { deliverableAnswer } from '../generate-answer-guard.js';
import { assessCompletionFacts, observedEvidence } from './completion-fields.js';

/** Deploy-36 core-07 (tsk_QKsCCDvwDQK5zybH9nbdF), the answer body verbatim. */
const CORE_07 =
  '已从维基百科 Python (programming language) 页面（tab_9eff90a8-0b49-437e-a972-79de6d3ef019）打开3个链接到新标签页，分别读取标题后切回起始页面：\n\n1. Programming paradigm - Wikipedia（tab_a5044355-544e-48ed-8f47-1d300d7467fa）\n2. Guido van Rossum - Wikipedia（tab_d0e4b121-96b8-435b-ad07-b0281d306f30）\n3. Python Software Foundation - Wikipedia（tab_97c2c16f-8aae-472f-aa5c-db9e1669abb2）\n\n当前活动标签页已回到打开这些链接的起始页面（Python (programming language) - Wikipedia, tab_9eff90a8-0b49-437e-a972-79de6d3ef019）。';

describe('FIX-36 #6 · core-07: tab ids are browser handles, never shown', () => {
  it('the production answer loses every tab id, keeps every title', () => {
    const shown = stripToolCallMarkup(CORE_07);
    expect(shown).not.toMatch(/tab_[0-9a-f]{8}/);
    expect(shown).toContain('Python (programming language) 页面打开3个链接');
    expect(shown).toContain('1. Programming paradigm - Wikipedia\n');
    expect(shown).toContain('（Python (programming language) - Wikipedia）。');
    expect(deliverableAnswer(CORE_07)).not.toMatch(/tab_[0-9a-f]{8}/);
  });
  it('a tab id is not a fact to check (no 未核实 note on it)', () => {
    const facts = assessCompletionFacts({
      summary: '- 当前活动标签页：tab_9eff90a8-0b49-437e-a972-79de6d3ef019',
      pages: [
        observedEvidence(
          'x',
          '- heading "Python" [level=1]',
          'https://en.wikipedia.org/wiki/Python',
        ),
      ],
    });
    expect(facts.unverified).toEqual([]);
  });
  it('text that only looks like it stays (a word, a URL path)', () => {
    const text =
      '变量 tab_size 与 https://example.com/tab_9eff90a8-0b49-437e-a972-79de6d3ef019 不变。';
    expect(stripToolCallMarkup(text)).toBe(text);
  });
});

const AMAZON = observedEvidence(
  'search',
  [
    '- heading "LISEN USB C to USB C Cable, 240W Fast Charging Type C Charger Cord (6.6FT)" [level=2]',
    '- generic: SGD 11.47',
    '- heading "Anker USB C to USB C Cable, 60W Fast Charging Cable (2-Pack, 3.3 ft, Black)" [level=2]',
    '- generic: SGD 12.77',
  ].join('\n'),
  'https://www.amazon.com/s?k=usb+c+cable',
);

describe('FIX-36 #6 · 「名称 — 价格」 lines are checked as a name and a price', () => {
  it('the production b-p02 lines are grounded (no 未核实)', () => {
    const facts = assessCompletionFacts({
      summary:
        '1. LISEN USB C to USB C Cable, 240W Fast Charging Type C Charger Cord (6.6FT) — SGD 11.47\n2. Anker USB C to USB C Cable, 60W Fast Charging Cable (2-Pack, 3.3 ft, Black) — SGD 12.77',
      pages: [AMAZON],
    });
    expect(facts.unverified).toEqual([]);
    expect(facts.contradictions).toEqual([]);
  });
  it('a price no read page shows is still reported', () => {
    const facts = assessCompletionFacts({
      summary:
        '1. LISEN USB C to USB C Cable, 240W Fast Charging Type C Charger Cord (6.6FT) — SGD 5.55',
      pages: [AMAZON],
    });
    expect([...facts.unverified, ...facts.contradictions].join('；')).toContain('5.55');
  });
  it('a name no read page shows is still reported', () => {
    const facts = assessCompletionFacts({
      summary: '1. Made Up Cable 9000 — SGD 11.47',
      pages: [AMAZON],
    });
    expect(facts.unverified.join('；')).toContain('Made Up Cable 9000');
  });
});

describe('FIX-36 #6 · core-09: 「1145 字节」 is the receipt’s 1145 bytes', () => {
  const page = observedEvidence(
    'dl',
    '- link "Images.txt"',
    'https://the-internet.herokuapp.com/download',
  );
  const receipts =
    'Images.txt | 1145 bytes/字节 | https://the-internet.herokuapp.com/download/Images.txt';
  it('the downloaded size in 字节 is grounded by the receipt', () => {
    const facts = assessCompletionFacts({
      summary: '- 文件名：Images.txt\n- 文件大小：1145 字节',
      pages: [page],
      receipts,
    });
    expect(facts.unverified).toEqual([]);
  });
  it('a size the receipt does not show is still reported', () => {
    const facts = assessCompletionFacts({
      summary: '- 文件名：Images.txt\n- 文件大小：9999 字节',
      pages: [page],
      receipts,
    });
    expect([...facts.unverified, ...facts.contradictions].join('；')).toContain('9999');
  });
});
