import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import path from 'node:path';
import test from 'node:test';
import {measurePage} from '../lib/checks.mjs';
import {observeControl} from '../lib/interaction.mjs';
const {chromium}=createRequire(path.resolve('apps/web-workbench/package.json'))('playwright');

test('menu radio choices are discovered and only checked choices without disclosures are idempotent',async()=>{
 const browser=await chromium.launch();try{
  const page=await browser.newPage();await page.setContent(`<div role="menu">
   <div role="menuitemradio" aria-checked="true">Selected</div>
   <div role="menuitemradio" aria-checked="false" onclick="this.setAttribute('aria-checked','true')">Other</div>
   <div role="menuitemradio" aria-checked="false">Dead</div>
   <div role="menuitemradio" aria-checked="true" aria-haspopup="menu">Dead popup</div>
   <div role="menuitem" aria-checked="true">Ordinary dead item</div>
  </div>`);
  const controls=(await measurePage(page)).elements;
  assert.equal(controls.filter(c=>c.role==='menuitemradio').length,4,'all radio menu choices must be scanned');
  const run=label=>observeControl(page,controls.find(c=>c.label===label),{checkDismissal:false});
  assert.equal((await run('Selected')).status,'idempotent');
  assert.equal((await run('Other')).status,'passed');
  for(const label of ['Dead','Dead popup','Ordinary dead item'])assert.equal((await run(label)).status,'failed',label);
 }finally{await browser.close()}
});
