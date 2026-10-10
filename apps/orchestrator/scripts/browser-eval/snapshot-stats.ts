/**
 * What a page's AI aria snapshot is made of (size, link-URL share, images), to
 * target unified-loop context compression. No model calls.
 *
 *   pnpm exec tsx scripts/browser-eval/snapshot-stats.ts https://example.com ...
 */
import { chromium } from 'playwright';
const urls = process.argv.slice(2);
const b = await chromium.launch({ headless: true });
for (const u of urls) {
  const p = await b.newPage();
  try {
    await p.goto(u, { timeout: 30000, waitUntil: 'domcontentloaded' });
    const t = await p.locator('body').ariaSnapshot({ mode: 'ai', timeout: 10000 } as never);
    const lines = t.split('\n');
    const urlLines = lines.filter((l) => /^\s*- \/url:/.test(l));
    const urlChars = urlLines.reduce((s, l) => s + l.length + 1, 0);
    const imgLines = lines.filter((l) => /^\s*- img/.test(l));
    console.log(
      `${u}\tchars=${t.length}\tlines=${lines.length}\turlLines=${urlLines.length}\turlChars=${urlChars} (${Math.round((100 * urlChars) / t.length)}%)\timg=${imgLines.length}`,
    );
  } catch (e) {
    console.log(`${u}\tERR ${(e as Error).message.slice(0, 60)}`);
  }
  await p.close();
}
await b.close();
