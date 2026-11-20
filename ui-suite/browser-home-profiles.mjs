/** Built Home UI -> actual Home router/Vault -> real Chromium state. All sites/auth/storage are synthetic. */
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { defaultBrowserNetworkPolicy } from '../apps/orchestrator/src/agent/browser-network-policy.js';
import { browserHomeSessions } from '../apps/orchestrator/src/browser-home/browser-home-session.js';
import { TestKeyProvider } from '../apps/orchestrator/src/browser-session-vault/crypto.js';
import { createVaultRuntime, installVaultRuntime } from '../apps/orchestrator/src/browser-session-vault/runtime.js';
import { MemoryVaultStore } from '../apps/orchestrator/src/browser-session-vault/vault.js';
import { env } from '../apps/orchestrator/src/config/env.js';
import { createScreencastProxy } from '../apps/orchestrator/src/streaming/screencast-proxy.js';
import { browserHomeRouter } from '../apps/orchestrator/src/trpc/routers/browser-home.js';
import { startSeedServer } from './lib/server.mjs';

const require = createRequire(new URL('../apps/orchestrator/package.json', import.meta.url));
const { chromium } = require('playwright');
const { pino } = require('pino');
const output = process.argv[2];
if (!output) throw new Error('output directory required');
await mkdir(output, { recursive: true });
const ORIGIN = 'https://fixture.test';
const OWNER = 'usr_ui';
const CAPS = { viewportV2:true, collaborationV2:true, observationV2:false, routingV2:false, replayV1:false };
const logger = pino({ level:'silent' });
env.BROWSER_HOME_ENABLED=true; env.BROWSER_HOME_ALLOWLIST=''; env.BROWSER_HOME_PROFILE_V1=true;
const oldCheck=defaultBrowserNetworkPolicy.check;
defaultBrowserNetworkPolicy.check=async (url)=>new URL(url).origin === ORIGIN ? { allowed:true,url,addresses:['1.1.1.1'] } : { allowed:false,reason:'private_network',message:'Synthetic site only' };
const seed=await startSeedServer(fileURLToPath(new URL('../apps/web-workbench',import.meta.url)));
const browser=await chromium.launch({ args:['--renderer-process-limit=2'] });
const instances=new Map();
let runtime;
let allowSeed=true;
let allocations=0;
const preparedPages=new WeakSet();
const setupPage=async (page)=>{
  if(preparedPages.has(page))return;
  preparedPages.add(page);
  await page.setViewportSize({width:1280,height:800});
  await page.route('**/*',async (route)=>{
    if(new URL(route.request().url()).origin !== ORIGIN)return route.abort();
    const init=allowSeed ? "document.cookie='sid=SYNTHETIC_SAVED_IDENTITY; path=/; SameSite=Lax; Secure';localStorage.setItem('account','SYNTHETIC_PRIVATE_SETTING');" : '';
    return route.fulfill({contentType:'text/html',body:`<!doctype html><meta charset="utf-8"><style>body{font:24px sans-serif;padding:40px}</style><h1>个人浏览器状态验证</h1><script>${init}document.body.insertAdjacentHTML('beforeend','<p id="identity">'+(document.cookie.includes('sid=SYNTHETIC_SAVED_IDENTITY')?'已恢复模拟账号':'无模拟登录状态')+'</p><p id="storage">'+(localStorage.getItem('account')==='SYNTHETIC_PRIVATE_SETTING'?'已恢复模拟设置':'无模拟设置')+'</p>')</script>`});
  });
};
const pool={
  allocate:async(taskId,userId,_viewport,session)=>{
    allocations++;
    let context=await browser.newContext();
    let interrupted=false;
    const executor={
      getPage:async()=>{ if(interrupted)throw new Error('session interrupted');const page=context.pages()[0]??await context.newPage();await setupPage(page);return page; },
      navigate:async(page,url)=>{await page.goto(url);return {ok:true};},
      createSessionVaultContext:async(config)=>{await context.close();context=await browser.newContext(config);return context;},
      markSessionInterrupted:()=>{interrupted=true;},
    };
    const activeRuntime=runtime;
    await activeRuntime.prepare(userId,executor,session);
    const instance={taskId,userId,executor,status:'ready',createdAt:Date.now(),lastActiveAt:Date.now(),index:allocations,
      capabilities:CAPS,sessionPolicy:session?.sessionPolicy,cloudProfileId:session?.cloudProfileId,
      context:()=>context,vaultRuntime:activeRuntime};
    instances.set(taskId,instance);return instance;
  },
  peek:(id)=>instances.get(id)??null,
  browserHomeHolder:()=>null,
  peekBrowserHome:(id)=>instances.get(`bhs_${id}`)??null,
  endBrowserHomeLoan:()=>null,
  touch:(id)=>{const inst=instances.get(id);if(inst)inst.lastActiveAt=Date.now();},
  setIdleTimeout:(id,ms)=>{const inst=instances.get(id);if(inst)inst.idleTimeoutMs=ms;return !!inst;},
  release:async(id)=>{const inst=instances.get(id);if(!inst)return false;inst.status='draining';instances.delete(id);await inst.vaultRuntime.finish(inst.executor);await inst.context().close();inst.status='dead';return true;},
};
const server=createServer();
const proxy=createScreencastProxy({pool,logger,authenticateToken:async()=>OWNER,
  beforeViewportAction:async(instance,envelope)=>({request:{taskId:instance.taskId,runId:'profile-ui-fixture',actor:'human',lane:'cdp',tabId:envelope.observation.tabId,origin:ORIGIN,observationRevision:envelope.observation.viewportRevision,actionDigest:'fixture'},decision:{kind:'allow',sensitive:false}}),
});
server.on('upgrade',proxy.handleUpgrade);server.listen(0,'127.0.0.1');await once(server,'listening');
const streamOrigin=`ws://127.0.0.1:${server.address().port}`;
const query={from:()=>query,where:()=>query,limit:async()=>[{modelDataRegion:'intl'}]};
const caller=(owner)=>browserHomeRouter.createCaller({userId:owner,db:{select:()=>query},logger,browserPool:pool});
const results=[];
let trial={dropResponse:false,savePosts:0,requestIds:[],closes:[]};
// A real HTTP boundary is necessary for unload keepalive; browser request interception can
// cancel its callback as the old document disappears and would falsify this lifecycle check.
const gateway=createServer(async(req,res)=>{
  try{
    const url=new URL(req.url,'http://127.0.0.1');
    if(!url.pathname.startsWith('/api/trpc/')){
      const response=await fetch(seed.origin+url.pathname+url.search);
      res.writeHead(response.status,Object.fromEntries([...response.headers].filter(([key])=>!['content-length','transfer-encoding','connection'].includes(key))));
      res.end(Buffer.from(await response.arrayBuffer()));return;
    }
    let bytes='';for await(const chunk of req){bytes+=chunk;if(bytes.length>65536)throw new Error('fixture input too large');}
    const names=decodeURIComponent(url.pathname.slice('/api/trpc/'.length)).split(',');
    if(!names.some(name=>name==='auth.me'||name.startsWith('browserHome.'))){
      const response=await fetch(seed.origin+url.pathname+url.search,{method:req.method,headers:{'content-type':'application/json'},...(req.method==='POST'?{body:bytes}: {})});
      res.writeHead(response.status,{'content-type':'application/json'});res.end(await response.text());return;
    }
    const owner=req.headers.authorization==='Bearer profile-ui-seed'?OWNER:'usr_other_fixture';
    const inputs=JSON.parse(req.method==='POST'?(bytes||'{}'):(url.searchParams.get('input')||'{}'));
    let original=[];
    if(names.some(name=>!name.startsWith('browserHome.'))){
      const response=await fetch(seed.origin+url.pathname+url.search,{method:req.method,headers:{'content-type':'application/json'},...(req.method==='POST'?{body:bytes}: {})});
      const raw=await response.json();original=Array.isArray(raw)?raw:[raw];
    }
    const data=[];
    for(const [index,name]of names.entries()){
      if(name==='auth.me'){data.push({result:{data:{...original[index]?.result?.data,userId:owner,browserHomeEnabled:true,browserHomeProfilesEnabled:true}}});continue;}
      if(!name.startsWith('browserHome.')){data.push(original[index]);continue;}
      const body=url.searchParams.has('batch')?inputs[index]:inputs;
      try{
        const input=body?.json??body;
        if(name==='browserHome.saveProfile'){trial.savePosts++;trial.requestIds.push(input.requestId);}
        const value=await caller(owner)[name.slice('browserHome.'.length)](input);
        if(name==='browserHome.close')trial.closes.push({viewerId:input?.viewerId,released:value.released});
        if(name==='browserHome.saveProfile'&&trial.dropResponse){trial.dropResponse=false;res.writeHead(200,{'content-type':'application/json'});res.end('{"incomplete":');return;}
        data.push({result:{data:value}});
      }catch(error){data.push({error:{message:error.message,code:-32012,data:{code:error.code??'INTERNAL_SERVER_ERROR',httpStatus:412,path:name}}});}
    }
    res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(url.searchParams.has('batch')?data:data[0]));
  }catch(error){res.writeHead(500,{'content-type':'application/json'});res.end(JSON.stringify({error:'synthetic gateway failed',message:error.message}));}
});
gateway.listen(0,'127.0.0.1');await once(gateway,'listening');
const appOrigin=`http://127.0.0.1:${gateway.address().port}`;

try{
  for(const viewport of [{width:1440,height:900},{width:390,height:844}].filter(value=>!process.argv[3]||value.width===Number(process.argv[3]))){
    const store=new MemoryVaultStore();
    runtime=createVaultRuntime({importEnabled:false,profileEnabled:false,cloudHomeEnabled:true,keys:new TestKeyProvider(),store});installVaultRuntime(runtime);
    allowSeed=true;
    trial={dropResponse:viewport.width===1440,savePosts:0,requestIds:[],closes:[]};
    const context=await browser.newContext({viewport});
    const page=await context.newPage();
    const errors=[];page.on('pageerror',(err)=>errors.push(err.message));
    await context.addInitScript(({streamOrigin,seedOrigin})=>{
      localStorage.setItem('holaday.access_token','profile-ui-seed');localStorage.setItem('holaday-theme','light');
      const Socket=window.WebSocket;
      window.WebSocket=class extends Socket{constructor(url,protocols){const parsed=new URL(url,location.href);super(parsed.pathname.startsWith('/screencast-ws/')?streamOrigin+parsed.pathname+parsed.search:parsed.pathname==='/ws'?seedOrigin.replace('http:','ws:')+parsed.pathname+parsed.search:url,protocols);}};
    },{streamOrigin,seedOrigin:seed.origin});
    try{
      await page.goto(`${appOrigin}/browser`);
      const address=page.getByRole('textbox',{name:/云浏览器地址栏/});await address.fill(ORIGIN);await address.press('Enter');
      await page.waitForFunction(()=>Boolean(document.querySelector('canvas')?.dataset.frameId));
      await page.getByRole('button',{name:'已保存的网站',exact:true}).click();
      await page.getByRole('button',{name:'保存当前站点',exact:true}).waitFor();
      assert(await page.getByRole('button',{name:'保存当前站点',exact:true}).isDisabled());
      await page.getByLabel(/我同意保存/).check();
      await page.getByRole('button',{name:'保存当前站点',exact:true}).click();
      if(viewport.width===1440){
        await page.getByRole('button',{name:'核对保存结果',exact:true}).waitFor();
        assert.equal(await page.evaluate(()=>Object.keys(localStorage).filter(key=>key.startsWith('holaday.home-profile-save.v1.')).length),1);
        await page.reload();await page.getByRole('button',{name:'已保存的网站',exact:true}).click();
      }
      await page.getByText(`已保存 ${ORIGIN}。`,{exact:true}).waitFor();
      await page.getByText('下次打开时使用',{exact:true}).waitFor();
      assert.equal(trial.savePosts,1);
      assert.equal(await page.evaluate(()=>Object.keys(localStorage).filter(key=>key.startsWith('holaday.home-profile-save.v1.')).length),0);
      const rows=await store.dump(OWNER);
      assert.equal(rows.grants.filter(grant=>grant.status==='connected').length,1);
      assert(!JSON.stringify(rows).includes('SYNTHETIC_PRIVATE_SETTING'));
      const selected=(await runtime.vault.cloudHomeSettings(OWNER)).selectedProfileId;assert(selected);
      await page.waitForFunction(()=>{const box=document.querySelector('[role=dialog]')?.getBoundingClientRect();return box&&box.right<=innerWidth+1&&box.left>=0&&box.width>=300;});
      assert.equal(await page.getByText(/任务执行出错/).count(),0,'unexpected task error in profile dialog');
      const shot=`${output}/profiles-${viewport.width}.png`;await page.screenshot({path:shot});
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
      await page.getByRole('button',{name:'Close',exact:true}).click();
      // A real full-page departure must release its exact viewer, including after a reload.
      await page.goto(appOrigin+'/');
      await page.waitForURL(appOrigin+'/');
      await page.waitForFunction(()=>location.pathname==='/');
      const deadline=Date.now()+8000;while(instances.has(`bhs_${OWNER}`)){if(Date.now()>deadline)throw new Error('Home leave did not release actual context: '+JSON.stringify(trial.closes));await new Promise(resolve=>setTimeout(resolve,50));}
      allowSeed=false;
      await page.goto(`${appOrigin}/browser`);
      await page.waitForFunction(()=>Boolean(document.querySelector('canvas')?.dataset.frameId));
      const restored=instances.get(`bhs_${OWNER}`);assert.equal(restored?.cloudProfileId,selected);
      const remote=await restored.executor.getPage();
      assert.equal(await remote.locator('#identity').textContent(),'已恢复模拟账号');
      assert.equal(await remote.locator('#storage').textContent(),'已恢复模拟设置');
      assert((await restored.context().cookies(ORIGIN)).some(cookie=>cookie.value==='SYNTHETIC_SAVED_IDENTITY'));
      assert.equal(trial.savePosts,1);
      results.push({viewport,saved:true,lostResponseRecovered:viewport.width===1440,savePosts:trial.savePosts,closeReceipts:trial.closes,restoredCookie:true,restoredLocalStorage:true,noHorizontalOverflow:true,pageErrors:errors,screenshot:shot});
      assert.deepEqual(errors,[]);
    }catch(error){
      await writeFile(`${output}/failure-${viewport.width}.json`,JSON.stringify({message:error.message,trial,pending:await page.evaluate(()=>Object.keys(localStorage).filter(key=>key.startsWith('holaday.home-profile-save.v1.')).map(key=>JSON.parse(localStorage.getItem(key)))),dialog:await page.locator('[role=dialog]').innerText().catch(()=>null)},null,2));
      await page.screenshot({path:`${output}/failure-${viewport.width}.png`}).catch(()=>{});throw error;
    }finally{await context.close();await browserHomeSessions.close(pool,OWNER);await runtime.vault.clear(OWNER);}
  }
  await writeFile(`${output}/results.json`,JSON.stringify({scope:'built actual UI and router/Vault with real synthetic Chromium; SQL/auth/process/KMS boundaries doubled; not real website login, OS input, model or production acceptance',results},null,2));
  console.log(JSON.stringify({passed:results.length,results}));
}finally{
  installVaultRuntime(undefined);defaultBrowserNetworkPolicy.check=oldCheck;
  for(const id of [...instances.keys()])await pool.release(id);
  await browser.close();await seed.close();gateway.closeAllConnections();await new Promise(resolve=>gateway.close(resolve));server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
}
