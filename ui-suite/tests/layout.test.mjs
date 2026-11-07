import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import { measureLayout, layoutFindings } from '../lib/layout-checks.mjs';
import { auditViewports } from '../lib/viewports.mjs';
const { chromium } = createRequire(path.resolve('apps/web-workbench/package.json'))('playwright');

test('layout checks find clipped columns even when the document itself has no scrollbar', async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 1000 } });
    await page.setContent(
      '<style>body{margin:0}.holaday-main{height:100vh;width:900px;margin-left:300px;overflow:hidden}[data-layout-container]{display:flex;width:100%;height:100%}section{flex:none;width:560px}</style><main class="holaday-main"><div data-layout-container><section>对话</section><section>浏览器</section></div></main>',
    );
    const broken = await measureLayout(page);
    assert.equal(broken.documentWidth, 1200);
    assert.ok(
      layoutFindings(broken).some((f) => f.rule === 'horizontal-overflow' && f.severity === 'P1'),
    );
    await page.addStyleTag({ content: 'section{width:50%;min-width:0}' });
    assert.deepEqual(layoutFindings(await measureLayout(page)), []);
  } finally {
    await browser.close();
  }
});

test('layout checks detect both root overflow and a short shell, accepting full-height scroll content', async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 1000 } });
    await page.setContent(
      '<style>body{margin:0}.holaday-shell{width:1250px;height:920px;display:flex}.holaday-sidebar{width:300px;height:920px}.holaday-main{flex:1;height:920px;overflow:auto}</style><div class="holaday-shell"><aside class="holaday-sidebar"></aside><main class="holaday-main"><article style="height:1600px">长内容</article></main></div>',
    );
    const bad = layoutFindings(await measureLayout(page));
    assert.ok(bad.some((f) => f.rule === 'horizontal-overflow' && f.control === 'document'));
    assert.equal(bad.filter((f) => f.rule === 'main-container-height').length, 3);
    await page.addStyleTag({
      content: '.holaday-shell{width:100%;height:100vh}.holaday-sidebar,.holaday-main{height:100%}',
    });
    assert.deepEqual(layoutFindings(await measureLayout(page)), []);
  } finally {
    await browser.close();
  }
});

test('default audit includes laptop aspect ratios, retaining legacy 960px baselines', () => {
  assert.deepEqual(auditViewports({}), [
    { width: 1440, height: 960 },
    { width: 1280, height: 960 },
    { width: 1024, height: 960 },
    { width: 1200, height: 1000 },
    { width: 1366, height: 768 },
  ]);
  assert.deepEqual(auditViewports({ UI_AUDIT_WIDTHS: '[1100,1200]' }), [
    { width: 1100, height: 960 },
    { width: 1200, height: 960 },
  ]);
  assert.deepEqual(auditViewports({ UI_AUDIT_VIEWPORTS: '[{"width":1100,"height":1300}]' }), [
    { width: 1100, height: 1300 },
  ]);
  assert.throws(() => auditViewports({ UI_AUDIT_VIEWPORTS: '[{"width":0,"height":1000}]' }));
  assert.throws(() => auditViewports({ UI_AUDIT_WIDTHS: '[1200]', UI_AUDIT_VIEWPORTS: '[]' }));
});

test('an opaque shell strip cannot paint over the browser toolbar even with pointer-events disabled', async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 1000 } });
    await page.setContent(
      '<style>body{margin:0}.hd-shell-topbar{position:absolute;inset:0 0 auto;height:76px;background:white;z-index:25;pointer-events:none}section{position:absolute;left:600px;top:0;width:600px;height:1000px}</style><section aria-label="浏览器工作区"><button>后退</button></section><div class="hd-shell-topbar"></div>',
    );
    assert.ok(
      layoutFindings(await measureLayout(page)).some((f) => f.rule === 'browser-header-occluded'),
    );
    await page.locator('.hd-shell-topbar').evaluate((e) => e.remove());
    assert.deepEqual(layoutFindings(await measureLayout(page)), []);
  } finally {
    await browser.close();
  }
});
