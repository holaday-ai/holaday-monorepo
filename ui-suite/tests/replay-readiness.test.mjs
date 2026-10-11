import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import path from 'node:path';
import test from 'node:test';
import {inspectControls,reusableControls,waitForSeedContent} from '../lib/interaction.mjs';
import {measurePage} from '../lib/checks.mjs';
const {chromium}=createRequire(path.resolve('apps/web-workbench/package.json'))('playwright');
test('ancestor replay waits for asynchronously loaded pagination control and fails if it never returns',async()=>{
 const browser=await chromium.launch();try{
 const page=await browser.newPage();
 const html=`<ul><li>第一项</li></ul><button onclick="const li=document.createElement('li');const b=document.createElement('button');b.textContent='查看追加任务';b.onclick=()=>b.textContent='已查看';li.append(b);document.querySelector('ul').append(li)">加载更多</button>`;
 await page.setContent(html);
 const reset=async()=>{await page.setContent('<main>加载任务列表</main>');await page.evaluate(html=>{setTimeout(()=>document.body.innerHTML=html,120)},html)};
 const results=await inspectControls(page,{reset,readinessTimeout:800});
 assert.ok(results.some(x=>x.label==='查看追加任务'&&x.status==='passed'));
 assert.equal(results.some(x=>['failed','uncovered'].includes(x.status)),false);
 await page.setContent(html);
 const failed=await inspectControls(page,{reset:async()=>{await page.setContent('<main>列表始终没有返回</main>')},readinessTimeout:150});
 assert.ok(failed.some(x=>x.status==='uncovered'));
 }finally{await browser.close()}
});
test('failed shared controls are retried instead of copied as successful coverage',async()=>{
 const browser=await chromium.launch();try{
 const page=await browser.newPage();await page.setContent('<aside><button onclick="this.textContent=\'完成\'">操作</button></aside>');
 const c=(await measurePage(page)).elements[0];const shared=new Map([[JSON.stringify([c.scope,c.id]),{reference:'/tasks',referencedStatus:'failed'}]]);
 const results=await inspectControls(page,{shared});
 assert.equal(results[0].status,'passed');
 }finally{await browser.close()}
});

test('canonical aliases cannot reuse failed, uncovered or P1-obscured coverage',()=>{
 assert.equal(reusableControls([{status:'passed'},{status:'disabled'}]),true);
 for(const status of ['failed','uncovered']) {
  assert.equal(reusableControls([{status:'passed'},{status}]),false);
  assert.equal(reusableControls([{status:'shared-reference',referencedStatus:status}]),false);
 }
 assert.equal(reusableControls([{status:'passed',layout:[{severity:'P1'}]}]),false);
 assert.equal(reusableControls([]),false);
});

test('initial scene waits for delayed seed content and rejects permanently absent data',async()=>{
 const browser=await chromium.launch();try{
  const page=await browser.newPage();await page.setContent('<main>加载中</main>');
  await page.evaluate(()=>{setTimeout(()=>{document.querySelector('main').textContent='每日测试计划'},120)});
  await waitForSeedContent(page,'每日测试计划',800);
  assert.equal(await page.getByText('每日测试计划').isVisible(),true);
  await page.setContent('<main>加载中</main>');
  await assert.rejects(()=>waitForSeedContent(page,'每日测试计划',150));
 }finally{await browser.close()}
});
