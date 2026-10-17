import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import { classifyGeometry, measurePage } from '../lib/checks.mjs';
import { inspectControls, observeControl } from '../lib/interaction.mjs';
import { isPopupNavigation } from '../lib/network.mjs';
const require = createRequire(path.resolve('apps/web-workbench/package.json'));
const { chromium } = require('playwright');
test('real browser detects dead button, records working state change, and detects clipped/truncated control', async () => {
  const browser = await chromium.launch({ args: ['--renderer-process-limit=2'] });
  const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
  try {
    await page.setContent(
      '<button id="dead">无效</button><button id="works" onclick="document.querySelector(\'output\').textContent=\'已完成\'">保存</button><output></output><button style="position:absolute;left:1010px;width:100px;overflow:hidden;white-space:nowrap">很长的截断按钮文字内容</button>',
    );
    let m = await measurePage(page);
    assert.equal(
      (
        await observeControl(
          page,
          m.elements.find((x) => x.label === '无效'),
        )
      ).status,
      'failed',
    );
    m = await measurePage(page);
    assert.equal(
      (
        await observeControl(
          page,
          m.elements.find((x) => x.label === '保存'),
        )
      ).status,
      'passed',
    );
    assert.ok(classifyGeometry(m.elements, 1024, 768).some((x) => x.rule === 'viewport-clipping'));
  } finally {
    await browser.close();
  }
});
test('menus require second-click and Escape dismissal; pagination must append rows', async () => {
  const browser = await chromium.launch({ args: ['--renderer-process-limit=2'] });
  const page = await browser.newPage();
  try {
    await page.setContent(
      `<button aria-haspopup="menu" aria-expanded="false" onclick="this.setAttribute('aria-expanded',this.getAttribute('aria-expanded')==='true'?'false':'true')">菜单</button><script>document.addEventListener('keydown',e=>{if(e.key==='Escape')document.querySelector('button').setAttribute('aria-expanded','false')})</script>`,
    );
    let m = await measurePage(page);
    let r = await observeControl(page, m.elements[0]);
    assert.equal(r.dismissal?.secondClick, true);
    assert.equal(r.dismissal?.escape, true);
    await page.setContent(
      `<button aria-haspopup="menu" aria-expanded="false" onclick="this.setAttribute('aria-expanded','true')">坏菜单</button>`,
    );
    m = await measurePage(page);
    r = await observeControl(page, m.elements[0]);
    assert.equal(r.status, 'failed');
    assert.match(r.reason, /dismiss/);
    await page.setContent(
      `<div role="row">一</div><button onclick="this.textContent='已加载'">加载更多</button>`,
    );
    m = await measurePage(page);
    r = await observeControl(
      page,
      m.elements.find((x) => x.label === '加载更多'),
    );
    assert.equal(r.status, 'failed');
    assert.match(r.reason, /append/);
  } finally {
    await browser.close();
  }
});

test('control identity survives text changes and pagination requires a new item', async () => {
  const browser = await chromium.launch({ args: ['--renderer-process-limit=2'] });
  const page = await browser.newPage();
  try {
    await page.setContent(
      `<ul><li>第一条</li></ul><button onclick="document.querySelector('ul').insertAdjacentHTML('beforeend','<li><button>新任务</button></li>')">加载更多</button>`,
    );
    const first = (await measurePage(page)).elements[0];
    const result = await observeControl(page, first);
    assert.equal(result.status, 'passed');
    await page.locator(`[data-ui-audit-id=${JSON.stringify(first.id)}]`).evaluate((e) => {
      e.textContent = '更多项目';
    });
    const changed = (await measurePage(page)).elements.find((e) => e.label === '更多项目');
    assert.equal(changed.id, first.id);
  } finally {
    await browser.close();
  }
});

test('password type changes are observable; padded reveal button is an intentional adornment', async () => {
  const browser = await chromium.launch({ args: ['--renderer-process-limit=2'] });
  const page = await browser.newPage();
  try {
    await page.setContent(
      `<div style="position:relative;width:240px"><input style="width:240px;height:40px;padding-right:70px;box-sizing:border-box" type="password"/><button aria-label="显示密码" style="position:absolute;right:0;top:5px;height:30px" onclick="document.querySelector('input').type='text'">显示密码</button></div>`,
    );
    const m = await measurePage(page);
    assert.ok(!classifyGeometry(m.elements, 1280, 720).some((f) => f.rule === 'control-overlap'));
    const r = await observeControl(
      page,
      m.elements.find((e) => e.label === '显示密码'),
    );
    assert.equal(r.status, 'passed');
  } finally {
    await browser.close();
  }
});

test('request-only and protocol actions are distinguished from dead buttons', async () => {
  const browser = await chromium.launch({ args: ['--renderer-process-limit=2'] });
  const page = await browser.newPage();
  try {
    await page.route('http://127.0.0.1:45678/**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'text/html; charset=utf-8',
        body: route.request().url().endsWith('/api/action')
          ? 'ok'
          : `<button onclick="fetch('/api/action')">刷新数据</button><a href="mailto:ui@example.test">邮件</a>`,
      }),
    );
    await page.goto('http://127.0.0.1:45678/');
    let m = await measurePage(page);
    assert.equal(
      (
        await observeControl(
          page,
          m.elements.find((e) => e.label === '刷新数据'),
        )
      ).status,
      'passed',
    );
    m = await measurePage(page);
    assert.equal(
      (
        await observeControl(
          page,
          m.elements.find((e) => e.label === '邮件'),
        )
      ).status,
      'protocol-link',
    );
  } finally {
    await browser.close();
  }
});

test('multiple paths to one scoped menu do not multiply control coverage', async () => {
  const browser = await chromium.launch({ args: ['--renderer-process-limit=2'] });
  const page = await browser.newPage();
  const html = `<button onclick="document.querySelector('section').hidden=false">入口A</button><button onclick="document.querySelector('section').hidden=false">入口B</button><section role="menu" aria-label="共享菜单" hidden><button onclick="document.querySelector('section').hidden=true">关闭</button></section><script>document.onkeydown=e=>{if(e.key==='Escape')document.querySelector('section').hidden=true}</script>`;
  try {
    await page.setContent(html);
    const results = await inspectControls(page, {
      reset: () => page.setContent(html),
      maxDepth: 2,
    });
    assert.equal(results.filter((r) => r.label === '关闭').length, 1);
    assert.equal(results.filter((r) => r.status === 'uncovered').length, 0);
  } finally {
    await browser.close();
  }
});

test('inline expanded sections need a collapse action but do not require Escape', async () => {
  const browser = await chromium.launch({ args: ['--renderer-process-limit=2'] });
  try {
    const page = await browser.newPage();
    await page.setContent(
      `<button aria-expanded="false" onclick="this.setAttribute('aria-expanded',this.getAttribute('aria-expanded')==='true'?'false':'true')">展开六项</button>`,
    );
    const result = await observeControl(page, (await measurePage(page)).elements[0]);
    assert.equal(result.status, 'passed');
    assert.equal(result.dismissal.kind, 'inline');
    assert.equal(result.dismissal.secondClick, true);
  } finally {
    await browser.close();
  }
});

test('external popup must leave about:blank and preserve its requested URL', async () => {
  const browser = await chromium.launch({ args: ['--renderer-process-limit=2'] });
  try {
    const page = await browser.newPage();
    await page
      .context()
      .route('https://example.test/**', (route) =>
        route.fulfill({ contentType: 'text/html', body: 'local target' }),
      );
    await page.setContent(
      `<button onclick="window.open('about:blank','_blank')">空白</button><a target="_blank" href="https://example.test/expected?x=1">目标</a>`,
    );
    let m = await measurePage(page);
    assert.equal(
      (
        await observeControl(
          page,
          m.elements.find((x) => x.label === '空白'),
        )
      ).reason,
      'popup remains about:blank',
    );
    m = await measurePage(page);
    const result = await observeControl(
      page,
      m.elements.find((x) => x.label === '目标'),
    );
    assert.equal(result.status, 'passed');
    assert.deepEqual(result.popupUrls, ['https://example.test/expected?x=1']);
  } finally {
    await browser.close();
  }
});

test('numeric phone inputs preserve phone length and newly enabled buttons get replayed', async () => {
  const browser = await chromium.launch({ args: ['--renderer-process-limit=2'] });
  try {
    const page = await browser.newPage();
    const html = `<input type="tel" inputmode="numeric" placeholder="手机号" oninput="document.querySelector('button').disabled=this.value.length!==11"><button disabled onclick="document.querySelector('output').textContent='sent'">发送验证码</button><output></output>`;
    await page.setContent(html);
    const result = await observeControl(page, (await measurePage(page)).elements[0]);
    assert.equal(result.status, 'passed');
    assert.equal(await page.locator('input').inputValue(), '13800000000');
    await page.setContent(html);
    const all = await inspectControls(page, { reset: () => page.setContent(html) });
    assert.ok(all.some((x) => x.label === '发送验证码' && x.status === 'passed'));
  } finally {
    await browser.close();
  }
});

test('background controls created behind a dialog wait for dismissal', async () => {
  const browser = await chromium.launch({ args: ['--renderer-process-limit=2'] });
  try {
    const page = await browser.newPage();
    const html = `<button onclick="openDialog()">打开</button><main></main><dialog role="dialog"><button onclick="document.querySelector('dialog').close()">关闭</button></dialog><script>function openDialog(){const b=document.createElement('button');b.textContent='新后台按钮';b.onclick=()=>b.textContent='42';document.querySelector('main').append(b);document.querySelector('dialog').showModal();}</script>`;
    await page.setContent(html);
    const results = await inspectControls(page, { reset: () => page.setContent(html) });
    assert.ok(results.some((x) => x.label === '新后台按钮' && x.status === 'passed'));
    assert.ok(!results.some((x) => x.label === '新后台按钮' && x.status === 'failed'));
  } finally {
    await browser.close();
  }
});

test('measurement excludes inert anchors, separates unnamed dialogs, and detects vertical clipped text', async () => {
  const browser = await chromium.launch({ args: ['--renderer-process-limit=2'] });
  try {
    const page = await browser.newPage();
    await page.setContent(
      `<a>inert</a><a href="#a">active</a><div class="fc-daygrid-day" data-date="2026-10-09">9</div><button style="position:absolute;left:50px;top:80px">background</button><div role="dialog" style="position:absolute;left:50px;top:80px"><button>foreground</button></div><p style="width:50px;height:10px;overflow:hidden">one two three four five six</p>`,
    );
    const m = await measurePage(page);
    assert.ok(!m.elements.some((x) => x.label === 'inert'));
    assert.ok(m.elements.some((x) => x.label === '9'));
    assert.notEqual(
      m.elements.find((x) => x.label === 'background').layer,
      m.elements.find((x) => x.label === 'foreground').layer,
    );
    assert.ok(m.truncatedText.some((x) => x.text.startsWith('one two')));
  } finally {
    await browser.close();
  }
});

test('style-only toggles and chooser uploads have observable effects', async () => {
  const browser = await chromium.launch({ args: ['--renderer-process-limit=2'] });
  try {
    const page = await browser.newPage();
    await page.setContent(
      `<button onclick="this.style.backgroundColor='red'">星期一</button><button onclick="document.querySelector('input').click()">上传</button><input type="file" accept="image/*" style="display:none" onchange="document.querySelector('output').textContent=this.files[0].name"><output></output>`,
    );
    assert.equal(
      (
        await observeControl(
          page,
          (await measurePage(page)).elements.find((x) => x.label === '星期一'),
        )
      ).status,
      'passed',
    );
    assert.equal(
      (
        await observeControl(
          page,
          (await measurePage(page)).elements.find((x) => x.label === '上传'),
        )
      ).status,
      'passed',
    );
    assert.equal(await page.locator('output').textContent(), 'ui.png');
  } finally {
    await browser.close();
  }
});

test('reserved textarea padding permits toolbar buttons but does not hide actual overlap', async () => {
  const browser = await chromium.launch({ args: ['--renderer-process-limit=2'] });
  try {
    const page = await browser.newPage();
    await page.setContent(
      `<textarea style="position:absolute;top:0;left:0;width:300px;height:150px;padding-bottom:50px;box-sizing:border-box"></textarea><button style="position:absolute;top:110px;left:10px;height:30px">toolbar</button><button style="position:absolute;top:20px;left:20px;height:30px">bad</button>`,
    );
    const m = await measurePage(page);
    const f = classifyGeometry(m.elements, 1280, 720).filter((x) => x.rule === 'control-overlap');
    assert.ok(!f.some((x) => x.control.includes('toolbar')));
    assert.ok(f.some((x) => x.control.includes('bad')));
  } finally {
    await browser.close();
  }
});

test('Escape dismisses popup when modal blocks a second trigger click', async () => {
  const browser = await chromium.launch({ args: ['--renderer-process-limit=2'] });
  try {
    const page = await browser.newPage();
    await page.setContent(
      `<button aria-expanded="false" aria-haspopup="menu" onclick="this.setAttribute('aria-expanded','true');document.querySelector('div').hidden=false">menu</button><div role="menu" hidden style="position:fixed;inset:0;background:white">panel</div><script>document.onkeydown=e=>{if(e.key==='Escape'){document.querySelector('div').hidden=true;document.querySelector('button').setAttribute('aria-expanded','false')}}</script>`,
    );
    const r = await observeControl(page, (await measurePage(page)).elements[0]);
    assert.equal(r.status, 'passed');
    assert.equal(r.dismissal.escape, true);
  } finally {
    await browser.close();
  }
});

test('calendar slots retain identity when month data changes', async () => {
  const browser = await chromium.launch({ args: ['--renderer-process-limit=2'] });
  try {
    const page = await browser.newPage();
    await page.setContent(
      '<div class="fc"><div class="fc-daygrid-day" data-date="2026-10-09">9</div></div>',
    );
    const first = (await measurePage(page)).elements[0];
    await page.setContent(
      '<div class="fc"><div class="fc-daygrid-day" data-date="2026-11-13">13</div></div>',
    );
    const second = (await measurePage(page)).elements[0];
    assert.equal(first.id, second.id);
    assert.notEqual(first.label, second.label);
  } finally {
    await browser.close();
  }
});

test('a pressed toggle is clicked; it is not mistaken for a selected radio option', async () => {
  const browser = await chromium.launch({ args: ['--renderer-process-limit=2'] });
  try {
    const page = await browser.newPage();
    await page.setContent(
      `<button aria-pressed="true" onclick="this.setAttribute('aria-pressed','false')">收藏</button>`,
    );
    assert.equal(
      (await observeControl(page, (await measurePage(page)).elements[0])).status,
      'passed',
    );
    assert.equal(await page.locator('button').getAttribute('aria-pressed'), 'false');
  } finally {
    await browser.close();
  }
});

test('failed ancestor replay never executes dependent controls', async () => {
  const browser = await chromium.launch({ args: ['--renderer-process-limit=2'] });
  try {
    const page = await browser.newPage();
    const html = `<button onclick="window.n=(window.n||0)+1;if(window.n===1)document.querySelector('section').hidden=false">打开</button><section hidden><button onclick="window.childRan=true;this.textContent='done'">依赖按钮</button></section>`;
    await page.setContent(html);
    const r = await inspectControls(page, { reset: () => page.setContent(html) });
    assert.ok(
      r.some(
        (x) =>
          x.label === '依赖按钮' &&
          x.status === 'uncovered' &&
          x.reason.includes('ancestor replay'),
      ),
    );
    assert.ok(!(await page.evaluate(() => window.childRan)));
  } finally {
    await browser.close();
  }
});

test('dialogs without expanded semantics must support Escape before clean replay', async () => {
  const browser = await chromium.launch({ args: ['--renderer-process-limit=2'] });
  try {
    const page = await browser.newPage();
    await page.setContent(
      `<button onclick="document.querySelector('dialog').showModal()">打开弹窗</button><dialog role="dialog"><button>子控件</button></dialog>`,
    );
    const r = await observeControl(page, (await measurePage(page)).elements[0]);
    assert.equal(r.status, 'passed');
    assert.equal(r.dismissal.escape, true);
    assert.equal(await page.locator('dialog').isVisible(), false);
    assert.equal(r.replayAfterDismissal, true);
  } finally {
    await browser.close();
  }
});

test('file grid action layer is an explicit overlap exception', async () => {
  const browser = await chromium.launch({ args: ['--renderer-process-limit=2'] });
  try {
    const page = await browser.newPage();
    await page.setContent(
      `<div class="hd-file-collection" data-view="grid"><div class="hd-file-row" style="position:relative;width:200px"><button style="width:200px;height:100px">预览文件</button><div style="position:absolute;right:0;bottom:0"><button>更多操作</button></div></div></div>`,
    );
    const m = await measurePage(page);
    assert.ok(!classifyGeometry(m.elements, 1280, 720).some((x) => x.rule === 'control-overlap'));
  } finally {
    await browser.close();
  }
});

test('hidden browser DOM does not invalidate an already-empty new-task composer', async () => {
  const browser = await chromium.launch({ args: ['--renderer-process-limit=2'] });
  try {
    const page = await browser.newPage();
    await page.route('http://127.0.0.1:45999/**', (route) =>
      route.fulfill({
        contentType: 'text/html; charset=utf-8',
        body: `<button>新任务</button><textarea placeholder="说说你想做的事..."></textarea><button aria-label="浏览器工作区">打开浏览器</button><section aria-label="浏览器工作区" style="display:none">隐藏浏览器</section>`,
      }),
    );
    await page.goto('http://127.0.0.1:45999/');
    assert.equal(
      (await observeControl(page, (await measurePage(page)).elements[0])).status,
      'idempotent',
    );
    await page.locator('section[aria-label="浏览器工作区"]').evaluate((e) => {
      e.style.display = 'block';
    });
    assert.equal(
      (await observeControl(page, (await measurePage(page)).elements[0])).status,
      'failed',
    );
  } finally {
    await browser.close();
  }
});

test('navigation target layout is checked by its own scenario, not during source-page transition', async () => {
  const browser = await chromium.launch({ args: ['--renderer-process-limit=2'] });
  try {
    const page = await browser.newPage();
    await page.route('http://127.0.0.1:45998/**', (route) =>
      route.fulfill({
        contentType: 'text/html; charset=utf-8',
        body: route.request().url().endsWith('/next')
          ? '<button style="position:absolute;top:10px;left:10px">one</button><button style="position:absolute;top:10px;left:10px">two</button>'
          : '<a href="/next">next</a>',
      }),
    );
    await page.goto('http://127.0.0.1:45998/');
    const r = await inspectControls(page);
    assert.equal(r[0].status, 'passed');
    assert.equal(r[0].layout, undefined);
    const m = await measurePage(page);
    assert.ok(
      classifyGeometry(m.elements, m.width, m.height).some((f) => f.rule === 'control-overlap'),
    );
  } finally {
    await browser.close();
  }
});

test('popup children are explored after clean replay and delayed Escape settles', async () => {
  const browser = await chromium.launch({ args: ['--renderer-process-limit=2'] });
  try {
    const page = await browser.newPage();
    const html = `<button onclick="document.querySelector('[role=dialog]').hidden=false">open</button><div role="dialog" hidden><button onclick="this.textContent='saved'">child</button></div><script>document.onkeydown=e=>{if(e.key==='Escape')setTimeout(()=>document.querySelector('[role=dialog]').hidden=true,150)}</script>`;
    const reset = () => page.setContent(html);
    await reset();
    const results = await inspectControls(page, { reset });
    assert.equal(results.find((x) => x.label === 'open').status, 'passed');
    assert.equal(results.find((x) => x.label === 'child').status, 'passed');
    assert.ok(!results.some((x) => x.status === 'uncovered'));
  } finally {
    await browser.close();
  }
});

test('selected matched skill is an idempotent choice', async () => {
  const browser = await chromium.launch({ args: ['--renderer-process-limit=2'] });
  try {
    const page = await browser.newPage();
    await page.setContent(
      '<button aria-pressed="true" aria-label="选择匹配技能：数据报告解读">数据报告解读</button>',
    );
    assert.equal(
      (await observeControl(page, (await measurePage(page)).elements[0])).status,
      'idempotent',
    );
  } finally {
    await browser.close();
  }
});

test('browser launch button is not the browser workspace panel', async () => {
  const browser = await chromium.launch({ args: ['--renderer-process-limit=2'] });
  try {
    const page = await browser.newPage();
    await page.setContent('<button aria-label="浏览器工作区">打开浏览器</button>');
    assert.equal((await measurePage(page)).browserPanelVisible, false);
    await page.setContent('<section aria-label="浏览器工作区">panel</section>');
    assert.equal((await measurePage(page)).browserPanelVisible, true);
  } finally {
    await browser.close();
  }
});

test('native modal dialog excludes intentionally covered background controls', async () => {
  const browser = await chromium.launch({ args: ['--renderer-process-limit=2'] });
  try {
    const page = await browser.newPage();
    await page.setContent(
      '<button>background</button><dialog open aria-modal="true" aria-label="Native"><button>inside</button></dialog>',
    );
    const m = await measurePage(page);
    assert.equal(m.elements.find((x) => x.label === 'background').intentionalOverlay, true);
    assert.equal(m.elements.find((x) => x.label === 'inside').scope, 'Native');
  } finally {
    await browser.close();
  }
});

test('closed details hide menu controls until the summary is expanded', async () => {
  const browser = await chromium.launch({ args: ['--renderer-process-limit=2'] });
  try {
    const page = await browser.newPage();
    await page.setContent(
      '<details><summary>menu</summary><div style="position:absolute;display:block"><button>hidden item</button></div></details>',
    );
    assert.ok(!(await measurePage(page)).elements.some((x) => x.tag === 'button'));
    await page.locator('summary').click();
    assert.ok((await measurePage(page)).elements.some((x) => x.label === 'hidden item'));
  } finally {
    await browser.close();
  }
});

test('repeatable batch cloning exercises first and second rows without unbounded recursion', async () => {
  const browser = await chromium.launch({ args: ['--renderer-process-limit=2'] });
  try {
    const page = await browser.newPage();
    const html = `<div role="dialog" aria-label="新建批量任务"><button aria-label="复用任务 1 的步骤和输出" onclick="add()">clone</button></div><script>window.n=1;function add(){n++;const b=document.createElement('button');b.setAttribute('aria-label','复用任务 '+n+' 的步骤和输出');b.textContent='clone';b.onclick=add;document.querySelector('div').append(b)}</script>`;
    const reset = () => page.setContent(html);
    await reset();
    const result = await inspectControls(page, { reset, maxDepth: 4, maxControls: 20 });
    assert.equal(result.filter((x) => x.status === 'passed').length, 2);
    assert.ok(result.some((x) => x.status === 'shared-reference' && x.repeatFamilyKey));
    assert.ok(!result.some((x) => x.status === 'uncovered'));
  } finally {
    await browser.close();
  }
});

test('early noopener popup navigation is fulfilled locally before its frame exists', async () => {
  const browser = await chromium.launch({ args: ['--renderer-process-limit=2'] });
  try {
    const page = await browser.newPage();
    await page.context().route('**/*', async (route) => {
      assert.equal(isPopupNavigation(route.request(), page), true);
      await route.fulfill({ contentType: 'text/html', body: 'local popup target' });
    });
    await page.setContent(
      `<button onclick="window.open('https://popup.example.test/target','_blank','noopener,noreferrer')">open</button>`,
    );
    const result = await observeControl(page, (await measurePage(page)).elements[0]);
    assert.equal(result.status, 'passed');
    assert.deepEqual(result.popupUrls, ['https://popup.example.test/target']);
  } finally {
    await browser.close();
  }
});

test('non-hit-testable disabled control is not occluded by its own parent', async () => {
  const browser = await chromium.launch({ args: ['--renderer-process-limit=2'] });
  try {
    const page = await browser.newPage();
    await page.setContent('<div><button disabled style="pointer-events:none">send</button></div>');
    const m = await measurePage(page);
    assert.equal(m.elements[0].hitBlocked, false);
    assert.ok(
      !classifyGeometry(m.elements, m.width, m.height).some((f) => f.rule === 'control-occluded'),
    );
    await page.setContent(
      '<div style="position:relative"><button>send</button><div style="position:absolute;inset:0">cover</div></div>',
    );
    const covered = await measurePage(page);
    assert.ok(
      classifyGeometry(covered.elements, covered.width, covered.height).some(
        (f) => f.rule === 'control-occluded',
      ),
    );
  } finally {
    await browser.close();
  }
});

test('native fullscreen excludes its intentionally hidden background but checks foreground overlap', async () => {
  const browser = await chromium.launch({ args: ['--renderer-process-limit=2'] });
  try {
    const page = await browser.newPage();
    await page.setContent(
      `<button style="position:absolute;left:-50px;top:400px">background</button><section id="full"><button onclick="document.querySelector('#full').requestFullscreen()">enter</button><button style="position:absolute;left:100px;top:100px">a</button><button style="position:absolute;left:100px;top:100px">b</button></section>`,
    );
    await page.getByText('enter', { exact: true }).click();
    await page.waitForFunction(() => Boolean(document.fullscreenElement), null, { timeout: 2000 });
    const m = await measurePage(page);
    assert.equal(m.elements.find((e) => e.label === 'background').intentionalOverlay, true);
    const findings = classifyGeometry(m.elements, m.width, m.height);
    assert.ok(!findings.some((f) => f.control?.includes('background')));
    assert.ok(findings.some((f) => f.rule === 'control-overlap'));
  } finally {
    await browser.close();
  }
});

test('newest nested portal is audited even when its z-index incorrectly hides it', async () => {
  const browser = await chromium.launch({ args: ['--renderer-process-limit=2'] });
  try {
    const page = await browser.newPage();
    await page.setContent(
      `<button style="position:absolute;left:600px">background</button><div role="dialog" style="position:fixed;inset:100px;background:white;z-index:71"><button>dialog action</button></div><div role="menu" style="position:fixed;left:150px;top:150px;background:white;z-index:50"><button>nested item</button></div>`,
    );
    let m = await measurePage(page);
    assert.equal(m.elements.find((e) => e.label === 'nested item').intentionalOverlay, false);
    assert.equal(m.elements.find((e) => e.label === 'nested item').hitBlocked, true);
    assert.ok(
      classifyGeometry(m.elements, m.width, m.height).some((f) => f.rule === 'control-occluded'),
    );
    await page.locator('[role=menu]').evaluate((e) => {
      e.style.zIndex = '80';
    });
    m = await measurePage(page);
    assert.equal(m.elements.find((e) => e.label === 'nested item').hitBlocked, false);
    assert.equal(m.elements.find((e) => e.label === 'dialog action').intentionalOverlay, true);
    assert.ok(
      !classifyGeometry(m.elements, m.width, m.height).some((f) => f.rule === 'control-occluded'),
    );
  } finally {
    await browser.close();
  }
});

test('hidden native toggles use their visible wrapping or associated label', async () => {
  const browser = await chromium.launch({ args: ['--renderer-process-limit=2'] });
  const page = await browser.newPage();
  try {
    await page.setContent(
      `<style>.sr-only { position:absolute; width:1px; height:1px; padding:0; margin:-1px; overflow:hidden; clip:rect(0,0,0,0); white-space:nowrap; border:0 } label { display:inline-block; padding:12px; background:#ddd }</style><label><input type="checkbox" class="sr-only" aria-label="通知开关">通知开关</label><input type="checkbox" id="external" class="sr-only"><label for="external">选股偏好</label>`,
    );
    const controls = (await measurePage(page)).elements.filter((x) => x.type === 'checkbox');
    assert.equal(controls.length, 2);
    for (const control of controls) {
      assert.equal(control.visuallyHidden, true);
      const result = await observeControl(page, control);
      assert.equal(result.status, 'passed');
      assert.equal(
        await page.locator(`[data-ui-audit-id=${JSON.stringify(control.id)}]`).isChecked(),
        true,
      );
    }
  } finally {
    await browser.close();
  }
});

test('video style current category is idempotent while another category still changes state', async () => {
  const browser = await chromium.launch({ args: ['--renderer-process-limit=2'] });
  const page = await browser.newPage();
  try {
    await page.route('http://127.0.0.1:45678/**', (route) =>
      route.fulfill({
        contentType: 'text/html; charset=utf-8',
        body: `<div role="dialog" aria-label="选择氛围"><button class="border-b-2 text-white" style="border-color:rgb(255,0,97)">氛围<span>风格基调</span></button><button class="border-b-2 text-white/55" onclick="document.querySelector('output').textContent='光感已选择'">光感<span>光线效果</span></button><output></output></div>`,
      }),
    );
    await page.goto('http://127.0.0.1:45678/video');
    const controls = (await measurePage(page)).elements;
    const active = controls.find((x) => x.label.startsWith('氛围'));
    assert.ok(active, JSON.stringify(controls.map((x) => ({ id: x.id, label: x.label }))));
    const inactive = controls.find((x) => x.label.startsWith('光感'));
    assert.equal((await observeControl(page, active)).status, 'idempotent');
    assert.equal((await observeControl(page, inactive)).status, 'passed');
  } finally {
    await browser.close();
  }
});
