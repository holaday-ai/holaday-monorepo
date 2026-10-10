import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { test, expect, type Page, type Locator } from 'playwright/test';
import { readProcedures, registerReadOnlyGuard, trackAuditReads, waitForAuditReads } from './audit-policy';

const output = path.resolve(process.env.HOLADAY_AUDIT_OUTPUT ?? 'e2e/artifacts');
const reads = readProcedures(path.resolve('src'));
function save(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), {recursive:true,mode:0o700});
  fs.writeFileSync(file, JSON.stringify(value,null,2), {mode:0o600}); fs.chmodSync(file,0o600);
}
async function ready(page: Page): Promise<void> {
  await page.waitForFunction(()=>document.body.innerText.trim().length>0);
  // Batched bootstrap reads can finish after the generic 12s observation window.
  // Keep all pending requests tracked and require settlement before UI assertions.
  await waitForAuditReads(page, 30_000); await page.waitForTimeout(250);
}
async function click(page: Page, target: Locator): Promise<void> {
  if (await page.evaluate(()=>navigator.maxTouchPoints>0)) await target.tap(); else await target.click();
  await page.waitForTimeout(150);
}
async function sidebar(page: Page): Promise<void> {
  const more=page.locator('button.hd-sidebar-more').filter({visible:true}).first();
  if (!await more.isVisible()) await click(page,page.getByRole('button',{name:/^(打开任务列表|切换侧边栏)$/}).filter({visible:true}).first());
}
function regression(name: string, action: (page: Page)=>Promise<void>): void {
 test(name, async ({browser,baseURL},info)=>{
  test.setTimeout(name === 'sidebar-retention-pagination' ? 5*60_000 : 3*60_000);
  const origin=new URL(baseURL!).origin;
  if (!['127.0.0.1','localhost'].includes(new URL(origin).hostname)) throw new Error('Loopback preview required');
  const state=JSON.parse(fs.readFileSync(process.env.HOLADAY_AUDIT_STORAGE_STATE!,'utf8')) as {origins:{origin:string;localStorage:{name:string;value:string}[]}[]};
  const authed=state.origins.find(entry=>entry.localStorage.some(value=>value.name==='holaday.access_token'&&value.value));
  if(!authed) throw new Error('Private Holaday storage state required');
  const context=await browser.newContext({...info.project.use,storageState:{cookies:[],origins:[{origin,localStorage:authed.localStorage.filter(entry=>entry.name==='holaday.access_token')}]},serviceWorkers:'block'});
  const blocks:string[]=[];
  await registerReadOnlyGuard(context,origin,reads,entry=>blocks.push(entry));
  context.setDefaultTimeout(8_000); context.setDefaultNavigationTimeout(30_000);
  const page=await context.newPage();trackAuditReads(page);
  const receipt={name,viewport:info.project.name,mode:process.env.HOLADAY_AUDIT_MODE??'verify',build:createHash('sha256').update(fs.readFileSync('dist/index.html')).digest('hex'),passed:false,blocks,at:new Date().toISOString()};
  try { await action(page); expect(blocks.filter(entry=>!entry.startsWith('WS ')), 'No unexpected writes or reads').toEqual([]); receipt.passed=true; }
  finally {
   const prefix=path.join(output,info.project.name+'-'+name.replace(/[^a-z0-9-]/gi,'-'));
   await page.screenshot({path:prefix+'.png',animations:'disabled',timeout:10_000}).then(()=>fs.chmodSync(prefix+'.png',0o600)).catch(()=>undefined);
   save(prefix+'.json',receipt);await context.close();
  }
 });
}

for(const route of ['/image','/video']) regression('media-model-toggle-'+route.slice(1),async page=>{
 await page.goto(route,{waitUntil:'domcontentloaded'});await ready(page);
 const modes=route==='/video'?['自由创作','动作复刻','人物口播']:['图片'];
 for(const mode of modes){
  if(route==='/video') await click(page,page.getByRole('tab',{name:mode,exact:true}));
  const trigger=route==='/image'?page.getByRole('button',{name:'选择图片模型',exact:true}):page.locator('button[title="模型与生成设置"]').filter({visible:true}).first();
  await click(page,trigger);const dialog=page.getByRole('dialog').filter({visible:true}).last();await expect(dialog).toBeVisible();
  await click(page,trigger);await expect(dialog).toBeHidden();
  await click(page,trigger);await page.keyboard.press('Escape');await expect(dialog).toBeHidden();
 }
});

for(const task of [false,true]) regression(task?'task-model-submenu':'home-model-submenu',async page=>{
 await page.goto('/',{waitUntil:'domcontentloaded'});await ready(page);
 if(task){await sidebar(page);const row=page.locator('.holaday-task-row').first();await expect(row).toBeVisible();await click(page,row.locator('button').first());await ready(page);expect(new URL(page.url()).searchParams.has('task')).toBe(true);}
 const attachments=page.getByRole('button',{name:'附件与任务选项',exact:true}).filter({visible:true});
 await click(page,attachments);const trigger=page.getByRole('menuitem').filter({hasText:/^模型/}).first();
 // A single available brain is rendered as static text, never a broken selector.
 if(!await trigger.count()){await expect(page.getByRole('menu').filter({visible:true})).toContainText('模型');await page.keyboard.press('Escape');return;}
 await click(page,trigger);await expect(trigger).toHaveAttribute('data-state','open');
 const submenu=page.getByRole('menu').filter({has:page.getByRole('menuitemradio')}).last();await expect(submenu).toBeVisible();
 const bounds=await submenu.boundingBox();const width=await page.evaluate(()=>innerWidth);expect(bounds).not.toBeNull();expect(bounds!.x).toBeGreaterThanOrEqual(-1);expect(bounds!.x+bounds!.width).toBeLessThanOrEqual(width+1);
 await click(page,trigger);await expect(trigger).toHaveAttribute('data-state','closed');await expect(submenu).toBeHidden();
 await page.keyboard.press('Escape');
});

regression('admin-model-editor-toggle',async page=>{
 await page.goto('/admin/models',{waitUntil:'domcontentloaded'});await ready(page);
 const expand=page.getByRole('button',{name:'各通道模型',exact:true});const count=await expand.count();expect(count).toBeGreaterThan(0);
 for(let index=0;index<count;index++){await click(page,expand.nth(index));const collapse=page.getByRole('button',{name:'收起',exact:true});await expect(collapse).toBeVisible();await click(page,collapse);await expect(collapse).toBeHidden();}
});

regression('sidebar-retention-pagination',async page=>{
 const reads:Record<string,unknown>[]=[];const pending=new Set<Promise<void>>();
 page.on('requestfinished',request=>{const url=new URL(request.url());if(!url.pathname.startsWith('/api/trpc/'))return;const names=url.pathname.slice('/api/trpc/'.length).split(',');const index=names.indexOf('tasks.list');if(index<0)return;
  const read=(async()=>{const response=await request.response();if(!response)return;const body=await response.json().catch(()=>null);const result=(Array.isArray(body)?body[index]:body)?.result?.data;const data=result?.json??result;let input:Record<string,unknown>|undefined;try{const raw=JSON.parse(url.searchParams.get('input')??'null');input=url.searchParams.has('batch')?raw?.[String(index)]:raw;}catch{ /* status metadata remains useful */ }
   reads.push({status:response.status(),rows:Array.isArray(data?.tasks)?data.tasks.length:null,requestedCursor:typeof input?.cursor==='number',cursorAdvanced:typeof input?.cursor==='number'?data?.nextCursor!==input.cursor:null,hasNext:data?.nextCursor!=null});
  })();pending.add(read);void read.finally(()=>pending.delete(read));});
 const counts:Record<string,unknown>={};
 try {
 await page.goto('/',{waitUntil:'domcontentloaded'});await ready(page);await sidebar(page);
 const more=page.getByRole('button',{name:'加载更多任务',exact:true});
 if(!await more.count()){expect(await page.locator('.holaday-task-row').count()).toBeGreaterThan(0);return;}
 const before=await page.locator('.holaday-task-row').count();counts.before=before;await click(page,more);
 const pager=page.getByRole('button',{name:/^(加载更多任务|加载中…)$/}).filter({visible:true});
 await expect.poll(async()=>!await pager.count()||await pager.isEnabled(),{timeout:180_000}).toBe(true);await ready(page);
 await expect.poll(async()=>await page.locator('.holaday-task-row').count()>before||!await more.count(),{timeout:60_000}).toBe(true);
 if(await page.locator('.holaday-task-row').count()<=before) await expect(page.getByRole('status').filter({hasText:/没有更多可见任务（\d+ 条已超出保留期）/})).toBeVisible();
 } finally {
  await Promise.all([...pending]);counts.after=await page.locator('.holaday-task-row').count();counts.pagerCount=await page.getByRole('button',{name:'加载更多任务',exact:true}).count();counts.exhaustedCount=await page.getByRole('status').filter({hasText:/没有更多可见任务/}).count();
  save(path.join(output,'diagnostics',(await page.evaluate(()=>navigator.maxTouchPoints>0)?'iphone-14':'desktop')+'-pagination-metadata.json'),{counts,reads});
 }
});

regression('notification-close-and-exclusive',async page=>{
 await page.goto('/usage',{waitUntil:'domcontentloaded'});await ready(page);
 const notice=page.getByRole('button',{name:/^通知(?:，|$)/}).filter({visible:true}).first();
 await click(page,notice);await expect(notice).toHaveAttribute('aria-expanded','true');
 // The page heading is outside the notification overlay and has no action.
 await click(page,page.getByRole('heading',{name:'用量',exact:true}));await expect(page.locator('button[aria-label^="通知"][aria-expanded="true"]')).toHaveCount(0);
 await click(page,notice);await page.keyboard.press('Escape');await expect(page.locator('button[aria-label^="通知"][aria-expanded="true"]')).toHaveCount(0);
 await click(page,notice);await sidebar(page);await click(page,page.locator('button.hd-sidebar-more').filter({visible:true}).first());await expect(page.locator('button[aria-label^="通知"][aria-expanded="true"]')).toHaveCount(0);await page.keyboard.press('Escape');
});

for(const [route,label] of [['/projects','搜索项目'],['/files','搜索文件名']]) regression('url-state-'+route.slice(1),async page=>{
 await page.goto(route,{waitUntil:'domcontentloaded'});await ready(page);
 const input=page.getByRole('textbox',{name:label,exact:true});await input.fill('__holaday_ui_verify__');await ready(page);expect(new URL(page.url()).searchParams.get('q')).toBe('__holaday_ui_verify__');
 await sidebar(page);await click(page,page.getByRole('button',{name:route==='/projects'?'文件库':'项目',exact:true}).filter({visible:true}).first());await ready(page);
 await page.goBack({waitUntil:'domcontentloaded'});await ready(page);await page.keyboard.press('Escape');await expect(input).toHaveValue('__holaday_ui_verify__');await page.reload({waitUntil:'domcontentloaded'});await ready(page);await expect(input).toHaveValue('__holaday_ui_verify__');
});


regression('home-skill-submenu',async page=>{
 await page.goto('/',{waitUntil:'domcontentloaded'});await ready(page);
 await click(page,page.getByRole('button',{name:'附件与任务选项',exact:true}).filter({visible:true}));
 const trigger=page.getByRole('menuitem').filter({hasText:/^技能/}).first();await click(page,trigger);
 await expect(trigger).toHaveAttribute('data-state','open');
 const submenu=page.getByRole('menu').filter({has:page.getByRole('menuitemradio')}).last();await expect(submenu).toBeVisible();
 const bounds=await submenu.boundingBox();const viewport=await page.evaluate(()=>({width:innerWidth,height:innerHeight}));
 expect(bounds).not.toBeNull();expect(bounds!.x).toBeGreaterThanOrEqual(-1);expect(bounds!.y).toBeGreaterThanOrEqual(-1);
 expect(bounds!.x+bounds!.width).toBeLessThanOrEqual(viewport.width+1);expect(bounds!.y+bounds!.height).toBeLessThanOrEqual(viewport.height+1);
 await click(page,trigger);await expect(trigger).toHaveAttribute('data-state','closed');await expect(submenu).toBeHidden();await page.keyboard.press('Escape');
});

regression('not-found-notification-outside',async page=>{
 await page.goto('/__holaday_ui_audit_not_found__',{waitUntil:'domcontentloaded'});await ready(page);
 await click(page,page.getByRole('button',{name:/^通知(?:，|$)/}).filter({visible:true}).first());
 if(await page.evaluate(()=>navigator.maxTouchPoints>0)) await page.touchscreen.tap(8,8);else await page.mouse.click(8,8);
 await expect(page.locator('button[aria-label^="通知"][aria-expanded="true"]')).toHaveCount(0);
 // A mobile navigation drawer opened by the logo is a different overlay.
 await page.keyboard.press('Escape');
});

regression('video-history-filter',async page=>{
 await page.goto('/video',{waitUntil:'domcontentloaded'});await ready(page);
 const history=page.locator('section.hd-media-history');
 const all=history.getByRole('button',{name:'全部',exact:true});await expect(all).toHaveClass(/border-b-2/);
 // The selected filter is idempotent. Check actual alternative selection and restoration.
 await click(page,all);await expect(all).toHaveClass(/border-b-2/);
 for(const label of ['最近','置顶']){const target=history.getByRole('button',{name:label,exact:true});await click(page,target);await expect(target).toHaveClass(/border-b-2/);await expect(all).not.toHaveClass(/border-b-2/);}
 await click(page,all);await expect(all).toHaveClass(/border-b-2/);
});

regression('video-consent-legal-links',async page=>{
 await page.goto('/video',{waitUntil:'domcontentloaded'});await ready(page);
 await click(page,page.getByRole('tab',{name:'人物口播',exact:true}));
 for(const [name,route] of [['《服务条款》','/terms'],['《隐私政策》','/privacy']]) {
  const link=page.getByRole('link',{name,exact:true});await expect(link).toHaveAttribute('target','_blank');await expect(link).toHaveAttribute('href',route);
  const pending=page.waitForEvent('popup');await click(page,link);const popup=await pending;
  await popup.waitForLoadState('domcontentloaded');expect(new URL(popup.url()).pathname).toBe(route);
  await expect(popup.locator('body')).not.toHaveText('');await popup.close();
 }
});

regression('video-style-dialog',async page=>{
 await page.goto('/video',{waitUntil:'domcontentloaded'});await ready(page);
 await click(page,page.getByRole('button',{name:'16:9 · 8秒 · 1080p',exact:true}));
 const trigger=page.getByRole('button',{name:/氛围 \/ 光感 \/ 色彩/});
 const dialog=page.locator('[role="dialog"][aria-label="选择氛围"]');
 await click(page,trigger);await expect(dialog).toBeVisible();
 const bounds=await dialog.boundingBox();const viewport=await page.evaluate(()=>({width:innerWidth,height:innerHeight}));
 expect(bounds).not.toBeNull();expect(bounds!.x).toBeGreaterThanOrEqual(-1);expect(bounds!.y).toBeGreaterThanOrEqual(-1);expect(bounds!.x+bounds!.width).toBeLessThanOrEqual(viewport.width+1);expect(bounds!.y+bounds!.height).toBeLessThanOrEqual(viewport.height+1);
 await dialog.locator('div.overflow-y-auto').evaluate(node=>{node.scrollTop=node.scrollHeight;});
 await click(page,dialog.getByRole('button',{name:'关闭风格选择',exact:true}));await expect(dialog).toBeHidden();await expect(trigger).toBeFocused();
 await click(page,trigger);await page.keyboard.press('Escape');await expect(dialog).toBeHidden();
 await click(page,trigger);if(await page.evaluate(()=>navigator.maxTouchPoints>0))await page.touchscreen.tap(2,2);else await page.mouse.click(2,2);await expect(dialog).toBeHidden();
});

regression('task-delete-confirm-cancel',async page=>{
 await page.goto('/',{waitUntil:'domcontentloaded'});await ready(page);await sidebar(page);
 const menus=page.getByRole('button',{name:'任务菜单',exact:true}).filter({visible:true});expect(await menus.count()).toBeGreaterThan(0);
 let found=false;for(let index=0;index<Math.min(await menus.count(),12);index++){
  await click(page,menus.nth(index));const remove=page.getByRole('menuitem',{name:'删除任务',exact:true});
  if(!await remove.isEnabled()){await page.keyboard.press('Escape');continue;}
  found=true;await click(page,remove);const dialog=page.locator('[role="dialog"]').filter({hasText:'确认删除此任务？'});
  await expect(dialog).toBeVisible();const cancel=dialog.getByRole('button',{name:'取消',exact:true});await expect(cancel).toBeVisible();await click(page,cancel);await expect(dialog).toBeHidden();break;
 }
 expect(found,'An existing deletable row is required; no records are created').toBe(true);
});
