/** Real local BrowserPool -> Chromium -> CDP acceptance; no model or credentials.
 * Run each case in a fresh process: tsx scripts/canary-browse-repro.ts canary|all|off|outsider output.json
 * macOS uses the pool's native headless Chromium path, Linux uses its quartet.
 */
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pino } from 'pino';
import type { UnifiedBrowserAction } from '../src/agent/browser-tools/unified-tools.js';

const mode = process.argv[2] ?? 'canary';
assert(['canary', 'all', 'off', 'outsider'].includes(mode));
const outputPath = process.argv[3] ?? join(tmpdir(), `canary-${mode}.json`);
Object.assign(process.env, {
  NODE_ENV: 'test',
  JWT_SECRET: 'public-local-test-placeholder-only-000000',
  DATABASE_URL: 'mysql://test:test@127.0.0.1:3306/test',
  REDIS_URL: 'redis://127.0.0.1:6379',
  BROWSER_VIEWPORT_V2: String(mode === 'all'),
  BROWSER_OBSERVATION_V2: String(mode === 'all'),
  BROWSER_REPLAY_V1: String(mode === 'all'),
  USER_BROWSER_ROUTING_V2: String(mode === 'all'),
  BROWSER_V2_CANARY_USER_IDS: ['canary', 'outsider'].includes(mode) ? 'usr_canary' : '',
});
const { BrowserPool } = await import('../src/browser-pool/browser-pool.js');
const { createPlaywrightUnifiedExecutor } = await import(
  '../src/agent/browser-tools/playwright-unified-executor.js'
);
const { ensureExecutionViewport } = await import('../src/agent/browser-tools/browser-viewport.js');
const { browserCapabilities, instanceBrowserCapabilities } = await import(
  '../src/config/browser-capabilities.js'
);
const { browserControlSessions } = await import(
  '../src/agent/supercar/browser-control-sessions.js'
);
const { createOwnedScreencastInputBridge } = await import(
  '../src/streaming/owned-screencast-input.js'
);
const { BrowserReplayStore, BrowserReplayRecorder } = await import(
  '../src/agent/browser-tools/browser-replay.js'
);
const root = await mkdtemp(join(tmpdir(), 'holaday-public-browse-'));
const listener = createServer();
await new Promise<void>((resolve) => listener.listen(0, '127.0.0.1', resolve));
const port = (listener.address() as { port: number }).port;
await new Promise<void>((resolve) => listener.close(() => resolve()));
const owner = mode === 'outsider' ? 'usr_outside' : 'usr_canary';
const pool = new BrowserPool(
  {
    maxInstances: 1,
    idleTimeoutMs: 300000,
    baseDir: root,
    cdpPortStart: port,
    vncPortStart: port + 1,
    wsPortStart: port + 2,
    displayStart: 170,
    screenSize: '1280x800x24',
    vncEnabled: false,
  },
  pino({ level: 'warn' }),
);
const records: unknown[] = [];
let succeeded = false;
try {
  const capabilities = Object.freeze(browserCapabilities(owner));
  const instance = await pool.allocate(`tsk_${mode}`, owner, 'sidepanel', { capabilities });
  const page = await instance.executor.getPage();
  await ensureExecutionViewport(page);
  const control = browserControlSessions.start(instance);
  const applied: unknown[] = [];
  const bridge = createOwnedScreencastInputBridge({
    instance,
    peek: (id) => pool.peek(id),
    onViewportApplied: (v) => applied.push(v),
  });
  await bridge.attach({
    handle: async (envelope) => {
      if (envelope.type === 'viewport')
        await page.setViewportSize({ width: envelope.width, height: envelope.height });
    },
  });
  await bridge.receive(
    JSON.stringify({ type: 'input', payload: { type: 'viewport', width: 500, height: 679 } }),
  );
  await control.control.checkpoint(async () => undefined);
  assert.deepEqual(page.viewportSize(), { width: 1280, height: 800 });
  process.env.BROWSER_V2_CANARY_USER_IDS = '';
  assert.deepEqual(instanceBrowserCapabilities(instance), capabilities);
  records.push({
    phase: 'topology',
    mode,
    apiPid: process.pid,
    browserPid: instance.bravePid,
    capabilities,
    viewport: page.viewportSize(),
    profile: instance.viewportProfile,
    applied,
  });
  const tools = createPlaywrightUnifiedExecutor(page, {
    observationV2: capabilities.observationV2,
  });
  const store = new BrowserReplayStore(join(root, 'replay'));
  const replay = capabilities.replayV1
    ? new BrowserReplayRecorder(
        store,
        owner,
        instance.taskId,
        new Set(['https://example.com', 'https://www.wikipedia.org']),
      )
    : null;
  const run = async (action: UnifiedBrowserAction) => {
    const result = await tools.execute(action);
    records.push({
      action,
      result: { ...result, image: undefined },
      url: tools.page.url(),
      viewport: tools.page.viewportSize(),
    });
    assert.equal(
      result.ok,
      true,
      `${action.tool}: ${result.errorCode ?? ''} ${result.errorMessage ?? result.text}`,
    );
    assert(!result.interruption, `${action.tool} unexpectedly interrupted`);
    const size = tools.page.viewportSize()!;
    assert(size.width >= 1280 && size.height >= 800);
    if (replay) await replay.capture(tools.page, String(records.length), 'after', 'ok');
    return result;
  };
  try {
    await run({ tool: 'navigate', url: 'https://example.com' });
    if (capabilities.observationV2) await run({ tool: 'read_page' });
    else {
      const disabled = await tools.execute({ tool: 'read_page' });
      assert.deepEqual(disabled, { ok: false, text: 'capability_missing' });
      records.push({
        phase: 'legacy-read',
        result: disabled,
        fallback: 'snapshot (existing V1 contract)',
      });
      await run({ tool: 'snapshot' });
    }
    const snapshot = await run({ tool: 'snapshot' });
    assert(snapshot.text.length > 100);
    const tabs = await run({ tool: 'list_tabs' });
    const original = JSON.parse(tabs.text).tabs[0].tabId as string;
    await run({ tool: 'new_tab' });
    await run({ tool: 'navigate', url: 'https://www.wikipedia.org/' });
    const wiki = await run({ tool: capabilities.observationV2 ? 'read_page' : 'snapshot' });
    assert(/wikipedia/i.test(wiki.text));
    await run({ tool: 'switch_tab', targetTabId: original });
    assert.equal(new URL(tools.page.url()).hostname, 'example.com');
    await run({ tool: 'snapshot' });
    const archive = replay ? await store.read(owner, instance.taskId) : null;
    const imageFrames = archive?.frames.filter((frame) => Boolean(frame.image)).length ?? 0;
    records.push({
      phase: 'replay',
      enabled: Boolean(replay),
      frames: archive?.frames.length ?? 0,
      imageFrames,
    });
    if (replay) assert(imageFrames > 0, 'expected public-page replay images');
    succeeded = true;
  } finally {
    await replay?.dispose();
    tools.dispose();
    control.finish();
  }
} finally {
  await pool.shutdown();
  await writeFile(outputPath, JSON.stringify({ mode, succeeded, records }, null, 2));
  await rm(root, { recursive: true, force: true });
}
console.log(JSON.stringify({ mode, succeeded, outputPath }));
