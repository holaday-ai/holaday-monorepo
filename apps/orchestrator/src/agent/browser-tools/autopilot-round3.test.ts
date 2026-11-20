import { chromium } from 'playwright';
import { describe, expect, it } from 'vitest';
import { createPlaywrightUnifiedExecutor } from './playwright-unified-executor.js';
import { runUnifiedBrowserLoop } from './unified-browser-loop.js';

/** BROWSER-AUTOPILOT-1 round 3 live findings (core-07, core-10). */
describe('frameset documents (core-10 /nested_frames)', () => {
  it('reads a frameset page instead of failing on a missing <body>', async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.route('http://frames.test/**', (route) => {
        const url = route.request().url();
        const body = url.endsWith('/left')
          ? '<body>LEFT FRAME</body>'
          : url.endsWith('/right')
            ? '<body>RIGHT FRAME</body>'
            : '<frameset cols="50%,50%"><frame src="/left"><frame src="/right"></frameset>';
        return route.fulfill({ contentType: 'text/html', body });
      });
      await page.goto('http://frames.test/');
      const tools = createPlaywrightUnifiedExecutor(page, { observationV2: true });
      try {
        const result = await tools.execute({ tool: 'read_page' });
        expect(result.ok, result.text).toBe(true);
        expect(result.text).toContain('LEFT FRAME');
      } finally {
        tools.dispose();
      }
    } finally {
      await browser.close();
    }
  });
});

describe('switching back to the source tab in cloud observation (core-07)', () => {
  it('records the switch target so the switch-back claim is proven', async () => {
    let active = 'source';
    let turn = 0;
    const script = [
      { name: 'read_page', input: {} },
      { name: 'click', input: { ref: 'e1', newTab: true } },
      { name: 'read_page', input: {} },
      { name: 'switch_tab', input: { targetTabId: 'source' } },
      {
        name: 'finish',
        input: { status: 'completed', summary: '新标签标题：Child。已切回原标签。' },
      },
    ];
    const result = await runUnifiedBrowserLoop({
      intent: '从页面打开链接到新标签，读标题后回到第一个',
      observationV2: true,
      maxSteps: 6,
      supportedTools: { download: false, upload: false, tabs: true },
      adapter: {
        metadata: { provider: 'anthropic', model: 'fixture' },
        async create() {
          const call = script[turn++]!;
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
      },
      execute: async (action) => {
        if (action.tool === 'click') {
          active = 'child';
          return {
            ok: true,
            text: 'opened',
            tabId: 'child',
            openedTab: true,
            url: 'https://c.test/',
          };
        }
        if (action.tool === 'switch_tab') {
          active = action.targetTabId;
          // Cloud observation: the switch returns a read; the tab id is in the text only.
          return { ok: true, text: JSON.stringify({ tabId: active, tree: 'heading "Source"' }) };
        }
        return {
          ok: true,
          text: JSON.stringify({
            tabId: active,
            tree: active === 'child' ? 'heading "Child" [level=1]' : 'heading "Source" [level=1]',
          }),
        };
      },
    });
    expect(result).toMatchObject({ status: 'completed' });
  });
});
