import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import path from 'node:path';
import test from 'node:test';
import {measurePage} from '../lib/checks.mjs';
import {observeControl} from '../lib/interaction.mjs';
const {chromium}=createRequire(path.resolve('apps/web-workbench/package.json'))('playwright');

test('selected grid cells are idempotent; unselected cells and disclosures must still act',async()=>{
  const browser=await chromium.launch();
  try {
    const page=await browser.newPage();
    await page.setContent(`<table class="fc" role="grid"><tbody><tr>
      <td role="gridcell" class="fc-daygrid-day" data-date="2026-10-09" aria-selected="true">已选日期</td>
      <td role="gridcell" class="fc-daygrid-day" data-date="2026-10-09" aria-selected="false" onclick="this.setAttribute('aria-selected','true')">选择另一日</td>
      <td role="gridcell" class="fc-daygrid-day" data-date="2026-10-09" aria-selected="false">失效日期</td>
      <td role="gridcell" class="fc-daygrid-day" data-date="2026-10-09" aria-selected="true" aria-haspopup="dialog">失效弹窗</td>
      <td role="gridcell" class="fc-daygrid-day" data-date="2026-10-09" aria-selected="true" aria-expanded="false" onclick="this.setAttribute('aria-expanded','true')">展开日期</td>
      <td role="gridcell" class="fc-daygrid-day" data-date="2026-10-09" aria-selected="true" aria-expanded="false">失效展开</td>
    </tr></tbody></table><button aria-selected="true">普通死按钮</button>`);
    const controls=(await measurePage(page)).elements;
    const run=label=>observeControl(page,controls.find(c=>c.label===label),{checkDismissal:false});
    assert.equal((await run('已选日期')).status,'idempotent');
    assert.equal((await run('选择另一日')).status,'passed');
    assert.equal(await page.getByRole('gridcell',{name:'选择另一日',exact:true}).getAttribute('aria-selected'),'true');
    for(const label of ['失效日期','失效弹窗','失效展开','普通死按钮'])assert.equal((await run(label)).status,'failed',label);
    assert.equal((await run('展开日期')).status,'passed');
    assert.equal(await page.getByRole('gridcell',{name:'展开日期',exact:true}).getAttribute('aria-expanded'),'true');
  } finally {await browser.close()}
});
