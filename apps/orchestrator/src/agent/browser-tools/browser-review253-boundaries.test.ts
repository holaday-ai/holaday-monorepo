import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { describe, expect, it } from 'vitest';
import { BrowserReplayRecorder, BrowserReplayStore } from './browser-replay.js';
import { createPlaywrightUnifiedExecutor } from './playwright-unified-executor.js';

async function readReplay(store: BrowserReplayStore, owner: string, task: string) {
  const replay = await store.read(owner, task);
  if (!replay) throw new Error('expected replay archive');
  return replay;
}

describe('PR253 true input sensitivity and replay lifecycle', () => {
  it('does not suppress ordinary login links or hidden password templates', async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.route('http://public.test/**', (r) =>
        r.fulfill({
          contentType: 'text/html; charset=utf-8',
          body: '<header><a href="/login">登录 / Sign in</a></header><article>完整普通文章</article><input type="password" style="display:none">',
        }),
      );
      await page.goto('http://public.test/article');
      const tools = createPlaywrightUnifiedExecutor(page, { observationV2: true });
      try {
        const data = JSON.parse((await tools.execute({ tool: 'get_page_text' })).text);
        expect(data.redacted ?? false).toBe(false);
        expect(data.text).toContain('完整普通文章');
        expect(data.end).toBe(true);
      } finally {
        tools.dispose();
      }
    } finally {
      await browser.close();
    }
  });
  it('masks cashier paths and editable card/payment-password/OTP fields without claiming end', async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      for (const [path, html] of [
        ['/cashier/index', '<h1>确认付款</h1>'],
        ['/pay', '<h1>余额支付</h1>'],
        ['/article', '<label>银行卡号<input name="cardNumber" value="synthetic-card"></label>'],
        ['/article', '<label>支付密码<input aria-label="支付密码" value="synthetic-pin"></label>'],
        ['/article', '<input autocomplete="one-time-code" value="123456">'],
        ['/article', '<input type="password" value="synthetic-password">'],
      ]) {
        const page = await browser.newPage();
        await page.route('http://private.test/**', (r) =>
          r.fulfill({ contentType: 'text/html; charset=utf-8', body: html }),
        );
        await page.goto(`http://private.test${path}`);
        const tools = createPlaywrightUnifiedExecutor(page, { observationV2: true });
        try {
          const data = JSON.parse((await tools.execute({ tool: 'get_page_text' })).text);
          expect(data.redacted).toBe(true);
          expect(data.end).toBe(false);
          expect(data.status).toBe('redacted_unread');
          expect(data.truncated).toBe(true);
          expect(data.text).toBeUndefined();
        } finally {
          tools.dispose();
          await page.close();
        }
      }
    } finally {
      await browser.close();
    }
  });
  it('does not sample while paused and resumes only after the takeover', async () => {
    const root = await mkdtemp(join(tmpdir(), 'replay-pause-'));
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.route('http://public.test/**', (r) =>
        r.fulfill({ body: '<h1>Public</h1>', contentType: 'text/html; charset=utf-8' }),
      );
      await page.goto('http://public.test/');
      const store = new BrowserReplayStore(root);
      const rec = new BrowserReplayRecorder(
        store,
        'alice',
        'task',
        new Set(['http://public.test']),
      );
      await rec.capture(page, 'before', 'sample');
      const inFlight = rec.capture(page, 'queued', 'sample');
      await rec.pause();
      await inFlight;
      const count = (await readReplay(store, 'alice', 'task')).total;
      await rec.capture(page, 'manual', 'sample');
      expect((await readReplay(store, 'alice', 'task')).total).toBe(count);
      rec.resume();
      await rec.capture(page, 'resumed', 'sample');
      expect((await readReplay(store, 'alice', 'task')).total).toBe(count + 1);
      await rec.dispose();
    } finally {
      await browser.close();
      await rm(root, { recursive: true, force: true });
    }
  });
  it('purges one owner and prevents resurrection across store instances', async () => {
    const root = await mkdtemp(join(tmpdir(), 'replay-owner-'));
    const frame = {
      id: 'a',
      actionId: 'a',
      phase: 'before' as const,
      capturedAt: 1,
      tabId: 't',
      frameId: 'f',
      observationRevision: 'r',
      sourceURL: 'http://public.test',
      redacted: false,
      gap: true,
    };
    const limits = { maxFrames: 10, maxBytes: 1000, maxMs: 1000 };
    try {
      const store = new BrowserReplayStore(root);
      await store.append('alice', 'a', frame, undefined, limits);
      await store.append('alice', 'b', frame, undefined, limits);
      await store.append('bob', 'b', frame, undefined, limits);
      await store.removeOwner('alice');
      expect(await store.read('alice', 'a')).toBeNull();
      expect(await store.read('alice', 'b')).toBeNull();
      expect(await store.read('bob', 'b')).not.toBeNull();
      const reopened = new BrowserReplayStore(root);
      await reopened.append('alice', 'late', frame, undefined, limits);
      expect(await reopened.read('alice', 'late')).toBeNull();
      expect(await reopened.read('bob', 'b')).not.toBeNull();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

it('detects new key-region receipts behind neutral GET endpoints while preserving old receipts', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    for (const [script, expected] of [
      ["fetch('/opaque');document.querySelector('p').textContent='下单成功，订单号 1001'", true],
      [
        "document.querySelector('main').insertAdjacentHTML('beforeend','<p>更多普通结果</p>')",
        false,
      ],
    ] as const) {
      const page = await browser.newPage();
      await page.route('http://extra.test/**', (r) =>
        r.fulfill({
          contentType: 'text/html; charset=utf-8',
          body: `<nav>我的订单</nav><main><p>${expected ? '' : '订单号 1000'}</p><button onclick="${script}">搜索</button></main>`,
        }),
      );
      await page.goto('http://extra.test/');
      const tools = createPlaywrightUnifiedExecutor(page, { observationV2: true });
      try {
        const state = JSON.parse((await tools.execute({ tool: 'read_page' })).text);
        const ref = state.tree
          .split('\n')
          .find((l: string) => l.includes('button'))
          .match(/ref=(e\d+)/)[1];
        const result = await tools.execute({
          tool: 'click',
          ref,
          observationRevision: state.observationRevision,
        });
        expect(result.effect?.unexpected).toBe(expected);
      } finally {
        tools.dispose();
        await page.close();
      }
    }
  } finally {
    await browser.close();
  }
});
it('does not exempt transactional beacons disguised as analytics', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.route('http://extra.test/**', (r) =>
      r.fulfill({
        body: `<button onclick="navigator.sendBeacon('/collect?action=create_order','synthetic')">搜索</button>`,
        contentType: 'text/html; charset=utf-8',
      }),
    );
    await page.goto('http://extra.test/');
    const tools = createPlaywrightUnifiedExecutor(page, { observationV2: true });
    try {
      const state = JSON.parse((await tools.execute({ tool: 'read_page' })).text);
      const result = await tools.execute({
        tool: 'click',
        ref: state.tree.match(/ref=(e\d+)/)[1],
        observationRevision: state.observationRevision,
      });
      expect(result.interruption?.reason).toBe('unexpected_effect');
    } finally {
      tools.dispose();
    }
  } finally {
    await browser.close();
  }
});
