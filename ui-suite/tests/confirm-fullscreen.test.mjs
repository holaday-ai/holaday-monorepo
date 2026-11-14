import assert from 'node:assert/strict';
import path from 'node:path';
import {createRequire} from 'node:module';
import test from 'node:test';
const appDir=path.resolve('apps/web-workbench');
const require=createRequire(path.join(appDir,'package.json'));
const {chromium}=require('playwright');
const {build}=createRequire(require.resolve('vite/package.json'))('esbuild');

test('the real confirmation stays visible and dismissible in native fullscreen',async()=>{
  const bundle=await build({stdin:{contents:`
    import React,{useState} from 'react';
    import {createRoot} from 'react-dom/client';
    import {ConfirmDialog} from './src/components/ConfirmDialog';
    function Fixture(){const [open,setOpen]=useState(false);return <main id="stage" style={{background:'white',width:'100%',height:'100vh'}}>
      <button onClick={()=>document.getElementById('stage').requestFullscreen()}>进入全屏</button>
      <button onClick={()=>setOpen(true)}>外部打开</button>
      <ConfirmDialog open={open} title="即将打开外部链接" onClose={()=>setOpen(false)} onConfirm={()=>{document.body.dataset.confirmed='true'}} />
    </main>};createRoot(document.getElementById('root')).render(<Fixture/>);`,resolveDir:appDir,loader:'tsx'},bundle:true,write:false,format:'iife',platform:'browser',jsx:'automatic',alias:{'@':path.join(appDir,'src')},define:{'process.env.NODE_ENV':'"production"'}});
  const browser=await chromium.launch();
  try {
    const page=await browser.newPage({viewport:{width:1024,height:768}});
    await page.route('**/*',route=>route.fulfill({contentType:'text/html',body:`<div id="root"></div><script>${bundle.outputFiles[0].text}</script>`}));
    await page.goto('http://127.0.0.1:12345/fullscreen-confirm-fixture');
    await page.getByRole('button',{name:'进入全屏',exact:true}).click();
    await page.waitForFunction(()=>Boolean(document.fullscreenElement));
    await page.getByRole('button',{name:'外部打开',exact:true}).click();
    const dialog=page.getByRole('dialog');await dialog.waitFor();
    assert.equal(await dialog.evaluate(e=>document.fullscreenElement.contains(e)),true,'a body portal outside the native fullscreen element cannot be seen');
    await dialog.getByRole('button',{name:'取消',exact:true}).click();
    await dialog.waitFor({state:'hidden'});assert.equal(await dialog.count(),0);assert.equal(await page.evaluate(()=>document.body.dataset.confirmed),undefined);
    await page.getByRole('button',{name:'外部打开',exact:true}).click();
    await page.evaluate(()=>document.exitFullscreen());
    await page.waitForFunction(()=>document.querySelector('[role="dialog"]')?.parentElement===document.body);
    await page.keyboard.press('Escape');await dialog.waitFor({state:'hidden'});assert.equal(await dialog.count(),0);
    assert.equal(await page.evaluate(()=>document.body.dataset.confirmed),undefined);
  } finally {await browser.close()}
});
