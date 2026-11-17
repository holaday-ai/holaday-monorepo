/** Actual pinned CRX adapter/resolver. Isolated MV3 entry, not the product
 * background, task API, file permission flow or public-site acceptance. */
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
const { build } = createRequire(requireExtension.resolve('vite'))('esbuild');
const { chromium } = createRequire(new URL('../../orchestrator/package.json', import.meta.url))(
  'playwright',
);
const sdk = join(root, 'node_modules/.holaday-patched/playwright-crx-0.15.0-c024d5adc65c/lib');
const sources = [
  'crx-adapter.ts',
  'selected-target.ts',
  'native-download.ts',
  'native-blob-source.ts',
].map((name) => join(root, 'packages/browser-driver/src', name));
const content = 'sku,qty\nORIGINAL-731,31\n';
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
let origin;
let context;
let worker;
let user;
let workDir;
let artifacts;
let hashes;
const requests = [];
const blob = `<button id="export">Export report</button><script>window.beforeCreate=window.URL.createObjectURL;document.querySelector('#export').onclick=()=>{document.body.dataset.clicks='1';const file=new Blob([${JSON.stringify(content)}],{type:'text/csv'});const link=document.createElement('a');link.download='report.csv';link.href=window.URL.createObjectURL(file);link.click();};</script>`;
const server = createServer(async (request, response) => {
  if (request.url.startsWith('/export')) {
    const chunks = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    requests.push({ method: request.method, body: Buffer.concat(chunks).toString() });
    response.setHeader('Content-Type', 'text/csv');
    response.setHeader('Content-Disposition', 'attachment; filename="report.csv"');
    response.end(content);
    return;
  }
  response.setHeader('Content-Type', 'text/html');
  const mode = request.url.slice(1);
  response.end(
    mode === 'normal'
      ? '<input id="query">'
      : mode === 'post'
        ? '<form action="/export" method="post"><input type="hidden" name="report" value="731"><button id="export">Export report</button></form>'
        : mode === 'get'
          ? '<a id="export" href="/export">Export report</a>'
          : mode === 'cached'
            ? `${blob}<script>{const url=window.URL.createObjectURL(new Blob([${JSON.stringify(content)}],{type:'text/csv'}));document.querySelector('#export').onclick=()=>{document.body.dataset.clicks='1';const link=document.createElement('a');link.download='report.csv';link.href=url;link.click();};}</script>`
            : mode === 'child-blob'
              ? `<iframe srcdoc="${blob.replaceAll('&', '&amp;').replaceAll('"', '&quot;')}"></iframe>`
              : ['blob', 'recovery'].includes(mode)
                ? blob
                : '<a id="export" download="report.csv" href="data:text/csv,sku%2Cqty%0AORIGINAL-731%2C31%0A">Export report</a>',
  );
});
before(
  async () => {
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    origin = `http://127.0.0.1:${server.address().port}`;
    workDir = await mkdtemp(join(tmpdir(), 'holaday-native-download-'));
    artifacts = process.env.HOLADAY_E2E_ARTIFACT_DIR ?? join(workDir, 'artifacts');
    await mkdir(artifacts, { recursive: true });
    const extension = join(artifacts, 'extension');
    await mkdir(extension);
    if (process.env.HOLADAY_SOURCE_FREEZE_JSON) {
      const freeze = JSON.parse(await readFile(process.env.HOLADAY_SOURCE_FREEZE_JSON, 'utf8'));
      for (const [path, hash] of Object.entries(freeze))
        assert.equal(sha(await readFile(path)), hash, `source changed: ${path}`);
    }
    hashes = Object.fromEntries(
      await Promise.all(sources.map(async (path) => [path, sha(await readFile(path))])),
    );
    await mkdir(join(extension, 'sdk'));
    for (const name of ['index.mjs', 'index-DedCW3aV.mjs'])
      await copyFile(join(sdk, name), join(extension, 'sdk', name));
    const entry = `import {PlaywrightCrxAdapter} from ${JSON.stringify(sources[0])};
globalThis.__probeDownload=async({tabId,origin,mode})=>{
  const adapter=new PlaywrightCrxAdapter({attachToTabId:tabId,allowedOrigins:[origin],userBrowserRoutingV2:true});
  let live=true,failed=false;
  const original=chrome.debugger.sendCommand;
  if(mode==='recovery')chrome.debugger.sendCommand=function(target,method,params){if(target.tabId===tabId&&method==='Fetch.disable'&&!failed){failed=true;return Promise.reject(new Error('controlled restore rejected before dispatch'));}return Reflect.apply(original,chrome.debugger,[target,method,params]);};
  try{
    const attached=await adapter.attachExistingTab();if(attached.status!=='ok')throw new Error(JSON.stringify(attached));
    const observed=await adapter.observeCurrentPage();if(observed.status!=='ok')throw new Error(JSON.stringify(observed));
    const action={kind:'click',selector:{scope:{timeoutMs:2000},selfHeal:false,description:'Export task report',strategies:[{kind:'css',value:'#export'}]}};
    const described=await adapter.describeTarget(action,observed.data.observationRevision);if(described.status!=='ok')throw new Error(JSON.stringify(described));
    const binding={token:described.data.token,observationRevision:described.data.observationRevision};
    if(mode==='changed')await chrome.debugger.sendCommand({tabId},'Runtime.evaluate',{expression:'document.querySelector("#export").href="/export?account=changed"'});
    if(mode==='stopped')live=false;
    const captured=await adapter.captureDownloadBound(action,binding,()=>live);
    if(mode==='recovery')return {captured,afterRecovery:await adapter.observeCurrentPage(),afterInput:await adapter.execute({kind:'goto',payload:{url:origin+'/should-not-navigate'}})};
    if(captured.status!=='ok'||captured.data.status!=='captured')return {captured};
    const file=captured.data;
    const read=await adapter.readDownloadChunk(file.downloadId,0,256*1024,()=>live);
    if(read.status!=='ok')throw new Error(JSON.stringify(read));
    const bytes=read.data.bytes;
    const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
    adapter.releaseDownload(file.downloadId);
    const released=await adapter.readDownloadChunk(file.downloadId,0,24,()=>live);
    return {captured,sourceText:new TextDecoder().decode(bytes),sourceSHA256:hash,released};
  }finally{
    live=false;
    try{await adapter.dispose();}finally{chrome.debugger.sendCommand=original;}
  }
};`;
    await writeFile(join(artifacts, 'worker-source.js'), entry);
    await build({
      stdin: { contents: entry, resolveDir: root, sourcefile: 'native-download-worker.js' },
      bundle: true,
      format: 'esm',
      platform: 'browser',
      target: 'chrome120',
      outfile: join(extension, 'worker.js'),
      logLevel: 'warning',
      plugins: [
        {
          name: 'one-original-crx-graph',
          setup(builder) {
            builder.onResolve({ filter: /^playwright-crx$/ }, () => ({
              path: './sdk/index.mjs',
              external: true,
            }));
          },
        },
      ],
    });
    const manifest = {
      manifest_version: 3,
      name: 'Holaday isolated native download adapter',
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
      if (await worker.evaluate(() => typeof globalThis.__probeDownload === 'function')) break;
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
          sources: hashes,
          sdkEntrySHA256: sha(await readFile(join(sdk, 'index.mjs'))),
          sdkBundleSHA256: sha(await readFile(join(sdk, 'index-DedCW3aV.mjs'))),
          workerSHA256: sha(await readFile(join(extension, 'worker.js'))),
          manifest,
          node: process.version,
          chromium: context.browser().version(),
          limits: [
            'Actual adapter/resolver and pinned SDK in isolated MV3; not product background/protocol/task permissions, real account/public-site/physical OS acceptance.',
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
for (const mode of [
  'data',
  'blob',
  'get',
  'post',
  'child-blob',
  'cached',
  'changed',
  'stopped',
  'recovery',
])
  test(
    `actual bound CRX original download (${mode})`,
    async () => {
      requests.length = 0;
      const page = await context.newPage();
      await page.goto(`${origin}/${mode}`);
      if (mode === 'child-blob') await page.frameLocator('iframe').locator('#export').waitFor();
      const tabId = await worker.evaluate(
        async (url) => (await chrome.tabs.query({ url }))[0].id,
        `${origin}/${mode}`,
      );
      await user.bringToFront();
      const active = await worker.evaluate(
        async () => (await chrome.tabs.query({ active: true, currentWindow: true }))[0].id,
      );
      let download;
      try {
        const native = ['changed', 'stopped'].includes(mode)
          ? null
          : page.waitForEvent('download', { timeout: 10000 }).catch(() => null);
        const result = await worker.evaluate((args) => globalThis.__probeDownload(args), {
          tabId,
          origin,
          mode,
        });
        download = await native;
        if (['changed', 'stopped'].includes(mode)) {
          assert.equal(result.captured.status, 'error', JSON.stringify(result));
          assert.equal(result.captured.data.clickOutcome, 'not_applied');
          assert.deepEqual(requests, []);
        } else {
          assert.ok(download, 'actual native download missing');
          const chunks = [];
          const stream = await download.createReadStream();
          assert.ok(stream);
          for await (const chunk of stream) chunks.push(chunk);
          const actual = Buffer.concat(chunks);
          assert.equal(actual.toString(), content);
          if (mode === 'recovery') {
            assert.equal(result.captured.error.code, 'download_restore_unconfirmed');
            assert.equal(result.captured.data.clickOutcome, 'applied');
            assert.equal(result.captured.data.interceptionRestored, false);
            assert.equal(result.afterRecovery.status, 'error');
            assert.equal(result.afterInput.status, 'error');
            assert.equal(result.afterInput.error.code, 'session_unavailable');
            assert.equal(page.url(), `${origin}/recovery`);
          } else if (mode === 'cached') {
            assert.equal(result.captured.status, 'ok');
            assert.equal(result.captured.data.status, 'clicked');
            assert.equal(result.captured.data.reason, 'blob_source_unavailable');
            assert.equal(result.sourceText, undefined);
          } else {
            assert.equal(result.captured.status, 'ok', JSON.stringify(result));
            assert.equal(result.captured.data.status, 'captured', JSON.stringify(result));
            assert.deepEqual(result.captured.data.metadata, {
              filename: 'report.csv',
              mimeType: 'text/csv',
              sizeBytes: 24,
              sha256: sha(actual),
            });
            assert.equal(result.sourceText, content);
            assert.equal(result.sourceSHA256, sha(actual));
            assert.equal(result.released.error.code, 'download_unavailable');
          }
          assert.deepEqual(
            requests,
            mode === 'post'
              ? [{ method: 'POST', body: 'report=731' }]
              : mode === 'get'
                ? [{ method: 'GET', body: '' }]
                : [],
          );
        }
        assert.equal(await user.locator('#query').inputValue(), 'keep user input 731');
        assert.equal(
          await worker.evaluate(
            async () => (await chrome.tabs.query({ active: true, currentWindow: true }))[0].id,
          ),
          active,
        );
        for (const [path, hash] of Object.entries(hashes))
          assert.equal(sha(await readFile(path)), hash);
        await writeFile(
          join(artifacts, `${mode}.json`),
          JSON.stringify(
            {
              result,
              normalTabUntouched: true,
              originalRequests: requests,
              chromium: context.browser().version(),
            },
            null,
            2,
          ),
        );
      } finally {
        await download?.delete();
        await page.close();
      }
    },
    { timeout: 30000 },
  );
