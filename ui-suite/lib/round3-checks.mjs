import assert from 'node:assert/strict';
import path from 'node:path';

/** Product regressions, exercised with normal clicks against the local contract seed. */
export async function round3Checks(page, route, width, out) {
  const checks = [];
  const capture = async (item, suffix = '') => {
    const file = `after-${item}-${width}${suffix}.jpg`;
    await page.screenshot({path:path.join(out,file),animations:'disabled'});
    return file;
  };
  const hit = async locator => {
    await locator.scrollIntoViewIfNeeded();
    await locator.click({trial:true});
  };
  const scroll = async () => {
    await page.locator('.holaday-main').evaluate(e => e.scrollTop = 200);
    await page.waitForTimeout(120);
  };
  if(route === '/skills') {
    await page.getByRole('button',{name:'描述任务',exact:true}).click();
    await page.getByRole('button',{name:/选择技能：/}).click();
    const menu = page.getByRole('menu');
    const option = menu.getByRole('menuitem').filter({hasText:'数据报告解读'});
    await hit(option);
    const z = await menu.evaluate(e=>Number(getComputedStyle(e).zIndex));
    const dialogZ = await page.locator('.hd-catalog-dialog').evaluate(e=>Number(getComputedStyle(e).zIndex));
    assert.ok(z > dialogZ,`menu ${z} must clear dialog ${dialogZ}`);
    const screenshot = await capture(1);
    await page.keyboard.press('Escape');
    await menu.waitFor({state:'hidden'});
    assert.equal(await page.getByRole('menu').count(),0);
    assert.equal(await page.locator('.hd-catalog-dialog').count(),1,'Escape must retain parent dialog');
    await page.getByRole('button',{name:/选择技能：/}).click();await option.click();
    assert.match(await page.getByRole('button',{name:/选择技能：/}).innerText(),/数据报告解读/);
    checks.push({item:1,screenshot});
  }
  if(route === '/settings') {
    const nav=page.getByRole('navigation',{name:'设置分区'});
    for(const name of ['通知','账号']) {
      await nav.getByRole('link',{name,exact:true}).click();await scroll();
      await hit(nav.getByRole('link',{name,exact:true}));
      const box=await nav.boundingBox();const dock=await page.getByTestId('desktop-account-dock').boundingBox();
      assert.ok(box.y>=dock.y+dock.height,`settings nav ${box.y} under dock ${dock.y+dock.height}`);
    }
    // Hash jumps must keep section content below the sticky navigation too.
    for (const [name,id] of [['外观','appearance'],['AI 视角','roles'],['数据区域','model-region'],['API Key','api-keys'],['浏览器数据','browser-data'],['AI 记忆','memory'],['通知','notifications'],['账号','account']]) {
      await nav.getByRole('link',{name,exact:true}).click();
      await page.waitForTimeout(2300);
      const section=await page.locator(`#${id}`).boundingBox();
      const navBox=await nav.boundingBox();
      assert.ok(section.y>=navBox.y+navBox.height+8,`${id} anchor must clear sticky settings nav`);
    }
    checks.push({item:2,screenshot:await capture(2)});
  }
  if(route === '/schedule') {
    await page.getByRole('button',{name:'月',exact:true}).click();await scroll();
    const create=page.getByRole('button',{name:'新建定时任务',exact:true});await hit(create);
    const b=await create.boundingBox();const dock=await page.getByTestId('desktop-account-dock').boundingBox();
    assert.ok(b.y>=dock.y+dock.height,'sticky create button must clear global dock');
    checks.push({item:3,screenshot:await capture(3)});
    await create.click();await page.getByRole('textbox').first().fill('UI audit');
    await page.getByRole('button',{name:'创建',exact:true}).click();
    await page.getByText('UI audit',{exact:true}).first().click();
    await page.getByRole('button',{name:'删除定时任务',exact:true}).click();
    await capture(4,'-open');
    const requests=[];const track=r=>requests.push(r.url());page.on('request',track);
    await page.keyboard.press('Escape');await page.waitForTimeout(120);page.off('request',track);
    assert.equal(await page.getByRole('dialog',{name:'删除定时任务？'}).count(),0,'Escape dismisses confirmation');
    assert.ok(!requests.some(url=>url.includes('scheduledTasks.delete')),'Escape must not delete');
    assert.ok(await page.getByText('UI audit',{exact:true}).count(),'scheduled task retained');
    checks.push({item:4,screenshot:await capture(4)});
  }
  if(route === '/cosmic') {
    const title=page.getByRole('heading',{name:'今日能量',exact:true});const box=await title.boundingBox();
    const dock=await page.getByTestId('desktop-account-dock').boundingBox();
    assert.ok(box.y>=dock.y+dock.height,'energy title must clear shell header');
    const date=await page.getByLabel('今日日期').boundingBox();assert.ok(date.y>=dock.y+dock.height,'date must clear dock');
    checks.push({item:5,screenshot:await capture(5)});
    const summaries=page.locator('.energy-magazine-card > p');
    assert.ok(await summaries.count()>0,'energy cards present');
    await summaries.first().scrollIntoViewIfNeeded();
    const clipped=await summaries.evaluateAll(els=>els.filter(e=>e.scrollHeight>e.clientHeight+1).map(e=>e.textContent));
    assert.deepEqual(clipped,[],'energy descriptions remain readable');
    await capture(5,'-descriptions');
    // Scrollable content must end above the persistent task dock at every scroll position.
    const taskDock=page.getByRole('region',{name:'运行中任务'});
    if(await taskDock.count()) {
      const viewport=await summaries.first().evaluate(e=>{
        for(let parent=e.parentElement;parent;parent=parent.parentElement) {
          if(/auto|scroll/.test(getComputedStyle(parent).overflowY) && parent.scrollHeight>parent.clientHeight) {
            const r=parent.getBoundingClientRect();return {bottom:r.bottom,height:r.height};
          }
        }
        return null;
      });
      const taskDockBox=await taskDock.boundingBox();
      assert.ok(viewport && viewport.height>0 && viewport.bottom<=taskDockBox.y,
        'energy scroll viewport must end above the task dock, so it cannot cover cards');
      for(const button of await page.locator('.energy-page button').filter({hasText:'做一个轻测试'}).all()) await hit(button);
      await capture(5,'-task-dock');
    }

  }
  if (route === '/stocks') {
    await withMissingQuotes(page, async () => {
      assert.equal(await page.locator('.hd-market-breadth').count(),0,'missing quotes must not render empty breadth bars');
      checks.push({item:7,screenshot:await capture(7)});
    });
    await stockSuggestionChecks(page,width,out);
  }
  if (['/video', '/image'].includes(route)) {
    checks.push({item:6,screenshots:await mediaLayoutChecks(page,route,width,out)});
  }
  if (['/planned', '/planned/legacy-batch'].includes(route)) {
    await planningInteractionChecks(page,route,width,out);checks.push({item:3,route});
  }
  return checks;
}

// Exact local tRPC fixture override; normal quotes are restored before generic traversal.
export async function withMissingQuotes(page, run) {
  const origin = new URL(page.url()).origin;
  const handler = async route => {
    const url = new URL(route.request().url());
    if (url.origin !== origin || !url.pathname.includes('stocks.dashboardSnapshot')) return route.fallback();
    const response = await route.fetch();
    const payload = await response.json();
    for (const item of Array.isArray(payload) ? payload : [payload]) {
      const data = item.result?.data;
      if (!data?.watchlistStocks) continue;
      data.watchlistStocks = data.watchlistStocks.map(stock=>({...stock,price:'—',changePct:0,spark:[]}));
      data.marketIndices=[];
      data.temperature=null;
    }
    await route.fulfill({response,json:payload});
  };
  await page.route('**/api/trpc/**',handler);
  try {
    const loaded=page.waitForResponse(r=>r.url().includes('stocks.dashboardSnapshot'));
    await page.reload();await loaded;
    await page.locator('.hd-market-lead').waitFor();
    await page.waitForTimeout(250);
    await run();
  } finally {await page.unroute('**/api/trpc/**',handler);}
}



export async function stockSuggestionChecks(page,width,out) {
  await page.reload();await page.locator('.hd-market-lead').waitFor();
  const summary=page.locator('.hd-stock-quick-research > summary');
  await summary.click();
  const group=page.getByRole('group',{name:'AI 研究建议',exact:true});
  await group.getByRole('button').first().click();await page.waitForTimeout(350);
  const check=async suffix=>{
    await summary.scrollIntoViewIfNeeded();
    await page.screenshot({path:path.join(out,`after-7-${width}-suggestions${suffix}.jpg`),animations:'disabled'});
    const heading=await summary.boundingBox();const fold=await page.locator('.hd-stock-dock-fold').boundingBox();
    for(const button of await group.getByRole('button').all()) {
      const b=await button.boundingBox();
      assert.ok(b.y>=heading.y+heading.height+7,'research suggestions must remain below their summary');
      assert.ok(b.y+b.height<=fold.y+fold.height+1,'expanded suggestions must remain inside the visible composer');
      await button.click({trial:true});
    }
    await summary.click({trial:true});
  };
  await check('');
  await page.getByRole('button',{name:'展开编辑',exact:true}).click();
  await check('-expanded');
  await page.getByRole('button',{name:'收起输入框',exact:true}).click();
  assert.ok((await page.locator('.hd-stock-dock-fold').boundingBox()).height<=1,'collapsed composer must still fold away');
  await page.getByRole('button',{name:'展开输入框',exact:true}).click();
  await check('-reopened');
}

export async function mediaLayoutChecks(page,route,width,out) {
  const screenshots=[];
  const snap=async suffix=>{
    const name=`after-6-${width}-${route.slice(1)}-${suffix}.jpg`;
    await page.screenshot({path:path.join(out,name),animations:'disabled'});screenshots.push(name);
  };
  const noOverlap=async(a,b,label)=>{
    const x=await a.boundingBox(),y=await b.boundingBox();
    assert.ok(x&&y,`${label}: controls must be visible`);
    assert.ok(x.x+x.width<=y.x || y.x+y.width<=x.x || x.y+x.height<=y.y || y.y+y.height<=x.y,`${label}: hit areas must not overlap`);
  };
  if(route==='/video') {
    const card=page.locator('.hd-template-card').filter({hasText:'细节特写'}).first();
    await card.waitFor();
    await card.evaluate(e=>{const main=e.closest('.holaday-main');main.scrollTop+=e.getBoundingClientRect().top-24});
    await page.waitForTimeout(100);
    await snap('header');
    const header=page.locator('.hd-shell-topbar');
    const bg=await header.evaluate(e=>getComputedStyle(e).backgroundColor);
    assert.match(bg,/^rgb\(/,'creative shell header must have an opaque base behind account controls');
    await page.locator('.holaday-main').evaluate(e=>e.scrollTop=0);
    await page.getByRole('tab',{name:'动作复刻',exact:true}).click();
    const slot=page.locator('.hd-media-mode:not([hidden]) .hd-asset-slot').first();
    const choose=page.waitForEvent('filechooser');await slot.click();
    await(await choose).setFiles({name:'ui.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a0u8AAAAASUVORK5CYII=','base64')});
    const remove=page.getByRole('button',{name:'移除主角照片',exact:true});await remove.waitFor();
    await snap('upload');await noOverlap(slot,remove,'uploaded photo and removal');
    await remove.click();assert.equal(await remove.count(),0,'normal removal must clear uploaded photo');
  } else {
    await page.getByRole('tab',{name:'锁定主角',exact:true}).click();
    const prompt=page.getByRole('textbox',{name:'描述你想要的最终画面',exact:true});
    const generate=page.getByRole('button',{name:'准备生成',exact:true});
    await prompt.scrollIntoViewIfNeeded();await snap('composer');
    await noOverlap(prompt,generate,'locked-subject input and generation');
    await prompt.fill('主角保持不变，使用明亮的自然光');
    await noOverlap(prompt,generate,'filled locked-subject input and generation');
    await prompt.evaluate(e=>e.style.height='230px');
    await noOverlap(prompt,generate,'resized locked-subject input and generation');
  }
  return screenshots;
}

export async function planningInteractionChecks(page,route,width,out) {
  if(route==='/planned') {
    const history=page.getByRole('button',{name:'旧任务记录',exact:true});
    await history.click();await page.getByRole('menuitem',{name:'原定时任务',exact:true}).waitFor();
    await page.screenshot({path:path.join(out,`after-3-${width}-legacy-menu.jpg`)});
    await page.keyboard.press('Escape');
    const today=page.getByRole('button',{name:'今天',exact:true});
    assert.ok(await today.isDisabled(),'today is inactive when already on today');
    await page.getByRole('button',{name:'上一个月',exact:true}).click();
    assert.ok(await today.isEnabled(),'today must become available in another month');
    await today.click();assert.ok(await today.isDisabled(),'returning to today restores its state');
  } else {
    await page.getByRole('button',{name:'新建批量任务',exact:true}).click();
    const dialog=page.getByRole('dialog',{name:'新建批量任务',exact:true});
    const header=dialog.locator('button[aria-expanded]').first();
    const goal=dialog.getByPlaceholder('例如：查 OpenAI 最新动态');
    await goal.fill('保留这条任务目标');
    await header.click();
    assert.equal(await header.getAttribute('aria-expanded'),'false','active batch card must collapse');
    assert.ok(await goal.isHidden(),'collapsed card hides editor');
    await page.screenshot({path:path.join(out,`after-4-${width}-batch-collapsed.jpg`)});
    await header.click();assert.equal(await goal.inputValue(),'保留这条任务目标','reopening preserves draft');
  }
}

/** Keep the local text-input helper and activity controls independently usable. */
export async function browserInputOverlayChecks(page, route, width, out) {
  const log = page.getByRole('button', { name: '显示操作日志', exact: true });
  await page.locator('button[data-sidebar="trigger"]').click();
  const takeover = page.getByRole('button', { name: '接管浏览器', exact: true });
  if (await takeover.count()) await takeover.click();
  await page.getByRole('button', { name: '打开文字输入辅助', exact: true }).click();
  const input = page.getByPlaceholder('中文 / 任意文本输入（先点击页面上的输入框获得焦点）');
  const bar = input.locator('..');
  await input.fill('本地输入布局检查');
  await bar.getByRole('button', { name: '发送', exact: true }).click();
  const screenshot = `after-10-${width}-${route.split(':').at(-1)}-input-log.jpg`;
  await page.screenshot({ path: path.join(out, screenshot), animations: 'disabled' });
  const assertAbove = async locator => {
    const [control, text] = await Promise.all([locator.boundingBox(), bar.boundingBox()]);
    assert.ok(control && text && control.y + control.height <= text.y,
      'activity controls must sit above the text input helper');
  };
  await assertAbove(log);
  await log.click();
  const closeLog = page.getByRole('button', { name: '收起操作日志', exact: true });
  await assertAbove(closeLog.locator('../..'));
  await page.screenshot({ path: path.join(out, screenshot.replace('.jpg', '-expanded.jpg')), animations: 'disabled' });
  await closeLog.click();
  await page.getByRole('button', { name: '关闭浮动输入框', exact: true }).click();
  assert.equal(await input.count(), 0, 'closing the helper restores direct input');
  await log.click();
  await closeLog.click();
  return [{ item: 'browser-input-log-clearance', screenshot }];
}

export async function scheduledChoiceChecks(page, width, out) {
  await page.getByRole('button', { name: '打开更多结果操作', exact: true }).click();
  await page.getByRole('menuitem', { name: '设为定时', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '新建定时任务', exact: true });
  for (const [initial, alternative] of [['每天', '每周'], ['不提醒', '30 分钟前']]) {
    const selected = dialog.getByRole('button', { name: initial, exact: true });
    const other = dialog.getByRole('button', { name: alternative, exact: true });
    assert.equal(await selected.getAttribute('aria-pressed'), 'true');
    await other.click();
    assert.equal(await other.getAttribute('aria-pressed'), 'true');
    assert.equal(await selected.getAttribute('aria-pressed'), 'false');
    await selected.click();
    assert.equal(await selected.getAttribute('aria-pressed'), 'true');
    assert.equal(await other.getAttribute('aria-pressed'), 'false');
  }
  const screenshot = `after-4-${width}-schedule-choices.jpg`;
  await page.screenshot({ path: path.join(out, screenshot), animations: 'disabled' });
  return [{ item: 'scheduled-choice-state', screenshot }];
}
