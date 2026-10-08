import {createRequire} from 'node:module';
import {mkdir,writeFile,symlink} from 'node:fs/promises';
import {pathToFileURL,fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
const repo=process.env.PR1_REPO ?? fileURLToPath(new URL('..',import.meta.url)).replace(/\/$/,'');
const out=process.env.PR1_OUT ?? '/private/tmp/holaday-tasks/browser-pr1';
const o=createRequire(repo+'/apps/orchestrator/package.json'), w=createRequire(repo+'/apps/web-workbench/package.json');
const {chromium}=o('playwright'),{WebSocketServer}=o('ws'),sharp=o('sharp');
const {default:pino}=await import(pathToFileURL(o.resolve('pino')));
const {createServer}=await import(pathToFileURL(w.resolve('vite')));
const {default:react}=await import(pathToFileURL(w.resolve('@vitejs/plugin-react')));
const {CdpStreamer}=await import(repo+'/apps/orchestrator/src/streaming/cdp-streamer.ts');
const {CdpInputHandler}=await import(repo+'/apps/orchestrator/src/streaming/cdp-input.ts');
const {DeferredScreencastInputBridge}=await import(repo+'/apps/orchestrator/src/streaming/screencast-input-bridge.ts');
const {BrowserFrameGuard}=await import(repo+'/apps/orchestrator/src/streaming/browser-viewport-v2.ts');
await mkdir(out+'/harness',{recursive:true});await mkdir(out+'/screens',{recursive:true});
try{await symlink(repo+'/apps/web-workbench/node_modules',out+'/harness/node_modules','dir');}catch{}
await writeFile(out+'/harness/package.json','{"type":"module"}');
await writeFile(out+'/harness/index.html','<!DOCTYPE html><html><body style="margin:0"><div id="root"></div><script type="module" src="/main.jsx"></script></body></html>');
await writeFile(out+'/harness/main.jsx',`import React from 'react';import {createRoot} from 'react-dom/client';
import {CdpScreencastViewport} from '/@fs/${repo}/apps/web-workbench/src/components/CdpScreencastViewport.tsx';
import {VncViewport} from '/@fs/${repo}/apps/web-workbench/src/components/VncViewport.tsx';
import {BrowserPanel} from '/@fs/${repo}/apps/web-workbench/src/components/BrowserPanel.tsx';
import {ToastProvider} from '/@fs/${repo}/apps/web-workbench/src/components/ui/toast.tsx';
import {useTaskStore} from '/@fs/${repo}/apps/web-workbench/src/stores/task-store.ts';
import {installVncPointerPrecisionBridge} from '/@fs/${repo}/apps/web-workbench/src/lib/vnc-pointer-precision.ts';
window.__installVncPrecision=()=>installVncPointerPrecisionBridge(document.querySelector('canvas'));
import '/@fs/${repo}/apps/web-workbench/src/index.css';
const q=new URLSearchParams(location.search);const width=Number(q.get('width')||390),sourceWidth=Number(q.get('source')||1280),v2=q.get('v2')!=='0';
window.__frames=0; window.__ready=false; const profile={width:sourceWidth,height:900};
useTaskStore.setState({tasks:[{taskId:'tsk_fixture',intent:'显示回归',title:null,tickCount:0,status:'executing',executionMode:'browser',createdAt:new Date()}],browserInteractive:false});
createRoot(document.getElementById('root')).render(q.get('parent')==='1'?<ToastProvider><BrowserPanel activeTaskId="tsk_fixture" taskStatus="executing" poolUserId="usr_fixture" layout="sheet" onToggleFullscreen={()=>{}}/></ToastProvider>:<div id="shell" style={{width,height:760,overflow:'hidden',background:'#edf4ff'}}><div id="surface" style={{width:v2||q.get('vnc')==='1'?'100%':'min(1280px, max(100%, 300vw))',height:'100%'}}>{q.get('vnc')==='1'?<VncViewport wsUrl={q.get('ws')} viewportV2={v2} viewOnly={v2} fitMode="contain" onStatusChange={s=>window.__ready=s==='connected'}/>:<CdpScreencastViewport wsUrl={q.get('ws')} streamToken="fixture" viewportV2={v2} desktopViewport={profile} viewOnly={false} controlLease="fixture-lease" fitMode={v2?'contain':'readable'} onFrameReady={()=>window.__frames++}/>}</div></div>);
`);
const wsserver=new WebSocketServer({host:'127.0.0.1',port:0});await new Promise(r=>wsserver.on('listening',r));const wsport=wsserver.address().port;
process.chdir(repo+'/apps/web-workbench');
const vite=await createServer({configFile:false,root:out+'/harness',plugins:[react()],define:{'import.meta.env.VITE_BROWSER_VIEWPORT_V2':'"true"'},resolve:{alias:{'@':repo+'/apps/web-workbench/src'}},css:{postcss:{plugins:[w('tailwindcss')({config:repo+'/apps/web-workbench/tailwind.config.ts'}),w('autoprefixer')()]}},server:{host:'127.0.0.1',port:0,proxy:{'/screencast-ws':{target:'ws://127.0.0.1:'+wsport,ws:true}},fs:{allow:[repo,out]}}});
await vite.listen();const port=vite.httpServer.address().port;
const browser=await chromium.launch({headless:true,args:['--disable-dev-shm-usage','--renderer-process-limit=2']});

let source,streamer,handler,serverWs,latest,received=[],rejected=0;const records=[];let framebufferSize={width:1280,height:900},vncPointers=[];
async function rfbFixture(ws) {
 const {width,height}=framebufferSize;
 const rgb=await sharp({create:{width,height,channels:4,background:'#eef2ff'}}).composite([{input:Buffer.from(`<svg width="${width}" height="${height}"><rect width="${width}" height="${height}" fill="none" stroke="#3957ad" stroke-width="12"/><text x="16" y="65" font-size="32">LEFT</text><text x="${Math.max(110,width-140)}" y="65" font-size="32">RIGHT</text><rect x="80" y="160" width="120" height="80" fill="red"/></svg>`)}]).raw().toBuffer();
 const bgra=Buffer.from(rgb);for(let i=0;i<bgra.length;i+=4){const red=bgra[i];bgra[i]=bgra[i+2];bgra[i+2]=red;}
 let stage=0,buffer=Buffer.alloc(0),sent=false;ws.send(Buffer.from('RFB 003.008\n'));
 ws.on('message',raw=>{buffer=Buffer.concat([buffer,Buffer.from(raw)]);for(;;){
 if(stage===0){if(buffer.length<12)return;buffer=buffer.subarray(12);ws.send(Buffer.from([1,1]));stage++;}
 else if(stage===1){if(buffer.length<1)return;buffer=buffer.subarray(1);ws.send(Buffer.alloc(4));stage++;}
 else if(stage===2){if(buffer.length<1)return;buffer=buffer.subarray(1);const init=Buffer.alloc(24+7);init.writeUInt16BE(width,0);init.writeUInt16BE(height,2);init[4]=32;init[5]=24;init[7]=1;init.writeUInt16BE(255,8);init.writeUInt16BE(255,10);init.writeUInt16BE(255,12);init[14]=16;init[15]=8;init[16]=0;init.writeUInt32BE(7,20);init.write('fixture',24);ws.send(init);stage++;}
 else {if(!buffer.length)return;const type=buffer[0];let len;if(type===0)len=20;else if(type===2){if(buffer.length<4)return;len=4+4*buffer.readUInt16BE(2);}else if(type===3||type===150)len=10;else if(type===5)len=6;else if(type===4)len=8;else if(type===6){if(buffer.length<8)return;len=8+buffer.readUInt32BE(4);}else{buffer=Buffer.alloc(0);return;}if(buffer.length<len)return;
 if(type===5)vncPointers.push({mask:buffer[1],x:buffer.readUInt16BE(2),y:buffer.readUInt16BE(4)});
 buffer=buffer.subarray(len);if(type===3&&!sent){const h=Buffer.alloc(16);h.writeUInt16BE(1,2);h.writeUInt16BE(width,8);h.writeUInt16BE(height,10);ws.send(Buffer.concat([h,bgra]));sent=true;}
 }
 }});
}
wsserver.on('connection',(ws,req)=>{
 if(req.url.startsWith('/rfb')){void rfbFixture(ws);return;}
 serverWs=ws;const currentSource=source;ws.send(JSON.stringify({type:'viewport-v2-ready',controlReady:true}));const guard=new BrowserFrameGuard();
 const currentStreamer=new CdpStreamer({getPage:async()=>currentSource,ws,logger:pino({level:'silent'}),viewportV2:true,onFrame:g=>{latest=g;guard.observe(g);},onObservationInvalidated:()=>{guard.invalidate();if(ws.readyState===1)ws.send(JSON.stringify({type:'observation-invalidated'}));}});
 const currentHandler=new CdpInputHandler(()=>currentStreamer.getSession(),pino({level:'silent'}),()=>currentStreamer.requestFrameRefresh(),undefined,true,async()=>currentSource,2400);
 const bridge=new DeferredScreencastInputBridge({maxViewportHeight:2400,onViewportApplied:v=>{currentStreamer.invalidateObservation();ws.send(JSON.stringify({type:'viewport-applied',...v}));currentStreamer.requestFrameRefresh();},beforeDispatch:async envelope=>{if(envelope.payload.type==='viewport'){currentStreamer.invalidateObservation();return;}if(!guard.validate(envelope.observation))throw new Error('stale');},runOwnedInput:async(_,act)=>act(new AbortController().signal),queueViewport:act=>void act(new AbortController().signal)});
 ws.on('message',raw=>{const m=JSON.parse(String(raw));if(m.type==='observe'){currentStreamer.requestFrameRefresh();return;}if(m.payload)received.push(m.payload);void bridge.receive(String(raw)).catch(()=>{rejected++;});});
 streamer=currentStreamer;
 void currentStreamer.start().then(()=>bridge.attach(currentHandler));ws.on('close',()=>{bridge.detach();void currentStreamer.stop();});
});
async function waitFrame(viewer) {await viewer.waitForFunction(()=>window.__frames>0,null,{timeout:15000});await viewer.waitForSelector('canvas[data-frame-id]',{timeout:15000});await viewer.waitForTimeout(80);}
async function setSource(context,width,zoom=1) {
 source=await context.newPage();await source.setViewportSize({width,height:900});
 await source.setContent(`<style>html{zoom:${zoom}}body{margin:0;background:#eef2ff;font:24px Arial}button,input{font:20px Arial}.edge{position:fixed;top:0;left:0;right:0;height:60px;border:5px solid #3757ad;display:flex;justify-content:space-between}.fixed{position:fixed;right:12px;top:72px;background:#ffd9df;padding:10px}</style><div class=edge><b>LEFT EDGE</b><b>RIGHT EDGE</b></div><button id=target style="position:absolute;left:80px;top:170px;width:100px;height:60px;background:#fa7777">TARGET</button><input id=chinese style="position:absolute;left:20px;top:265px;width:220px;height:45px"><iframe id=frame style="position:absolute;left:20px;top:340px;width:250px;height:110px" srcdoc='<button id=inner style="position:absolute;left:20px;top:15px;width:100px;height:45px">IFRAME</button>'></iframe><button id=fixed class=fixed>FIXED</button><div style="height:1600px;padding-top:650px">LONG PAGE</div>`);
 await source.evaluate(()=>{window.hits=[];document.addEventListener('click',e=>window.hits.push({id:e.target.id,x:e.clientX,y:e.clientY}));});
}
try {
 if(!process.env.PR1_EXTRA_ONLY) for(const dpr of (process.env.PR1_DPR?[Number(process.env.PR1_DPR)]:[1,2])) {
 const ctx=await browser.newContext({deviceScaleFactor:dpr});
 for(const srcWidth of [320,430,1280,1600]) for(const pageZoom of [.8,1,1.25,2]) {
  await setSource(ctx,srcWidth,pageZoom);const viewer=await ctx.newPage();
  for(const panel of [390,430,760,1440]) {
   received=[];await viewer.setViewportSize({width:panel,height:800});
   await viewer.goto(`http://127.0.0.1:${port}/?width=${panel}&source=${srcWidth}&ws=${encodeURIComponent('ws://127.0.0.1:'+wsport+'/cdp')}`);await waitFrame(viewer);
   const dims=await viewer.evaluate(()=>{const s=document.querySelector('#shell'),c=document.querySelector('canvas'),r=c.getBoundingClientRect();return {host:s.clientWidth,scroll:s.scrollWidth,rect:{x:r.x,y:r.y,width:r.width,height:r.height},image:{width:c.width,height:c.height}};});
   assert.equal(dims.scroll,dims.host);assert(dims.rect.x>=-.01&&dims.rect.x+dims.rect.width<=panel+.01);
   const box=await source.locator('#target').boundingBox();const target={x:box.x+box.width/2,y:box.y+box.height/2};
   const hitsBefore=await source.evaluate(()=>window.hits.length);
   await viewer.mouse.click(dims.rect.x+dims.rect.width*target.x/srcWidth,dims.rect.y+dims.rect.height*target.y/900);
   await viewer.waitForTimeout(90);const down=received.filter(x=>x.type==='mouseDown').at(-1);if(!down){await viewer.screenshot({path:out+'/screens/failure.png'});console.log(JSON.stringify({dims,latest,received,rejected}));}assert(down,`missing click ${panel}/${srcWidth}/${pageZoom}/${dpr}`);
   const error=Math.max(Math.abs(down.x-target.x),Math.abs(down.y-target.y));if(error>2)console.log(JSON.stringify({panel,srcWidth,pageZoom,dpr,error,down,target,dims}));assert(error<=2,`error ${error}`);
   assert.equal(await source.evaluate(()=>window.hits.length),hitsBefore+1);assert.equal((await source.evaluate(()=>window.hits.at(-1)))?.id,'target');
   const actualDpr=await source.evaluate(()=>window.devicePixelRatio);if(actualDpr!==dpr)console.log(JSON.stringify({panel,srcWidth,pageZoom,dpr,actualDpr,received,latest}));assert.equal(actualDpr,dpr);
   const name=`cdp-panel${panel}-source${srcWidth}-dpr${dpr}-page-content-zoom${pageZoom*100}.png`;
   await viewer.screenshot({path:out+'/screens/'+name});records.push({transport:'CDP',panel,srcWidth,dpr,pageContentZoom:pageZoom,actualDpr,error,image:dims.image,frame:{...latest,frameId:'redacted-local-frame',tabId:'local-fixture'}});
   await streamer.stop();
  }
  await viewer.close();await source.close();
 }
 await ctx.close();
 }
 // Actual compositor pageScaleFactor (pinch), independently of CSS content zoom.
 if(!process.env.PR1_EXTRA_ONLY) {
 const ctx=await browser.newContext();await setSource(ctx,1600,1);const viewer=await ctx.newPage();await viewer.setViewportSize({width:430,height:800});
 await viewer.goto(`http://127.0.0.1:${port}/?width=430&source=1600&ws=${encodeURIComponent('ws://127.0.0.1:'+wsport+'/cdp')}`);await waitFrame(viewer);
 for(const scale of [1.25,2]) {
  const c=await source.context().newCDPSession(source);await c.send('Emulation.setPageScaleFactor',{pageScaleFactor:scale});await c.detach();
  streamer.requestFrameRefresh();await viewer.waitForTimeout(500);assert.equal(latest.pageScaleFactor,scale);
  const r=await viewer.locator('canvas').boundingBox();const box=await source.locator('#target').boundingBox();const x=box.x+box.width/2,y=box.y+box.height/2;
  received=[];await viewer.mouse.click(r.x+r.width*x*scale/1600,r.y+r.height*y*scale/900);await viewer.waitForTimeout(150);
  const down=received.find(m=>m.type==='mouseDown');assert(down);assert(Math.abs(down.x-x)<=2&&Math.abs(down.y-y)<=2);assert.equal((await source.evaluate(()=>window.hits.at(-1))).id,'target');
  records.push({transport:'CDP',compositorPageScale:scale,error:Math.max(Math.abs(down.x-x),Math.abs(down.y-y))});
 }
 // Chinese insertion, fixed overlay and iframe through the same real handler.
 let c=await source.context().newCDPSession(source);await c.send('Emulation.setPageScaleFactor',{pageScaleFactor:1});await c.detach();streamer.requestFrameRefresh();await viewer.waitForTimeout(400);
 async function clickRemote(x,y){streamer.requestFrameRefresh();await viewer.waitForTimeout(260);const r=await viewer.locator('canvas').boundingBox();await viewer.mouse.click(r.x+r.width*x/1600,r.y+r.height*y/900);await viewer.waitForTimeout(150);}
 await clickRemote(100,287);await viewer.locator('input[aria-hidden="true"]').evaluate(el=>{el.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}));el.dispatchEvent(new CompositionEvent('compositionend',{data:'中文输入正常',bubbles:true}));});await viewer.waitForTimeout(150);assert.equal(await source.locator('#chinese').inputValue(),'中文输入正常');
 const fixed=await source.locator('#fixed').boundingBox();await clickRemote(fixed.x+fixed.width/2,fixed.y+fixed.height/2);assert.equal((await source.evaluate(()=>window.hits.at(-1))).id,'fixed');
 const inner=await source.frameLocator('#frame').locator('#inner').boundingBox();await clickRemote(inner.x+inner.width/2,inner.y+inner.height/2);assert(await source.frameLocator('#frame').locator('#inner').evaluate(el=>el===document.activeElement));
 records.push({chinese:true,fixed:true,iframe:true});
 // Local original/zoom/pan controls preserve the remote viewport.
 await viewer.getByRole('button',{name:'100%',exact:true}).click();await viewer.getByRole('button',{name:'放大',exact:true}).click();await viewer.getByRole('button',{name:'平移画面',exact:true}).click();await viewer.getByRole('menuitem',{name:'平移画面右',exact:true}).click();await viewer.screenshot({path:out+'/screens/cdp-local-zoom-pan.png'});assert(!received.some(m=>m.type==='viewport'&&m.width!==1600));
 await viewer.getByRole('button',{name:'适应',exact:true}).click();await viewer.getByRole('button',{name:'网页显示模式'}).click();await viewer.getByRole('menuitem',{name:'按面板宽度渲染',exact:true}).click();await viewer.waitForTimeout(700);assert(received.some(m=>m.type==='viewport'&&m.width===430));
 records.push({explicitPanelRendering:true,localPanZoom:true});
 await streamer.stop();await viewer.close();await source.close();await ctx.close();
 }
 // Real noVNC against a synthetic raw RFB framebuffer, not a CDP transform.
 if(!process.env.PR1_EXTRA_ONLY) for(const dpr of [1,2]){const context=await browser.newContext({deviceScaleFactor:dpr});const v=await context.newPage();for(const width of [320,430,1280,1600])for(const panel of [390,430,760,1440]){
  framebufferSize={width,height:900};vncPointers=[];await v.setViewportSize({width:panel,height:800});await v.goto(`http://127.0.0.1:${port}/?width=${panel}&vnc=1&v2=0&ws=${encodeURIComponent('ws://127.0.0.1:'+wsport+'/rfb')}`);await v.waitForFunction(()=>window.__ready,null,{timeout:15000});await v.waitForTimeout(200);
  await v.evaluate(()=>window.__installVncPrecision());const r=await v.locator('canvas').boundingBox();await v.mouse.click(r.x+r.width*130/width,r.y+r.height*200/900);await v.waitForTimeout(100);const point=vncPointers.find(p=>p.mask===1);assert(point,'RFB pointer missing');const error=Math.max(Math.abs(point.x-130),Math.abs(point.y-200));if(error>2)console.log(JSON.stringify({panel,width,dpr,error,point,r}));assert(error<=2);
  records.push({transport:'VNC',panel,framebufferWidth:width,dpr,error});await v.screenshot({path:out+`/screens/vnc-panel${panel}-fb${width}-dpr${dpr}.png`});
 }await v.close();await context.close();}

 // Actual BrowserPanel: portrait coverage, toolbar layout, mode and ACK flow.
 const portraitDpr=Number(process.env.PR1_PORTRAIT_DPR ?? 1);
 const parentContext=await browser.newContext({hasTouch:true,deviceScaleFactor:portraitDpr});
 await setSource(parentContext,1280,1);const parentViewer=await parentContext.newPage();
 await parentViewer.addInitScript(()=>localStorage.setItem('holaday.access_token','local-fixture'));
 await parentViewer.route('**/api/**', async route=>{
  if(route.request().url().includes('/stream-token'))return route.fulfill({json:{token:'local-fixture'}});
  const paths=new URL(route.request().url()).pathname.split('/').at(-1).split(',');
  return route.fulfill({json:paths.map(()=>({result:{data:{taskId:'tsk_fixture',phase:'agent',lease:null,supported:true,error:null,mode:'running'}}}))});
 });
 for(const [panel,height] of [[390,844],[430,932],[760,1100]]) {
  await parentViewer.setViewportSize({width:panel,height});
  await parentViewer.goto(`http://127.0.0.1:${port}/?parent=1`);
  await parentViewer.waitForSelector('canvas[data-frame-id]',{timeout:15000});
  const bounds=await parentViewer.evaluate(()=>{
   const c=document.querySelector('canvas'),rect=c.getBoundingClientRect(),host=c.closest('.cdp-screencast-host'),toolbar=document.querySelector('[role="toolbar"][aria-label="画面工具栏"]'),tr=toolbar.getBoundingClientRect();
   const br=toolbar.querySelector('button').getBoundingClientRect(),surface=toolbar.parentElement;
   const section=c.closest('section'),sr=section.getBoundingClientRect();
   return {bodyWidth:document.documentElement.clientWidth,bodyScrollWidth:document.documentElement.scrollWidth,hostWidth:host.clientWidth,hostHeight:host.clientHeight,hostScrollWidth:host.scrollWidth,frameLeft:rect.left,frameRight:rect.right,frameTop:rect.top,frameBottom:rect.bottom,coverage:rect.width*rect.height/(host.clientWidth*host.clientHeight),coverageIncludingToolbar:rect.width*rect.height/(surface.clientWidth*surface.clientHeight),fullPanelCoverage:rect.width*rect.height/(sr.width*sr.height),toolbarBottom:tr.bottom,toolbarHeight:tr.height,toolbarWidth:toolbar.clientWidth,toolbarScrollWidth:toolbar.scrollWidth,buttonHeight:br.height,checkboxes:toolbar.querySelectorAll('input[type="checkbox"]').length};
  });
  assert.equal(bounds.bodyWidth,bounds.bodyScrollWidth);assert.equal(bounds.hostWidth,bounds.hostScrollWidth);assert(bounds.frameLeft>=0&&bounds.frameRight<=panel);
  assert(bounds.coverage>=.85,`portrait coverage ${panel}: ${bounds.coverage}`);assert(bounds.coverageIncludingToolbar>=.85);assert(bounds.fullPanelCoverage>=.85,`full panel coverage ${panel}: ${bounds.fullPanelCoverage}`);assert.equal(bounds.toolbarWidth,bounds.toolbarScrollWidth);assert(bounds.toolbarBottom<=bounds.frameTop+.1);assert(bounds.toolbarHeight<=42);assert(bounds.buttonHeight<=30);assert.equal(bounds.checkboxes,0);
  assert.equal(latest.cssWidth,1024);assert(latest.cssHeight<=2400);
  const active=parentViewer.getByRole('button',{name:'适应',exact:true});assert.equal(await active.getAttribute('aria-pressed'),'true');
  assert.equal(await active.evaluate(e=>getComputedStyle(e).backgroundColor),'rgb(255, 0, 97)');
  await parentViewer.screenshot({path:out+`/screens/portrait-fix-${panel}.png`});
  if(panel===390)await parentViewer.getByRole('toolbar',{name:'画面工具栏'}).screenshot({path:out+'/screens/toolbar-fix-closeup.png'});
  assert.equal(await source.evaluate(()=>window.devicePixelRatio),portraitDpr);
  records.push({portraitFix:true,panel,height,dpr:portraitDpr,remoteWidth:latest.cssWidth,remoteHeight:latest.cssHeight,...bounds});
  // Manual desktop-width fallback must preserve a confirmed matching frame.
  await parentViewer.getByRole('button',{name:'网页显示模式'}).click();await parentViewer.getByRole('menuitem',{name:'桌面宽度 1280',exact:true}).click();
  const deadline=Date.now()+15000;while(latest.cssWidth!==1280&&Date.now()<deadline)await new Promise(r=>setTimeout(r,25));assert.equal(latest.cssWidth,1280);
  // Screencast JPEG dimensions are authoritative and need not equal CSS×DPR.
  const confirmed=latest;
  await parentViewer.waitForFunction(g=>{const c=document.querySelector('canvas');return c?.dataset.frameId?.startsWith(`${g.tabId}:${g.viewportRevision}:`)&&c.width===g.imageWidth&&c.height===g.imageHeight;},confirmed,{timeout:15000});
  await streamer.stop();
 }
 await parentViewer.close();await source.close();await parentContext.close();
 await writeFile(out+(process.env.PR1_EXTRA_ONLY?'/extra-acceptance.json':'/acceptance.json'),JSON.stringify({scope:'Local actual Chromium/CDP/component plus synthetic RFB with actual noVNC; no production or account validation',records,rejected},null,2));
 console.log(JSON.stringify({cases:records.length,cdp:records.filter(r=>r.transport==='CDP').length,vnc:records.filter(r=>r.transport==='VNC').length,maxError:Math.max(...records.map(r=>r.error||0))}));
} finally {await streamer?.stop();await browser.close();await vite.close();for(const ws of wsserver.clients)ws.terminate();await new Promise(r=>wsserver.close(r));}
