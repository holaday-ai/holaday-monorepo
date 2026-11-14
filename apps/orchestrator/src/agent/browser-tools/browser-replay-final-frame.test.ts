import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type Browser, type Page, chromium } from 'playwright';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { BrowserReplayRecorder, BrowserReplayStore } from './browser-replay.js';

/**
 * FIX-REPLAY-GAPS (bakeoff-3 D19-B09) — a task that parks for the user or ends
 * right after an action on a page that is still settling used to end its replay
 * on an image-less `failure` frame ("此处未录制或连接中断"), although the live view
 * showed the page. The recorder now records one final frame before it pauses
 * (awaiting_user) or is disposed (completed / failed / cancelled / timeout).
 */

// DOM text changes every 10 ms for ~1.2 s: every screenshot taken meanwhile is
// discarded by the observation-revision check (the existing rule), like a page
// still loading after navigation.
const SETTLING = `<h1>Video page</h1><p id="t">0</p><script>
  let n = 0; const id = setInterval(() => { document.getElementById('t').textContent = String(++n); if (n > 120) clearInterval(id); }, 10);
</script>`;

let browser: Browser;
beforeAll(async () => {
  browser = await chromium.launch({ headless: true });
}, 60_000);
afterAll(async () => {
  await browser?.close();
});

async function setup(body: string, limits = {}) {
  const root = await mkdtemp(join(tmpdir(), 'replay-final-'));
  const page = await browser.newPage();
  await page.route('http://example.test/**', (r) => r.fulfill({ body, contentType: 'text/html' }));
  const store = new BrowserReplayStore(root);
  const recorder = new BrowserReplayRecorder(
    store,
    'owner',
    'task',
    new Set(['http://example.test']),
    limits,
  );
  return {
    page,
    store,
    recorder,
    async frames() {
      const all = [];
      for (let offset: number | null = 0; offset !== null; ) {
        const read: Awaited<ReturnType<BrowserReplayStore['read']>> = await store.read(
          'owner',
          'task',
          offset,
        );
        all.push(...read!.frames);
        offset = read!.next;
      }
      return all;
    },
    async cleanup() {
      await page.close();
      await rm(root, { recursive: true, force: true });
    },
  };
}

/** The last action ends on the still-settling page and its failure frame is a gap. */
async function failOnSettlingPage(page: Page, recorder: BrowserReplayRecorder) {
  await recorder.capture(page, 'action-1', 'before');
  await page.goto('http://example.test/watch', { waitUntil: 'commit' });
  await recorder.capture(page, 'action-1', 'failure', 'failed');
}

it.each(['pause', 'dispose'] as const)(
  'ends the replay on a final frame with the page (%s)',
  async (end) => {
    const t = await setup(SETTLING);
    try {
      await failOnSettlingPage(t.page, t.recorder);
      await t.recorder[end]();
      const frames = await t.frames();
      expect(frames.at(-2)).toMatchObject({ actionId: 'action-1', phase: 'failure', gap: true });
      expect(frames.at(-1)).toMatchObject({
        actionId: 'final',
        phase: 'final',
        gap: false,
        redacted: false,
        image: expect.stringMatching(/^data:image\/jpeg;base64,/),
      });
    } finally {
      await t.cleanup();
    }
  },
  20_000,
);

it('keeps masking a sensitive final page and never stores its content', async () => {
  const t = await setup('<h1>登录</h1><label>密码<input type="password" value="s3cret"></label>');
  try {
    await t.page.goto('http://example.test/login');
    await t.recorder.capture(t.page, 'action-1', 'after');
    await t.recorder.dispose();
    const frames = await t.frames();
    expect(frames.at(-1)).toMatchObject({ phase: 'final', redacted: true });
    expect(frames.at(-1)?.image).toBeUndefined();
    expect(JSON.stringify(frames)).not.toContain('s3cret');
  } finally {
    await t.cleanup();
  }
});

it('does not record an unapproved origin as the final frame', async () => {
  const t = await setup('<h1>Elsewhere</h1>');
  try {
    await t.page.route('http://other.test/**', (r) =>
      r.fulfill({ body: '<h1>Other</h1>', contentType: 'text/html' }),
    );
    await t.page.goto('http://other.test/');
    await t.recorder.capture(t.page, 'action-1', 'after');
    await t.recorder.dispose();
    const frames = await t.frames();
    expect(frames.at(-1)).toMatchObject({ phase: 'final', gap: true });
    expect(frames.every((frame) => !frame.image)).toBe(true);
  } finally {
    await t.cleanup();
  }
});

it('records nothing while parked for the user, then finalizes again when the task ends', async () => {
  const t = await setup('<h1>Public page</h1>');
  try {
    await t.page.goto('http://example.test/');
    await t.recorder.capture(t.page, 'action-1', 'after');
    await t.recorder.pause();
    // The user's takeover while parked is never recorded.
    await t.recorder.capture(t.page, 'sample-1', 'sample');
    expect((await t.frames()).map((f) => f.phase)).toEqual(['after', 'final']);
    t.recorder.resume();
    await t.recorder.dispose();
    expect((await t.frames()).map((f) => f.phase)).toEqual(['after', 'final', 'final']);
  } finally {
    await t.cleanup();
  }
});

it('keeps the final frame image past the frame budget', async () => {
  const t = await setup('<h1>Public page</h1>', { maxFrames: 2 });
  try {
    await t.page.goto('http://example.test/');
    await t.recorder.capture(t.page, 'a', 'before');
    await t.recorder.capture(t.page, 'a', 'after');
    await t.recorder.capture(t.page, 'b', 'before'); // over budget: dropped
    await t.recorder.dispose();
    const frames = await t.frames();
    expect(frames.map((f) => f.phase)).toEqual(['before', 'after', 'final']);
    expect(frames.at(-1)?.image).toMatch(/^data:image\/jpeg;base64,/);
    expect((await t.store.read('owner', 'task'))!.truncated).toBe(true);
  } finally {
    await t.cleanup();
  }
});

it('does nothing when the recorder never saw a page', async () => {
  const t = await setup('<h1>unused</h1>');
  try {
    await t.recorder.dispose();
    expect(await t.store.read('owner', 'task')).toBeNull();
  } finally {
    await t.cleanup();
  }
});
