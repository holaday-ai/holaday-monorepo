import { describe, expect, it } from 'vitest';
import type { MessagesAdapter } from '../../llm/messages-adapter.js';
import { assessCompletionFacts, declaredAbsentFields } from './completion-fields.js';
import { runUnifiedBrowserLoop } from './unified-browser-loop.js';

describe('FIX-51 #4 · core-07: a tab bound by both tabId and sourceURL (Deploy-51 online)', () => {
  const TAB = 'tab_f0057b0d-3fca-4223-adb7-6467406b6a04';
  const OTHER = 'tab_58f1c8fb-f559-4e7b-9f5f-d6ccde28b11c';
  const CHROME = 'https://en.wikipedia.org/wiki/Google_Chrome';
  const SAFARI = 'https://en.wikipedia.org/wiki/Safari_(web_browser)';
  const INTENT = '请使用云端浏览器，从一个页面打开3个链接到新标签，分别读标题后回到第一个';
  const pages = [
    { text: '- heading "Google Chrome" [level=1]', tabId: TAB, sourceURL: CHROME },
    { text: '- heading "Safari (web browser)" [level=1]', tabId: OTHER, sourceURL: SAFARI },
    // The tab's listed document title: readTabTitles has its tab, no URL.
    { text: 'Google Chrome - Wikipedia', tabId: TAB },
    { text: 'Safari (web browser) - Wikipedia', tabId: OTHER },
  ];
  const check = (fact: { tabId?: string; sourceURL?: string }) =>
    assessCompletionFacts({
      summary: '1. Google Chrome - Wikipedia',
      fields: [{ name: '新标签1标题', value: 'Google Chrome - Wikipedia', ...fact }],
      pages,
      intent: INTENT,
    }).contradictions;

  it('its own title holds, bound by tab, by URL, or by both', () => {
    expect(check({ tabId: TAB, sourceURL: CHROME })).toEqual([]);
    expect(check({ tabId: TAB })).toEqual([]);
    expect(check({ sourceURL: CHROME })).toEqual([]);
  });

  it("reverse: another tab's title, by tab, by URL, or by both, is still another page's", () => {
    for (const fact of [
      { tabId: OTHER, sourceURL: SAFARI },
      { tabId: OTHER },
      { sourceURL: SAFARI },
    ])
      expect(check(fact).join(), JSON.stringify(fact)).toContain('来自其他页面');
    // Its tab with the URL of a page that tab never read.
    expect(check({ tabId: TAB, sourceURL: SAFARI }).join()).toContain('未成功读取');
  });

  it('in the loop: completed at once, and no tab id reaches the answer', async () => {
    const START = 'https://en.wikipedia.org/wiki/Web_browser';
    const START_TAB = 'tab_7c4c5f16-cf69-40af-85a5-8eb012a2e7bc';
    const summary = `读到的标题：\n1. Google Chrome - Wikipedia（${TAB}）\n\n起始页面是 Web browser - Wikipedia（${START_TAB}）。`;
    const calls = [
      { name: 'navigate', input: { url: START } },
      { name: 'snapshot', input: {} },
      { name: 'read_page', input: { tabId: TAB } },
      { name: 'list_tabs', input: {} },
      {
        name: 'finish',
        input: {
          status: 'completed',
          summary,
          fields: [
            {
              name: '新标签1标题',
              value: 'Google Chrome - Wikipedia',
              tabId: TAB,
              sourceURL: CHROME,
            },
          ],
        },
      },
    ];
    let turn = 0;
    const seen: string[] = [];
    const adapter: MessagesAdapter = {
      metadata: { provider: 'anthropic', model: 'fixture' },
      async create(request) {
        seen.push(JSON.stringify(request.messages.at(-1)));
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
    const outcome = await runUnifiedBrowserLoop({
      intent: '读这个新标签的标题',
      adapter,
      maxSteps: 8,
      observationV2: true,
      currentPageUrl: () => START,
      execute: (async (action: { tool: string; tabId?: string }) => {
        if (action.tool === 'list_tabs')
          return {
            ok: true,
            url: START,
            text: JSON.stringify({
              tabs: [
                { tabId: START_TAB, title: 'Web browser - Wikipedia' },
                { tabId: TAB, title: 'Google Chrome - Wikipedia' },
              ],
            }),
          };
        const tab = action.tabId === TAB;
        return {
          ok: true,
          url: tab ? CHROME : START,
          tabId: tab ? TAB : START_TAB,
          text: JSON.stringify({
            tabId: tab ? TAB : START_TAB,
            frameId: 'frame_main',
            sourceURL: tab ? CHROME : START,
            tree: tab ? '- heading "Google Chrome" [level=1]' : '- heading "Web browser" [level=1]',
            frames: [],
          }),
        };
      }) as never,
    });
    expect(seen.join('\n')).not.toContain('来自其他页面');
    expect(outcome).toMatchObject({ status: 'completed' });
    expect((outcome as { summary: string }).summary).toContain('Google Chrome - Wikipedia');
    expect((outcome as { summary: string }).summary).not.toMatch(/tab_[0-9a-f]/);
  });
});

describe('FIX-51 #5 · b-p02: 「未显示价格」 of the results page, the price read on the details page', () => {
  const INTENT = '请使用云端浏览器，amazon.com 搜 usb c cable 前3个商品名和价格';
  const ITEM = 'Anker USB C to USB C Cable, 60W Fast Charging Cable (2-Pack, 3.3 ft, Black)';
  const PAGES = ['SGD 12.77 SGD 11.47', `- heading "${ITEM}"\n- text: S$12.77`];
  const list = `1. Anker — SGD 12.77\n2. LISEN — SGD 11.47\n3. ${ITEM} — S$12.77`;
  /** Deploy-51 online (tsk_6m3k87uEezdLUazHMhtHs), verbatim: the last two finishes. */
  const FINAL = `已在 amazon.com 搜索 "usb c cable"，前3个商品名称和价格（照页面原样）：\n\n${list}\n\n说明：第3条在搜索结果页快照被截断未显示价格，已打开其详情页并通过 get_page_text 读取到价格文本 "S$12.77"。用户未要求链接，故不提供。`;
  const THIRD = `${list}\n\n说明：第3条在搜索结果页快照被截断未显示价格，已打开其详情页读取到价格 S$12.77（来自详情页 ref=e240）。用户未要求链接，故不提供。`;

  it('online verbatim: the gap is filled in the same sentence, not absent', () => {
    expect(declaredAbsentFields(INTENT, FINAL, undefined, PAGES)).toEqual([]);
    expect(declaredAbsentFields(INTENT, THIRD, undefined, PAGES)).toEqual([]);
  });

  it('reverse: still absent when the value is not read, not on a page, or of another item', () => {
    for (const tail of [
      '第3条未显示价格。',
      '第3条未显示价格，已打开详情页，读取到价格 S$99.99。',
      '第3条未显示价格，第2条读取到价格 S$12.77。',
      '第3条未显示价格，读取到价格未显示。',
      '第3条未显示价格，读取到价格信息不完整。',
      '第3条未显示价格，读取到价格 推测是 S$12.77。',
    ])
      expect(declaredAbsentFields(INTENT, `${list}\n${tail}`, undefined, PAGES), tail).toEqual([
        '价格',
      ]);
  });
});
