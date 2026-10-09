import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { verifyAkshareProduction, checkHostAkshare } from './akshare-production-gate.mjs';
const good = { name: 'akshare-mcp-http', pid: 12, pm2_env: { status: 'online', restart_time: 0 } };
function fixture(processes = [good], health = { status: 'ok', adapter_ready: true }) {
 return { readProcessList: async () => JSON.stringify(processes), readHealth: async () => JSON.stringify(health) };
}
test('online process and healthy adapter pass without any mutations', async () => {
 assert.deepEqual(await verifyAkshareProduction(fixture()), { ok: true, pid: 12, restarts: 0 });
});
for (const [label, processes] of [['missing', []], ['stopped', [{...good, pid:0, pm2_env:{status:'stopped',restart_time:0}}]], ['duplicate', [good,good]]]) {
 test(`rejects ${label} even if HTTP would be healthy`, async () => {
  let called=false; const f=fixture(processes);f.readHealth=async()=>{called=true;return '{}';};
  await assert.rejects(verifyAkshareProduction(f), /AKSHARE_PROCESS_UNAVAILABLE/); assert.equal(called,false);
 });
}
for (const health of [{}, {status:'ok',adapter_ready:false}, {status:'error',adapter_ready:true}]) {
 test(`rejects HTTP 200 with unhealthy body ${JSON.stringify(health)}`, async()=>{
  await assert.rejects(verifyAkshareProduction(fixture([good],health)), /AKSHARE_HEALTH_UNAVAILABLE/);
 });
}
test('network and manager failures disclose only stable categories', async()=>{
 for(const key of ['readProcessList','readHealth']){
  const f=fixture();f[key]=async()=>{throw Error('secret-cookie-value');};
  await assert.rejects(verifyAkshareProduction(f), e=>!e.message.includes('secret')&&/^AKSHARE_/.test(e.message));
 }
});
test('process replacement or restart during the health check is rejected',async()=>{
 const f=fixture();let n=0;f.readProcessList=async()=>JSON.stringify([n++?{...good,pid:99}:good]);
 await assert.rejects(verifyAkshareProduction(f),/AKSHARE_PROCESS_CHANGED/);
});

test('host gate rejects redirects and non-200 even with an ok body',async()=>{
 for (const status of ['302','204','503']) {
  await assert.rejects(checkHostAkshare(async(command)=>command==='pm2'?JSON.stringify([good]):JSON.stringify({status:'ok',adapter_ready:true})+'\n'+status),/AKSHARE_HEALTH_UNAVAILABLE/);
 }
});

test('absent PM2 daemon refuses before jlist can create another daemon',async()=>{
 const calls=[];await assert.rejects(checkHostAkshare(async(command)=>{calls.push(command);throw Error('daemon absent');}),/AKSHARE_PROCESS_UNAVAILABLE/);
 assert.deepEqual(calls,['bash']);
});


// Exercise the actual Bash probe; only the root-owned PID file path is redirected
// to a temporary fixture. No PM2 process is started or signalled.
for (const [label, content, passes] of [
 ['newline', String(process.pid)+'\n', true],
 ['no trailing newline', String(process.pid), true],
 ['empty', '', false],
 ['malformed', 'not-a-pid', false],
 ['zero', '0', false],
 ['dead process', '99999999', false],
 ['missing file', null, false],
]) {
 test(`host daemon PID probe handles ${label} and remains fail-closed`, async()=>{
  const directory=await mkdtemp(join(tmpdir(),'holaday-akshare-pid-'));
  const file=join(directory,'pm2.pid');let processReads=0;
  try {
   if(content!==null)await writeFile(file,content);
   const run=promisify(execFile);
   const probe=checkHostAkshare(async(command,args,options)=>{
    if(command==='bash')return (await run(command,[args[0],args[1].replace('/root/.pm2/pm2.pid',"'"+file.replaceAll("'", "'\\''")+"'")],{...options,encoding:'utf8'})).stdout;
    if(command==='pm2'){processReads++;return JSON.stringify([good]);}
    if(command==='curl')return JSON.stringify({status:'ok',adapter_ready:true})+'\n200';
    throw Error('unexpected command');
   });
   if(passes){assert.deepEqual(await probe,{ok:true,pid:12,restarts:0});assert.equal(processReads,2);}
   else{await assert.rejects(probe,/AKSHARE_PROCESS_UNAVAILABLE/);assert.equal(processReads,0);}
  }finally{await rm(directory,{recursive:true,force:true});}
 });
}
