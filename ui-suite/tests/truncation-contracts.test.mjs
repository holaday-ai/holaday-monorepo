import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import path from 'node:path';
import test from 'node:test';
import {measurePage,classifyGeometry} from '../lib/checks.mjs';
const {chromium}=createRequire(path.resolve('apps/web-workbench/package.json'))('playwright');
test('truncation exemptions require named icon tooltip or marked URL input; text and incomplete contracts still fail',async()=>{
 const browser=await chromium.launch();try{
 const p=await browser.newPage();await p.setContent(`<style>button,input{display:block;width:32px;height:32px;overflow:hidden;white-space:nowrap;margin:8px} .sr{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap}span.bad{display:block;width:30px;overflow:hidden;white-space:nowrap}</style>
 <button data-icon-only="true" aria-label="项目" title="项目"><svg width="16" height="16"></svg><span class="sr">这是隐藏的完整标签</span></button>
 <button data-icon-only="true" aria-label="无提示"><svg width="16" height="16"></svg>很长很长的文字</button>
 <button data-icon-only="true" title="仅有提示">没有可访问标签且文字很长</button>
 <button aria-label="正文按钮">真实按钮文字不应因提示被忽略</button>
 <input aria-label="地址栏" data-browser-address="true" value="https://example.com/a/very/long/url">
 <input aria-label="普通输入" value="这是很长的普通表单内容">
 <input aria-label="非网址" data-browser-address="true" value="这不是网址只是很长的文字">
 <span class="sr">搜索 AI 记忆</span><span class="bad">真实被截的正文</span>`);
 const m=await measurePage(p), f=classifyGeometry(m.elements,1280,720).filter(x=>x.rule==='unexplained-truncation');
 const flagged=label=>f.some(x=>x.control===m.elements.find(x=>x.label===label)?.id);
 assert.equal(flagged('项目'),false);
 for(const label of ['无提示','仅有提示','正文按钮','普通输入','非网址'])assert.equal(flagged(label),true,label);
 assert.equal(flagged('地址栏'),false);
 assert.equal(m.truncatedText.some(x=>x.text==='搜索 AI 记忆'),false);
 assert.equal(m.truncatedText.some(x=>x.text==='真实被截的正文'),true);
 }finally{await browser.close()}
});

test('selected calendar cells require matching aria-selected semantics',async()=>{
 const browser=await chromium.launch();try{
 const page=await browser.newPage();await page.setContent('<table class="fc"><tbody><tr><td class="fc-daygrid-day hd-selected-day" data-date="2026-10-09" aria-selected="true">9</td><td class="fc-daygrid-day hd-selected-day" data-date="2026-10-10">10</td></tr></tbody></table>');
 const m=await measurePage(page);
 assert.equal(m.elements.find(x=>x.label==='9').selectedWithoutSemantics,false);
 assert.equal(m.elements.find(x=>x.label==='10').selectedWithoutSemantics,true);
 }finally{await browser.close()}
});
