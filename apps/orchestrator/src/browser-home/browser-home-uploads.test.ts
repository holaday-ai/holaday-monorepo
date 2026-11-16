import type { EventEmitter } from 'node:events';
import { rm } from 'node:fs/promises';
import { pino } from 'pino';
import { type Browser, chromium } from 'playwright';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createPlaywrightUnifiedExecutor } from '../agent/browser-tools/playwright-unified-executor.js';
import { runUnifiedSupercarTask } from '../agent/browser-tools/unified-supercar-runner.js';
import { browserControlSessions } from '../agent/supercar/browser-control-sessions.js';
import type { BrowserInstance } from '../browser-pool/types.js';
import { env } from '../config/env.js';
import { browserOutputFixture } from '../files/testing/browser-output-fixture.js';
import type { MessagesAdapter, NeutralOutputContentBlock } from '../llm/messages-adapter.js';
import type { Context } from '../trpc/context.js';
import { browserHomeRouter } from '../trpc/routers/browser-home.js';
import { BrowserHomeUploads, browserHomeUploads } from './browser-home-uploads.js';

let browser: Browser;
beforeAll(async () => {
  browser = await chromium.launch({ args: ['--renderer-process-limit=2'] });
});
afterAll(async () => {
  await browser?.close();
});
const HTML = `<title>Upload workspace</title><h1>Upload workspace</h1><button id="choose">Choose report</button><p id="result"></p><label>Note<input id="note"></label><script>
document.querySelector('button').onclick=()=>{const file=document.createElement('input');file.type='file';file.accept='.csv';file.onchange=async()=>{document.querySelector('p').textContent=await file.files[0].text()};file.click()};</script>`;
async function fixture(collaborationV2 = true, manager = new BrowserHomeUploads()) {
  const f = await browserOutputFixture();
  const context = await browser.newContext();
  await context.route('https://fixture.test/**', (route) =>
    route.fulfill({ contentType: 'text/html', body: HTML }),
  );
  const page = await context.newPage();
  await page.goto('https://fixture.test/?token=synthetic-private');
  const home: BrowserInstance = {
    taskId: 'bhs_usr_alice',
    userId: 'usr_alice',
    status: 'ready',
    sessionPolicy: 'personal_home',
    index: 0,
    createdAt: Date.now(),
    lastActiveAt: Date.now(),
    capabilities: {
      ...(collaborationV2 ? { collaborationV2: true as const } : {}),
      viewportV2: true,
      observationV2: true,
      routingV2: false,
      replayV1: false,
    },
    executor: { getPage: async () => page } as never,
  };
  let live: BrowserInstance | null = home;
  let enabled = true;
  let active = true;
  const onIdle = vi.fn();
  const control = browserControlSessions.review(home).control;
  const pool = {
    peek: (id: string) => (live?.taskId === id ? live : null),
    touch: vi.fn(),
    browserHomeHolder: () => null,
    peekBrowserHome: () => live,
  };
  await manager.attach({
    instance: home,
    pool,
    files: f.service,
    userIdInternal: 7,
    enabled: () => enabled,
    activeOwner: async () => active,
    onIdle,
  });
  const row = await f.service.storeUpload({
    userIdInternal: 7,
    userExternalId: 'usr_alice',
    filename: 'report.csv',
    mimetype: 'text/csv',
    buffer: Buffer.from('sku,qty\nA-731,31\n'),
  });
  return {
    ...f,
    context,
    page,
    home,
    pool,
    manager,
    control,
    row,
    onIdle,
    enable(value: boolean) {
      enabled = value;
    },
    active(value: boolean) {
      active = value;
    },
    replace(value: BrowserInstance) {
      live = value;
    },
    async open() {
      await control.runHuman(() => page.locator('#choose').click(), 'mouseDown');
      await vi.waitFor(async () =>
        expect((await manager.current(home))?.request?.state).toBe('awaiting_files'),
      );
      return (await manager.current(home))!;
    },
    async close() {
      control.close();
      await context.close();
      await rm(f.root, { recursive: true, force: true });
    },
  };
}

describe('owned Home native file requests', () => {
  it.each([false, true])(
    'rechecks a model finish when the person opens a picker during thinking (v2=%s)',
    async (v2) => {
      const f = await fixture(v2);
      let turn = 0;
      let opened: Awaited<ReturnType<typeof f.open>> | undefined;
      const tool = (name: string, input: unknown): NeutralOutputContentBlock => ({
        type: 'tool_use',
        name,
        input,
        id: `${name}-${turn}`,
      });
      const adapter: MessagesAdapter = {
        metadata: { provider: 'anthropic', model: 'scripted-picker-finish' },
        async create(request) {
          let content: NeutralOutputContentBlock[];
          if (turn++ === 0) content = [tool('snapshot', {})];
          else if (turn === 2) {
            opened = await f.open();
            content = [
              tool('finish', { status: 'completed', summary: '网页标题为 Upload workspace' }),
              tool('navigate', { url: 'https://fixture.test/stale-plan' }),
            ];
          } else {
            expect(JSON.stringify(request.messages.at(-1))).toContain('fresh_observation');
            content = [
              tool('finish', { status: 'completed', summary: '网页标题为 Upload workspace' }),
            ];
          }
          return {
            id: `response-${turn}`,
            metadata: this.metadata,
            content,
            stopReason: 'tool_use',
            usage: {
              inputTokens: 1,
              outputTokens: 1,
              cacheReadInputTokens: null,
              cacheCreationInputTokens: null,
              complete: true,
            },
          };
        },
      };
      let done = false;
      const running = runUnifiedSupercarTask({
        taskId: 'tsk_picker_finish',
        intent: '查看网页标题',
        executor: f.home.executor,
        browserControl: f.control,
        browserCapabilities: {
          viewportV2: true,
          observationV2: true,
          routingV2: false,
          replayV1: false,
        },
        messagesAdapter: adapter,
      }).then((result) => {
        done = true;
        return result;
      });
      try {
        await vi.waitFor(() => expect(opened).toBeTruthy());
        await new Promise((resolve) => setTimeout(resolve, 50));
        expect(done).toBe(false);
        await f.manager.cancel(f.home, {
          instanceId: opened!.instanceId,
          requestId: opened!.request!.id,
        });
        expect((await running).status).toBe('completed');
        expect(turn).toBe(3);
        expect(f.page.url()).not.toContain('stale-plan');
      } finally {
        f.control.close();
        await running;
        await f.close();
      }
    },
    15_000,
  );
  it('uses actual protected procedures with original instance/request and active owner checks', async () => {
    const original = {
      BROWSER_HOME_ENABLED: env.BROWSER_HOME_ENABLED,
      BROWSER_HOME_FILES_V1: env.BROWSER_HOME_FILES_V1,
      BROWSER_HOME_ALLOWLIST: env.BROWSER_HOME_ALLOWLIST,
    };
    Object.assign(env, {
      BROWSER_HOME_ENABLED: true,
      BROWSER_HOME_FILES_V1: true,
      BROWSER_HOME_ALLOWLIST: '',
    });
    const f = await fixture(true, browserHomeUploads);
    const caller = (userId: string) =>
      browserHomeRouter.createCaller({
        userId,
        db: f.db,
        logger: pino({ level: 'silent' }),
        browserPool: f.pool,
      } as unknown as Context);
    try {
      const opened = await f.open();
      expect(await caller('usr_bob').fileRequest({ instanceId: opened.instanceId })).toMatchObject({
        session: null,
        changed: true,
      });
      const alice = caller('usr_alice');
      expect(await alice.fileRequest({ instanceId: opened.instanceId })).toMatchObject({
        session: { request: { id: opened.request!.id } },
      });
      const input = {
        instanceId: opened.instanceId,
        requestId: opened.request!.id,
        fileIds: [f.row.externalId],
      };
      await expect(caller('usr_bob').chooseFiles(input)).rejects.toThrow();
      await expect(
        alice.chooseFiles({ ...input, instanceId: '5c9c2c6e-f9c9-4bdf-9fba-108b2a1aa671' }),
      ).rejects.toThrow();
      expect((await alice.chooseFiles(input)).request?.state).toBe('handed_to_page');
      expect((await alice.chooseFiles(input)).request?.state).toBe('handed_to_page');
      await vi.waitFor(async () =>
        expect(await f.page.locator('#result').textContent()).toContain('A-731,31'),
      );
      f.faults.ownerStatus = 'closed';
      await expect(alice.fileRequest({ instanceId: opened.instanceId })).rejects.toMatchObject({
        code: 'UNAUTHORIZED',
      });
      env.BROWSER_HOME_FILES_V1 = false;
      expect(await alice.fileRequest({ instanceId: opened.instanceId })).toEqual({
        enabled: false,
        changed: false,
        session: null,
      });
    } finally {
      Object.assign(env, original);
      await f.close();
    }
  });
  it.each([false, true])(
    'pauses the actual control, permits human input and hands selected owned bytes to the original chooser (v2=%s)',
    async (v2) => {
      const f = await fixture(v2);
      try {
        const opened = await f.open();
        expect(opened.request).toMatchObject({
          origin: 'https://fixture.test',
          accept: '.csv',
          multiple: false,
        });
        expect(JSON.stringify(opened)).not.toContain('synthetic-private');
        expect((f.page as unknown as EventEmitter).listenerCount('filechooser')).toBe(1);
        const observe = vi.fn(async () => {});
        expect(await f.control.checkpoint(observe, { maxWaitMs: 30 })).toMatchObject({
          blocked: true,
        });
        expect(observe).not.toHaveBeenCalled();
        await f.control.runHuman(() => f.page.locator('#note').fill('user kept'), 'insertText');
        const result = await f.manager.choose(f.home, {
          instanceId: opened.instanceId,
          requestId: opened.request!.id,
          fileIds: [f.row.externalId],
        });
        expect(result.request?.state).toBe('handed_to_page');
        await vi.waitFor(async () =>
          expect(await f.page.locator('#result').textContent()).toContain('A-731,31'),
        );
        expect(await f.page.locator('#note').inputValue()).toBe('user kept');
        expect(f.home.homeFileUploads?.pending()).toBe(false);
        expect(f.control.hasUnobservedHumanInput()).toBe(true);
        expect(f.onIdle).toHaveBeenCalled();
      } finally {
        await f.close();
      }
    },
  );
  it.each([1, 2])(
    'cancels during file read %s without holding the human input queue or delivering late',
    async (heldRead) => {
      const f = await fixture();
      let release!: () => void;
      const wait = new Promise<void>((done) => {
        release = done;
      });
      try {
        const opened = await f.open();
        const load = f.service.loadMany.bind(f.service);
        let reads = 0;
        const read = vi.spyOn(f.service, 'loadMany').mockImplementation(async (...args) => {
          if (++reads === heldRead) await wait;
          return load(...args);
        });
        const choosing = f.manager.choose(f.home, {
          instanceId: opened.instanceId,
          requestId: opened.request!.id,
          fileIds: [f.row.externalId],
        });
        await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(heldRead));
        await f.control.runHuman(() => f.page.locator('#note').fill('user kept'), 'insertText');
        expect(
          (
            await f.manager.cancel(f.home, {
              instanceId: opened.instanceId,
              requestId: opened.request!.id,
            })
          ).request?.state,
        ).toBe('cancelled');
        release();
        expect((await choosing).request?.state).toBe('cancelled');
        expect(await f.page.locator('#result').textContent()).toBe('');
        expect(await f.page.locator('#note').inputValue()).toBe('user kept');
        expect(f.home.homeFileUploads?.pending()).toBe(false);
      } finally {
        release();
        await f.close();
      }
    },
  );
  it('treats concurrent retries of the same manual selection as one handoff', async () => {
    const f = await fixture();
    try {
      const opened = await f.open();
      const input = {
        instanceId: opened.instanceId,
        requestId: opened.request!.id,
        fileIds: [f.row.externalId],
      };
      await Promise.all([f.manager.choose(f.home, input), f.manager.choose(f.home, input)]);
      expect((await f.manager.current(f.home))?.request?.state).toBe('handed_to_page');
      await vi.waitFor(async () =>
        expect(await f.page.locator('#result').textContent()).toContain('A-731,31'),
      );
    } finally {
      await f.close();
    }
  });
  it.each(['navigate', 'replace', 'disabled', 'account'] as const)(
    'refuses stale %s before loading any file bytes',
    async (change) => {
      const f = await fixture();
      try {
        const opened = await f.open();
        const read = vi.spyOn(f.service, 'loadMany');
        if (change === 'navigate') await f.page.reload();
        if (change === 'replace') f.replace({ ...f.home, executor: {} as never });
        if (change === 'disabled') f.enable(false);
        if (change === 'account') f.active(false);
        await expect(
          f.manager.choose(f.home, {
            instanceId: opened.instanceId,
            requestId: opened.request!.id,
            fileIds: [f.row.externalId],
          }),
        ).rejects.toThrow();
        expect(read).not.toHaveBeenCalled();
        expect(f.home.homeFileUploads?.pending()).toBe(false);
      } finally {
        await f.close();
      }
    },
  );
  it('keeps an uncertain native delivery as unknown and never resends a repeated request', async () => {
    const f = await fixture();
    let sends = 0;
    f.page.once('filechooser', (chooser) => {
      const set = chooser.setFiles.bind(chooser);
      vi.spyOn(chooser, 'setFiles').mockImplementation(async (...args) => {
        sends++;
        await set(...args);
        throw new Error('synthetic lost receipt');
      });
    });
    try {
      const opened = await f.open();
      const input = {
        instanceId: opened.instanceId,
        requestId: opened.request!.id,
        fileIds: [f.row.externalId],
      };
      expect((await f.manager.choose(f.home, input)).request?.state).toBe('unknown');
      expect((await f.manager.choose(f.home, input)).request?.state).toBe('unknown');
      expect(sends).toBe(1);
      await vi.waitFor(async () =>
        expect(await f.page.locator('#result').textContent()).toContain('A-731,31'),
      );
    } finally {
      await f.close();
    }
  });
  it('routes an assistant click through the same single page listener without opening a competing human request', async () => {
    const f = await fixture();
    const tools = createPlaywrightUnifiedExecutor(f.page, {
      resolveUploads: async () => [
        {
          fileId: f.row.externalId,
          name: 'report.csv',
          mimeType: 'text/csv',
          buffer: Buffer.from('sku,qty\nA-731,31\n'),
        },
      ],
    });
    try {
      const snapshot = await tools.execute({ tool: 'snapshot' });
      const ref = snapshot.text.match(/button "Choose report" \[ref=(e\d+)\]/)![1]!;
      const clicked = await tools.execute({ tool: 'click', ref });
      expect(clicked.fileChooser?.id).toBeTruthy();
      expect((f.page as unknown as EventEmitter).listenerCount('filechooser')).toBe(1);
      expect((await f.manager.current(f.home))?.request).toBeNull();
      expect(f.home.homeFileUploads?.pending()).toBe(false);
    } finally {
      tools.dispose();
      await f.close();
    }
  });
});
