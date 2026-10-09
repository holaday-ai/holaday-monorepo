import { chromium } from 'playwright';
import { expect, it } from 'vitest';
import { env } from '../../config/env.js';
import type { MessagesAdapter, NeutralMessagesRequest } from '../../llm/messages-adapter.js';
import { runUnifiedSupercarTask } from './unified-supercar-runner.js';

it('runs V2 reads and ref-bound actions through the production cloud gate', async () => {
  const browser = await chromium.launch({ headless: true, args: ['--renderer-process-limit=2'] });
  const before = env.BROWSER_OBSERVATION_V2;
  env.BROWSER_OBSERVATION_V2 = true;
  try {
    const page = await browser.newPage();
    await page.setContent(
      "<label>关键词<input></label><button onclick=\"document.querySelector('p').textContent='结果：'+document.querySelector('input').value\">搜索</button><p></p>",
    );
    let turn = 0;
    const latest = (request: NeutralMessagesRequest) => {
      const content = request.messages.at(-1)!.content;
      if (typeof content === 'string') throw new Error('missing tool result');
      const result = content.find((b) => b.type === 'tool_result');
      if (!result || result.type !== 'tool_result') throw new Error('missing tool result');
      return JSON.parse(result.content);
    };
    const adapter = {
      create: async (request: NeutralMessagesRequest) => {
        turn++;
        let name = 'read_page',
          input: Record<string, unknown> = {};
        if (turn === 2 || turn === 4) {
          const state = latest(request);
          const ref = state.tree
            .split('\n')
            .find((l: string) => l.includes(turn === 2 ? 'textbox' : 'button'))
            .match(/ref=(e\d+)/)[1];
          name = turn === 2 ? 'type' : 'click';
          input = {
            ref,
            observationRevision: state.observationRevision,
            tabId: state.tabId,
            frameId: state.frameId,
            ...(turn === 2 ? { text: '收纳' } : {}),
          };
        }
        if (turn === 6) {
          name = 'finish';
          input = { status: 'completed', summary: '结果：收纳', evidence: '结果：收纳' };
        }
        return { content: [{ type: 'tool_use', id: String(turn), name, input }] };
      },
    } as unknown as MessagesAdapter;
    const result = await runUnifiedSupercarTask({
      taskId: 'test-v2',
      intent: '搜索收纳',
      executor: { getPage: async () => page } as never,
      messagesAdapter: adapter,
      maxIterations: 6,
    });
    expect(result.status).toBe('completed');
    expect(await page.locator('p').innerText()).toBe('结果：收纳');
  } finally {
    env.BROWSER_OBSERVATION_V2 = before;
    await browser.close();
  }
});
