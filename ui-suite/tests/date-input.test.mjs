import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import path from 'node:path';
import test from 'node:test';
import {measurePage} from '../lib/checks.mjs';
import {observeControl} from '../lib/interaction.mjs';
const require=createRequire(path.resolve('apps/web-workbench/package.json'));
const {chromium}=require('playwright');
test('date traversal changes an already seeded date and still rejects inputs which discard edits',async()=>{
  const browser=await chromium.launch();
  try {
    const page=await browser.newPage();
    await page.setContent(`<input type="date" aria-label="日期" value="2026-10-09"><input type="date" aria-label="失效日期" value="2026-10-09" oninput="this.value='2026-10-09'">`);
    const controls=(await measurePage(page)).elements;
    const run=label=>observeControl(page,controls.find(c=>c.label===label),{checkDismissal:false});
    assert.equal((await run('日期')).status,'passed');
    assert.notEqual(await page.getByLabel('日期',{exact:true}).inputValue(),'2026-10-09');
    assert.equal((await run('失效日期')).status,'failed','discarded edits must still fail');
  } finally {await browser.close()}
});
