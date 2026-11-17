/** Actual repository extension + original native downloads + server task FileService.
 * Auth/DB/model/WS boundaries are controlled; no real account or OS-dialog proof. */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { MockOrchestrator } from './mock-orchestrator.mjs';

const require = createRequire(new URL('../../orchestrator/package.json', import.meta.url));
const { chromium } = require('playwright');
const { tsImport } = require('tsx/esm/api');
const root = fileURLToPath(new URL('..', import.meta.url));
const server = new MockOrchestrator();
const taskId = 'e2e-original-download-task';
const downloadCapability = 'task_file_download_v1';
let artifacts;
let siteOrigin;
const requests = [];
const content = 'sku,qty\nORIGINAL-731,31\n';
const sourcePath =
  '/export?ticket=PRIVATE-SOURCE-731&x=%2f&x=+&range=7&X-Amz-Signature=PRIVATE-SOURCE-731';
const blobHTML = `<button id="export">Export report</button><script>document.querySelector('#export').onclick=()=>{document.body.dataset.clicks='1';const blob=new Blob([${JSON.stringify(content)}],{type:'text/csv'});const a=document.createElement('a');a.href=window.URL.createObjectURL(blob);a.download='report.csv';a.click();};</script>`;
const site = createServer(async (request, response) => {
  const path = new URL(request.url, 'http://fixture').pathname;
  if (path === '/export') {
    const chunks = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    requests.push({
      method: request.method,
      path: request.url,
      body: Buffer.concat(chunks).toString(),
    });
    if (request.url.includes('defer=1')) await new Promise((resolve) => setTimeout(resolve, 5500));
    if (response.destroyed) return;
    response.setHeader('Content-Type', 'text/csv');
    response.setHeader('Content-Disposition', 'attachment; filename="report.csv"');
    response.end(content);
    return;
  }
  const kind = path.slice(1);
  let body = blobHTML;
  if (kind === 'roundtrip')
    body += `<input hidden id="report" type="file" accept=".csv"><p id="received"></p><script>document.querySelector('#report').onchange=async function(){const bytes=new Uint8Array(await this.files[0].arrayBuffer());document.body.dataset.changes=String(Number(document.body.dataset.changes||0)+1);document.body.dataset.receivedSha=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');document.querySelector('#received').textContent='Received report.csv';};</script>`;
  if (kind === 'get')
    body = `<a id="export" href="${sourcePath}" onclick="document.body.dataset.clicks='1'">Export report</a>`;
  if (kind === 'get-delayed')
    body = `<a id="export" href="${sourcePath}&defer=1" onclick="document.body.dataset.clicks='1'">Export report</a>`;
  if (kind === 'post')
    body = `<form action="${sourcePath}" method="post"><input type="hidden" name="report" value="731"><button id="export" onclick="document.body.dataset.clicks='1'">Export report</button></form>`;
  if (kind === 'data')
    body = `<a id="export" href="data:text/csv,sku%2Cqty%0AORIGINAL-731%2C31%0A" download="report.csv" onclick="document.body.dataset.clicks='1'">Export report</a>`;
  if (kind === 'child')
    body = `<iframe srcdoc="${blobHTML.replaceAll('&', '&amp;').replaceAll('"', '&quot;')}"></iframe>`;
  if (kind === 'cached')
    body += `<script>{const url=window.URL.createObjectURL(new Blob([${JSON.stringify(content)}],{type:'text/csv'}));document.querySelector('#export').onclick=()=>{document.body.dataset.clicks='1';const a=document.createElement('a');a.href=url;a.download='report.csv';a.click();};}</script>`;
  response.setHeader('Content-Type', 'text/html');
  response.end(`<!doctype html><title>Original download ${kind}</title>${body}`);
});
let workDir;
let context;
let worker;
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
function successful(reply) {
  assert.equal(reply.ok, true, JSON.stringify({ error: reply.error, result: reply.result }));
  return reply.result;
}

before(
  async () => {
    await server.start();
    await new Promise((resolve) => site.listen(0, '127.0.0.1', resolve));
    siteOrigin = `http://127.0.0.1:${site.address().port}`;
    workDir = mkdtempSync(join(tmpdir(), 'holaday-task-download-'));
    artifacts = process.env.HOLADAY_E2E_ARTIFACT_DIR ?? join(workDir, 'artifacts');
    const out = artifacts ? join(artifacts, 'extension') : join(workDir, 'extension');
    if (artifacts) mkdirSync(artifacts, { recursive: true });
    if (process.env.HOLADAY_SOURCE_FREEZE_JSON) {
      const frozen = JSON.parse(readFileSync(process.env.HOLADAY_SOURCE_FREEZE_JSON, 'utf8'));
      for (const [path, hash] of Object.entries(frozen))
        assert.equal(sha(readFileSync(path)), hash, `source changed: ${path}`);
    }
    const built = spawnSync(
      process.execPath,
      [join(root, 'node_modules/vite/bin/vite.js'), 'build', '--outDir', out, '--emptyOutDir'],
      {
        cwd: root,
        encoding: 'utf8',
        env: {
          ...process.env,
          NODE_ENV: 'production',
          VITE_LOCAL_CHROME_QA: '1',
          VITE_WORKBENCH_URL: `http://localhost:${server.port}`,
          VITE_ORCHESTRATOR_HTTP: server.origin,
          VITE_ORCHESTRATOR_WS: `ws://127.0.0.1:${server.port}/ws`,
        },
      },
    );
    assert.equal(built.status, 0, `candidate build failed\n${built.stdout}\n${built.stderr}`);
    if (artifacts) {
      const hashes = {};
      const walk = (dir) => {
        for (const item of readdirSync(dir, { withFileTypes: true })) {
          const path = join(dir, item.name);
          if (item.isDirectory()) walk(path);
          else hashes[path.slice(out.length + 1)] = sha(readFileSync(path));
        }
      };
      walk(out);
      writeFileSync(
        join(artifacts, 'build-proof.json'),
        JSON.stringify(
          {
            files: hashes,
            manifest: JSON.parse(readFileSync(join(out, 'manifest.json'), 'utf8')),
            freeze: process.env.HOLADAY_SOURCE_FREEZE_JSON ?? null,
          },
          null,
          2,
        ),
      );
    }
    context = await chromium.launchPersistentContext(join(workDir, 'profile'), {
      channel: 'chromium',
      headless: true,
      args: [
        '--renderer-process-limit=2',
        `--disable-extensions-except=${out}`,
        `--load-extension=${out}`,
      ],
    });
    worker =
      context.serviceWorkers()[0] ??
      (await context.waitForEvent('serviceworker', { timeout: 15_000 }));
    const connected = server.waitForConnection(1, 20_000);
    for (let i = 0; i < 20 && !server.received.some((msg) => msg.type === 'client.hello'); i++) {
      await worker.evaluate(async () =>
        chrome.storage.local.set({ 'holaday.access_token': 'e2e-synthetic-file-token-0001' }),
      );
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    await connected;
    assert.ok(
      server.received
        .find((msg) => msg.type === 'client.hello')
        .userBrowserProtocol.capabilities.includes(downloadCapability),
    );
  },
  { timeout: 60_000 },
);

after(async () => {
  await context?.close().catch(() => {});
  await server.stop().catch(() => {});
  await new Promise((resolve) => site.close(resolve));
  if (workDir) rmSync(workDir, { recursive: true, force: true });
});

const host = await tsImport(
  new URL('../../orchestrator/src/files/testing/chrome-download-candidate.ts', import.meta.url)
    .href,
  import.meta.url,
);
const cases = ['get', 'get-delayed', 'post', 'data', 'blob', 'child']
  .map((kind) => ({ kind, mode: 'owned' }))
  .concat(
    [{ kind: 'cached', mode: 'cached' }],
    [{ kind: 'roundtrip', mode: 'roundtrip' }],
    ['denied', 'lost-open', 'corrupt-chunk', 'store-unknown'].map((mode) => ({
      kind: 'blob',
      mode,
    })),
  );
for (const { kind, mode } of cases)
  test(`actual task original download (${kind}/${mode})`, { timeout: 45000 }, async () => {
    requests.length = 0;
    const page = await context.newPage();
    await page.goto(`${siteOrigin}/${kind}?ticket=PRIVATE-PAGE-731&range=7`);
    if (kind === 'child') await page.frameLocator('iframe').locator('#export').waitFor();
    await page.bringToFront();
    const tabs = successful(await server.call(taskId, 'tabs')).tabs;
    const selected = tabs.find((tab) => tab.title === `Original download ${kind}` && tab.active);
    assert.ok(selected);
    const target = {
      tabId: selected.tabId,
      expectedUrl: page.url(),
      selectionId: selected.selectionId,
    };
    const user = await context.newPage();
    await user.goto(`${server.origin}/page.html`);
    await user.locator('#query').fill('keep normal browsing 731');
    await user.bringToFront();
    const active = await worker.evaluate(
      async () => (await chrome.tabs.query({ active: true, currentWindow: true }))[0].id,
    );
    const downloads = [];
    page.on('download', (download) => downloads.push(download));
    try {
      const pending = host.runChromeDownloadCandidate({
        mode,
        taskId,
        target,
        confirmPost: kind === 'post' && mode === 'owned',
        confirmTransfer: mode === 'roundtrip',
        send: async (_user, options) => server.call(options.taskId, options.kind, options.args),
      });
      pending.catch(() => {});
      if (kind === 'get-delayed') {
        await page.waitForFunction(() => document.body.dataset.clicks === '1');
        await user.locator('#query').fill('keep normal browsing 731 continued');
      }
      const result = await pending;
      writeFileSync(
        join(artifacts, `${kind}-${mode}-result.json`),
        JSON.stringify(result, null, 2),
      );
      assert.equal(result.closeConfirmed, true, JSON.stringify(result));
      assert.equal(
        result.modelPrivateDataLeaked,
        false,
        'original URLs/bytes entered model messages',
      );
      assert.equal(result.modelNonSensitiveQueryPreserved, true);
      assert.equal(
        result.questions.length,
        (kind === 'post' && mode === 'owned') || mode === 'roundtrip' ? 1 : 0,
      );
      const expectedSHA = sha(Buffer.from(content));
      if (mode === 'owned' || mode === 'roundtrip') {
        assert.equal(result.outcome.status, 'completed', JSON.stringify(result));
        assert.equal(result.stores, 1);
        assert.equal(result.published.length, 1);
        assert.equal(result.admitted.length, 1);
        assert.deepEqual(
          result.stored.map((file) => ({
            text: file.text,
            size: file.sizeBytes,
            sha: file.sha256,
            mime: file.mimeType,
          })),
          [{ text: content, size: 24, sha: expectedSHA, mime: 'text/csv' }],
        );
        assert.equal(result.admitted[0].source.kind, 'browser_download');
        assert.equal(result.admitted[0].source.origin, siteOrigin);
        if (mode === 'roundtrip') {
          assert.equal(result.commands.filter((op) => op === 'upload_commit').length, 1);
          assert.equal(await page.locator('body').getAttribute('data-changes'), '1');
          assert.equal(await page.locator('body').getAttribute('data-received-sha'), expectedSHA);
        }
      } else {
        assert.notEqual(result.outcome.status, 'completed', JSON.stringify(result));
        assert.equal(result.published.length, 0);
        assert.equal(result.admitted.length, 0);
        assert.equal(result.stores, mode === 'store-unknown' ? 1 : 0);
        assert.equal(result.stored.length, mode === 'store-unknown' ? 1 : 0);
        if (mode === 'store-unknown') assert.equal(result.stored[0].sha256, expectedSHA);
      }
      assert.equal(
        result.commands.filter((op) => op === 'download_open').length,
        mode === 'denied' ? 0 : 1,
      );
      if (mode !== 'denied') {
        for (let i = 0; !downloads.length && i < 40; i++)
          await new Promise((resolve) => setTimeout(resolve, 25));
        assert.equal(downloads.length, 1);
        const stream = await downloads[0].createReadStream();
        assert.ok(stream);
        const chunks = [];
        for await (const chunk of stream) chunks.push(chunk);
        assert.equal(sha(Buffer.concat(chunks)), expectedSHA);
      } else assert.equal(downloads.length, 0);
      const clicks =
        kind === 'child'
          ? await page.frameLocator('iframe').locator('body').getAttribute('data-clicks')
          : await page.locator('body').getAttribute('data-clicks');
      assert.equal(clicks, mode === 'denied' ? null : '1');
      assert.deepEqual(
        requests,
        kind === 'get' || kind === 'get-delayed'
          ? [
              {
                method: 'GET',
                path: sourcePath + (kind === 'get-delayed' ? '&defer=1' : ''),
                body: '',
              },
            ]
          : kind === 'post'
            ? [{ method: 'POST', path: sourcePath, body: 'report=731' }]
            : [],
      );
      assert.equal(page.url(), `${siteOrigin}/${kind}?ticket=PRIVATE-PAGE-731&range=7`);
      assert.equal(
        await user.locator('#query').inputValue(),
        kind === 'get-delayed' ? 'keep normal browsing 731 continued' : 'keep normal browsing 731',
      );
      assert.equal(
        await worker.evaluate(
          async () => (await chrome.tabs.query({ active: true, currentWindow: true }))[0].id,
        ),
        active,
      );
      writeFileSync(
        join(artifacts, `${kind}-${mode}.json`),
        JSON.stringify(
          {
            result,
            originalRequests: requests,
            nativeDownloads: downloads.length,
            normalTabUntouched: true,
            otherTabInputWhileWaiting: kind === 'get-delayed',
            chromium: context.browser().version(),
          },
          null,
          2,
        ),
      );
    } finally {
      for (const download of downloads) await download.delete();
      await user.close();
      await page.close();
    }
  });
