import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test, expect } from 'playwright/test';
import { allowRequest, decideControl, registerReadOnlyGuard, trackAuditReads, waitForAuditReads, routePatterns, readProcedures, discoverDynamicRoutes, selectAuditRoutes, type Control } from './audit-policy';

const base = 'http://127.0.0.1:4173';
const control: Control = { key: '1', selector: 'button', label: '', tag: 'button', role: '', href: null, type: 'button', expanded: null, disabled: false, hasReason: false };

test('live audit denies mutations, unknown API reads, external requests and unsafe schemes', () => {
  const reads = new Set(['tasks.list', 'auth.me']);
  expect(allowRequest('GET', new URL('/api/trpc/tasks.list,auth.me?batch=1', base), base, reads)).toBe(true);
  for (const [method, endpoint] of [['POST', '/api/trpc/tasks.create'], ['DELETE', '/api/files/x'], ['GET', '/api/trpc/admin.runSelfCheck'], ['GET', '/api/trpc/tasks.list,tasks.create'], ['GET', '/api/auth/logout'], ['GET', 'https://other.example/api/trpc/tasks.list']]) {
    expect(allowRequest(method, new URL(endpoint, base), base, reads)).toBe(false);
  }
  expect(decideControl({ ...control, label: '确认删除', expanded: 'false' })).toBe('final-action');
  expect(decideControl({ ...control, label: '发送通知' })).toBe('final-action');
  expect(decideControl({ ...control, label: '神秘按钮' })).toBe('unreviewed');
  expect(decideControl({ ...control, href: 'javascript:alert(1)' })).toBe('unreviewed');
  expect(decideControl({ ...control, label: '生成设置' })).toBe('safe');
  expect(decideControl({ ...control, label: '显示密码', draftChoice: true })).toBe('final-action');
  expect(decideControl({ ...control, label: '查看 API 密钥' })).toBe('final-action');
});

test('route inventory includes multiline, aliases and dynamic routes without inventing IDs', () => {
  expect(routePatterns('<Route path="/" element={<Home />} /><Route\n path="/projects/:projectId"\n element={<Project/>} /><Route path="/app" />')).toEqual(['/', '/projects/:projectId', '/app']);
});

test('browser transport guard intercepts unsafe requests before any upstream handler', async ({ context, page }) => {
  let upstreamWrites = 0;
  const blocks: string[] = [];
  await context.route('**/*', route => {
    const request = route.request();
    if (request.method() !== 'GET') upstreamWrites++;
    return route.fulfill({ contentType: request.url() === `${base}/` ? 'text/html' : 'application/json', body: request.url() === `${base}/` ? '<h1>Guard fixture</h1>' : '{}' });
  });
  await registerReadOnlyGuard(context, base, new Set(['tasks.list']), entry => blocks.push(entry));
  await page.goto(base);
  const statuses = await page.evaluate(async () => {
    const read = await fetch('/api/trpc/tasks.list');
    const write = await fetch('/api/trpc/tasks.create', { method: 'POST' });
    const unknown = await fetch('/api/trpc/admin.runSelfCheck');
    return [read.status, write.status, unknown.status];
  });
  expect(statuses).toEqual([200, 409, 409]);
  expect(upstreamWrites).toBe(0);
  expect(blocks).toEqual(['POST /api/trpc/tasks.create', 'GET /api/trpc/admin.runSelfCheck']);
});


test('read inventory includes typed aliases and loader references but never mutations', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'holaday-audit-reads-'));
  try {
    fs.writeFileSync(path.join(directory, 'fixture.ts'), 'const typedClient: Client = trpc; typedClient.organizations.list.query(); typedClient.projects.get.query({}); typedClient.projects.create.mutate({}); load(trpc.projects.list.query); trpc.secret.queryExtra();');
    expect([...readProcedures(directory)].sort()).toEqual(['organizations.list', 'projects.get', 'projects.list']);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});


test('read readiness waits for API data while an unrelated image remains pending', async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  let releaseAsset: () => void = () => undefined;
  const assetSignal = new Promise<void>(resolve => { releaseAsset = resolve; });
  let assetFinished = false;
  const base = 'http://127.0.0.1:49199';
  await context.route('**/*', async route => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === '/api/trpc/tasks.list') {
      await new Promise(resolve => setTimeout(resolve, 450));
      await route.fulfill({ contentType: 'application/json', body: '{}' });
    } else if (pathname === '/slow-image') {
      await assetSignal; assetFinished = true;
      await route.fulfill({ contentType: 'image/png', body: '' }).catch(() => undefined);
    } else {
      await route.fulfill({ contentType: 'text/html', body: '<h1>Read fixture</h1><img src="/slow-image"><script>setTimeout(() => fetch("/api/trpc/tasks.list").then(r => r.json()).then(() => document.body.dataset.loaded = "true"), 30)</script>' });
    }
  });
  trackAuditReads(page);
  try {
    await page.goto(base, { waitUntil: 'domcontentloaded' });
    await waitForAuditReads(page);
    expect(await page.locator('body').getAttribute('data-loaded')).toBe('true');
    expect(assetFinished).toBe(false);
  } finally { releaseAsset(); await context.close(); }
});


test('a timed-out read still fails without repeating the full wait; a new read gets its own window', async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  let release: () => void = () => undefined;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await context.route('**/*', async route => {
    if (new URL(route.request().url()).pathname.startsWith('/api/trpc/')) await gate;
    await route.fulfill({ contentType: 'text/html', body: '<h1>Read timeout fixture</h1>' }).catch(() => undefined);
  });
  trackAuditReads(page);
  try {
    await page.goto(base, { waitUntil: 'domcontentloaded' });
    const first = page.waitForRequest(`${base}/api/trpc/tasks.list`);
    await page.evaluate(() => { void fetch('/api/trpc/tasks.list').catch(() => undefined); }); await first;
    await expect(waitForAuditReads(page, 150)).rejects.toThrow('read requests did not settle');
    const repeat = await Promise.race([
      waitForAuditReads(page, 5_000).then(() => 'incorrect success', () => 'recorded failure'),
      page.waitForTimeout(400).then(() => 'repeated full wait'),
    ]);
    expect(repeat).toBe('recorded failure');
    const second = page.waitForRequest(`${base}/api/trpc/projects.list`);
    await page.evaluate(() => { void fetch('/api/trpc/projects.list').catch(() => undefined); }); await second;
    const fresh = await Promise.race([
      waitForAuditReads(page, 5_000).then(() => 'incorrect success', () => 'premature timeout'),
      page.waitForTimeout(400).then(() => 'new read still waiting'),
    ]);
    expect(fresh).toBe('new read still waiting');
  } finally { release(); await context.close(); }
});


test('dynamic discovery respects team scope and each response in a mixed batch', () => {
  const responses = [
    {result:{data:[{projectId:'personal_real',name:'Personal'},{projectId:'team_real',scope:'organization',organizationId:'org_real'}]}},
    {result:{data:[{batchId:'batch_real',projectId:'irrelevant'}]}},
  ];
  const routes = discoverDynamicRoutes(responses, ['projects.list','batchTasks.list']);
  expect(routes['/projects/:projectId']).toBe('/projects/team_real');
  expect(routes['/batch/:batchId']).toBe('/batch/batch_real');
  expect(discoverDynamicRoutes({result:{data:[{projectId:'personal_real'}]}},['projects.list'])['/projects/:projectId']).toBeUndefined();
  expect(discoverDynamicRoutes({result:{data:[{projectId:'unrelated'}]}},['tasks.list'])['/video/edit/:projectId']).toBeUndefined();
});

test('route shards reject unknown patterns instead of silently reducing coverage', () => {
  const all=['/','/files','/batch/:batchId'];
  expect(selectAuditRoutes(all, JSON.stringify(['/files','/batch/:batchId']))).toEqual(['/files','/batch/:batchId']);
  expect(selectAuditRoutes(all, undefined)).toEqual(all);
  expect(()=>selectAuditRoutes(all, JSON.stringify(['/imaginary']))).toThrow('Unknown audit route');
  expect(()=>selectAuditRoutes(all, '[]')).toThrow('nonempty');
});


test('read readiness waits for the first ownership read, not perpetual successful background polls', async ({browser})=>{
 const context=await browser.newContext();const page=await context.newPage();let completions=0;
 await context.route('**/*',async route=>{
  const name=new URL(route.request().url()).pathname;
  if(name==='/api/trpc/tasks.browserControlState'){
   await new Promise(resolve=>setTimeout(resolve,250));completions++;
   await route.fulfill({contentType:'application/json',body:'{}'}).catch(()=>undefined);
  }else await route.fulfill({contentType:'text/html',body:'<h1>Polling fixture</h1><script>const poll=()=>fetch("/api/trpc/tasks.browserControlState").catch(()=>{});poll();setInterval(poll,100)</script>'});
 });
 trackAuditReads(page);
 try{
  await page.goto(base,{waitUntil:'domcontentloaded'});
  await waitForAuditReads(page,1500);
  expect(completions).toBeGreaterThan(0);
 }finally{await context.close();}
});
