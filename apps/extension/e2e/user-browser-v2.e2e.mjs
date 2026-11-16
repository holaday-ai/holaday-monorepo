/** Local protocol-v2 acceptance using the real bundled repository extension.
 * Run: node --test e2e/user-browser-v2.e2e.mjs
 * Loopback synthetic pages/token only; no real account or model calls.
 * Covers real targets, confirmation, revisions, origins and protected task tabs.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
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
      { ...protocol, capabilities: [...protocol.capabilities, 'human_activity_v1'] },
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
