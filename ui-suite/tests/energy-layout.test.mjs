import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';
const { chromium } = createRequire(path.resolve('apps/web-workbench/package.json'))('playwright');

test('energy choices fit their available content width even when the window uses desktop media queries', async () => {
  const css = fs.readFileSync('apps/web-workbench/src/components/energy/energy.css', 'utf8');
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 1000 } });
    for (const width of [600, 710, 810, 940]) {
      await page.setContent(
        `<style>*{box-sizing:border-box}body{margin:0}${css}</style><div class="energy-page" style="width:${width}px;margin-left:250px"><div id="energy-recharge"><section class="energy-hero"><div class="energy-hero__copy"><h2>今天想补哪一种能量？</h2></div><div class="energy-hero__art"></div><div class="energy-need-list">${['专注', '放松', '自信', '好心情'].map((label) => `<button class="energy-need-option"><span>+</span><strong>${label}</strong></button>`).join('')}</div><button class="energy-hero__action">开始 30 秒补给</button></section></div></div>`,
      );
      const clipped = await page.locator('.energy-hero').evaluate((hero) => {
        const box = hero.getBoundingClientRect();
        return [...hero.querySelectorAll('button')]
          .filter((button) => {
            const r = button.getBoundingClientRect();
            return r.right > box.right + 1 || r.left < box.left - 1;
          })
          .map((button) => button.textContent);
      });
      assert.deepEqual(clipped, [], `choices must fit at ${width}px available width`);
    }
  } finally {
    await browser.close();
  }
});
