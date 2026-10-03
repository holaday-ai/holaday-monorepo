import { execFileSync, spawnSync } from 'node:child_process';
import { openSync, closeSync, readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Local-only, fixed synthetic DB/Redis endpoints. Never a production verifier.
const root = fileURLToPath(new URL('../../', import.meta.url));
const cwd = resolve(root, 'apps/orchestrator');
const all = execFileSync('rg', ['--files', 'src'], {cwd, encoding:'utf8'}).trim().split('\n');
const exact = [
  'application-entry', 'application-main.wiring', 'http.execution-drain-wiring',
  ...['application-boot','http-listener','http-drain','cleanup-drain','drain-controller',
      'drain-control-server','drain-state-store','execution-drain','owned-operation',
      'poller-stop','auxiliary-database'].map(x => `execution/${x}`),
  'trpc/context', 'trpc/routers/tasks.drain', 'trpc/routers/task-queue-execution',
  'trpc/routers/task-queue-start', 'queue/task-queue', 'queue/task-queue-drain',
  'planned/planned-runner', 'planned/planned-runner-drain', 'planned/planned-poller-drain',
  'agent/scheduled-runner', 'agent/scheduled-runner-drain',
  'agent/a-share/prewarm-scheduler', 'agent/a-share/prewarm-drain',
  'agent/a-share/prewarm-io-drain', 'agent/a-share/akshare-http-client',
  'energy/analytics-cleanup',
  'api-keys/webhook-handler', 'api-keys/webhook-handler-drain', 'api-keys/webhook-idempotency-service',
  'agent/vision-loop/browser-close-receipt', 'agent/vision-loop/browser-route-events',
  'agent/vision-loop/playwright-executor.cdp-auth', 'agent/vision-loop/playwright-executor.cdp-resource',
  'agent/vision-loop/playwright-executor.connection-drain', 'agent/vision-loop/playwright-executor.drain',
].map(x => `src/${x}.test.ts`);
for (const file of exact) if (!all.includes(file)) throw new Error(`MISSING_TEST:${file}`);
const files = [...new Set([...exact, ...all.filter(f =>
  /^src\/(browser-pool|ws)\/.+\.test\.ts$/.test(f) && !f.includes('.integration.')
)])].sort();
if (process.argv.includes('--list')) { console.log(JSON.stringify(files,null,2)); process.exit(0); }
const directory = mkdtempSync('/private/tmp/holaday-quartet-final-');
console.log(JSON.stringify({directory, files:files.length}));
const runs = [];
for(let offset=0; offset<files.length; offset+=20) {
  const memory=execFileSync('memory_pressure',['-Q'],{encoding:'utf8'});
  const free=Number(memory.match(/System-wide memory free percentage: (\d+)%/)?.[1]);
  const disk=execFileSync('df',['-k',root],{encoding:'utf8'}).trim().split('\n').at(-1).trim().split(/\s+/);
  if(!Number.isFinite(free)||free<40||Number(disk[3])<10*1024*1024) throw new Error('RESOURCE_GATE_REFUSED');
  const batch=files.slice(offset,offset+20);
  const prefix=resolve(directory,`batch-${runs.length+1}`);
  const log=openSync(`${prefix}.log`,'wx');
  const result=spawnSync(process.execPath,['node_modules/vitest/vitest.mjs','run',...batch,
    '--poolOptions.threads.maxThreads=1','--poolOptions.threads.minThreads=1','--no-file-parallelism',
    '--reporter=json',`--outputFile=${prefix}.json`],{
    cwd, env:{...process.env,NODE_OPTIONS:'--max-old-space-size=2048',NODE_ENV:'test',
      DATABASE_URL:'mysql://synthetic:synthetic@127.0.0.1:1/holaday_synthetic_test',
      REDIS_URL:'redis://127.0.0.1:1/15'},stdio:['ignore',log,log],timeout:900000,
  });
  closeSync(log);
  let report;
  try {report=JSON.parse(readFileSync(`${prefix}.json`,'utf8'));} catch {}
  const observed=new Set((report?.testResults??[]).map(r=>r.name));
  const missing=batch.filter(f=>!observed.has(resolve(cwd,f)));
  const summary={batch:runs.length+1,files:batch,passed:report?.numPassedTests??0,
    failed:report?.numFailedTests??null,skipped:report?.numPendingTests??0,
    missing,exitCode:result.status,memoryFree:free};
  runs.push(summary);
  writeFileSync(resolve(directory,'summary.json'),JSON.stringify({files,runs},null,2));
  console.log(JSON.stringify({...summary,files:batch.length}));
  if(result.status!==0||!report?.success||missing.length) process.exit(1);
}
