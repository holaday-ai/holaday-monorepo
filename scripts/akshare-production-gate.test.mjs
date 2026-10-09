import assert from 'node:assert/strict';
import { test } from 'node:test';
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
