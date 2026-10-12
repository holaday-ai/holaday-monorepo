/** Anonymous, bounded public snapshots for manual regression evidence. No models or logins. */
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { redactPageText } from '../src/agent/browser-tools/page-redaction.js';
import { createPlaywrightUnifiedExecutor } from '../src/agent/browser-tools/playwright-unified-executor.js';
const output = resolve(process.argv[2]!);
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const rows = [];
try {
  for (const [name, url] of [
    ['youtube-search', 'https://www.youtube.com/results?search_query=Playwright+tutorial'],
    ['youtube-video', 'https://www.youtube.com/watch?v=jNQXAC9IVRw'],
    ['google', 'https://www.google.com/search?q=OpenAI'],
    ['jd-login', 'https://passport.jd.com/new/login.aspx'],
  ]) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await page.route('**/*', (r) =>
      ['media'].includes(r.request().resourceType()) ? r.abort() : r.continue(),
    );
    const tools = createPlaywrightUnifiedExecutor(page, { observationV2: true });
    try {
      await page.goto(url!, { waitUntil: 'domcontentloaded', timeout: 20000 });
      await page.waitForTimeout(700);
      const snapshot = await redactPageText(page, await page.locator('body').ariaSnapshot());
      const blocker = await tools.blocker();
      const record = {
        name,
        url: page.url(),
        title: await page.title(),
        blocker,
        snapshot: snapshot.slice(0, 16000),
      };
      await writeFile(join(output, `${name}.json`), JSON.stringify(record, null, 2));
      await page.screenshot({ path: join(output, `${name}.png`) });
      rows.push({ name, blocker, characters: snapshot.length });
    } catch (error) {
      rows.push({ name, error: (error as Error).name });
    } finally {
      tools.dispose();
      await page.close();
    }
  }
  await writeFile(join(output, 'summary.json'), JSON.stringify(rows, null, 2));
  console.log(JSON.stringify(rows));
} finally {
  await browser.close();
}
