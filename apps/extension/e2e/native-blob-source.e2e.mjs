/** Actual pinned CRX + new native source component in an isolated MV3 extension.
 * This is not the product background entry or the task/file-permission API. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../..', import.meta.url));
const requireExtension = createRequire(new URL('../package.json', import.meta.url));
const requireVite = createRequire(requireExtension.resolve('vite'));
const { build } = requireVite('esbuild');
const requireBackend = createRequire(new URL('../../orchestrator/package.json', import.meta.url));
const { chromium } = requireBackend('playwright');
const sdk = join(root, 'node_modules/.holaday-patched/playwright-crx-0.15.0-c024d5adc65c/lib');
const source = join(root, 'packages/browser-driver/src/native-blob-source.ts');
const content = 'sku,qty\nORIGINAL-731,31\n';
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
let origin;
let context;
let worker;
let user;
let workDir;
let artifacts;
let sourceHash;
const server = createServer((request, response) => {
  response.setHeader('Content-Type', 'text/html');
  if (request.url === '/normal') response.end('<input id="query">');
  else
    response.end(
      `<!doctype html><title>Native Blob source</title><button id="export">Export report</button><script>window.originalCreateObjectURL=window.URL.createObjectURL;document.querySelector("#export").onclick=()=>{document.body.dataset.clicks=String(Number(document.body.dataset.clicks||0)+1);const blob=new Blob([${JSON.stringify(content)}],{type:"text/csv"});const link=document.createElement("a");link.download="report.csv";link.href=window.URL.createObjectURL(blob);link.click();};</script>`,
    );
});

before(
  async () => {
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    origin = `http://127.0.0.1:${server.address().port}`;
    workDir = await mkdtemp(join(tmpdir(), 'holaday-native-blob-'));
    artifacts = process.env.HOLADAY_E2E_ARTIFACT_DIR ?? join(workDir, 'artifacts');
    await mkdir(artifacts, { recursive: true });
    const extension = join(artifacts, 'extension');
    await mkdir(extension);
    if (process.env.HOLADAY_SOURCE_FREEZE_JSON) {
      const freeze = JSON.parse(await readFile(process.env.HOLADAY_SOURCE_FREEZE_JSON, 'utf8'));
      for (const [path, hash] of Object.entries(freeze))
        assert.equal(sha(await readFile(path)), hash, `source changed: ${path}`);
    }
    sourceHash = sha(await readFile(source));
    await mkdir(join(extension, 'sdk'));
    for (const name of ['index.mjs', 'index-DedCW3aV.mjs'])
      await copyFile(join(sdk, name), join(extension, 'sdk', name));
    const entry = `import {crx} from './sdk/index.mjs';
import {captureNativeBlobSources} from ${JSON.stringify(source)};
globalThis.__probeBlobSource=async({tabId,origin,mode})=>{
  const app=(await crx.get())??(await crx.start());
  const page=await app.attach(tabId);
  const send=(method,params)=>chrome.debugger.sendCommand({tabId},method,params);
  const tree=await send('Page.getFrameTree',{});const frameId=tree.frameTree.frame.id;
  const document=await send('DOM.getDocument',{});
  const selected=await send('DOM.querySelector',{nodeId:document.root.nodeId,selector:'#export'});
  const native=await send('DOM.resolveNode',{nodeId:selected.nodeId});
  let live=true,lease,began,completed=false,clickError;
  const deadline=setTimeout(()=>{},10000);
  const listener=(source,method,params)=>{
    if(source.tabId!==tabId)return;
    if(method==='Page.downloadWillBegin'&&params.frameId===frameId&&!began)began={guid:params.guid,url:params.url,filename:params.suggestedFilename};
    if(method==='Page.downloadProgress'&&params.guid===began?.guid&&params.state==='completed')completed=true;
  };
  chrome.debugger.onEvent.addListener(listener);
  try{
    lease=await captureNativeBlobSources({owner:app,frameId,nodeObjectId:native.object.objectId,origin,cdp:send,current:()=>live});
    try{await page.locator('#export').click({timeout:5000});}catch(error){clickError=String(error.message).slice(0,300);}
    for(let attempt=0;(!began||!completed)&&attempt<100;attempt++)await new Promise(resolve=>setTimeout(resolve,25));
    if(!began||!completed)throw new Error('actual native download receipt missing');
    if(mode==='competing-api')await send('Runtime.callFunctionOn',{objectId:native.object.objectId,functionDeclaration:'function(){window.URL.createObjectURL=function replacement(){throw new Error("website replacement")};}',returnByValue:true});
    try{await lease.restore();}catch(error){return {status:'restore_unconfirmed',error:String(error.message),nativeCompleted:completed,clickError,bytesExposed:false};}
    const restored=await send('Runtime.callFunctionOn',{objectId:native.object.objectId,functionDeclaration:'function(){return window.URL.createObjectURL===window.originalCreateObjectURL;}',returnByValue:true});
    if(mode==='stopped')live=false;
    if(mode==='promise-hook')await send('Runtime.callFunctionOn',{objectId:native.object.objectId,functionDeclaration:'function(){const then=Promise.prototype.then;const fake=new ArrayBuffer(24);Object.defineProperty(Promise.prototype,"constructor",{value:function ForeignPromise(){},configurable:true});Promise.prototype.then=function(resolve,reject){return Reflect.apply(then,this,[()=>resolve(fake),reject]);};}',returnByValue:true});
    try{
      const info=await lease.describe(began.url);
      const bytes=await lease.read(began.url,0,256*1024);
      const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
      return {status:'captured',info,sourceSHA256:hash,sourceText:new TextDecoder().decode(bytes),nativeCompleted:completed,restored:restored.result.value,clickError};
    }catch(error){return {status:'refused',error:String(error.message),nativeCompleted:completed,restored:restored.result.value,clickError,bytesExposed:false};}
  }finally{
    clearTimeout(deadline);live=false;
    await lease?.dispose().catch(()=>{});
    chrome.debugger.onEvent.removeListener(listener);
    await send('Runtime.releaseObject',{objectId:native.object.objectId}).catch(()=>{});
    await app.detach(page);
  }
};`;
    await writeFile(join(artifacts, 'worker-source.js'), entry);
    await build({
      stdin: { contents: entry, resolveDir: root, sourcefile: 'native-blob-source-worker.js' },
      bundle: true,
      external: ['./sdk/index.mjs'],
      format: 'esm',
      platform: 'browser',
      target: 'chrome120',
      outfile: join(extension, 'worker.js'),
      logLevel: 'warning',
    });
    const manifest = {
      manifest_version: 3,
      name: 'Holaday isolated native Blob source',
      version: '0.0.1',
      permissions: ['debugger', 'tabs'],
      host_permissions: ['http://127.0.0.1/*'],
      background: { service_worker: 'worker.js', type: 'module' },
    };
    await writeFile(join(extension, 'manifest.json'), JSON.stringify(manifest, null, 2));
    context = await chromium.launchPersistentContext(join(workDir, 'profile'), {
      channel: 'chromium',
      headless: true,
      acceptDownloads: true,
      args: [
        '--renderer-process-limit=2',
        `--disable-extensions-except=${extension}`,
        `--load-extension=${extension}`,
      ],
    });
    worker =
      context.serviceWorkers()[0] ??
      (await context.waitForEvent('serviceworker', { timeout: 15000 }));
    for (let i = 0; ; i++) {
      if (await worker.evaluate(() => typeof globalThis.__probeBlobSource === 'function')) break;
      assert.ok(i < 30);
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    user = await context.newPage();
    await user.goto(`${origin}/normal`);
    await user.locator('#query').fill('keep user input 731');
    await writeFile(
      join(artifacts, 'build-proof.json'),
      JSON.stringify(
        {
          sourceHash,
          sdkEntrySHA256: sha(await readFile(join(sdk, 'index.mjs'))),
          sdkBundleSHA256: sha(await readFile(join(sdk, 'index-DedCW3aV.mjs'))),
          workerSHA256: sha(await readFile(join(extension, 'worker.js'))),
          manifest,
          node: process.version,
          chromium: context.browser().version(),
          limits: [
            'Actual pinned SDK and source helper, isolated probe entry; no product task/permission/protocol or real account/OS acceptance.',
          ],
        },
        null,
        2,
      ),
    );
  },
  { timeout: 60000 },
);
after(async () => {
  await context?.close().catch(() => {});
  await new Promise((resolve) => server.close(resolve));
  if (workDir) await rm(workDir, { recursive: true, force: true });
});

for (const mode of ['dynamic', 'promise-hook', 'stopped', 'competing-api', 'cached'])
  test(
    `actual CRX native Blob source (${mode})`,
    async () => {
      const page = await context.newPage();
      await page.goto(`${origin}/fixture`);
      if (mode === 'cached')
        await page.evaluate(() => {
          const url = window.URL.createObjectURL(
            new Blob(['sku,qty\nORIGINAL-731,31\n'], { type: 'text/csv' }),
          );
          document.querySelector('#export').onclick = () => {
            document.body.dataset.clicks = '1';
            const link = document.createElement('a');
            link.href = url;
            link.download = 'report.csv';
            link.click();
          };
        });
      const tabId = await worker.evaluate(
        async (origin) => (await chrome.tabs.query({ url: `${origin}/fixture` }))[0].id,
        origin,
      );
      await user.bringToFront();
      const active = await worker.evaluate(
        async () => (await chrome.tabs.query({ active: true, currentWindow: true }))[0].id,
      );
      try {
        const pending = page.waitForEvent('download', { timeout: 10000 });
        const call = worker.evaluate((args) => globalThis.__probeBlobSource(args), {
          tabId,
          origin,
          mode,
        });
        const [download, result] = await Promise.all([pending, call]);
        const stream = await download.createReadStream();
        assert.ok(stream);
        const chunks = [];
        for await (const chunk of stream) chunks.push(chunk);
        const bytes = Buffer.concat(chunks);
        assert.equal(bytes.toString(), content);
        assert.equal(result.nativeCompleted, true);
        assert.equal(result.clickError, undefined);
        if (mode === 'dynamic' || mode === 'promise-hook') {
          assert.equal(result.status, 'captured', JSON.stringify(result));
          assert.equal(result.sourceSHA256, sha(bytes));
          assert.equal(result.sourceText, content);
          assert.deepEqual(result.info, { sizeBytes: 24, mimeType: 'text/csv' });
          assert.equal(result.restored, true);
        } else {
          assert.equal(result.bytesExposed, false);
          assert.equal(result.status, mode === 'competing-api' ? 'restore_unconfirmed' : 'refused');
          assert.equal(
            result.error,
            mode === 'competing-api'
              ? 'blob_capture_restore_unconfirmed'
              : mode === 'stopped'
                ? 'scope_unavailable'
                : 'blob_source_unavailable',
          );
        }
        assert.equal(await page.locator('body').getAttribute('data-clicks'), '1');
        assert.equal(await user.locator('#query').inputValue(), 'keep user input 731');
        assert.equal(
          await worker.evaluate(
            async () => (await chrome.tabs.query({ active: true, currentWindow: true }))[0].id,
          ),
          active,
        );
        assert.equal(sha(await readFile(source)), sourceHash);
        await writeFile(
          join(artifacts, `${mode}.json`),
          JSON.stringify(
            {
              result,
              originalDownload: { sizeBytes: bytes.length, sha256: sha(bytes) },
              normalTabUntouched: true,
              chromium: context.browser().version(),
            },
            null,
            2,
          ),
        );
        await download.delete();
      } finally {
        await page.close();
      }
    },
    { timeout: 30000 },
  );
