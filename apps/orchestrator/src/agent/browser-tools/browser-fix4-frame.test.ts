import { chromium } from 'playwright';
import { expect, it } from 'vitest';
import { completionGap } from './browser-completion.js';
import { createPlaywrightUnifiedExecutor } from './playwright-unified-executor.js';
import { describeUnifiedAction } from './unified-action-gate.js';
import { parseUnifiedBrowserAction } from './unified-tools.js';

it('waits for visible matching text rather than the first hidden duplicate', async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.setContent('<span hidden>views</span><span>1.8B views</span>');
  const executor = createPlaywrightUnifiedExecutor(page, { observationV2: true });
  try {
    const result = await executor.execute({ tool: 'wait_for', text: 'views', timeoutMs: 100 });
    expect(result).toMatchObject({ ok: true });
  } finally {
    executor.dispose();
    await browser.close();
  }
});
it('identifies the blank surface of a same-origin read-only editor iframe', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(
      '<iframe title="Editor" style="width:500px;height:300px" srcdoc="<style>html,body{height:100%;margin:0}</style><body aria-readonly=\'true\'><p>Your content goes here.</p></body>"></iframe>',
    );
    const box = await page.locator('iframe').boundingBox();
    const description = await describeUnifiedAction(
      page,
      { tool: 'click_at', x: box!.x + 200, y: box!.y + 200 },
      () => null,
    );
    expect(description.unverified).toBeNull();
    expect(description.descriptors[0]?.tagName).toBe('body');
  } finally {
    await browser.close();
  }
});

it('opens an observed link in a new task-owned tab through a real click', async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.context().route('https://fixture.example/**', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: route.request().url().endsWith('/detail')
        ? '<h1>Detail title</h1>'
        : '<a href="/detail">Read detail</a>',
    }),
  );
  await page.goto('https://fixture.example/');
  const executor = createPlaywrightUnifiedExecutor(page, { observationV2: true });
  try {
    const snapshot = JSON.parse((await executor.execute({ tool: 'read_page' })).text);
    const ref = snapshot.tree.match(/\[ref=(e\d+)\]/)?.[1];
    const result = await executor.execute(
      parseUnifiedBrowserAction('click', {
        ref,
        newTab: true,
        tabId: snapshot.tabId,
        frameId: snapshot.frameId,
        observationRevision: snapshot.observationRevision,
      }),
    );
    expect(result, JSON.stringify(result)).toMatchObject({ ok: true });
    expect(page.context().pages()).toHaveLength(2);
    expect(executor.page).not.toBe(page);
    expect(executor.page.url()).toBe('https://fixture.example/detail');
  } finally {
    executor.dispose();
    await browser.close();
  }
});

it('labels playlist/video links and rejects a playlist offered as the requested video', async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.setContent(
    '<ytd-playlist-renderer><a href="https://www.youtube.com/watch?v=one&list=course">Course playlist</a></ytd-playlist-renderer><ytd-video-renderer><a href="https://www.youtube.com/watch?v=two">One video</a></ytd-video-renderer>',
  );
  const executor = createPlaywrightUnifiedExecutor(page, { observationV2: true });
  try {
    const value = JSON.parse((await executor.execute({ tool: 'links' })).text);
    expect(value.items.map((x: { kind: string }) => x.kind)).toEqual(['playlist', 'video']);
    expect(
      completionGap(
        'YouTube 搜索并返回前5个视频标题',
        '1. Course playlist（播放列表）',
        [{ tool: 'read_page', ok: true, url: 'https://www.youtube.com/results' }],
        true,
      ),
    ).toContain('播放列表');
  } finally {
    executor.dispose();
    await browser.close();
  }
});
