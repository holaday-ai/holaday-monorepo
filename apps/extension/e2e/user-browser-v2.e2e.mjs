/** Local protocol-v2 acceptance using the real bundled repository extension.
 * Run: node --test e2e/user-browser-v2.e2e.mjs
 * Loopback synthetic pages/token only; no real account or model calls.
 * Covers real targets, confirmation, revisions, origins and protected task tabs.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
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
      protocol,
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
