import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { expect, it } from 'vitest';
import type { NeutralMessagesRequest } from '../../llm/messages-adapter.js';
import { createPlaywrightUnifiedExecutor } from './playwright-unified-executor.js';
import { runUnifiedSupercarTask } from './unified-supercar-runner.js';

it('completes public video metadata through the real runner and discloses the unplayed player wall', async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const html = readFileSync(
    new URL('../../../scripts/browser-eval/blocker-fixtures/player.html', import.meta.url),
    'utf8',
  );
  const requests: NeutralMessagesRequest[] = [];
  const steps: string[] = [];
  const ticks: unknown[] = [];
  await page.route('**/*', (r) =>
    r.fulfill({ contentType: 'text/html; charset=utf-8', body: html }),
  );
  let turn = 0;
  try {
    const result = await runUnifiedSupercarTask({
      taskId: 'public-player-metadata',
      userExternalId: 'owner',
      intent: '请使用云端浏览器，YouTube 公开视频页读标题/频道/播放量/发布日期（不播放）',
      executor: { getPage: async () => page } as never,
      browserCapabilities: {
        observationV2: true,
        viewportV2: true,
        replayV1: false,
        routingV2: true,
      },
      onTick: (e) => {
        ticks.push(e);
        if (e.execution) steps.push(e.execution.actionKind);
      },
      messagesAdapter: {
        metadata: { provider: 'anthropic', model: 'scripted' },
        async create(request) {
          requests.push(request);
          const actions = [
            {
              name: 'navigate',
              input: { url: 'https://www.youtube.com/watch?v=public', expect: '公开页' },
            },
            { name: 'read_page', input: {} },
            {
              name: 'finish',
              input: {
                status: 'completed',
                summary:
                  '标题：Public video title；频道：Forbes Breaking News；播放量：33K views；发布日期：1 year ago（相对时间，非精确日期）。',
                evidence: 'Public video title',
              },
            },
          ];
          const a = actions[turn++];
          if (!a) throw new Error('unexpected extra model turn');
          return {
            id: String(turn),
            metadata: this.metadata,
            content: [{ type: 'tool_use' as const, id: String(turn), ...a }],
            stopReason: 'tool_use' as const,
            usage: {
              inputTokens: 0,
              outputTokens: 0,
              cacheReadInputTokens: null,
              cacheCreationInputTokens: null,
              complete: true,
            },
          };
        },
      },
    });
    expect(result.status).toBe('completed');
    if (result.status === 'completed') {
      expect(result.summary).toContain('Public video title');
      expect(result.summary).toContain('33K views');
      expect(result.summary).toContain('非精确日期');
      expect(result.summary).toContain('播放器需登录验证');
      expect(result.summary).toContain('未主动播放');
    }
    expect(ticks).not.toContainEqual(
      expect.objectContaining({
        execution: expect.objectContaining({
          actionKind: 'browser_local_wall',
          errorCode: expect.any(String),
        }),
      }),
    );
    expect(steps).toContain('navigate');
    expect(steps).toContain('read_page');
    expect(steps).not.toContain('click');
    expect(JSON.stringify(requests[1])).toContain('未主动播放');
    expect(ticks).toContainEqual(
      expect.objectContaining({
        execution: expect.objectContaining({ actionKind: 'browser_local_wall', ok: true }),
      }),
    );
  } finally {
    await browser.close();
  }
});

it('allows read-only description expansion but refuses a click inside the verified player wall', async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  try {
    await page.setContent(
      readFileSync(
        new URL('../../../scripts/browser-eval/blocker-fixtures/player.html', import.meta.url),
        'utf8',
      ),
    );
    await page
      .locator('#movie_player button')
      .evaluate((el) => el.setAttribute('onclick', "document.body.dataset.played='true'"));
    const tools = createPlaywrightUnifiedExecutor(page, {
      taskIntent: '读取标题、频道、播放量、发布日期，不播放',
    });
    let snapshot = await tools.snapshot();
    const ref = snapshot
      .split('\n')
      .find((line) => line.includes('button "Sign in"'))
      ?.match(/\[ref=(e\d+)\]/)?.[1];
    expect(ref).toBeTruthy();
    expect(await tools.execute({ tool: 'click', ref: ref! })).toMatchObject({
      ok: false,
      errorCode: 'local_wall_protected',
    });
    expect(await page.locator('body').getAttribute('data-played')).toBeNull();
    snapshot = await tools.snapshot();
    const more = snapshot
      .split('\n')
      .find((line) => line.includes('button "more"'))
      ?.match(/\[ref=(e\d+)\]/)?.[1];
    expect(more).toBeTruthy();
    expect((await tools.execute({ tool: 'click', ref: more! })).ok).toBe(true);
    expect(await page.locator('#date').innerText()).toBe('Published on September 20, 2025');
    tools.dispose();
  } finally {
    await browser.close();
  }
});
