import { chromium } from 'playwright';
import { describe, expect, it } from 'vitest';
import { completionGap } from './browser-completion.js';
import { describeUnifiedAction } from './unified-action-gate.js';

/** BROWSER-AUTOPILOT-1 round 2 live findings (core-07, core-10). */
describe('switching back to the original tab (core-07)', () => {
  const opened = [
    { tool: 'click', ok: true, tabId: 'new1', openedTab: true, fromTabId: 'source' },
    { tool: 'click', ok: true, tabId: 'new2', openedTab: true, fromTabId: 'source' },
  ];
  it.each(['最后切回源标签', '已切回原标签', '已返回第一个标签', '回到初始标签'])(
    'accepts "%s" when the last switch went to the tab that opened the links',
    (claim) => {
      expect(
        completionGap(
          '从一个页面打开链接到新标签，读标题后回到第一个',
          claim,
          [...opened, { tool: 'switch_tab', ok: true, tabId: 'source' }],
          false,
        ),
      ).toBeNull();
    },
  );
  it('still rejects the claim when the last switch went to a new tab', () => {
    expect(
      completionGap(
        '从一个页面打开链接到新标签，读标题后回到第一个',
        '最后切回源标签',
        [...opened, { tool: 'switch_tab', ok: true, tabId: 'new1' }],
        false,
      ),
    ).toBe('switch_tab 回执未证明切回原标签。');
  });
});

describe('blank document surface (core-10)', () => {
  it('is an ordinary unlabelled click, not an unidentifiable target', async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
      await page.setContent('<h1>Editor loading…</h1><p>Your content goes here.</p>');
      const description = await describeUnifiedAction(
        page,
        { tool: 'click_at', x: 600, y: 500 },
        () => null,
      );
      expect(description.unverified).toBeNull();
      expect(description.descriptors[0]).toMatchObject({ kind: 'click' });
      expect(description.descriptors[0]?.label ?? null).toBeNull();
    } finally {
      await browser.close();
    }
  });
});

describe('tab titles from the listing (core-07)', () => {
  it('ground the title of a tab that was read, never of one that was not', async () => {
    const { listedTabTitles, readTabTitles } = await import('./unified-browser-loop.js');
    const titles = listedTabTitles(
      JSON.stringify({
        tabs: [
          { tabId: 'read', title: 'Wikipedia, the free encyclopedia' },
          { tabId: 'unread', title: 'Timeout page' },
        ],
      }),
    );
    expect(readTabTitles(titles, new Set(['read']))).toEqual([
      { text: 'Wikipedia, the free encyclopedia', tabId: 'read' },
    ]);
  });
});

describe('fields are part of the delivered answer (core-07)', () => {
  it('appends field values the summary leaves out', async () => {
    const { fieldLines } = await import('./unified-browser-loop.js');
    expect(
      fieldLines(
        [
          { name: '新标签1标题', value: 'Alpha' },
          { name: '新标签2标题', value: 'Beta' },
          { name: 'summary', value: 'prose' },
        ],
        '已读取标题 Alpha',
      ),
    ).toBe('- 新标签2标题：Beta');
  });
});
