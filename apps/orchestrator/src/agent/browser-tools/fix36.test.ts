import { stripToolCallMarkup } from '@holaday/shared-types';
import { describe, expect, it } from 'vitest';
import type { MessagesAdapter } from '../../llm/messages-adapter.js';
import { deliverableAnswer } from '../generate-answer-guard.js';
import { assessCompletionFacts, observedEvidence } from './completion-fields.js';
import type { UnifiedToolResult } from './playwright-unified-executor.js';
import { runUnifiedBrowserLoop } from './unified-browser-loop.js';

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
  it('a frame id is the same kind of handle (seen in a core-10 rerun)', () => {
    const text =
      '成功定位到 TinyMCE 编辑器的 iframe（frame_d7f4ff1d-2402-41e1-9d12-4dc877bd4f5a）。';
    expect(stripToolCallMarkup(text)).toBe('成功定位到 TinyMCE 编辑器的 iframe。');
  });
  it('a tab id in the finish fields is not a fact to check either (local core-07 rerun)', () => {
    const facts = assessCompletionFacts({
      summary: '已切回起始页面。',
      fields: [{ name: '当前活动标签', value: 'tab_9eff90a8-0b49-437e-a972-79de6d3ef019' }],
      pages: [
        observedEvidence(
          'x',
          '- heading "Browser" [level=1]',
          'https://en.wikipedia.org/wiki/Browser',
        ),
      ],
    });
    expect(facts.unverified).toEqual([]);
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
  it('a labelled handle goes with its label (local core-07: 「，tabId: tab_…」)', () => {
    expect(
      stripToolCallMarkup(
        '已切换回起始标签（Web browser - Wikipedia，tabId: tab_9eff90a8-0b49-437e-a972-79de6d3ef019）。',
      ),
    ).toBe('已切换回起始标签（Web browser - Wikipedia）。');
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
  it('a listed 「文件名，大小 N bytes」 line is a name and a size (local core-09)', () => {
    const facts = assessCompletionFacts({
      summary: '1. Images.txt，大小 1145 bytes',
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

function scripted(calls: Array<{ name: string; input: Record<string, unknown> }>) {
  let turn = 0;
  const adapter: MessagesAdapter = {
    metadata: { provider: 'anthropic', model: 'fixture' },
    async create() {
      const call = calls[Math.min(turn++, calls.length - 1)]!;
      return {
        id: String(turn),
        metadata: { provider: 'anthropic', model: 'fixture' },
        content: [{ type: 'tool_use', id: String(turn), ...call }],
        stopReason: 'tool_use',
        usage: {
          inputTokens: 1,
          outputTokens: 1,
          cacheReadInputTokens: null,
          cacheCreationInputTokens: null,
          complete: true,
        },
      };
    },
  };
  return adapter;
}

const CHECKBOXES =
  '- heading "Checkboxes" [level=3]\n- checkbox "checkbox 1"\n- checkbox "checkbox 2" [checked]\n- text: Powered by Elemental Selenium';
const INTENT_10 = '请使用云端浏览器，打开 the-internet.herokuapp.com 的 iframe 与 checkboxes 页面';

function runParts(finishes: string[]) {
  let url = 'about:blank';
  const execute = async (action: { tool: string; url?: string }): Promise<UnifiedToolResult> => {
    if (action.tool === 'navigate') {
      url = action.url!;
      return { ok: true, text: `已打开 ${url}`, url };
    }
    return { ok: true, text: CHECKBOXES, url };
  };
  const adapter = scripted([
    { name: 'navigate', input: { url: 'https://the-internet.herokuapp.com/checkboxes' } },
    { name: 'snapshot', input: {} },
    ...finishes.map((summary) => ({ name: 'finish', input: { status: 'completed', summary } })),
  ]);
  return runUnifiedBrowserLoop({
    intent: INTENT_10,
    adapter,
    maxSteps: 8,
    execute: execute as never,
    currentPageUrl: () => url,
  } as never);
}

describe('FIX-36 #3 · core-10: a named part never covered is 部分完成, not a failure', () => {
  const only = 'checkboxes 页面有两个复选框：checkbox 1 未勾选，checkbox 2 已勾选。';
  it('sent back once for 「iframe」, still without it → 部分完成 naming iframe', async () => {
    const outcome = await runParts([only, only]);
    expect(outcome).toMatchObject({
      status: 'completed',
      summary: expect.stringMatching(/^部分完成：任务要求的「iframe」部分未完成/),
      partial: expect.objectContaining({ missing: 'iframe' }),
    });
  });
  it('another contradiction left with it is still a failure', async () => {
    const wrong = `${only} 页面标题为「Checkbox Page 9000」。`;
    const outcome = await runParts([wrong, wrong]);
    expect(outcome.status).toBe('failed');
  });
});

describe('FIX-36 · a numbered list marker is no engagement count (local reg-dy-2)', () => {
  const page = observedEvidence(
    'dy',
    '- text [互动=点赞]: "4740"\n- text [互动=评论]: "214"\n- text [互动=收藏]: "4369"\n- text [互动=分享]: "1652"',
    'https://www.douyin.com/video/7377304298310389027',
  );
  it('「3. 点赞数：4740」 is 4740 likes, not 3', () => {
    const facts = assessCompletionFacts({
      summary:
        '1. 视频标题：第52集\n2. 作者：小喵麻麻\n3. 点赞数：4740\n4. 评论数：214\n5. 收藏数：4369\n6. 分享数：1652',
      pages: [page],
    });
    expect(facts.contradictions).toEqual([]);
  });
  it('a wrong count in the same list is still caught', () => {
    const facts = assessCompletionFacts({
      summary: '3. 点赞数：9999\n4. 评论数：214',
      pages: [page],
    });
    expect(facts.contradictions.join('；')).toContain('9999');
  });
});
