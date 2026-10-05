#!/usr/bin/env bash
# Root reads production config; secrets travel only in PM2's child environment.
# Usage: bash scripts/ops/pm2-start-with-env.sh [repository-root]
# Does not save PM2: verify health first, then save and chmod the dump to 0600.
set -euo pipefail
set +x
[[ ${EUID:-$(id -u)} == 0 ]] || { printf 'PM2_ENV_ERROR=ROOT_REQUIRED\n' >&2; exit 1; }
REPO_ROOT=${1:-/opt/holaday-monorepo}
[[ "$REPO_ROOT" == /* && "$REPO_ROOT" != / ]] || exit 1
/opt/node22/bin/node - "$REPO_ROOT" <<'NODE'
const fs=require('fs'),cp=require('child_process'),path=require('path');
const {createRequire}=require('module');
const root=path.resolve(process.argv[2]),dir=path.join(root,'apps/orchestrator');
const names=['holaday-orchestrator','holaday-account-closure-worker'];
const scripts=['/var/lib/holaday-deploy/start-orchestrator-production.sh','/var/lib/holaday-deploy/start-account-closure-worker-production.sh'];
function fail(code){console.error('PM2_ENV_ERROR='+code);process.exit(1)}
function command(args,env){const r=cp.spawnSync('pm2',args,{env,timeout:30000,stdio:'pipe'});return r.status===0&&!r.error}
try {
 if(process.getuid()!==0||!process.versions.node.startsWith('22.'))fail('ROOT_NODE22_REQUIRED');
 if(fs.existsSync('/var/lib/holaday/ordinary-maintenance'))fail('MAINTENANCE_EXPLICIT_TRANSITION_REQUIRED');
 const config=path.join(dir,'.env'),stat=fs.lstatSync(config);
 if(!stat.isFile()||stat.isSymbolicLink()||stat.uid!==0||(stat.mode&0o077)!==0)fail('CONFIG_PERMISSIONS');
 const dotenv=createRequire(path.join(dir,'package.json'))('dotenv');
 const env=dotenv.parse(fs.readFileSync(config));
 if(['DATABASE_URL','REDIS_URL','JWT_SECRET'].some(k=>!env[k]))fail('CONFIG_MISSING');
 if(['HOLADAY_POOL_BOOT','HOLADAY_POOL_CANDIDATE','HOLADAY_ORDINARY_MAINTENANCE','HOLADAY_ORDINARY_CANDIDATE'].some(k=>env[k]))fail('CONTROLLED_RUNTIME');
 const user=cp.execFileSync('getent',['passwd','998'],{encoding:'utf8'}).trim().split(':');
 if(user[2]!=='998'||!/^\d+$/.test(user[3])||!user[5].startsWith('/'))fail('RUNTIME_USER');
 const controlEnv={PATH:'/opt/node22/bin:/usr/local/bin:/usr/bin:/bin',PM2_HOME:'/root/.pm2',HOME:'/root'};
 const rows=JSON.parse(cp.execFileSync('pm2',['jlist'],{env:controlEnv,encoding:'utf8',timeout:10000}));
 const context={HOME:user[5],USER:user[0],LOGNAME:user[0]};
 for(let i=0;i<names.length;i++){
  const matches=rows.filter(p=>p.name===names[i]);
  if(matches.length>1)fail('DUPLICATE_PROCESS');
  const old=matches[0]?.pm2_env;
  if(old&&(Number(old.uid)!==998||Number(old.gid)!==Number(user[3])||old.pm_exec_path!==scripts[i]))fail('RUNTIME_IDENTITY');
  if(old&&['HOLADAY_POOL_BOOT','HOLADAY_POOL_CANDIDATE','HOLADAY_ORDINARY_MAINTENANCE','HOLADAY_ORDINARY_CANDIDATE'].some(k=>old[k]))fail('CONTROLLED_RUNTIME');
  if(i===0&&old)for(const k of ['XDG_RUNTIME_DIR','BROWSER_POOL_DIR','PLAYWRIGHT_BROWSERS_PATH','CHROME_BIN','CHROME_DEVEL_SANDBOX','DISPLAY'])if(old[k])context[k]=old[k];
  fs.accessSync(scripts[i],fs.constants.X_OK);
 }
 for(const file of ['dist/index.js','dist/account-closure/worker-entry.js'])fs.accessSync(path.join(dir,file),fs.constants.R_OK);
 const appEnv={...context,...env,PATH:controlEnv.PATH,PM2_HOME:controlEnv.PM2_HOME,HTTP_PORT:'4001',WS_PORT:'4002'};
 // Recreate only the two application definitions so removed flags do not linger
 // in PM2's merge-on-restart environment. Keep their original scripts and uid/gid.
 for(const name of names)if(rows.some(p=>p.name===name)&&!command(['delete',name],controlEnv))fail('DELETE_FAILED');
 for(let i=0;i<names.length;i++){
  const args=['start',scripts[i],'--name',names[i],'--interpreter','/usr/bin/bash','--cwd',dir,'--uid','998','--gid',user[3],'--restart-delay','2000'];
  if(i===1)args.push('--instances','1','--max-memory-restart','512M','--kill-timeout','660000');
  if(!command(args,appEnv)){command(['stop',...names],controlEnv);fail('START_FAILED');}
 }
 console.log('PM2_ENV_START=OK uid=998 http=4001 ws=4002 save=false');
} catch {fail('OPERATION_FAILED');}
NODE
