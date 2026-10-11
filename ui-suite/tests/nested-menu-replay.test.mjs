import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import path from 'node:path';
import test from 'node:test';
import {inspectControls} from '../lib/interaction.mjs';
const {chromium}=createRequire(path.resolve('apps/web-workbench/package.json'))('playwright');

test('nested popup dismissal replays from reset instead of clicking its departing parent',async()=>{
 const browser=await chromium.launch();try{
  const page=await browser.newPage();
  const reset=()=>page.setContent(`<button id="root" aria-haspopup="menu" aria-expanded="false" onclick="openRoot()">Options</button><output id="result"></output>
  <script>
   function openRoot(){document.getElementById('root').setAttribute('aria-expanded','true');if(document.getElementById('parent'))return;const parent=document.createElement('div');parent.id='parent';parent.setAttribute('role','menu');parent.innerHTML='<button id="nested" aria-haspopup="menu" aria-expanded="false" onclick="openNested()">Nested</button><button aria-haspopup="menu">Broken</button>';document.body.append(parent)}
   function openNested(){document.getElementById('nested').setAttribute('aria-expanded','true');if(document.getElementById('child'))return;const child=document.createElement('div');child.id='child';child.setAttribute('role','menu');const action=document.createElement('button');action.textContent='Nested action';action.onclick=()=>{document.getElementById('result').textContent='done'};child.append(action);document.getElementById('parent').append(child)}
   document.addEventListener('keydown',event=>{if(event.key!=='Escape')return;document.getElementById('root').setAttribute('aria-expanded','false');const parent=document.getElementById('parent');if(parent){document.getElementById('nested').setAttribute('aria-expanded','false');parent.style.pointerEvents='none';setTimeout(()=>parent.remove(),120)}});
  </script>`);
  await reset();const results=await inspectControls(page,{reset,maxControls:20});
  assert.equal(results.find(c=>c.label==='Nested')?.status,'passed');
  assert.equal(results.find(c=>c.label==='Nested action')?.status,'passed');
  assert.equal(results.find(c=>c.label==='Broken')?.status,'failed','a nonfunctional popup must remain a failure');
  assert.equal(results.some(c=>c.status==='uncovered'),false);
 }finally{await browser.close()}
});
