import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { expect, it } from 'vitest';
import { BrowserReplayStore, BrowserReplayRecorder } from './browser-replay.js';
import { createPlaywrightUnifiedExecutor } from './playwright-unified-executor.js';

it('records without invalidating the current actionable refs', async () => {
  const root = await mkdtemp(join(tmpdir(), 'replay-refs-'));
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.route('http://example.test/**', (r) =>
      r.fulfill({ body: '<label>Name<input></label>', contentType: 'text/html' }),
    );
    await page.goto('http://example.test/');
    const tools = createPlaywrightUnifiedExecutor(page, { observationV2: true });
    const snapshot = JSON.parse((await tools.execute({ tool: 'read_page' })).text);
    const recorder = new BrowserReplayRecorder(
      new BrowserReplayStore(root),
      'u',
      't',
      new Set(['http://example.test']),
    );
    await recorder.capture(page, 'a', 'before');
    const result = await tools.execute({
      tool: 'type',
      ref: snapshot.tree.match(/ref=(e\d+)/)[1],
      text: 'Alice',
      observationRevision: snapshot.observationRevision,
    });
    expect(result.ok, result.text).toBe(true);
    expect(await page.locator('input').inputValue()).toBe('Alice');
    tools.dispose();
    await recorder.dispose();
  } finally {
    await browser.close();
    await rm(root, { recursive: true, force: true });
  }
});

it('stores owner-only frames, masks login/2FA/payment, expires and deletes replay', async () => {
  const root = await mkdtemp(join(tmpdir(), 'replay-test-'));
  const browser = await chromium.launch({ headless: true, args: ['--renderer-process-limit=2'] });
  let now = 1000;
  try {
    const store = new BrowserReplayStore(root, () => now);
    const page = await browser.newPage();
    await page.route('http://example.test/**', (route) =>
      route.fulfill({ body: '<h1>Public catalog</h1>', contentType: 'text/html' }),
    );
    await page.goto('http://example.test/catalog');
    const recorder = new BrowserReplayRecorder(
      store,
      'owner',
      'task',
      new Set(['http://example.test']),
    );
    await recorder.capture(page, 'a', 'before');
    await page.setContent(
      '<label>Password<input type="password" value="s3cret"></label><p>s3cret</p>',
    );
    await recorder.capture(page, 'a', 'after');
    await page.setContent('<input autocomplete="one-time-code" value="123456">');
    await recorder.capture(page, 'b', 'failure');
    const result = await store.read('owner', 'task');
    expect(result!.frames).toHaveLength(3);
    expect(result!.frames[0]!.image).toMatch(/^data:image\/jpeg;base64,/);
    expect(result!.frames[1]!.image).toBeUndefined();
    expect(result!.frames[1]!.redacted).toBe(true);
    expect(result!.frames[2]!.redacted).toBe(true);
    expect(JSON.stringify(result)).not.toContain('s3cret');
    expect(await store.read('attacker', 'task')).toBeNull();
    await store.remove('attacker', 'task');
    expect(await store.read('owner', 'task')).not.toBeNull();
    now += 7 * 86400000 + 1;
    expect(await store.read('owner', 'task')).toBeNull();
    await store.remove('owner', 'task');
    expect(await store.read('owner', 'task')).toBeNull();
    await recorder.capture(page, 'late', 'after');
    expect(await store.read('owner', 'task')).toBeNull();
  } finally {
    await browser.close();
    await rm(root, { recursive: true, force: true });
  }
});

it('does not capture unapproved origins and represents gaps and limits explicitly', async () => {
  const root = await mkdtemp(join(tmpdir(), 'replay-limit-'));
  const browser = await chromium.launch({ headless: true });
  try {
    const store = new BrowserReplayStore(root);
    const page = await browser.newPage();
    const recorder = new BrowserReplayRecorder(store, 'u', 't', new Set(), { maxFrames: 2 });
    await recorder.capture(page, 'a', 'before');
    await recorder.capture(page, 'a', 'failure');
    await recorder.capture(page, 'b', 'after');
    const replay = await store.read('u', 't');
    expect(replay!.frames.every((f) => !f.image && f.gap)).toBe(true);
    expect(replay!.truncated).toBe(true);
  } finally {
    await browser.close();
    await rm(root, { recursive: true, force: true });
  }
});
