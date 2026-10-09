import assert from 'node:assert/strict';
import test from 'node:test';
import { assertLocalUrl, classifyGeometry, evaluateGate } from '../lib/checks.mjs';
import { canonicalUrl, discoverRoutes, scanControls, scenarioSlug } from '../lib/inventory.mjs';
import { isPopupNavigation } from '../lib/network.mjs';
import { createSeed, dispatch } from '../lib/seed.mjs';
test('new JSX routes and native/custom controls cannot silently disappear from inventory', () => {
  assert.deepEqual(
    discoverRoutes(
      '<Route path="/" element={<Home/>}/><Route path="/x/:id" element={<Detail/>}/>',
    ).map((x) => x.pattern),
    ['/', '/x/:id'],
  );
  assert.equal(
    scanControls(
      '<button onClick={save}>保存</button><Select onValueChange={change}/><a href="/x">链接</a>',
      'x.tsx',
    ).length,
    3,
  );
});
test('unhandled seed RPC remains an explicit coverage error', () =>
  assert.throws(() => dispatch(createSeed(), 'unknown.rpc', {}, 'GET'), /UNHANDLED_SEED_RPC/));
test('pagination appends seeded rows; mutation persists only in isolated seed state', () => {
  const seed = createSeed();
  const first = dispatch(seed, 'tasks.list', { limit: 2 }, 'GET');
  assert.equal(first.tasks.length, 2);
  assert.ok(first.nextCursor);
  const second = dispatch(seed, 'tasks.list', { limit: 2, cursor: first.nextCursor }, 'GET');
  assert.notEqual(second.tasks[0].taskId, first.tasks[0].taskId);
  dispatch(seed, 'tasks.rename', { taskId: first.tasks[0].taskId, title: '已改名' }, 'POST');
  assert.equal(
    dispatch(seed, 'tasks.detail', { taskId: first.tasks[0].taskId }, 'GET').title,
    '已改名',
  );
});
test('overlap exemption is explicit; clipping, truncation and dead coverage stay blocking', () => {
  const bad = {
    id: 'x',
    x: 95,
    y: 0,
    width: 20,
    height: 20,
    scrollWidth: 60,
    clientWidth: 20,
    truncated: true,
    hasHint: false,
  };
  assert.ok(classifyGeometry([bad], 100, 100).some((x) => x.rule === 'viewport-clipping'));
  assert.ok(classifyGeometry([bad], 100, 100).some((x) => x.rule === 'unexplained-truncation'));
  assert.equal(evaluateGate({ findings: [], coverageGaps: ['missing'] }), 'failed');
  assert.equal(evaluateGate({ findings: [{ severity: 'P1' }], coverageGaps: [] }), 'failed');
  assert.equal(evaluateGate({ findings: [], coverageGaps: [] }), 'passed');
});
test('audits reject non-loopback targets including misleading hosts', () => {
  for (const url of ['https://holaday.ai', 'http://localhost.evil', 'http://127.0.0.1.evil'])
    assert.throws(() => assertLocalUrl(url));
  assert.equal(assertLocalUrl('http://127.0.0.1:1234').hostname, '127.0.0.1');
});

test('overlapping independent controls fail while nested controls and intentional overlay layers do not', () => {
  const a = { id: 'a', x: 0, y: 0, width: 30, height: 30, inViewport: true, layer: 'page' };
  const b = { id: 'b', x: 10, y: 0, width: 30, height: 30, inViewport: true, layer: 'page' };
  assert.ok(classifyGeometry([a, b], 100, 100).some((x) => x.rule === 'control-overlap'));
  assert.equal(classifyGeometry([a, { ...b, ancestorIds: ['a'] }], 100, 100).length, 0);
  assert.equal(classifyGeometry([a, { ...b, layer: 'menu' }], 100, 100).length, 0);
});

test('an interrupted or partial report cannot pass even with zero findings', () => {
  assert.equal(
    evaluateGate({ expectedPages: 240, pages: [], findings: [], coverageGaps: [] }),
    'failed',
  );
  assert.equal(
    evaluateGate({ expectedPages: 1, pages: [{}], findings: [], coverageGaps: [] }),
    'failed',
  );
  assert.equal(
    evaluateGate({
      expectedPages: 1,
      pages: [{}],
      finishedAt: '2026-10-09T00:00:00Z',
      findings: [],
      coverageGaps: [],
    }),
    'passed',
  );
});

test('settings and Chrome fixtures expose real response shapes and isolated mutations', () => {
  const s = createSeed();
  assert.equal(dispatch(s, 'tasks.localChromeTabs').connected, false);
  assert.ok(Array.isArray(dispatch(s, 'memory.list').memories));
  dispatch(s, 'memory.clear', {}, 'POST');
  assert.deepEqual(dispatch(s, 'memory.list').memories, []);
  assert.equal(dispatch(s, 'accountClosure.preview').automaticRefund, false);
  assert.equal(dispatch(s, 'auth.loginOptions').emailCode, true);
  dispatch(s, 'watchlists.enableDailyBriefing', {}, 'POST');
  assert.equal(dispatch(s, 'watchlists.briefingStatus').enabled, true);
});

test('home and catch-all screenshots never share a filename', () => {
  assert.notEqual(scenarioSlug('/'), scenarioSlug('*'));
});

test('canonical routes retain settings hash sections', () => {
  assert.notEqual(
    canonicalUrl('http://localhost/settings#memory'),
    canonicalUrl('http://localhost/settings#account'),
  );
  assert.equal(canonicalUrl('http://localhost/settings#memory'), '/settings#memory');
});

test('astrology empty trend uses the actual nullable shape and batch creation persists its response', () => {
  const seed = createSeed();
  for (const period of ['daily', 'weekly', 'monthly', 'yearly'])
    assert.equal(dispatch(seed, `astrology.${period}`, {}).sevenDayTrend, null);
  const created = dispatch(seed, 'batchTasks.create', { prompts: ['one', 'two', 'one'] }, 'POST');
  assert.equal(created.itemsTotal, 2);
  assert.equal(dispatch(seed, 'batchTasks.detail', { batchId: created.batchId }).items.length, 2);
  assert.ok(dispatch(seed, 'batchTasks.list', {}).items.some((x) => x.batchId === created.batchId));
});

test('popup classification accepts only navigation and handles the pre-frame request race', () => {
  const main = {};
  assert.equal(isPopupNavigation({ isNavigationRequest: () => false }, main), false);
  assert.equal(
    isPopupNavigation(
      { isNavigationRequest: () => true, frame: () => ({ page: () => main }) },
      main,
    ),
    false,
  );
  assert.equal(
    isPopupNavigation(
      {
        isNavigationRequest: () => true,
        frame: () => {
          throw Error('Frame for this navigation request is not available');
        },
      },
      main,
    ),
    true,
  );
});
