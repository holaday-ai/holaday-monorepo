import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import path from 'node:path';
import test from 'node:test';
import {measurePage} from '../lib/checks.mjs';
import {observeControl} from '../lib/interaction.mjs';
const require=createRequire(path.resolve('apps/web-workbench/package.json'));
const {chromium}=require('playwright');

test('current page navigation is idempotent, while inactive and disclosure controls must act',async()=>{
  const browser=await chromium.launch();
  try {
    const page=await browser.newPage();
    await page.setContent(`<nav><button aria-current="page">当前页</button><button>其他页</button><button aria-current="page" aria-expanded="false" onclick="this.setAttribute('aria-expanded','true')">项目</button><button aria-current="page" aria-expanded="false">失效展开</button></nav>`);
    const controls=(await measurePage(page)).elements;
    const run=label=>observeControl(page,controls.find(c=>c.label===label),{checkDismissal:false});
    assert.equal((await run('当前页')).status,'idempotent');
    assert.equal((await run('其他页')).status,'failed','inactive dead navigation must still fail');
    assert.equal((await run('项目')).status,'passed','current-page disclosure must still be clicked');
    assert.equal(await page.getByRole('button',{name:'项目',exact:true}).getAttribute('aria-expanded'),'true');
    assert.equal((await run('失效展开')).status,'failed','current-page semantics must not excuse a broken disclosure');
  } finally {await browser.close()}
});
