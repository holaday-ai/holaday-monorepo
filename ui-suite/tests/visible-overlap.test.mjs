import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import path from 'node:path';
import test from 'node:test';
import {classifyGeometry,measurePage} from '../lib/checks.mjs';
import {inspectControls} from '../lib/interaction.mjs';
const require=createRequire(path.resolve('apps/web-workbench/package.json'));
const {chromium}=require('playwright');
test('clipped-off scroll content is not an overlap, but visible obstruction remains a P1', async()=>{
 const browser=await chromium.launch({args:['--renderer-process-limit=2']});
 try {
  const page=await browser.newPage({viewport:{width:1024,height:768}});
  await page.setContent(`<div style="position:absolute;left:10px;top:10px;width:240px;height:50px;overflow:auto"><button onclick="this.setAttribute('aria-expanded','true')" style="display:block;width:240px;height:80px">详细步骤</button></div><textarea style="position:absolute;left:10px;top:60px;width:240px;height:50px;box-sizing:border-box"></textarea>`);
  const before=await measurePage(page);
  assert.equal(classifyGeometry(before.elements,1024,768).filter(f=>f.rule==='control-overlap').length,0,'invisible clipped-off pixels must not overlap the composer');
  await page.getByRole('button',{name:'详细步骤'}).click();
  assert.equal(await page.getByRole('button',{name:'详细步骤'}).getAttribute('aria-expanded'),'true');
  await page.locator('textarea').evaluate(e=>e.style.top='35px');
  const broken=await measurePage(page);
  assert.ok(classifyGeometry(broken.elements,1024,768).some(f=>f.rule==='control-overlap'&&f.severity==='P1'),'visible obstruction must still fail');
 } finally {await browser.close()}
});

test('scrollable content behind a pinned navigation is clipped, while fixed controls still fail', async()=>{
 const browser=await chromium.launch();
 try {
  const page=await browser.newPage({viewport:{width:1024,height:768}});
  await page.setContent(`<div id="scroll" style="position:absolute;left:10px;top:0;width:240px;height:200px;overflow:auto"><nav style="position:sticky;top:20px;height:40px;z-index:10;background:white"><button style="width:100px;height:40px">导航</button></nav><div style="height:60px"></div><button id="flow" style="width:100px;height:40px" onclick="this.dataset.clicked='yes'">正文</button><div style="height:900px"></div></div>`);
  await page.locator('#scroll').evaluate(e=>e.scrollTop=80);
  const clipped=await measurePage(page);
  assert.equal(classifyGeometry(clipped.elements,1024,768).filter(f=>f.severity==='P1').length,0,'scrollable content underneath the pinned header is outside its visible scroll area');
  await page.locator('#scroll').evaluate(e=>e.scrollTop=0);
  await page.getByRole('button',{name:'正文',exact:true}).click();
  assert.equal(await page.locator('#flow').getAttribute('data-clicked'),'yes');
  await page.locator('#scroll').evaluate(e=>e.scrollTop=80);
  await page.evaluate(()=>{const e=document.createElement('button');e.textContent='固定控件';e.style.cssText='position:fixed;left:10px;top:20px;width:100px;height:40px;z-index:30';document.body.append(e)});
  const blocked=await measurePage(page);
  assert.ok(classifyGeometry(blocked.elements,1024,768).some(f=>f.severity==='P1'),'two fixed/sticky control layers must still fail');
 }finally{await browser.close()}
});

test('a dismissible live notice is an intentional overlay; an undismissible obstruction still fails',async()=>{
 const browser=await chromium.launch();
 try{
  const page=await browser.newPage({viewport:{width:1024,height:768}});
  await page.setContent(`<button id="under" onclick="this.dataset.clicked='yes';this.textContent='已打开'" style="position:absolute;left:10px;top:100px;width:150px;height:40px">正文按钮</button><div aria-live="polite" style="position:fixed;left:10px;top:100px;width:150px;height:40px;z-index:20;background:white"><button aria-label="关闭提示" onclick="this.parentElement.remove()" style="width:150px;height:40px">已保存</button></div>`);
  const covered=await measurePage(page);
  assert.equal(classifyGeometry(covered.elements,1024,768).filter(f=>f.severity==='P1').length,0,'dismissible notification overlay is intentional');
  const results=await inspectControls(page);
  assert.ok(results.some(r=>r.label==='关闭提示' && r.status==='passed'));
  assert.ok(results.some(r=>r.label==='正文按钮' && r.status==='passed'),'underlying control must be traversed after dismissal');
  assert.equal(await page.locator('#under').getAttribute('data-clicked'),'yes');
  await page.evaluate(()=>{const e=document.createElement('div');e.setAttribute('aria-live','polite');e.textContent='不可关闭';e.style.cssText='position:fixed;left:10px;top:100px;width:150px;height:40px;z-index:20;background:white';document.body.append(e)});
  const blocked=await measurePage(page);
  assert.ok(classifyGeometry(blocked.elements,1024,768).some(f=>f.severity==='P1'),'live-region text alone must not exempt an obstruction');
 }finally{await browser.close()}
});
