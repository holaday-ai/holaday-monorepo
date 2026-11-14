import { type Browser, chromium } from 'playwright';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { completionGap } from './browser-completion.js';
import { createPlaywrightUnifiedExecutor } from './playwright-unified-executor.js';
let browser: Browser;
beforeAll(async () => {
  browser = await chromium.launch({ headless: true });
});
afterAll(async () => {
  await browser?.close();
});
it('rejects completed infinite scroll when every actual scroll reports no growth', () => {
  expect(
    completionGap(
      'infinite_scroll 滚动5次后读内容',
      '已滚动5次，无新增内容',
      [
        { tool: 'navigate', ok: true, url: 'https://example.com/infinite_scroll' },
        ...Array.from({ length: 5 }, () => ({
          tool: 'scroll',
          ok: true,
          scroll: { beforeHeight: 800, afterHeight: 800, addedChars: 0, grew: false },
        })),
      ],
      true,
    ),
  ).toBeTruthy();
});
it('scrolls the visible inner scroll container and waits for delayed content', async () => {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.setContent(`<style>body{margin:0}.feed{position:absolute;left:40px;top:40px;width:500px;height:300px;overflow-y:auto}</style>
  <div class="feed"><div style="height:600px">Existing article</div></div><script>
  const feed=document.querySelector('.feed');let loaded=false;feed.addEventListener('scroll',()=>{
  if(!loaded&&feed.scrollTop+feed.clientHeight>=feed.scrollHeight-10){loaded=true;setTimeout(()=>feed.insertAdjacentHTML('beforeend','<p style="height:400px">New actual article</p>'),650)}});
  </script>`);
  const tools = createPlaywrightUnifiedExecutor(page, { observationV2: true });
  try {
    const result = await tools.execute({ tool: 'scroll', direction: 'down', amount: 2 });
    expect(result.scroll?.grew).toBe(true);
    expect(result.scroll?.addedChars).toBeGreaterThan(0);
    expect(await page.locator('.feed').innerText()).toContain('New actual article');
  } finally {
    tools.dispose();
    await page.close();
  }
});
