import assert from 'node:assert/strict';
import path from 'node:path';
import { BROWSER_FRAME, edgeMarkedFrame } from './frame.mjs';

/**
 * FIX-33 #4 (BOSS: a w3schools page in the task browser panel cut off on the right,
 * reachable only by scrollbars). Page-sized frames — the desktop viewports the panel
 * asks for on w3schools html_forms, YouTube and a JD item page — must be seen whole:
 * inside every clipping ancestor, aspect kept, no horizontal scrollbar, with the
 * sidebar open or closed, at a phone width, and with viewport v2 on or off. 「100%
 * 原尺寸」 shows the page 1:1 and scrolls; a takeover click lands where it was aimed.
 */
const PAGES = [
  ['w3schools-html-forms', 1280, 800],
  ['youtube', 1440, 900],
  ['jd-item', 1280, 1784],
];

async function measure(page) {
  return page.evaluate(() => {
    const canvas = document.querySelector('canvas');
    if (!canvas) return null;
    const r = canvas.getBoundingClientRect();
    let clip = { left: 0, top: 0, right: innerWidth, bottom: innerHeight };
    const scrollers = [];
    for (let el = canvas.parentElement; el && el !== document.body; el = el.parentElement) {
      const cs = getComputedStyle(el);
      if (el.scrollWidth > el.clientWidth + 1 && /auto|scroll/.test(cs.overflowX))
        scrollers.push(el.className.slice(0, 60));
      if (cs.overflowX !== 'visible' || cs.overflowY !== 'visible') {
        const b = el.getBoundingClientRect();
        clip = {
          left: Math.max(clip.left, b.left),
          top: Math.max(clip.top, b.top),
          right: Math.min(clip.right, b.right),
          bottom: Math.min(clip.bottom, b.bottom),
        };
      }
    }
    return {
      source: [canvas.width, canvas.height],
      rect: [r.left, r.top, r.right, r.bottom],
      clip: [clip.left, clip.top, clip.right, clip.bottom],
      aspect: r.width / r.height / (canvas.width / canvas.height),
      scale: r.width / canvas.width,
      scrollers,
    };
  });
}

async function waitForFrame(page, width, height) {
  await page.waitForFunction(
    ([w, h]) => [...document.querySelectorAll('canvas')].some((c) => c.width === w && c.height === h),
    [width, height],
    { timeout: 6000 },
  );
  await page.waitForTimeout(150);
}

function assertWhole(m, label) {
  assert.ok(m, `${label}: no live canvas`);
  const [left, top, right, bottom] = m.rect;
  const [cl, ct, cr, cb] = m.clip;
  assert.ok(left >= cl - 1 && right <= cr + 1, `${label}: page cut horizontally ${JSON.stringify(m)}`);
  assert.ok(top >= ct - 1 && bottom <= cb + 1, `${label}: page cut vertically ${JSON.stringify(m)}`);
  assert.ok(Math.abs(m.aspect - 1) < 0.01, `${label}: aspect changed ${m.aspect}`);
  assert.deepEqual(m.scrollers, [], `${label}: horizontal scrollbar ${m.scrollers}`);
  // Fitted to the panel width (or its height for a tall page), not a thumbnail.
  assert.ok(right - left >= (cr - cl) * 0.98 || bottom - top >= (cb - ct) * 0.98, `${label}: not fitted`);
}

async function requests(server) {
  return server.seed.requests.filter((r) => r.name === 'local.browser.input');
}

export async function browserPanelFitChecks(page, server, width, out) {
  const items = [];
  const baseUrl = page.url();
  const viewport = page.viewportSize();
  try {
    for (const v2 of [false, true]) {
      await page.request.get(`${server.origin}/__ui_seed/viewport-v2?on=${v2 ? 1 : 0}`);
      for (const [name, w, h] of PAGES) {
        server.setFrame(edgeMarkedFrame(w, h));
        for (const sidebar of ['closed', 'open']) {
          await page.goto(baseUrl);
          await waitForFrame(page, w, h);
          if (sidebar === 'open') {
            await page.locator('button[data-sidebar="trigger"]').first().click();
            await page.waitForTimeout(250);
          }
          const label = `${name}@${width} v2=${v2} sidebar=${sidebar}`;
          assertWhole(await measure(page), label);
          const screenshot = `after-fix33-${width}-${name}-${v2 ? 'v2' : 'v1'}-${sidebar}.png`;
          await page.screenshot({ path: path.join(out, screenshot), animations: 'disabled' });
          items.push({ item: 'browser-panel-fit', label, screenshot });
        }
      }
      if (v2) {
        // The panel asks the remote browser for a desktop-width page, never the narrow
        // panel width that made wide pages overflow inside the remote browser.
        const sent = (await requests(server)).filter((r) => r.input.type === 'viewport');
        assert.ok(sent.length > 0, 'v2: no viewport request');
        for (const r of sent)
          assert.ok(r.input.width >= 1280, `v2: remote viewport too narrow ${JSON.stringify(r.input)}`);
      }
    }
    await page.request.get(`${server.origin}/__ui_seed/viewport-v2?on=0`);

    // 「100% 原尺寸」 is 1:1 and scrolls; 「适应面板」 brings the whole page back.
    server.setFrame(edgeMarkedFrame(1280, 800));
    await page.goto(baseUrl);
    await waitForFrame(page, 1280, 800);
    const fit = page.getByRole('button', { name: '适应面板', exact: true });
    const actual = page.getByRole('button', { name: '100% 原尺寸', exact: true });
    assert.equal(await fit.getAttribute('aria-pressed'), 'true', 'fit is the default');
    await actual.click();
    await page.waitForTimeout(200);
    const oneToOne = await measure(page);
    assert.ok(Math.abs(oneToOne.scale - 1) < 0.01, `100%: scale ${oneToOne.scale}`);
    assert.equal(await actual.getAttribute('aria-pressed'), 'true');
    await page.screenshot({
      path: path.join(out, `after-fix33-${width}-actual-size.png`),
      animations: 'disabled',
    });
    await fit.click();
    await page.waitForTimeout(200);
    assertWhole(await measure(page), `fit restored@${width}`);

    // Takeover: a click on the scaled page lands on the same page pixel.
    const takeover = page.getByRole('button', { name: '接管浏览器', exact: true });
    if (await takeover.count()) {
      await takeover.click();
      await page.waitForTimeout(300);
      const m = await measure(page);
      const [left, top, right, bottom] = m.rect;
      const before = (await requests(server)).length;
      const [u, v] = [0.9, 0.5];
      await page.mouse.click(left + (right - left) * u, top + (bottom - top) * v);
      await page.waitForTimeout(200);
      const down = (await requests(server)).slice(before).find((r) => r.input.type === 'mouseDown');
      assert.ok(down, 'takeover click was not sent');
      assert.ok(Math.abs(down.input.x - 1280 * u) <= 3, `click x ${down.input.x} ≠ ${1280 * u}`);
      assert.ok(Math.abs(down.input.y - 800 * v) <= 3, `click y ${down.input.y} ≠ ${800 * v}`);
      items.push({ item: 'browser-takeover-click-mapping', label: `${down.input.x},${down.input.y}` });
    }

    // Phone width: the same page, whole.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(baseUrl);
    const sheetButton = page.getByRole('button', { name: /浏览器/ }).first();
    if (!(await page.locator('canvas').count()) && (await sheetButton.count()))
      await sheetButton.click();
    await waitForFrame(page, 1280, 800);
    assertWhole(await measure(page), `phone@390 from ${width}`);
    await page.screenshot({ path: path.join(out, `after-fix33-${width}-phone.png`), animations: 'disabled' });
    items.push({ item: 'browser-panel-fit', label: 'phone 390x844' });
  } finally {
    server.setFrame(BROWSER_FRAME);
    await page.request.get(`${server.origin}/__ui_seed/viewport-v2?on=0`);
    if (viewport) await page.setViewportSize(viewport);
    await page.goto(baseUrl);
  }
  return items;
}
