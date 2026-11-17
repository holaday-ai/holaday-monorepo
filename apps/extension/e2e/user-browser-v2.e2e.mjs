/** Local protocol-v2 acceptance using the real bundled repository extension.
 * Run: node --test e2e/user-browser-v2.e2e.mjs
 * Loopback synthetic pages/token only; no real account or model calls.
 * Covers real targets, confirmation, revisions, origins and protected task tabs.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { MockOrchestrator } from './mock-orchestrator.mjs';

// Reuse the workspace's locked Playwright (an orchestrator dependency).
const require = createRequire(new URL('../../orchestrator/package.json', import.meta.url));
const { chromium } = require('playwright');

const EXTENSION_ROOT = fileURLToPath(new URL('..', import.meta.url));
const ORCHESTRATOR_ROOT = fileURLToPath(new URL('../../orchestrator/', import.meta.url));

const TOKEN = 'e2e-synthetic-token-0001';
const TASK_ID = 'e2e-v2-task';

const server = new MockOrchestrator();
let workDir;
let context;
let serviceWorker;

function buildExtension(outDir) {
  const result = spawnSync(
    process.execPath,
    [
      join(EXTENSION_ROOT, 'node_modules', 'vite', 'bin', 'vite.js'),
      'build',
      '--outDir',
      outDir,
      '--emptyOutDir',
    ],
    {
      cwd: EXTENSION_ROOT,
      encoding: 'utf8',
      env: {
        ...process.env,
        NODE_ENV: process.env.HOLADAY_E2E_REACT_DEV === '1' ? 'development' : 'production',
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

before(async () => {
  await server.start();
  workDir = mkdtempSync(join(tmpdir(), 'holaday-ext-e2e-'));
  const extDir = join(workDir, 'extension');
  buildExtension(extDir);
  context = await chromium.launchPersistentContext(join(workDir, 'profile'), {
    channel: 'chromium',
    headless: process.env.HOLADAY_E2E_HEADED !== '1',
    args: [
      '--renderer-process-limit=2',
      `--disable-extensions-except=${extDir}`,
      `--load-extension=${extDir}`,
    ],
  });
  serviceWorker =
    context.serviceWorkers()[0] ??
    (await context.waitForEvent('serviceworker', { timeout: 15_000 }));
  if (process.env.HOLADAY_E2E_DEBUG === '1') {
    context.on('console', (msg) => console.log(`[browser:${msg.type()}]`, msg.text()));
  }
});

after(async () => {
  await context?.close().catch(() => undefined);
  await server.stop().catch(() => undefined);
  if (workDir) rmSync(workDir, { recursive: true, force: true });
});

async function loadServerModule(name) {
  const { tsImport } = await import(
    pathToFileURL(join(ORCHESTRATOR_ROOT, 'node_modules', 'tsx', 'dist', 'esm', 'api', 'index.mjs'))
      .href
  );
  return tsImport(pathToFileURL(join(ORCHESTRATOR_ROOT, 'src', name)).href, import.meta.url);
}
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
  ],
};
const css = (value) => ({ description: 'model hint Search', strategies: [{ kind: 'css', value }] });
const call = (session) => server.call(TASK_ID, 'session', { session });
test(
  'repository extension v2: real target, gate, revisions and protected task tabs',
  { timeout: 180_000 },
  async (t) => {
    let page;
    let sessionId;
    let revision;
    let selected;
    const connect = server.waitForConnection(1, 20_000);
    for (let i = 0; i < 20 && !server.connections.some((c) => c.helloAt); i++) {
      await serviceWorker.evaluate(
        async (token) => chrome.storage.local.set({ 'holaday.access_token': token }),
        TOKEN,
      );
      await new Promise((r) => setTimeout(r, 500));
    }
    await connect;
    assert.deepEqual(
      server.received.find((m) => m.type === 'client.hello').userBrowserProtocol,
      { ...protocol, capabilities: [...protocol.capabilities, 'human_activity_v1', 'task_file_upload_v1'] },
    );
    const open = async (p) => {
      await p.bringToFront();
      const list = await server.call(TASK_ID, 'tabs');
      const tab = list.result.tabs.find((x) => x.title === 'V2 fixture' && x.active);
      assert.ok(tab);
      selected = tab;
      const reply = await call({
        op: 'open',
        target: { tabId: tab.tabId, expectedUrl: server.origin, selectionId: tab.selectionId },
        protocol,
        grantedOrigins: [server.origin],
      });
      assert.equal(reply.ok, true, reply.error?.code);
      sessionId = reply.result.sessionId;
      revision = reply.result.observation.observationRevision;
    };
    const observe = async () => {
      const result = await call({ op: 'observe', sessionId });
      assert.equal(result.ok, true, result.error?.code);
      revision = result.result.observation.observationRevision;
      return result;
    };
    const describe = async (action) =>
      call({ op: 'describe', sessionId, action, observationRevision: revision });
    const bound = async (action, target) =>
      call({
        op: 'act',
        sessionId,
        action,
        binding: { token: target.token, observationRevision: target.observationRevision },
      });
    await t.test('task-tab preparation survives a worker crash before the marker receipt and after navigation', async () => {
      const source = await context.newPage();
      const sourceUrl = `${server.origin}/v2.html?recovery=source-private-signed-value`;
      await source.goto(sourceUrl);
      const user = await context.newPage();
      await user.goto(`${server.origin}/page.html`);
      await user.locator('#query').fill('normal user browsing');
      const discovered = await server.call(TASK_ID, 'tabs');
      const original = discovered.result.tabs.find((tab) => tab.title === 'V2 fixture');
      const userTab = discovered.result.tabs.find((tab) => tab.active);
      assert.ok(original && userTab);
      const args = { target: { tabId: original.tabId, expectedUrl: server.origin, selectionId: original.selectionId }, preparationId: '5e40e175-95f2-4251-b86e-463dc41cb9f6', recoverable: true };
      const extensionId = new URL(serviceWorker.url()).host;
      let preparedId;
      const restart = async () => {
        const before = server.connections.filter((c) => c.helloAt).length;
        const cdp = await context.newCDPSession(user);
        await cdp.send('ServiceWorker.enable');
        await cdp.send('ServiceWorker.stopAllWorkers');
        await cdp.detach();
        const popup = await context.newPage();
        try {
          await popup.goto(`chrome-extension://${extensionId}/src/popup/index.html`);
          await server.waitForConnection(before + 1, 30_000);
          serviceWorker = context.serviceWorkers().at(-1);
          assert.ok(serviceWorker);
        } finally { await popup.close(); }
        await user.bringToFront();
      };
      try {
        const fresh = await server.call(TASK_ID, 'task_tab', { ...args, preparationId: 'a168eae6-e63f-4ae4-aea8-f6ea2a8d5d54' });
        assert.equal(fresh.ok, true, JSON.stringify(fresh));
        await serviceWorker.evaluate((id) => chrome.tabs.remove(id), fresh.result.tabId);
        assert.equal(await serviceWorker.evaluate(() => {
          const write = chrome.storage.session.set.bind(chrome.storage.session);
          const blocked = (items) => Object.values(items).some((entry) => entry?.phase === 'created') ? new Promise(() => {}) : write(items);
          chrome.storage.session.set = blocked;
          return chrome.storage.session.set === blocked;
        }), true);
        const markerCreated = context.waitForEvent('page');
        const interrupted = server.call(TASK_ID, 'task_tab', args, 2500).catch(() => ({ ok: false }));
        const marker = await markerCreated;
        await marker.waitForURL(/task-launch\.html#/);
        const saved = await serviceWorker.evaluate(() => chrome.storage.session.get(null));
        assert.equal(Object.values(saved).filter((entry) => entry?.phase === 'creating').length, 1);
        assert.equal(JSON.stringify(saved).includes('source-private-signed-value'), false);
        await restart();
        await interrupted;
        const recovered = await server.call(TASK_ID, 'task_tab', args);
        assert.equal(recovered.ok, true, JSON.stringify(recovered));
        preparedId = recovered.result.tabId;
        assert.notEqual(preparedId, original.tabId);
        const firstSelection = recovered.result.selectionId;
        await restart();
        const again = await server.call(TASK_ID, 'task_tab', args);
        assert.equal(again.ok, true, JSON.stringify(again));
        assert.equal(again.result.tabId, preparedId);
        assert.notEqual(again.result.selectionId, firstSelection, 'new worker issues a fresh owned selection');
        const state = await serviceWorker.evaluate(async (sourceUrl) => {
          const tabs = await chrome.tabs.query({ windowType: 'normal' });
          return { matching: tabs.filter((tab) => tab.url === sourceUrl).length, markers: tabs.filter((tab) => tab.url?.includes('/task-launch.html#')).length, active: tabs.find((tab) => tab.active)?.id, stored: JSON.stringify(await chrome.storage.session.get(null)) };
        }, sourceUrl);
        assert.equal(state.matching, 2, 'one source and exactly one prepared task tab');
        assert.equal(state.markers, 0);
        assert.equal(state.active, userTab.tabId);
        assert.equal(state.stored.includes('source-private-signed-value'), false);
        assert.equal(state.stored.includes(TOKEN), false);
        assert.equal(await user.locator('#query').inputValue(), 'normal user browsing');
      } finally {
        if (preparedId !== undefined) await serviceWorker.evaluate((id) => chrome.tabs.remove(id), preparedId).catch(() => {});
        await source.close(); await user.close();
      }
    });
    await t.test('the bundled sidepanel resumes unknown preparation and creation across closes and a worker restart', async () => {
      const source = await context.newPage();
      const sourceUrl = `${server.origin}/v2.html?ui=source-private-signed-value&sig=a%2Bb%2FC`;
      await source.goto(sourceUrl);
      const user = await context.newPage();
      await user.goto(`${server.origin}/page.html`);
      await user.locator('#query').fill('normal browsing survives recovery');
      const extensionId = new URL(serviceWorker.url()).host;
      const taskId = 'tsk_sidepanel_recovered';
      const packets = [];
      const preparations = [];
      const creations = [];
      let preparedTabId;
      let created = false;
      let acknowledgeCount = 0;
      let signalPrepared;
      let signalCreated;
      let signalAcknowledged;
      const preparedSeen = new Promise((r) => { signalPrepared = r; });
      const createdSeen = new Promise((r) => { signalCreated = r; });
      const acknowledged = new Promise((r) => { signalAcknowledged = r; });
      const wait = (promise, label) => {
        let timer;
        return Promise.race([promise, new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error(label)), 15_000);
        })]).finally(() => clearTimeout(timer));
      };
      const openPanel = async () => {
        const page = context.waitForEvent('page');
        const cdp = await context.newCDPSession(user);
        await cdp.send('Target.createTarget', { url: `chrome-extension://${extensionId}/src/sidepanel/index.html`, background: true });
        await cdp.detach();
        const panel = await page;
        await panel.waitForLoadState('domcontentloaded');
        return panel;
      };
      let panel;
      server.rpcHandler = async (req, res) => {
        const url = new URL(req.url, server.origin);
        if (req.headers.authorization !== `Bearer ${TOKEN}`) {
          res.writeHead(401, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ error: { message: 'fixture authentication required' } })); return;
        }
        const raw = req.method === 'GET' ? url.searchParams.get('input') : await new Promise((resolve) => {
          let body = ''; req.on('data', (part) => { body += part; }); req.on('end', () => resolve(body));
        });
        const input = raw ? JSON.parse(raw) : {};
        packets.push({ path: url.pathname, input });
        const reply = (data) => { res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' }); res.end(JSON.stringify({ result: { data } })); };
        const connectionId = server.connections.filter((c) => c.helloAt && !c.closedAt).at(-1)?.clientId;
        if (url.pathname === '/trpc/auth.me') return reply({ userId: 'fixture-owner', email: 'fixture@local.invalid', plan: 'pro', displayName: 'Local fixture' });
        if (url.pathname === '/trpc/tasks.localChromeLaunchOptions') return reply({ backgroundTaskTabs: true, launchRecovery: true });
        if (url.pathname === '/trpc/tasks.localChromeTabs') {
          const list = await server.call('ui-discovery', 'tabs');
          assert.equal(list.ok, true);
          return reply({ backgroundTaskTabs: true, launchRecovery: true,
            tabs: list.result.tabs.map((tab) => ({ extensionClientId: connectionId, tabId: tab.tabId,
              expectedUrl: tab.url, selectionId: tab.selectionId, title: tab.title,
              taskTabStart: true, launchRecoveryReady: true, launchBrowserSessionId: list.result.launchBrowserSessionId })) });
        }
        if (url.pathname === '/trpc/tasks.localChromeLaunchReceipt') {
          if (created) {
            for (const ws of server.sockets) ws.send(JSON.stringify({ type: 'server.task.terminal', taskId,
              status: 'cancelled', reason: 'Synthetic cancellation before recovery' }));
            return reply({ state: 'created', taskId, status: 'cancelled' });
          }
          return reply({ state: 'absent' });
        }
        if (url.pathname === '/trpc/tasks.localChromeTaskTab') {
          preparations.push(input);
          const selected = input.selection;
          const result = await server.call(`ui-prepare-${preparations.length}`, 'task_tab', {
            target: { tabId: selected.tabId, expectedUrl: selected.expectedUrl, selectionId: selected.selectionId },
            preparationId: input.preparationId, recoverable: true, resumeOnly: input.resumeOnly,
            taskTabMode: input.mode, launchBrowserSessionId: selected.launchBrowserSessionId,
          });
          assert.equal(result.ok, true, JSON.stringify(result));
          if (preparedTabId !== undefined) assert.equal(result.result.tabId, preparedTabId);
          preparedTabId = result.result.tabId;
          if (preparations.length === 1) { signalPrepared(); return; } // Lose only the HTTP receipt.
          return reply({ extensionClientId: connectionId, tabId: preparedTabId, expectedUrl: result.result.url,
            selectionId: result.result.selectionId, launchBrowserSessionId: selected.launchBrowserSessionId, title: result.result.title });
        }
        if (url.pathname === '/trpc/tasks.create') {
          creations.push(input);
          assert.equal(input.localChrome.tabId, preparedTabId);
          assert.deepEqual(Object.keys(input.localChrome).sort(), ['expectedUrl', 'extensionClientId', 'launchBrowserSessionId', 'selectionId', 'tabId']);
          created = true; signalCreated(); return; // The task exists; lose its response as well.
        }
        if (url.pathname === '/trpc/tasks.localChromeLaunchAcknowledge') {
          assert.equal(input.taskId, taskId);
          const result = await server.call(`ui-release-${input.preparationId}`, 'task_tab_release', {
            preparationId: input.preparationId, launchBrowserSessionId: input.launchBrowserSessionId,
          });
          assert.equal(result.ok, true, JSON.stringify(result));
          acknowledgeCount++; reply({ acknowledged: true }); signalAcknowledged(); return;
        }
        reply({ tasks: [] });
      };
      try {
        await serviceWorker.evaluate(() => chrome.storage.local.set({ 'holaday.user': {
          externalId: 'stale-owner', email: 'stale@local.invalid', plan: 'pro', displayName: 'Stale cached account',
        } }));
        panel = await openPanel();
        await panel.locator('textarea').fill('整理后台数据，保留结果供我检查');
        await panel.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => b.textContent === '发送任务' && !b.disabled));
        await source.bringToFront();
        await panel.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent === '发送任务').click());
        await wait(preparedSeen, 'sidepanel did not prepare');
        await user.bringToFront();
        await panel.close(); panel = undefined;
        const beforeProfile = (await server.call('ui-profile-before', 'tabs')).result.launchBrowserSessionId;
        const before = server.connections.filter((c) => c.helloAt).length;
        const cdp = await context.newCDPSession(user);
        await cdp.send('ServiceWorker.enable'); await cdp.send('ServiceWorker.stopAllWorkers'); await cdp.detach();
        panel = await openPanel();
        await server.waitForConnection(before + 1, 30_000);
        serviceWorker = context.serviceWorkers().at(-1);
        assert.equal((await server.call('ui-profile-after', 'tabs')).result.launchBrowserSessionId, beforeProfile);
        await wait(createdSeen, 'sidepanel did not resume preparation');
        await panel.close(); panel = undefined;
        panel = await openPanel();
        await wait(acknowledged, 'sidepanel did not recover the original task');
        await panel.getByText(taskId, { exact: true }).waitFor();
        const state = await serviceWorker.evaluate(async ({ sourceUrl, prefix }) => {
          const tabs = await chrome.tabs.query({ windowType: 'normal' });
          const stored = await chrome.storage.local.get(null);
          return { matching: tabs.filter((t) => t.url === sourceUrl).length,
            activeUrl: tabs.find((t) => t.active)?.url,
            launches: Object.keys(stored).filter((key) => key.startsWith(prefix)),
            released: Object.values(await chrome.storage.session.get(null)).filter((v) => v?.phase === 'released').length };
        }, { sourceUrl, prefix: 'holaday.browser-launch.v1.' });
        assert.equal(preparations.length, 2); assert.equal(preparations[1].resumeOnly, true);
        assert.equal(preparations[0].preparationId, preparations[1].preparationId);
        assert.equal(creations.length, 1); assert.equal(acknowledgeCount, 1);
        assert.equal(state.matching, 2); assert.equal(state.activeUrl, `${server.origin}/page.html`);
        assert.equal(state.launches.length, 0); assert.ok(state.released >= 1);
        assert.equal(JSON.stringify(packets).includes('source-private-signed-value'), false);
        assert.equal(await user.locator('#query').inputValue(), 'normal browsing survives recovery');
        assert.deepEqual({
          verifiedAccountShown: await panel.getByText('Local fixture', { exact: true }).count(),
          staleAccountShown: await panel.getByText('Stale cached account', { exact: true }).count(),
          cancelledTaskLabel: await panel.getByText('任务已取消', { exact: true }).count(),
          misleadingFailureLabel: await panel.getByText('任务失败', { exact: true }).count(),
        }, { verifiedAccountShown: 1, staleAccountShown: 0, cancelledTaskLabel: 1, misleadingFailureLabel: 0 });
        await panel.setViewportSize({ width: 390, height: 844 });
        assert.equal(await panel.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
        const artifactDir = process.env.HOLADAY_E2E_ARTIFACT_DIR;
        if (artifactDir) {
          mkdirSync(artifactDir, { recursive: true });
          await panel.screenshot({ path: join(artifactDir, 'sidepanel-recovered-390.png') });
          writeFileSync(join(artifactDir, 'sidepanel-recovery.json'), JSON.stringify({
            preparationRequests: preparations.length, taskCreateRequests: creations.length,
            acknowledgementRequests: acknowledgeCount, duplicateTasks: creations.length - 1,
            duplicateTaskPages: state.matching - 2, workerSessionIdentityPreserved: true,
            userInputPreserved: true, sourceUrlNeverUploaded: true, width: 390, overflow: false,
            syntheticOnly: true, physicalOsInputAcceptance: false,
          }, null, 2));
        }
        const refreshed = await server.call('ui-current-source', 'tabs');
        const original = refreshed.result.tabs.find((tab) => tab.tabId === preparations[0].selection.tabId);
        const currentArgs = { target: { tabId: original.tabId, expectedUrl: original.url, selectionId: original.selectionId },
          preparationId: '9f40e175-95f2-4251-b86e-463dc41cb9f6', recoverable: true,
          taskTabMode: 'current', launchBrowserSessionId: beforeProfile };
        const pageCount = context.pages().length;
        const current = await server.call('ui-current-prepare', 'task_tab', currentArgs);
        assert.equal(current.ok, true, JSON.stringify(current));
        assert.equal(current.result.tabId, original.tabId);
        assert.equal(current.result.taskTabCreated, false);
        assert.equal(context.pages().length, pageCount);
        await source.goto(`${sourceUrl}#user-changed`);
        const changed = await server.call('ui-current-changed', 'task_tab', { ...currentArgs, resumeOnly: true });
        assert.equal(changed.ok, false);
        assert.equal(changed.error.code, 'target_changed');
        assert.equal(context.pages().length, pageCount);
        assert.equal((await server.call('ui-current-release', 'task_tab_release', {
          preparationId: currentArgs.preparationId, launchBrowserSessionId: beforeProfile,
        })).ok, true);
      } finally {
        server.rpcHandler = undefined;
        await panel?.close().catch(() => {});
        if (preparedTabId !== undefined) await serviceWorker.evaluate((id) => chrome.tabs.remove(id), preparedTabId).catch(() => {});
        await source.close(); await user.close();
      }
    });
    await t.test('background task tab keeps normal browsing and input untouched', async () => {
      const sourcePage = await context.newPage();
      await sourcePage.goto(`${server.origin}/v2.html?start=background`);
      const userPage = await context.newPage();
      await userPage.goto(`${server.origin}/page.html`);
      await userPage.bringToFront();
      await userPage.locator('#query').fill('user typing');
      const discovery = await server.call(TASK_ID, 'tabs');
      const source = discovery.result.tabs.find((tab) => tab.title === 'V2 fixture');
      const userTab = discovery.result.tabs.find((tab) => tab.active);
      assert.ok(source && userTab);
      const preparationId = '4488c303-9880-44d9-885e-51e13755933b';
      const target = {
        tabId: source.tabId,
        expectedUrl: server.origin,
        selectionId: source.selectionId,
      };
      const newPage = context.waitForEvent('page');
      const prepared = await server.call(TASK_ID, 'task_tab', { target, preparationId });
      assert.equal(prepared.ok, true, JSON.stringify(prepared.error));
      const taskPage = await newPage;
      await taskPage.waitForLoadState('domcontentloaded');
      assert.notEqual(prepared.result.tabId, source.tabId);
      const repeated = await server.call(TASK_ID, 'task_tab', { target, preparationId });
      assert.deepEqual(repeated.result, prepared.result);
      const opened = await call({
        op: 'open',
        target: {
          tabId: prepared.result.tabId,
          expectedUrl: prepared.result.url,
          selectionId: prepared.result.selectionId,
        },
        protocol,
        grantedOrigins: [server.origin],
      });
      assert.equal(opened.ok, true, JSON.stringify(opened.error));
      const sessionId = opened.result.sessionId;
      try {
        const tabs = await call({ op: 'tabs', sessionId, operation: 'list' });
        assert.deepEqual(
          tabs.result.tabs.map(({ tabId, ownership }) => ({ tabId, ownership })),
          [{ tabId: prepared.result.tabId, ownership: 'task' }],
        );
        const action = { kind: 'click', selector: css('#search') };
        const described = await call({
          op: 'describe',
          sessionId,
          action,
          observationRevision: opened.result.observation.observationRevision,
        });
        assert.equal(described.ok, true, JSON.stringify(described.error));
        const applied = await call({
          op: 'act',
          sessionId,
          action,
          binding: {
            token: described.result.target.token,
            observationRevision: described.result.target.observationRevision,
          },
        });
        assert.equal(applied.ok, true, JSON.stringify(applied.error));
        assert.equal(await taskPage.locator('#effects').textContent(), '1');
        assert.equal(await sourcePage.locator('#effects').textContent(), '0');
        assert.equal(await userPage.locator('#query').inputValue(), 'user typing');
        const active = await serviceWorker.evaluate(
          async () => (await chrome.tabs.query({ active: true, currentWindow: true }))[0]?.id,
        );
        assert.equal(active, userTab.tabId);
        await userPage.locator('#query').press('End');
        await userPage.keyboard.type(' continues');
        assert.equal(await userPage.locator('#query').inputValue(), 'user typing continues');
      } finally {
        await call({ op: 'close', sessionId });
      }
      await taskPage.close();
      await sourcePage.close();
      await userPage.close();
    });
    await t.test(
      'bundled sidepanel sends an independent target while the user switches pages',
      async () => {
        const sourcePage = await context.newPage();
        await sourcePage.goto(`${server.origin}/v2.html?from=sidepanel`);
        await sourcePage.locator('#query').fill('original input');
        const userPage = await context.newPage();
        await userPage.goto(`${server.origin}/page.html`);
        await userPage.locator('#query').fill('normal browsing');
        await serviceWorker.evaluate(async () =>
          chrome.storage.local.set({
            'holaday.user': {
              externalId: 'fixture-user',
              email: 'fixture@example.test',
              plan: 'free',
            },
          }),
        );
        const sidepanel = await context.newPage();
        const trace = [];
        sidepanel.on('pageerror', (error) => trace.push(`pageerror:${error.message}`));
        let created;
        let preparedPage;
        await sidepanel.route(`${server.origin}/trpc/**`, async (route) => {
          const procedure = new URL(route.request().url()).pathname.split('/').at(-1);
          trace.push(procedure);
          const clientId = server.connections.at(-1).clientId;
          let data;
          if (procedure === 'tasks.localChromeLaunchOptions') {
            data = { backgroundTaskTabs: true };
          } else if (procedure === 'tasks.localChromeTabs') {
            const discovery = await server.call(TASK_ID, 'tabs');
            data = {
              backgroundTaskTabs: true,
              tabs: discovery.result.tabs.map(({ url, ...tab }) => ({
                ...tab,
                expectedUrl: url,
                extensionClientId: clientId,
                taskTabStart: true,
              })),
            };
          } else if (procedure === 'tasks.localChromeTaskTab') {
            const { selection, preparationId } = route.request().postDataJSON();
            assert.equal(selection.extensionClientId, clientId);
            const nextPage = context.waitForEvent('page');
            const { extensionClientId: _connection, ...target } = selection;
            const result = await server.call(TASK_ID, 'task_tab', { target, preparationId });
            assert.equal(result.ok, true, JSON.stringify(result.error));
            preparedPage = await nextPage;
            data = {
              extensionClientId: clientId,
              tabId: result.result.tabId,
              expectedUrl: result.result.url,
              selectionId: result.result.selectionId,
              title: result.result.title,
            };
            // The user switches tabs while preparation is in flight. The task
            // must stay on its captured source, rather than follow the active tab.
            await userPage.bringToFront();
          } else if (procedure === 'tasks.create') {
            created = route.request().postDataJSON();
            data = { taskId: 'tsk_sidepanel_fixture', status: 'executing' };
          } else {
            throw new Error(`unexpected sidepanel request ${procedure}`);
          }
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ result: { data } }),
          });
        });
        try {
          const panelUrl = await serviceWorker.evaluate(() =>
            chrome.runtime.getURL(chrome.runtime.getManifest().side_panel.default_path),
          );
          await sidepanel.goto(panelUrl);
          await sourcePage.bringToFront();
          await sidepanel.getByLabel('任务页面').waitFor();
          if (process.env.HOLADAY_E2E_ARTIFACT_DIR) {
            mkdirSync(process.env.HOLADAY_E2E_ARTIFACT_DIR, { recursive: true });
            await sidepanel.setViewportSize({ width: 390, height: 844 });
            await sidepanel.screenshot({
              path: join(process.env.HOLADAY_E2E_ARTIFACT_DIR, 'ba1-sidepanel-390.png'),
              fullPage: true,
            });
          }
          await sidepanel.locator('textarea').fill('整理报表');
          await sidepanel.getByRole('button', { name: '发送任务' }).click();
          try {
            await sidepanel.waitForFunction(
              () =>
                document.querySelector('textarea')?.value === '' ||
                document.querySelector('[role="alert"]'),
            );
          } catch (error) {
            throw new Error(
              `${error.message}\ntrace=${JSON.stringify(trace)}\npanel=${await sidepanel.locator('body').innerText()}`,
            );
          }
          assert.equal(
            await sidepanel.locator('textarea').inputValue(),
            '',
            await sidepanel.locator('body').innerText(),
          );
          assert.equal(created.intent, '整理报表');
          assert.match(created.clientRequestId, /^[0-9a-f-]{36}$/);
          assert.equal(new URL(preparedPage.url()).search, '?from=sidepanel');
          const discovery = await server.call(TASK_ID, 'tabs');
          const original = discovery.result.tabs.find(
            (tab) => tab.title === 'V2 fixture' && tab.tabId !== created.localChrome.tabId,
          );
          assert.notEqual(created.localChrome.tabId, original.tabId);
          assert.equal(await sourcePage.locator('#query').inputValue(), 'original input');
          assert.equal(await userPage.locator('#query').inputValue(), 'normal browsing');
          const active = discovery.result.tabs.find((tab) => tab.active);
          assert.equal(active.title, 'E2E 页面一');
          await userPage.locator('#query').press('End');
          await userPage.keyboard.type(' continues');
          assert.equal(await userPage.locator('#query').inputValue(), 'normal browsing continues');
        } finally {
          await sidepanel.close();
          await preparedPage?.close();
          await sourcePage.close();
          await userPage.close();
        }
      },
    );
    await t.test(
      'open v2 handshake and ordinary button auto click through unified gate',
      async () => {
        page = await context.newPage();
        await page.goto(`${server.origin}/v2.html?item=42#details`);
        await open(page);
        const source = await observe();
        assert.equal(source.result.observation.sourceURL, page.url());
        const action = { kind: 'click', selector: css('#search') };
        const reply = await describe(action);
        assert.equal(reply.ok, true, reply.error?.code);
        assert.equal(reply.result.target.element.visibleText, '搜索');
        assert.equal(reply.result.target.origin, server.origin);
        const { createDescriptionActionGate, describeUserBrowserAction } = await loadServerModule(
          'agent/browser-tools/unified-action-gate.ts',
        );
        const { classifyRuntimeAction } = await loadServerModule(
          'agent/supercar/runtime-action-policy.ts',
        );
        let parked = 0;
        const gate = createDescriptionActionGate({
          describe: async () => describeUserBrowserAction(action, reply.result.target),
          pageUrl: () => server.origin,
          onBeforeAction: classifyRuntimeAction,
          park: async () => {
            parked++;
            return null;
          },
          aborted: () => false,
        });
        assert.equal((await gate(action, 'before')).kind, 'proceed');
        assert.equal(parked, 0);
        const acted = await bound(action, reply.result.target);
        assert.equal(acted.ok, true, acted.error?.code);
        assert.equal(await page.textContent('#effects'), '1');
        revision = acted.result.observation.observationRevision;
      },
    );
    assert.ok(sessionId, 'v2 open must succeed before further checks');
    await t.test(
      'pay, icon delete, focused payment Enter and generic submit ask confirmation with zero effects',
      async () => {
        const { createDescriptionActionGate, describeUserBrowserAction } = await loadServerModule(
          'agent/browser-tools/unified-action-gate.ts',
        );
        const { classifyRuntimeAction } = await loadServerModule(
          'agent/supercar/runtime-action-policy.ts',
        );
        for (const action of [
          { kind: 'click', selector: css('#pay') },
          { kind: 'click', selector: css('#icon') },
          { kind: 'key', payload: { key: 'Enter' } },
          { kind: 'key', payload: { key: 'Space' } },
        ]) {
          if (action.kind === 'key') await page.locator('#amount').focus();
          await observe();
          const reply = await describe(action);
          assert.equal(reply.ok, true, reply.error?.code);
          if (action.kind === 'key') {
            assert.equal(reply.result.target.form.method, 'post');
            assert.equal(reply.result.target.form.action, `${server.origin}/payment`);
          }
          let parked = 0;
          const gate = createDescriptionActionGate({
            describe: async () => describeUserBrowserAction(action, reply.result.target),
            pageUrl: () => server.origin,
            onBeforeAction: classifyRuntimeAction,
            park: async () => {
              parked++;
              return null;
            },
            aborted: () => false,
          });
          assert.equal((await gate(action, 'before')).kind, 'stop');
          assert.equal(parked, 1);
          assert.equal(await page.textContent('#effects'), '1');
        }
      },
    );
    await t.test('native typing invalidates the old target, preserves the edit and permits a fresh decision', async () => {
      await page.locator('#query').focus();
      await page.evaluate(() => {
        window.manualRaceClicks = 0;
        document.querySelector('#search').addEventListener('click', () => window.manualRaceClicks++);
      });
      await observe();
      const action = { kind: 'click', selector: css('#search') };
      const ticket = (await describe(action)).result.target;
      try {
        await page.keyboard.type('private native edit');
        assert.equal(await page.locator('#query').inputValue(), 'private native edit');
        const stale = await bound(action, ticket);
        assert.equal(stale.ok, false, 'the model’s pre-edit target must not execute');
        assert.equal(stale.result.error, 'stale_observation');
        assert.equal(stale.result.actionOutcome, 'not_applied');
        assert.equal(await page.evaluate(() => window.manualRaceClicks), 0);
        assert.equal(JSON.stringify(stale).includes('private native edit'), false);
        assert.equal(await page.locator('#query').inputValue(), 'private native edit');
        await observe();
        const fresh = await describe(action);
        assert.equal(fresh.ok, true);
        assert.equal((await bound(action, fresh.result.target)).ok, true);
        assert.equal(await page.evaluate(() => window.manualRaceClicks), 1);
        assert.equal(await page.locator('#query').inputValue(), 'private native edit');
      } finally {
        await page.locator('#query').fill('');
      }
    });
    await t.test('native held keys, drag and trusted IME yield naturally with exact task/document binding', async () => {
      await call({ op: 'close', sessionId });
      const { BrowserControl } = await loadServerModule('agent/supercar/browser-control.ts');
      const { SelectedChromeClient } = await loadServerModule('agent/supercar/selected-chrome-client.ts');
      const control = new BrowserControl(Date.now, { collaborationV2: true });
      const operations = [];
      const client = new SelectedChromeClient({
        userId: 'fixture', taskId: TASK_ID, extensionClientId: 'fixture', control,
        routingV2: true, collaborationV2: true,
        send: async (_, input) => {
          operations.push(input.args.session.op);
          return server.call(TASK_ID, 'session', input.args);
        },
      });
      let other;
      let ime;
      try {
        const list = await server.call(TASK_ID, 'tabs');
        const tab = list.result.tabs.find((t) => t.tabId === selected.tabId);
        assert.ok(tab);
        const opened = await client.open({ tabId: tab.tabId, expectedUrl: server.origin, selectionId: tab.selectionId });
        assert.equal(opened.ok, true, JSON.stringify(opened));
        await page.locator('#query').focus();
        await client.observe();
        assert.equal((await client.checkpoint()).resumed, false);

        await page.keyboard.down('Shift');
        const sinceHeld = operations.filter((op) => op === 'observe').length;
        assert.equal((await client.checkpoint({ maxWaitMs: 2100 })).blocked, true);
        assert.equal(operations.filter((op) => op === 'observe').length, sinceHeld);
        assert.equal(operations.includes('act'), false);
        await page.keyboard.up('Shift');
        assert.equal((await client.checkpoint({ maxWaitMs: 5000 })).resumed, true);

        const box = await page.locator('#query').boundingBox();
        assert.ok(box);
        await page.mouse.move(box.x + 5, box.y + 5);
        await page.mouse.down();
        assert.equal((await client.checkpoint({ maxWaitMs: 150 })).blocked, true);
        await page.mouse.move(box.x + 20, box.y + 5);
        await page.mouse.up();
        assert.equal((await client.checkpoint({ maxWaitMs: 5000 })).resumed, true);

        other = await context.newPage();
        await other.goto(`${server.origin}/page.html`);
        await other.locator('#query').fill('unrelated user input');
        assert.equal((await client.checkpoint()).resumed, false);
        const active = await serviceWorker.evaluate(async () => (await chrome.tabs.query({ active: true, currentWindow: true }))[0]?.id);
        assert.notEqual(active, selected.tabId, 'activity queries must not activate the task tab');
        assert.equal(await other.locator('#query').inputValue(), 'unrelated user input');
        await other.close(); other = null;
        await page.bringToFront();
        await page.locator('#query').focus();
        await client.observe();
        ime = await context.newCDPSession(page);
        // Trusted browser IME events, not a page-created CompositionEvent (see CDP Input).
        await ime.send('Input.imeSetComposition', { text: '中', selectionStart: 1, selectionEnd: 1 });
        assert.equal((await client.checkpoint({ maxWaitMs: 150 })).blocked, true);
        await ime.send('Input.insertText', { text: '中文' });
        assert.equal((await client.checkpoint({ maxWaitMs: 150 })).blocked, true, 'an untrusted end is not a release receipt');
        await page.keyboard.press('ArrowRight');
        assert.equal((await client.checkpoint({ maxWaitMs: 5000 })).resumed, true);
        assert.equal(await page.locator('#query').inputValue(), '中文');

        const action = { kind: 'click', selector: css('#search') };
        assert.equal((await client.describe(action, client.revision)).ok, true);
        assert.equal((await client.execute(action, client.revision)).ok, true);
        assert.equal((await client.checkpoint()).resumed, false, 'our own observed click is not a human takeover');
        assert.equal((await client.execute({ kind: 'goto', payload: { url: `${server.origin}/v2.html?own=native` } }, client.revision)).ok, true);
        assert.equal((await client.checkpoint()).resumed, false, 'our own observed navigation is not a human takeover');
        await page.keyboard.down('Shift');
        await page.reload();
        assert.equal((await client.checkpoint({ maxWaitMs: 5000 })).blocked, true, 'a lost held document between polls is not a release receipt');
      } finally {
        await page.keyboard.up('Shift').catch(() => {});
        await page.mouse.up().catch(() => {});
        await ime?.detach().catch(() => {});
        await other?.close().catch(() => {});
        await client.close();
        await page.locator('#query').fill('');
        await page.evaluate(() => { document.querySelector('#effects').textContent = '1'; });
        try {
          const discovery = await server.call(TASK_ID, 'tabs');
          const selectedAgain = discovery.result.tabs.find((tab) => tab.tabId === selected.tabId);
          assert.ok(selectedAgain);
          const resumed = new SelectedChromeClient({
            userId: 'fixture', taskId: TASK_ID, extensionClientId: 'fixture',
            control: new BrowserControl(Date.now, { collaborationV2: true }), routingV2: true, collaborationV2: true,
            send: async (_, input) => server.call(TASK_ID, 'session', input.args),
          });
          try {
            assert.equal((await resumed.open({ tabId: selectedAgain.tabId, expectedUrl: server.origin, selectionId: selectedAgain.selectionId })).ok, true, 'a released seat must support another advanced task');
            assert.equal((await resumed.checkpoint()).resumed, false);
          } finally { await resumed.close(); }
        } finally { await open(page); }
      }
    });
    await t.test('iframe, shadow, ambiguity, missing target and stale DOM revision', async () => {
      await observe();
      for (const [selector, text] of [
        ['#inside', '删除项目'],
        ['#shadow', 'Shadow search'],
      ]) {
        const reply = await describe({ kind: 'click', selector: css(selector) });
        assert.equal(reply.ok, true, reply.error?.code);
        assert.equal(reply.result.target.element.visibleText, text);
      }
      assert.equal(
        (await describe({ kind: 'click', selector: css('.ambiguous') })).result.error,
        'target_ambiguous',
      );
      assert.equal(
        (await describe({ kind: 'click', selector: css('#missing') })).result.error,
        'target_missing',
      );
      const action = { kind: 'click', selector: css('#search') };
      const ticket = (await describe(action)).result.target;
      await page.locator('#search').evaluate((el) => {
        el.textContent = '确认支付';
      });
      const stale = await bound(action, ticket);
      assert.equal(stale.ok, false);
      assert.equal(stale.result.error, 'stale_observation');
      assert.equal(await page.textContent('#effects'), '1');
      await page.locator('#search').evaluate((el) => {
        el.textContent = '搜索';
      });
      await observe();
      const old = (await describe(action)).result.target;
      await observe();
      assert.equal((await bound(action, old)).result.actionOutcome, 'not_applied');
    });
    await t.test(
      'real hit target and page context: shadow, overlays, transaction pages, closed-shadow focus',
      async () => {
        const { createDescriptionActionGate, describeUserBrowserAction } = await loadServerModule(
          'agent/browser-tools/unified-action-gate.ts',
        );
        const { classifyRuntimeAction } = await loadServerModule(
          'agent/supercar/runtime-action-policy.ts',
        );
        const effects = () => page.evaluate(() => Number(window.effects || 0));
        // One action through describe → unified gate → bound act, like the runner.
        const run = async (action, { reply = '不要', during } = {}) => {
          let parked = 0;
          let target;
          const gate = createDescriptionActionGate({
            pageUrl: () => page.url(),
            onBeforeAction: classifyRuntimeAction,
            aborted: () => false,
            park: async () => {
              parked++;
              await during?.();
              return reply;
            },
            describe: async () => {
              const described = await describe(action);
              assert.equal(described.ok, true, described.result?.error);
              target = described.result.target;
              return describeUserBrowserAction(action, target);
            },
          });
          const decision = await gate(action, 'before');
          const receipt = decision.kind === 'proceed' ? await bound(action, target) : null;
          if (receipt?.ok) revision = receipt.result.observation.observationRevision;
          return { parked, decision, receipt, target, effects: await effects() };
        };
        const scene = async (path, html) => {
          await page.evaluate((next) => history.replaceState(null, '', next), path);
          await page.setContent(html);
          await page.evaluate(() => {
            window.effects = 0;
          });
          await observe();
        };
        const click = (selector) => ({ kind: 'click', selector: css(selector), deadlineMs: 500 });
        const pay = `<button style='width:220px;height:80px' onclick='window.effects++'>确认支付</button>`;
        const shadow = (mode, nested) =>
          `<div id='host' style='position:absolute;left:10px;top:10px;width:220px;height:80px'></div><script>
            ((root) => {
              if (${nested}) {
                root.innerHTML = "<div id='inner' style='width:220px;height:80px'></div>";
                root.querySelector('#inner').attachShadow({ mode: 'closed' }).innerHTML = \`${pay}\`;
              } else root.innerHTML = \`${pay}\`;
            })(document.querySelector('#host').attachShadow({ mode: '${mode}' }));
          </script>`;
        for (const [mode, nested] of [
          ['open', false],
          ['closed', false],
          ['open', true],
        ]) {
          await scene('/v2.html', shadow(mode, nested));
          const refused = await run(click('#host'));
          assert.equal(refused.target.element.visibleText, '确认支付');
          assert.deepEqual(
            [refused.parked, refused.decision.kind, refused.effects],
            [1, 'stop', 0],
          );
          await observe();
          // Confirmed: the click lands on exactly the described inner button.
          const confirmed = await run(click('#host'), { reply: '确认执行' });
          assert.deepEqual([confirmed.parked, confirmed.decision.kind], [1, 'proceed']);
          assert.equal(confirmed.receipt.ok, true, confirmed.receipt.result?.error);
          assert.equal(confirmed.effects, 1);
        }
        await scene(
          '/v2.html',
          `<button id='pay' style='width:220px;height:80px' onclick='window.effects++'>确认支付</button><div style='position:absolute;left:8px;top:8px;width:220px;height:80px;pointer-events:none'>提示</div>`,
        );
        const overlay = await run(click('#pay'));
        assert.deepEqual(
          [overlay.target.element.visibleText, overlay.parked, overlay.effects],
          ['确认支付', 1, 0],
        );
        for (const path of ['/checkout', '/pay', '/order/confirm']) {
          const next = `<button id='next' type='button' style='width:220px;height:80px' onclick='window.effects++'>继续</button>`;
          await scene(`${path}?coupon=SYNTHETIC#step`, next);
          const refused = await run(click('#next'));
          assert.deepEqual(refused.target.page, {
            url: `${server.origin}${path}`,
            transactional: true,
          });
          assert.deepEqual(
            [refused.parked, refused.decision.kind, refused.effects],
            [1, 'stop', 0],
          );
          await observe();
          const timedOut = await run(click('#next'), { reply: null });
          assert.equal(timedOut.decision.outcome.status, 'awaiting_user');
          assert.deepEqual([timedOut.parked, timedOut.effects], [1, 0]);
          await observe();
          const moved = await run(click('#next'), {
            reply: '确认执行',
            during: () => page.evaluate(() => history.pushState(null, '', '/elsewhere')),
          });
          assert.deepEqual([moved.parked, moved.decision.kind, moved.effects], [1, 'skip', 0]);
          await scene(path, next);
          const confirmed = await run(click('#next'), { reply: '确认执行' });
          assert.deepEqual(
            [confirmed.parked, confirmed.decision.kind, confirmed.effects],
            [1, 'proceed', 1],
          );
        }
        await scene('/v2.html', shadow('closed', false));
        await page.mouse.click(30, 30);
        await page.evaluate(() => {
          window.effects = 0;
        });
        await observe();
        for (const key of ['Enter', 'Space']) {
          const keyed = await run({ kind: 'key', payload: { key } });
          assert.equal(keyed.target.element.visibleText, '确认支付');
          assert.deepEqual([keyed.parked, keyed.decision.kind, keyed.effects], [1, 'stop', 0]);
        }
        // Ordinary controls — plain, under a decorative overlay, inside shadow
        // roots, on a list page — still click without any confirmation.
        const ordinary = [
          ['/list?q=shoes', `<button id='t' onclick='window.effects++'>下一页</button>`],
          [
            '/v2.html',
            `<button id='t' style='width:220px;height:80px' onclick='window.effects++'>展开</button><div style='position:absolute;left:8px;top:8px;width:220px;height:80px;pointer-events:none'>提示</div>`,
          ],
          [
            '/v2.html',
            shadow('closed', false)
              .replaceAll('确认支付', '查看详情')
              .replace("id='host'", "id='t'")
              .replace("'#host'", "'#t'"),
          ],
          ['/checkout', `<a id='t' href='#detail' onclick='window.effects++'>查看商品详情</a>`],
        ];
        for (const [path, html] of ordinary) {
          await scene(path, html);
          const done = await run(click('#t'));
          assert.deepEqual(
            [done.parked, done.decision.kind, done.effects],
            [0, 'proceed', 1],
            path,
          );
        }
        await page.goto(`${server.origin}/v2.html`);
        await observe();
      },
    );
    await t.test('scroll/select and list/new/switch never admit unrelated user tabs', async () => {
      const unrelated = await context.newPage();
      await unrelated.goto(`${server.origin}/page2.html`);
      const all = await server.call(TASK_ID, 'tabs');
      const unrelatedTab = all.result.tabs.find((x) => x.title === 'E2E 页面二');
      assert.ok(unrelatedTab);
      const listed = await call({ op: 'tabs', sessionId, operation: 'list' });
      assert.equal(listed.result.tabs.length, 1);
      assert.equal(listed.result.tabs[0].tabId, selected.tabId);
      const denied = await call({
        op: 'tabs',
        sessionId,
        operation: 'switch',
        tabId: unrelatedTab.tabId,
      });
      assert.equal(denied.result.error, 'task_tab_required');
      const action = { kind: 'select', selector: css('#choice'), payload: { text: 'Two' } };
      const ticket = (await describe(action)).result.target;
      const selectedOption = await bound(action, ticket);
      assert.equal(selectedOption.ok, true, selectedOption.error?.code);
      assert.equal(await page.inputValue('#choice'), 'b');
      const scrolled = await call({
        op: 'act',
        sessionId,
        action: { kind: 'scroll', payload: { deltaY: 400, deltaX: 0 } },
      });
      assert.equal(scrolled.ok, true, scrolled.error?.code);
      const created = await call({
        op: 'tabs',
        sessionId,
        operation: 'new',
        url: `${server.origin}/page2.html`,
      });
      assert.equal(created.ok, true, created.error?.code);
      assert.equal(created.result.tabs.length, 2);
      const newId = created.result.observation.tabId;
      assert.notEqual(newId, unrelatedTab.tabId);
      const switched = await call({
        op: 'tabs',
        sessionId,
        operation: 'switch',
        tabId: selected.tabId,
      });
      assert.equal(switched.ok, true, switched.error?.code);
      assert.equal(switched.result.observation.tabId, selected.tabId);
      revision = switched.result.observation.observationRevision;
      assert.equal(unrelated.isClosed(), false);
    });
    await t.test(
      'cross-origin navigation refuses observation until a fresh exact-origin grant',
      async () => {
        const other = new MockOrchestrator();
        await other.start();
        try {
          const denied = await call({
            op: 'tabs',
            sessionId,
            operation: 'new',
            url: `${other.origin}/v2.html`,
          });
          assert.equal(denied.result.error, 'origin_grant_required');
          await page.locator('iframe').evaluate((el, url) => {
            el.src = url;
          }, `${other.origin}/frame.html`);
          await page.frameLocator('iframe').locator('#inside').waitFor();
          const sameOriginObservation = await observe();
          assert.equal(sameOriginObservation.result.observation.frames.length, 0);
          assert.equal(
            (await describe({ kind: 'click', selector: css('#inside') })).result.error,
            'target_missing',
          );
          await page.goto(`${other.origin}/v2.html`);
          const observed = await call({ op: 'observe', sessionId });
          assert.equal(observed.ok, false);
          assert.equal(observed.result.error, 'origin_grant_required');
          assert.equal(observed.result.observation, undefined);
          await call({ op: 'close', sessionId });
          await page.bringToFront();
          const list = await server.call(TASK_ID, 'tabs');
          const newTarget = list.result.tabs.find((x) => x.title === 'V2 fixture' && x.active);
          const granted = await call({
            op: 'open',
            target: {
              tabId: newTarget.tabId,
              expectedUrl: other.origin,
              selectionId: newTarget.selectionId,
            },
            protocol,
            grantedOrigins: [other.origin],
          });
          assert.equal(granted.ok, true, granted.error?.code);
          assert.equal(granted.result.observation.origin, other.origin);
          sessionId = granted.result.sessionId;
        } finally {
          await other.stop();
        }
      },
    );
    await call({ op: 'close', sessionId });
    await t.test(
      'server client recognizes old plugin as capability_missing and offline identity route awaits user',
      async () => {
        const { SelectedChromeClient } = await loadServerModule(
          'agent/supercar/selected-chrome-client.ts',
        );
        const control = {
          canAgentAct: () => true,
          close: () => {},
          settled: async () => {},
          checkpoint: async () => ({ resumed: false, waitedMs: 0 }),
        };
        const client = new SelectedChromeClient({
          userId: 'a',
          taskId: 'old',
          extensionClientId: 'old',
          routingV2: true,
          control,
          send: async () => ({
            ok: true,
            result: {
              ok: true,
              sessionId: '00000000-0000-4000-8000-000000000001',
              observation: {
                tabId: 3,
                origin: server.origin,
                title: 'old',
                bodyText: '',
                ariaSnapshot: '',
                truncated: false,
              },
            },
          }),
        });
        const old = await client.open({
          tabId: 3,
          expectedUrl: server.origin,
          selectionId: '00000000-0000-4000-8000-000000000001',
        });
        assert.equal(old.error, 'capability_missing');
        const { decideUserBrowserRoute } = await loadServerModule(
          'agent/supercar/user-browser-routing.ts',
        );
        const route = decideUserBrowserRoute({
          enabled: true,
          intent: '查看我的京东订单',
          extensionOnline: false,
        });
        assert.equal(route.lane, 'awaiting_user');
        assert.match(route.question, /安装.*连接.*在线/);
      },
    );
  },
);
