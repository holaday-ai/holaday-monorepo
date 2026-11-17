/** Repository extension + real CRX + owned server file scope on loopback fixtures.
 * Auth/DB/model/WS boundaries are controlled; no real account or OS-dialog proof. */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
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
const taskId = 'e2e-owned-file-task';
const uploadCapability = 'task_file_upload_v1';
const chooserCapability = 'task_file_chooser_v1';
const protocol = {
  version: 2,
  capabilitiesVersion: 1,
  capabilities: [
    'real_target',
    'revision_binding',
    'exact_origin',
    'scroll',
    'select',
    'task_tabs',
    uploadCapability,
    chooserCapability,
  ],
};
let workDir;
let context;
let worker;
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const call = (session, task = taskId) => server.call(task, 'session', { session });
function successful(reply) {
  assert.equal(reply.ok, true, JSON.stringify({ error: reply.error, result: reply.result }));
  return reply.result;
}

before(
  async () => {
    await server.start();
    workDir = mkdtempSync(join(tmpdir(), 'holaday-native-upload-'));
    const artifacts = process.env.HOLADAY_E2E_ARTIFACT_DIR;
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
        .userBrowserProtocol.capabilities.includes(uploadCapability),
    );
  },
  { timeout: 60_000 },
);

after(async () => {
  await context?.close().catch(() => {});
  await server.stop().catch(() => {});
  if (workDir) rmSync(workDir, { recursive: true, force: true });
});

async function fixture(
  enabled = true,
  accept = '.csv',
  openSession = true,
  extraCapabilities = [],
) {
  const page = await context.newPage();
  await page.goto(`${server.origin}/page2.html`);
  await page.setContent(
    `<!doctype html><title>File upload fixture</title><form action="/receive?ticket=PRIVATE-FIXTURE" method="post"><label>Report<input id="report" type="file" accept="${accept}" style="display:none"></label></form><p id="receipt"></p><script>document.querySelector('#report').onchange=async function(){document.body.dataset.effects=String(Number(document.body.dataset.effects||0)+1);const bytes=new Uint8Array(await this.files[0].arrayBuffer());document.body.dataset.receivedBytes=String(bytes.length);document.body.dataset.lastByte=String(bytes[bytes.length-1]);document.body.dataset.sha=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');document.querySelector('#receipt').textContent='Received '+this.files[0].name+' with '+bytes.length+' verified bytes';}</script>`,
  );
  await page.bringToFront();
  const tabs = successful(await server.call(taskId, 'tabs')).tabs;
  const selected = tabs.find((tab) => tab.title === 'File upload fixture' && tab.active);
  assert.ok(selected);
  const target = {
    tabId: selected.tabId,
    expectedUrl: page.url(),
    selectionId: selected.selectionId,
  };
  const opened = openSession
    ? successful(
        await call({
          op: 'open',
          target,
          protocol: enabled
            ? { ...protocol, capabilities: [...protocol.capabilities, ...extraCapabilities] }
            : {
                ...protocol,
                capabilities: protocol.capabilities.filter((value) => value !== uploadCapability),
              },
          grantedOrigins: [server.origin],
        }),
      )
    : null;
  const user = await context.newPage();
  await user.goto(`${server.origin}/page.html`);
  await user.locator('#query').fill('keep normal browsing 731');
  await user.bringToFront();
  const active = await worker.evaluate(
    async () => (await chrome.tabs.query({ active: true, currentWindow: true }))[0]?.id,
  );
  const sessionId = opened?.sessionId;
  return {
    page,
    user,
    sessionId,
    target,
    revision: opened?.observation.observationRevision,
    active,
    close: async () => {
      if (sessionId) successful(await call({ op: 'close', sessionId }));
      await user.close();
      await page.close();
    },
  };
}

async function prepare(f, bytes, name = 'report.csv', mimeType = 'text/csv', chooserId) {
  const files = [
    { fileId: 'file_731', name, mimeType, sizeBytes: bytes.length, sha256: sha(bytes) },
  ];
  const action = {
    kind: 'upload',
    ...(!chooserId
      ? { selector: { description: 'Report', strategies: [{ kind: 'css', value: '#report' }] } }
      : {}),
    payload: { files, ...(chooserId ? { chooserId } : {}) },
  };
  const target = successful(
    await call({
      op: 'upload_describe',
      sessionId: f.sessionId,
      action,
      observationRevision: f.revision,
    }),
  ).target;
  assert.equal(target.fileInput.formOrigin, server.origin);
  assert.equal(JSON.stringify(target).includes('PRIVATE-FIXTURE'), false);
  const begin = {
    op: 'upload_begin',
    sessionId: f.sessionId,
    action,
    binding: { token: target.token, observationRevision: target.observationRevision },
  };
  const state = successful(await call(begin)).uploadState;
  assert.equal(state.phase, 'begun');
  assert.deepEqual(successful(await call(begin)).uploadState, state);
  return { transferId: state.transferId, files, target };
}
async function sendBytes(f, transferId, bytes) {
  for (let offset = 0; offset < bytes.length; offset += 256 * 1024) {
    const part = bytes.subarray(offset, offset + 256 * 1024);
    const receipt = successful(
      await call({
        op: 'upload_chunk',
        sessionId: f.sessionId,
        transferId,
        fileIndex: 0,
        offset,
        data: part.toString('base64'),
      }),
    ).uploadState;
    assert.equal(receipt.phase, 'progress');
    assert.equal(receipt.nextOffset, offset + part.length);
  }
}

test('actual repository extension file channel', { timeout: 180_000 }, async (t) => {
  for (const mode of ['detached', 'connected', 'child-frame', 'opaque-frame']) {
    await t.test(`actual CRX native chooser handle (${mode})`, async () => {
      const f = await fixture(
        true,
        '.csv',
        true,
        mode === 'connected' ? ['human_activity_v1'] : [],
      );
      try {
        const nativePage = (id = 'choose') =>
          `<button id="${id}" type="button" onclick="document.body.dataset.clicks=String(Number(document.body.dataset.clicks||0)+1);const file=document.createElement('input');file.type='file';file.accept='.csv';${mode === 'connected' ? 'document.body.append(file);' : ''}file.onchange=async()=>{document.body.dataset.effects=String(Number(document.body.dataset.effects||0)+1);const bytes=new Uint8Array(await file.files[0].arrayBuffer());document.body.dataset.sha=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');document.body.dataset.received=await file.files[0].text()};file.click()">Choose report</button>`;
        if (mode === 'child-frame' || mode === 'opaque-frame') {
          await f.page.setContent(
            mode === 'child-frame'
              ? '<button id="choose" type="button" onclick="frames[0].document.querySelector(\'button\').click()">Choose report</button><iframe></iframe>'
              : '<iframe sandbox="allow-scripts"></iframe>',
          );
          await f.page.locator('iframe').evaluate(
            (el, html) => {
              el.srcdoc = html;
            },
            nativePage(mode === 'child-frame' ? 'child-choose' : 'choose'),
          );
          await f.page.frameLocator('iframe').locator('button').waitFor();
        } else await f.page.setContent(nativePage());
        const observed = successful(
          await call({ op: 'observe', sessionId: f.sessionId }),
        ).observation;
        const action = {
          kind: 'click',
          selector: {
            description: 'Choose report',
            strategies: [{ kind: 'css', value: '#choose' }],
          },
        };
        const described = await call({
          op: 'describe',
          sessionId: f.sessionId,
          action,
          observationRevision: observed.observationRevision,
        });
        if (mode === 'opaque-frame' && !described.ok) {
          assert.equal(described.result.error, 'target_obscured');
          assert.equal(
            await f.page.frameLocator('iframe').locator('body').getAttribute('data-clicks'),
            null,
          );
          assert.equal(
            await f.page.frameLocator('iframe').locator('body').getAttribute('data-effects'),
            null,
          );
          const artifacts = process.env.HOLADAY_E2E_ARTIFACT_DIR;
          if (artifacts)
            writeFileSync(
              join(artifacts, 'chooser-opaque-frame.json'),
              JSON.stringify(
                {
                  stage: 'description',
                  error: described.result.error,
                  actualClicks: 0,
                  fileChanges: 0,
                  chromium: context.browser()?.version(),
                },
                null,
                2,
              ),
            );
          return;
        }
        const target = successful(described).target;
        const captured = successful(
          await call({
            op: 'chooser_open',
            sessionId: f.sessionId,
            action,
            binding: { token: target.token, observationRevision: target.observationRevision },
          }),
        );
        assert.equal(captured.actionOutcome, 'applied');
        if (mode === 'opaque-frame') {
          assert.deepEqual(captured.chooserState, {
            status: 'clicked',
            clickOutcome: 'applied',
            reason: 'chooser_unavailable',
          });
          assert.equal(
            await f.page.frameLocator('iframe').locator('body').getAttribute('data-clicks'),
            '1',
          );
          assert.equal(
            await f.page.frameLocator('iframe').locator('body').getAttribute('data-effects'),
            null,
          );
          const artifacts = process.env.HOLADAY_E2E_ARTIFACT_DIR;
          if (artifacts)
            writeFileSync(
              join(artifacts, 'chooser-opaque-frame.json'),
              JSON.stringify(
                {
                  state: captured.chooserState,
                  actualClicks: 1,
                  fileChanges: 0,
                  chromium: context.browser()?.version(),
                },
                null,
                2,
              ),
            );
          return;
        }
        assert.equal(captured.chooserState.status, 'captured');
        const bytes = Buffer.from('sku,qty\nA-731,31\n');
        const p = await prepare(
          { ...f, revision: captured.observation.observationRevision },
          bytes,
          'report.csv',
          'text/csv',
          captured.chooserState.chooserId,
        );
        if (mode === 'child-frame') assert.notEqual(p.target.frameId, target.frameId);
        await sendBytes(f, p.transferId, bytes);
        const result = successful(
          await call({ op: 'upload_commit', sessionId: f.sessionId, transferId: p.transferId }),
        );
        assert.equal(result.uploadState.receipt.status, 'handed_to_page');
        const child = mode === 'child-frame';
        await f.page.waitForFunction(
          ({ hash, child }) => {
            const doc = child ? frames[0].document : document;
            return doc.body.dataset.sha === hash;
          },
          { hash: sha(bytes), child },
        );
        const actual = await f.page.evaluate((child) => {
          const doc = child ? frames[0].document : document;
          return {
            received: doc.body.dataset.received,
            effects: doc.body.dataset.effects,
            clicks: doc.body.dataset.clicks,
          };
        }, child);
        assert.equal(actual.received, 'sku,qty\nA-731,31\n');
        assert.equal(actual.effects, '1');
        assert.equal(actual.clicks, '1');
        assert.equal(await f.user.locator('#query').inputValue(), 'keep normal browsing 731');
        assert.equal(
          await worker.evaluate(
            async () => (await chrome.tabs.query({ active: true, currentWindow: true }))[0]?.id,
          ),
          f.active,
        );
        const artifacts = process.env.HOLADAY_E2E_ARTIFACT_DIR;
        if (artifacts)
          writeFileSync(
            join(artifacts, `chooser-${mode}.json`),
            JSON.stringify(
              {
                actual,
                nativeTarget: p.target,
                clickTarget: target,
                normalTabUntouched: true,
                chromium: context.browser()?.version(),
              },
              null,
              2,
            ),
          );
      } finally {
        await f.close();
      }
    });
  }
  const host = await tsImport(
    new URL('../../orchestrator/src/files/testing/chrome-upload-candidate.ts', import.meta.url)
      .href,
    import.meta.url,
  );
  for (const mode of ['owned', 'declined', 'unprovided', 'full-budget']) {
    await t.test(`current server runner and actual loaded extension (${mode})`, async () => {
      const f = await fixture(true, '.csv', false);
      const commands = [];
      try {
        const result = await host.runChromeUploadCandidate({
          mode,
          taskId,
          target: f.target,
          origin: server.origin,
          send: async (_user, options) => {
            commands.push(options.args?.session?.op);
            return server.call(options.taskId, options.kind, options.args);
          },
        });
        assert.equal(result.closeConfirmed, true);
        if (mode === 'owned' || mode === 'full-budget') {
          assert.equal(result.outcome.status, 'completed', JSON.stringify(result.outcome));
          await f.page.waitForFunction(
            (hash) => document.body.dataset.sha === hash,
            result.expectedSHA256,
          );
          assert.equal(
            await f.page.locator('body').getAttribute('data-received-bytes'),
            String(result.sizeBytes),
          );
          assert.equal(
            await f.page.locator('body').getAttribute('data-last-byte'),
            String(result.lastByte),
          );
          assert.equal(await f.page.locator('body').getAttribute('data-effects'), '1');
          assert.ok(commands.includes('upload_commit'));
          assert.deepEqual(result.questions, []);
        } else {
          assert.notEqual(result.outcome.status, 'completed');
          assert.equal(await f.page.locator('body').getAttribute('data-effects'), null);
          assert.equal(commands.includes('upload_begin'), false);
          if (mode === 'declined') {
            assert.equal(result.questions.length, 1);
            assert.ok(result.questions[0].includes('report.csv'));
          } else assert.deepEqual(result.admittedFileIds, []);
        }
        assert.ok(result.maxModelRequestBytes < 100_000);
        assert.equal(commands.filter((op) => op === 'close').length, 1);
        const normalInput = await f.user.locator('#query').inputValue();
        const activeAfter = await worker.evaluate(
          async () => (await chrome.tabs.query({ active: true, currentWindow: true }))[0]?.id,
        );
        assert.equal(normalInput, 'keep normal browsing 731');
        assert.equal(activeAfter, f.active);
        const actualFile = await f.page.locator('#report').evaluate((node) => ({
          count: node.files.length,
          sha256: document.body.dataset.sha ?? null,
          sizeBytes: document.body.dataset.receivedBytes ?? null,
          lastByte: document.body.dataset.lastByte ?? null,
          effects: document.body.dataset.effects ?? null,
          visibleReceipt: document.querySelector('#receipt').textContent,
        }));
        assert.equal(actualFile.count, mode === 'owned' || mode === 'full-budget' ? 1 : 0);
        const artifacts = process.env.HOLADAY_E2E_ARTIFACT_DIR;
        if (artifacts)
          writeFileSync(
            join(artifacts, `server-${mode}.json`),
            JSON.stringify(
              {
                ...result,
                commands,
                actualFile,
                normalTab: { before: f.active, after: activeAfter, input: normalInput },
                chromium: context.browser()?.version(),
                normalTabUntouched: true,
              },
              null,
              2,
            ),
          );
      } finally {
        await f.close();
      }
    });
  }
  await t.test(
    'bound ordinary inputs still use the current driver and preserve the user tab',
    async () => {
      const f = await fixture();
      try {
        await f.page.setContent(
          '<input id="notes"><select id="choice"><option>A</option><option>B</option></select><button id="go" onclick="document.body.dataset.effects=String(Number(document.body.dataset.effects||0)+1)">Run</button>',
        );
        let observation = successful(
          await call({ op: 'observe', sessionId: f.sessionId }),
        ).observation;
        const selector = (value) => ({
          description: 'Input fixture',
          strategies: [{ kind: 'css', value }],
        });
        const actions = [
          { kind: 'type', selector: selector('#notes'), payload: { text: 'native731' } },
          { kind: 'select', selector: selector('#choice'), payload: { text: 'B' } },
          { kind: 'click', selector: selector('#go') },
          { kind: 'key', payload: { key: 'Enter' } },
        ];
        for (const action of actions) {
          const target = successful(
            await call({
              op: 'describe',
              sessionId: f.sessionId,
              action,
              observationRevision: observation.observationRevision,
            }),
          ).target;
          const result = successful(
            await call({
              op: 'act',
              sessionId: f.sessionId,
              action,
              binding: { token: target.token, observationRevision: target.observationRevision },
            }),
          );
          assert.equal(result.actionOutcome, 'applied');
          observation = result.observation;
        }
        assert.equal(await f.page.locator('#notes').inputValue(), 'native731');
        assert.equal(await f.page.locator('#choice').inputValue(), 'B');
        assert.equal(await f.page.locator('body').getAttribute('data-effects'), '2');
        assert.equal(await f.user.locator('#query').inputValue(), 'keep normal browsing 731');
        assert.equal(
          await worker.evaluate(
            async () => (await chrome.tabs.query({ active: true, currentWindow: true }))[0]?.id,
          ),
          f.active,
        );
      } finally {
        await f.close();
      }
    },
  );
  await t.test('bound exact bytes, deduplication and background task target', async () => {
    const f = await fixture();
    try {
      const bytes = Buffer.from('sku,qty\nA-731,31\n');
      const p = await prepare(f, bytes);
      await sendBytes(f, p.transferId, bytes);
      assert.equal(await f.page.locator('body').getAttribute('data-effects'), null);
      const commit = { op: 'upload_commit', sessionId: f.sessionId, transferId: p.transferId };
      const receipt = successful(await call(commit)).uploadState;
      assert.equal(receipt.phase, 'finished');
      assert.equal(receipt.receipt.status, 'handed_to_page');
      assert.deepEqual(receipt.receipt.files, p.files);
      assert.deepEqual(successful(await call(commit)).uploadState, receipt);
      await f.page.waitForFunction((hash) => document.body.dataset.sha === hash, sha(bytes));
      assert.equal(await f.page.locator('body').getAttribute('data-effects'), '1');
      assert.equal(await f.user.locator('#query').inputValue(), 'keep normal browsing 731');
      assert.equal(
        await worker.evaluate(
          async () => (await chrome.tabs.query({ active: true, currentWindow: true }))[0]?.id,
        ),
        f.active,
      );
    } finally {
      await f.close();
    }
  });
  await t.test('changed target and another task cannot obtain native file selection', async () => {
    const f = await fixture();
    try {
      const bytes = Buffer.from('sku,qty\nA-731,31\n');
      const p = await prepare(f, bytes);
      const denied = await call(
        {
          op: 'upload_chunk',
          sessionId: f.sessionId,
          transferId: p.transferId,
          fileIndex: 0,
          offset: 0,
          data: bytes.toString('base64'),
        },
        'other-task',
      );
      assert.equal(denied.ok, false);
      assert.equal(denied.result.error, 'session_unavailable');
      await sendBytes(f, p.transferId, bytes);
      await f.page.locator('#report').evaluate((node) => node.replaceWith(node.cloneNode()));
      const receipt = successful(
        await call({ op: 'upload_commit', sessionId: f.sessionId, transferId: p.transferId }),
      ).uploadState.receipt;
      assert.equal(receipt.status, 'not_applied');
      assert.equal(await f.page.locator('#report').evaluate((node) => node.files.length), 0);
      assert.equal(await f.page.locator('body').getAttribute('data-effects'), null);
    } finally {
      await f.close();
    }
  });
  await t.test('old capability negotiation keeps upload unavailable', async () => {
    const f = await fixture(false);
    try {
      const denied = await call({
        op: 'upload_describe',
        sessionId: f.sessionId,
        action: {
          kind: 'upload',
          selector: { description: 'Report', strategies: [{ kind: 'css', value: '#report' }] },
          payload: {
            files: [
              {
                fileId: 'file_731',
                name: 'report.csv',
                mimeType: 'text/csv',
                sizeBytes: 0,
                sha256: sha(Buffer.alloc(0)),
              },
            ],
          },
        },
        observationRevision: f.revision,
      });
      assert.equal(denied.ok, false);
      assert.equal(denied.result.error, 'capability_missing');
    } finally {
      await f.close();
    }
  });
  await t.test('full 50MiB arrives through the actual CRX buffer and file input', async () => {
    const f = await fixture(true, '.bin');
    try {
      const bytes = Buffer.alloc(50 * 1024 * 1024);
      bytes[bytes.length - 1] = 90;
      const p = await prepare(f, bytes, 'payload.bin', 'application/octet-stream');
      await sendBytes(f, p.transferId, bytes);
      const state = successful(
        await call({ op: 'upload_commit', sessionId: f.sessionId, transferId: p.transferId }),
      ).uploadState;
      assert.equal(state.receipt.status, 'handed_to_page', JSON.stringify(state));
      await f.page.waitForFunction((hash) => document.body.dataset.sha === hash, sha(bytes), {
        timeout: 20_000,
      });
      assert.equal(await f.page.locator('body').getAttribute('data-received-bytes'), '52428800');
      assert.equal(await f.page.locator('body').getAttribute('data-last-byte'), '90');
      assert.equal(await f.page.locator('body').getAttribute('data-effects'), '1');
    } finally {
      await f.close();
    }
  });
});
