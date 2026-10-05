const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const vm=require('node:vm');
const path=process.argv[2]||require('node:path').join(__dirname,'pm2-start-with-env.sh');
function run({missing=false,uid=998,failStart=false}={}){
 assert.ok(fs.existsSync(path),'production env startup script must exist');
 const source=fs.readFileSync(path,'utf8').split("<<'NODE'\n")[1]?.split('\nNODE')[0];assert.ok(source);
 const calls=[],lines=[];const env={DATABASE_URL:'test-db-secret',REDIS_URL:'test-redis-secret',JWT_SECRET:'test-jwt-secret'};if(missing)delete env.JWT_SECRET;
 const names=['holaday-orchestrator','holaday-account-closure-worker'];
 const rows=names.map((name,i)=>({name,pm2_env:{uid,gid:998,pm_exec_path:'/var/lib/holaday-deploy/start-'+(i?'account-closure-worker':'orchestrator')+'-production.sh',HOME:'/var/lib/holaday',BROWSER_POOL_DIR:'/var/lib/holaday-browsers',QWEN_CORE_ROLLOUT_MODE:'off',BROWSER_EXECUTOR:'legacy'}}));
 const cp={execFileSync(bin,args){if(bin==='getent')return 'holaday:x:998:998::/var/lib/holaday:/usr/sbin/nologin\n';if(bin==='pm2'&&args[0]==='jlist')return JSON.stringify(rows);throw Error('unexpected read')},spawnSync(bin,args,opts){calls.push({bin,args,opts});return {status:failStart&&args[0]==='start'?1:0}}};
 const fakefs={existsSync(p){return !p.includes('ordinary-maintenance')},lstatSync(){return {uid:0,mode:0o100600,isFile:()=>true,isSymbolicLink:()=>false}},readFileSync(){return 'not logged'},accessSync(){},constants:{X_OK:1,R_OK:4}};
 const sandbox={require(n){if(n==='fs')return fakefs;if(n==='child_process')return cp;if(n==='path')return require('node:path');if(n==='module')return {createRequire:()=>()=>({parse:()=>env})};throw Error(n)},process:{argv:['node','-', '/opt/holaday-monorepo'],getuid:()=>0,versions:{node:'22.20.0'},exit(c){throw Object.assign(Error('exit'),{code:c})}},console:{log:(s)=>lines.push(s),error:(s)=>lines.push(s)}};
 let code=0;try{vm.runInNewContext(source,sandbox)}catch(e){code=e.code||99}
 return {calls,lines,code};
}
test('starts original scripts as UID998 with production secrets only in child env',()=>{const r=run();assert.equal(r.code,0);const starts=r.calls.filter(x=>x.args[0]==='start');assert.equal(starts.length,2);for(const c of starts){assert.equal(c.opts.env.JWT_SECRET,'test-jwt-secret');assert.equal(c.opts.env.HTTP_PORT,'4001');assert.equal(c.opts.env.WS_PORT,'4002');assert.equal(c.opts.env.BROWSER_EXECUTOR,undefined);assert.equal(c.opts.env.QWEN_CORE_ROLLOUT_MODE,undefined);assert.ok(c.args.includes('998'));assert.ok(!JSON.stringify(c.args).includes('secret'));}assert.ok(!r.lines.join('\n').includes('secret'));});
test('missing production config refuses before process changes',()=>{const r=run({missing:true});assert.notEqual(r.code,0);assert.equal(r.calls.length,0);});
test('mismatched runtime identity refuses before process changes',()=>{const r=run({uid:0});assert.notEqual(r.code,0);assert.equal(r.calls.length,0);});
test('start failure immediately stops both named services',()=>{const r=run({failStart:true});assert.notEqual(r.code,0);assert.deepEqual(Array.from(r.calls.at(-1).args),['stop','holaday-orchestrator','holaday-account-closure-worker']);});
