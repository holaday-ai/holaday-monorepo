/**
 * Offline extension e2e (batch 10.4).
 *
 *   pnpm --filter @holaday/extension e2e:offline
 *
 * 1. Starts a loopback mock orchestrator on a random port.
 * 2. Builds the unpacked extension in local-QA mode (VITE_LOCAL_CHROME_QA=1,
 *    loopback-only endpoints, loopback-only host permissions) into a temp dir.
 *    Production defaults are untouched: these env vars only exist in this build.
 * 3. Loads it into Playwright Chromium (new headless) via --load-extension.
 * 4. Drives: connect → tool calls (tabs / session open = snapshot / click /
 *    type) → result frames → orchestrator outage + restart → reconnect →
 *    continue on the same session → tab switch → service-worker recycle
 *    (CDP ServiceWorker.stopAllWorkers) → tab close.
 *
 * Debug: HOLADAY_E2E_DEBUG=1 prints browser + mock logs; HOLADAY_E2E_HEADED=1
 * shows the window.
 *
 * No real model, no external site: every page is served by the mock server.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { after, before, test } from 'node:test';
import { MockOrchestrator } from './mock-orchestrator.mjs';

// Reuse the workspace's locked Playwright (an orchestrator dependency).
const require = createRequire(new URL('../../orchestrator/package.json', import.meta.url));
const { chromium } = require('playwright');

const EXTENSION_ROOT = fileURLToPath(new URL('..', import.meta.url));
const ORCHESTRATOR_ROOT = fileURLToPath(new URL('../../orchestrator/', import.meta.url));

/** The orchestrator's real SelectedChromeClient (the runner's side of the
 *  selected-tab protocol), loaded through the workspace's tsx. */
async function loadSelectedChromeClient() {
  const { tsImport } = await import(
    pathToFileURL(join(ORCHESTRATOR_ROOT, 'node_modules', 'tsx', 'dist', 'esm', 'api', 'index.mjs')).href
  );
  const mod = await tsImport(
    pathToFileURL(join(ORCHESTRATOR_ROOT, 'src', 'agent', 'supercar', 'selected-chrome-client.ts')).href,
    import.meta.url,
  );
  return mod.SelectedChromeClient;
}
const TOKEN = 'e2e-synthetic-token-0001';
const TASK_ID = 'e2e-task-1';
const SECRET_PASSWORD = 'hunter2-e2e-secret';
const SECRET_OTP = '934211';

const server = new MockOrchestrator();
let workDir;
let context;
let serviceWorker;

function buildExtension(outDir) {
  const result = spawnSync(
    process.execPath,
    [join(EXTENSION_ROOT, 'node_modules', 'vite', 'bin', 'vite.js'), 'build', '--outDir', outDir, '--emptyOutDir'],
    {
      cwd: EXTENSION_ROOT,
      encoding: 'utf8',
      env: {
        ...process.env,
        VITE_LOCAL_CHROME_QA: '1',
        // Different origin from the fixture pages: the auth-bridge content
        // script mirrors the workbench's localStorage token (null there would
        // log the extension out), so fixtures must not be the workbench.
        VITE_WORKBENCH_URL: `http://localhost:${server.port}`,
        VITE_ORCHESTRATOR_HTTP: server.origin,
        VITE_ORCHESTRATOR_WS: `ws://127.0.0.1:${server.port}/ws`,
      },
    },
  );
  if (result.status !== 0) {
    throw new Error(`extension build failed:\n${result.stdout}\n${result.stderr}`);
  }
}

function roleSelector(description, role, name) {
  return { description, strategies: [{ kind: 'role', role, name }] };
}

function labelSelector(description, label) {
  return { description, strategies: [{ kind: 'label', value: label }] };
}

async function openSession(page) {
  await page.bringToFront();
  const listed = await server.call(TASK_ID, 'tabs');
  assert.equal(listed.ok, true);
  const title = await page.title();
  const tab = listed.result.tabs.find((t) => t.title === title);
  assert.ok(tab, `tab "${title}" should be listed`);
  const opened = await server.call(TASK_ID, 'session', {
    session: {
      op: 'open',
      target: { tabId: tab.tabId, expectedUrl: page.url(), selectionId: tab.selectionId },
    },
  });
  return { opened, tab, tabs: listed.result.tabs };
}

function act(sessionId, action) {
  return server.call(TASK_ID, 'session', { session: { op: 'act', sessionId, action } });
}

before(async () => {
  await server.start();
  workDir = mkdtempSync(join(tmpdir(), 'holaday-ext-e2e-'));
  const extDir = join(workDir, 'extension');
  buildExtension(extDir);
  context = await chromium.launchPersistentContext(join(workDir, 'profile'), {
    channel: 'chromium',
    headless: process.env.HOLADAY_E2E_HEADED !== '1',
    args: [`--disable-extensions-except=${extDir}`, `--load-extension=${extDir}`],
  });
  serviceWorker =
    context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker', { timeout: 15_000 }));
  if (process.env.HOLADAY_E2E_DEBUG === '1') {
    context.on('console', (msg) => console.log(`[browser:${msg.type()}]`, msg.text()));
  }
});

after(async () => {
  await context?.close().catch(() => undefined);
  await server.stop().catch(() => undefined);
  if (workDir) rmSync(workDir, { recursive: true, force: true });
});

test('extension offline e2e: connect → snapshot/click/type → reconnect → continue', { timeout: 180_000 }, async (t) => {
  let page;
  let sessionId;

  await t.test('connects with the stored token and receives welcome', async () => {
    // onInstalled('install') resets auth state asynchronously right after
    // load; keep re-seeding the synthetic token until the install reset has
    // settled and the extension has said hello.
    const connected = server.waitForConnection(1, 20_000);
    let settled = false;
    void connected.then(() => (settled = true), () => (settled = true));
    for (let i = 0; i < 20 && !settled; i += 1) {
      const stored = await serviceWorker.evaluate(async (token) => {
        const out = await chrome.storage.local.get('holaday.access_token');
        if (out['holaday.access_token'] !== token) {
          await chrome.storage.local.set({ 'holaday.access_token': token });
        }
        return out['holaday.access_token'] ?? null;
      }, TOKEN);
      if (stored === TOKEN) break;
      await new Promise((r) => setTimeout(r, 500));
    }
    const connection = await connected;
    assert.equal(connection.bearer, TOKEN);
    const hello = server.received.find((m) => m.type === 'client.hello');
    assert.equal(hello?.token, TOKEN);
  });

  await t.test('lists tabs and opens a selected-tab session (snapshot)', async () => {
    page = await context.newPage();
    await page.goto(`${server.origin}/page.html`);
    const { opened } = await openSession(page);
    assert.equal(opened.type, 'client.extension.tool_result');
    assert.equal(opened.taskId, TASK_ID);
    assert.equal(opened.ok, true, JSON.stringify(opened.error));
    sessionId = opened.result.sessionId;
    assert.match(sessionId, /^[0-9a-f-]{36}$/);
    const observation = opened.result.observation;
    assert.equal(observation.origin, server.origin);
    assert.match(observation.ariaSnapshot, /button "提交"/);
    assert.match(observation.bodyText, /已点击 0 次/);
  });

  await t.test('click via semantic role selector returns applied + fresh snapshot', async () => {
    const clicked = await act(sessionId, {
      kind: 'click',
      selector: roleSelector('提交按钮', 'button', '提交'),
    });
    assert.equal(clicked.ok, true, JSON.stringify(clicked.error));
    assert.equal(clicked.result.actionOutcome, 'applied');
    assert.match(clicked.result.observation.bodyText, /已点击 1 次/);
    assert.equal(await page.textContent('#status'), '已点击 1 次');
  });

  await t.test('type via label selector fills the field', async () => {
    const typed = await act(sessionId, {
      kind: 'type',
      selector: labelSelector('搜索词输入框', '搜索词'),
      payload: { text: 'hola e2e' },
    });
    assert.equal(typed.ok, true, JSON.stringify(typed.error));
    assert.equal(typed.result.actionOutcome, 'applied');
    assert.equal(await page.inputValue('#query'), 'hola e2e');
  });

  await t.test('snapshot never carries password / OTP values in plain text', async () => {
    // The user fills secrets themselves (e.g. during a human handoff).
    await page.fill('#pw', SECRET_PASSWORD);
    await page.fill('#otp', SECRET_OTP);
    const observed = await server.call(TASK_ID, 'session', { session: { op: 'observe', sessionId } });
    assert.equal(observed.ok, true, JSON.stringify(observed.error));
    const wire = JSON.stringify(observed);
    assert.ok(!wire.includes(SECRET_PASSWORD), 'password value leaked into observation');
    assert.ok(!wire.includes(SECRET_OTP), 'OTP value leaked into observation');
    // Non-sensitive typed values stay visible to the agent.
    assert.match(observed.result.observation.ariaSnapshot, /hola e2e/);
  });

  await t.test('orchestrator outage → extension reconnects → same session continues', async () => {
    const before = server.connections.length;
    await server.drop();
    await new Promise((r) => setTimeout(r, 2_000));
    await server.start();
    const connection = await server.waitForConnection(2, 45_000);
    assert.ok(server.connections.length > before);
    assert.equal(connection.bearer, TOKEN);

    const clicked = await act(sessionId, {
      kind: 'click',
      selector: roleSelector('提交按钮', 'button', '提交'),
    });
    assert.equal(clicked.ok, true, JSON.stringify(clicked.error));
    assert.equal(clicked.result.actionOutcome, 'applied');
    assert.equal(await page.textContent('#status'), '已点击 2 次');
  });

  await t.test('multiple tabs: listing shows both, user tab switch does not move the session', async () => {
    const second = await context.newPage();
    await second.goto(`${server.origin}/page2.html`);
    await second.bringToFront();
    const listed = await server.call(TASK_ID, 'tabs');
    const titles = listed.result.tabs.map((tab) => tab.title);
    assert.ok(titles.includes('E2E 页面一') && titles.includes('E2E 页面二'), titles.join(','));
    // Session stays pinned to tab one even though tab two is now active.
    const clicked = await act(sessionId, {
      kind: 'click',
      selector: roleSelector('提交按钮', 'button', '提交'),
    });
    assert.equal(clicked.ok, true, JSON.stringify(clicked.error));
    assert.equal(await page.textContent('#status'), '已点击 3 次');
    await second.close();
  });

  await t.test('service worker recycled → reconnects on wake; stale session is refused', async () => {
    const connectionsBefore = server.connections.filter((c) => c.helloAt).length;
    const extensionId = new URL(serviceWorker.url()).host;
    const cdp = await context.newCDPSession(page);
    await cdp.send('ServiceWorker.enable');
    await cdp.send('ServiceWorker.stopAllWorkers');
    await cdp.detach();
    // The socket must go away with the worker.
    const deadline = Date.now() + 10_000;
    while (server.sockets.size > 0 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 100));
    }
    assert.equal(server.sockets.size, 0, 'socket should close when the worker stops');
    // Wake the worker the way a user would (opening the popup).
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/src/popup/index.html`);
    const connection = await server.waitForConnection(connectionsBefore + 1, 30_000);
    assert.equal(connection.bearer, TOKEN);
    await popup.close();
    serviceWorker = context.serviceWorkers().at(-1) ?? serviceWorker;

    // In-memory selected session died with the worker: refused, never replayed.
    const stale = await act(sessionId, {
      kind: 'click',
      selector: roleSelector('提交按钮', 'button', '提交'),
    });
    assert.equal(stale.ok, false);
    assert.equal(stale.error?.code, 'session_unavailable');
    assert.equal(stale.result?.actionOutcome, 'not_applied');
    assert.equal(await page.textContent('#status'), '已点击 3 次');

    const { opened } = await openSession(page);
    assert.equal(opened.ok, true, JSON.stringify(opened.error));
    sessionId = opened.result.sessionId;
  });

  await t.test('closing the session tab fails safely and frees the seat', async () => {
    await page.close();
    const clicked = await act(sessionId, {
      kind: 'click',
      selector: roleSelector('提交按钮', 'button', '提交'),
    });
    assert.equal(clicked.ok, false);
    assert.notEqual(clicked.result?.actionOutcome, 'applied');
    const closed = await server.call(TASK_ID, 'session', { session: { op: 'close', sessionId } });
    assert.equal(closed.ok, true, JSON.stringify(closed.error));

    const fresh = await context.newPage();
    await fresh.goto(`${server.origin}/page.html`);
    const { opened } = await openSession(fresh);
    assert.equal(opened.ok, true, `new session after tab close: ${JSON.stringify(opened.error)}`);
    await server.call(TASK_ID, 'session', { session: { op: 'close', sessionId: opened.result.sessionId } });
  });
  await t.test('orchestrator SelectedChromeClient accepts every extension receipt', async () => {
    const SelectedChromeClient = await loadSelectedChromeClient();
    const contractPage = await context.newPage();
    await contractPage.goto(`${server.origin}/page.html`);
    await contractPage.bringToFront();
    const listed = await server.call(TASK_ID, 'tabs');
    const tab = listed.result.tabs.find((entry) => entry.title === 'E2E 页面一' && entry.active);
    assert.ok(tab, 'contract tab should be listed as active');
    const control = {
      canAgentAct: () => true,
      close: () => undefined,
      settled: async () => undefined,
      checkpoint: async (refresh) => {
        await refresh();
        return { resumed: false, waitedMs: 0 };
      },
    };
    const client = new SelectedChromeClient({
      userId: 'e2e-user',
      taskId: TASK_ID,
      extensionClientId: 'e2e-client',
      control,
      // Same mapping as ws/server.ts: tool_result frame → ExtensionToolCallOutcome.
      send: async (_userId, options) => {
        const frame = await server.call(options.taskId, options.kind, options.args);
        return {
          ok: frame.ok,
          ...(frame.result !== undefined ? { result: frame.result } : {}),
          ...(frame.error ? { error: frame.error } : {}),
        };
      },
    });

    const opened = await client.open({
      tabId: tab.tabId,
      expectedUrl: contractPage.url(),
      selectionId: tab.selectionId,
    });
    assert.equal(opened.ok, true, JSON.stringify(opened));
    assert.equal(opened.revision, 1);

    const clicked = await client.execute(
      { kind: 'click', selector: roleSelector('提交按钮', 'button', '提交') },
      client.revision,
    );
    assert.equal(clicked.ok, true, JSON.stringify(clicked));
    assert.equal(clicked.actionOutcome, 'applied');

    const typed = await client.execute(
      {
        kind: 'type',
        selector: labelSelector('搜索词输入框', '搜索词'),
        payload: { text: 'contract' },
      },
      client.revision,
    );
    assert.equal(typed.ok, true, JSON.stringify(typed));
    assert.equal(await contractPage.inputValue('#query'), 'contract');

    const missing = await client.execute(
      { kind: 'click', selector: roleSelector('不存在的按钮', 'button', '不存在') },
      client.revision,
    );
    assert.equal(missing.ok, false);
    assert.equal(missing.actionOutcome, 'not_applied', JSON.stringify(missing));

    await contractPage.fill('#pw', SECRET_PASSWORD);
    const observed = await client.observe();
    assert.equal(observed.ok, true, JSON.stringify(observed));
    assert.ok(!JSON.stringify(observed).includes(SECRET_PASSWORD));

    const closed = await client.close();
    assert.deepEqual(closed, { ok: true, closed: true });
  });
});
