import { rm } from 'node:fs/promises';
import { type Browser, chromium } from 'playwright';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { env } from '../../config/env.js';
import { parseFileForPrompt } from '../../files/parsers.js';
import { browserOutputFixture } from '../../files/testing/browser-output-fixture.js';
import type {
  MessagesAdapter,
  NeutralMessagesRequest,
  NeutralOutputContentBlock,
} from '../../llm/messages-adapter.js';
import { BrowserControl } from '../supercar/browser-control.js';
import { BrowserTaskFiles } from './browser-task-files.js';

const legacy = vi.hoisted(() => ({
  run: vi.fn(async () => ({
    status: 'completed' as const,
    summary: 'legacy',
    iterations: 1,
    toolsUsed: [],
  })),
}));
vi.mock('../supercar/agent-loop.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../supercar/agent-loop.js')>()),
  runSupercarTask: legacy.run,
}));

const { hasParkedSupercarHandle, runSupercarTask, supercarAbort, supercarReply } = await import(
  '../supercar/qwen-only-agent-loop.js'
);
const { classifyRuntimeAction } = await import('../supercar/runtime-action-policy.js');

const PAGE = `<!doctype html><title>合成商城</title><label>关键词 <input /></label>
<button onclick="document.getElementById('r').textContent='结果：'+document.querySelector('input').value">搜索</button><p id="r"></p>`;

function scripted(
  turns: Array<
    (
      request: NeutralMessagesRequest,
    ) => NeutralOutputContentBlock[] | Promise<NeutralOutputContentBlock[]>
  >,
): MessagesAdapter {
  let index = 0;
  return {
    metadata: { provider: 'anthropic', model: 'scripted' },
    async create(request) {
      const turn = turns[index++];
      if (!turn) throw new Error('script exhausted');
      return {
        id: `r${index}`,
        metadata: this.metadata,
        content: await turn(request),
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
}
const call = (name: string, input: unknown, id = name): NeutralOutputContentBlock => ({
  type: 'tool_use',
  id,
  name,
  input,
});
const refIn = (request: NeutralMessagesRequest, pattern: RegExp) => {
  const text = JSON.stringify(request.messages.at(-1));
  const line = text.split('\\n').find((candidate) => pattern.test(candidate));
  const ref = line?.match(/\[ref=(e\d+)\]/)?.[1];
  if (!ref) throw new Error(`no ref for ${pattern}`);
  return ref;
};

describe('BROWSER_EXECUTOR switch at the supercar entry', () => {
  let browser: Browser;
  const original = env.BROWSER_EXECUTOR;
  beforeAll(async () => {
    browser = await chromium.launch({ headless: true });
  }, 60_000);
  afterAll(async () => {
    await browser?.close();
  });
  afterEach(() => {
    Object.assign(env, { BROWSER_EXECUTOR: original });
    legacy.run.mockClear();
  });

  it('defaults to unified; BROWSER_EXECUTOR=legacy rolls back to the coordinate loop', async () => {
    expect(original).toBe('unified');
    Object.assign(env, { BROWSER_EXECUTOR: 'legacy' });
    const outcome = await runSupercarTask({
      taskId: 't_legacy',
      intent: 'x',
      executor: {} as never,
      messagesAdapter: scripted([]),
    });
    expect(outcome.summary).toBe('legacy');
    expect(legacy.run).toHaveBeenCalledTimes(1);
  });

  it('passes actual parsed CSV and image attachments into the production browser loop', async () => {
    const page = await browser.newPage();
    await page.route('https://fixture.browser.test/', (route) =>
      route.fulfill({ contentType: 'text/html', body: PAGE }),
    );
    await page.goto('https://fixture.browser.test/');
    const f = await browserOutputFixture();
    const csvRow = await f.service.storeUpload({
      userIdInternal: 7,
      userExternalId: 'usr_alice',
      filename: 'stock.csv',
      mimetype: 'text/csv',
      buffer: Buffer.from('sku,quantity\nBLUE-731,31\n'),
    });
    const imageRow = await f.service.storeUpload({
      userIdInternal: 7,
      userExternalId: 'usr_alice',
      filename: 'reference.png',
      mimetype: 'image/png',
      buffer: await page.screenshot(),
    });
    const loaded = await f.service.loadMany([csvRow.externalId, imageRow.externalId], 7);
    expect(loaded).toHaveLength(2);
    expect(await f.service.loadMany([csvRow.externalId, imageRow.externalId], 8)).toEqual([]);
    const csv = await parseFileForPrompt(
      loaded[0]!.buffer,
      loaded[0]!.row.filename,
      loaded[0]!.row.mimetype,
    );
    const image = await parseFileForPrompt(
      loaded[1]!.buffer,
      loaded[1]!.row.filename,
      loaded[1]!.row.mimetype,
    );
    const requests: NeutralMessagesRequest[] = [];
    try {
      const outcome = await runSupercarTask({
        taskId: 't_actual_attachment',
        intent: '把附件的 SKU 填入关键词，不要搜索或提交',
        executor: { getPage: async () => page } as never,
        attachments: [...csv.blocks, ...image.blocks],
        messagesAdapter: scripted([
          (request) => {
            requests.push(request);
            return [call('screenshot', {}, 'screenshot-initial')];
          },
          () => [call('screenshot', {}, 'screenshot-one')],
          () => [call('screenshot', {}, 'screenshot-two')],
          () => [call('snapshot', {}, 'before-fill')],
          (request) => {
            requests.push(request);
            const text = JSON.stringify(request.messages[0]);
            const sku = text.match(/BLUE-\d+/)?.[0];
            return sku
              ? [call('type', { ref: refIn(request, /textbox/), text: sku })]
              : [call('finish', { status: 'failed', summary: '没有收到附件' })];
          },
          () => [call('snapshot', {}, 'after-fill')],
          () => [
            call('finish', {
              status: 'completed',
              summary: '已填入 BLUE-731，未提交',
              evidence: 'BLUE-731',
            }),
          ],
        ]),
      });
      expect(JSON.stringify(requests[0]?.messages[0])).toContain('BLUE-731');
      const blocks = requests[0]?.messages[0]?.content;
      expect(
        Array.isArray(blocks) &&
          blocks.some(
            (block) =>
              block.type === 'image' &&
              block.source.data === (image.blocks[0] as { source: { data: string } }).source.data,
          ),
      ).toBe(true);
      const retained = requests.at(-1)?.messages[0]?.content;
      expect(
        Array.isArray(retained) &&
          retained.some(
            (block) =>
              block.type === 'image' &&
              block.source.data === (image.blocks[0] as { source: { data: string } }).source.data,
          ),
      ).toBe(true);
      expect(outcome.status).toBe('completed');
      expect(await page.locator('input').inputValue()).toBe('BLUE-731');
      expect(await page.locator('#r').textContent()).toBe('');
    } finally {
      await page.close();
      await rm(f.root, { recursive: true, force: true });
    }
  }, 15_000);

  it.each(['unsupported', 'oversized'])(
    'rejects %s attachments before calling a model or acting',
    async (kind) => {
      const page = await browser.newPage();
      let calls = 0;
      const onAction = vi.fn();
      try {
        const outcome = await runSupercarTask({
          taskId: `t_attachment_${kind}`,
          intent: '阅读附件',
          executor: { getPage: async () => page } as never,
          attachments:
            kind === 'unsupported'
              ? [{ type: 'tool_use', id: 'untrusted-call', name: 'click', input: {} }]
              : [
                  {
                    type: 'image',
                    source: {
                      type: 'base64',
                      media_type: 'image/png',
                      data: 'A'.repeat(4_000_001),
                    },
                  },
                ],
          onAction,
          messagesAdapter: scripted([
            () => {
              calls++;
              return [call('finish', { status: 'failed', summary: 'should not call a model' })];
            },
          ]),
        });
        expect(outcome).toMatchObject({
          status: 'failed',
          reason: expect.stringContaining('附件'),
          failureSource: 'tool',
        });
        expect(calls).toBe(0);
        expect(onAction).not.toHaveBeenCalled();
      } finally {
        await page.close();
      }
    },
  );

  it('uses admitted file IDs and the existing gate to deliver a requested file at the real task entry', async () => {
    const page = await browser.newPage();
    const f = await browserOutputFixture();
    const before = (env as unknown as Record<string, unknown>).BROWSER_TASK_FILES_V1;
    Object.assign(env, { BROWSER_TASK_FILES_V1: true });
    try {
      const row = await f.service.storeUpload({
        userIdInternal: 7,
        userExternalId: 'usr_alice',
        filename: 'report.csv',
        mimetype: 'text/csv',
        buffer: Buffer.from('sku,qty\nA-731,31\n'),
      });
      const scope = new BrowserTaskFiles({
        taskId: 't_upload_entry',
        userId: 7,
        files: f.service,
        active: async () => true,
      });
      scope.admitValidated(await f.service.loadMany([row.externalId], 7));
      await page.route('https://fixture.browser.test/', (route) =>
        route.fulfill({
          contentType: 'text/html',
          body: '<label>Report <input type="file" id="file" accept=".csv"></label><p id="received"></p><script>document.querySelector("input").onchange=async function(){document.querySelector("p").textContent="页面读到："+await this.files[0].text();}</script>',
        }),
      );
      await page.goto('https://fixture.browser.test/');
      const requests: NeutralMessagesRequest[] = [];
      const onAwaitingUser = vi.fn();
      const outcome = await runSupercarTask({
        taskId: 't_upload_entry',
        userExternalId: 'usr_alice',
        intent: '把附件 report.csv 上传到 fixture.browser.test 的文件控件，核对页面读到的内容',
        executor: { getPage: async () => page } as never,
        browserTaskFiles: scope,
        onAwaitingUser,
        messagesAdapter: scripted([
          (request) => {
            requests.push(request);
            return [call('snapshot', {})];
          },
          (request) => [
            call('upload', {
              ref: refIn(request, /button \\"Report\\"/),
              fileIds: [row.externalId],
            }),
          ],
          () => [call('wait_for', { text: '页面读到：sku,qty' })],
          () => [call('snapshot', {}, 'received')],
          () => [
            call('finish', {
              status: 'completed',
              summary: '已交给文件控件，页面读到 A-731,31',
              evidence: 'A-731,31',
            }),
          ],
        ]),
      });
      expect(JSON.stringify(requests[0]?.messages)).toContain(row.externalId);
      expect(outcome.status).toBe('completed');
      expect(await page.locator('#received').textContent()).toContain('A-731,31');
      expect(onAwaitingUser).not.toHaveBeenCalled();
    } finally {
      Object.assign(env, { BROWSER_TASK_FILES_V1: before });
      await page.close();
      await rm(f.root, { recursive: true, force: true });
    }
  }, 15_000);

  async function uploadFixture(taskId: string, initial = true, credential = false) {
    const f = await browserOutputFixture();
    const page = await browser.newPage();
    const before = env.BROWSER_TASK_FILES_V1;
    env.BROWSER_TASK_FILES_V1 = true;
    const row = await f.service.storeUpload({
      userIdInternal: 7,
      userExternalId: 'usr_alice',
      filename: 'report.csv',
      mimetype: 'text/csv',
      buffer: Buffer.from('sku,qty\nA-731,31\n'),
    });
    const loaded = await f.service.loadMany([row.externalId], 7);
    const scope = new BrowserTaskFiles({
      taskId,
      userId: 7,
      files: f.service,
      active: async () => true,
    });
    if (initial) scope.admitValidated(loaded);
    await page.route('https://fixture.browser.test/', (route) =>
      route.fulfill({
        contentType: 'text/html',
        body: `<form action="/upload"><label>Report <input type="file" id="file" accept=".csv"></label>${credential ? '<input type="password">' : ''}</form><label>Note <input id="note"></label><p id="received"></p><script>document.querySelector("#file").onchange=async function(){document.querySelector("#received").textContent="页面读到："+await this.files[0].text();}</script>`,
      }),
    );
    await page.goto('https://fixture.browser.test/');
    return {
      f,
      page,
      row,
      loaded,
      scope,
      cleanup: async () => {
        env.BROWSER_TASK_FILES_V1 = before;
        await page.close();
        await rm(f.root, { recursive: true, force: true });
      },
    };
  }
  it('asks with concrete files and destination; file text cannot confirm disclosure', async () => {
    const taskId = 't_upload_proposal';
    const c = await uploadFixture(taskId);
    const onAwaitingUser = vi.fn();
    const running = runSupercarTask({
      taskId,
      intent: '请处理此附件和网页',
      browserTaskFiles: c.scope,
      executor: { getPage: async () => c.page } as never,
      onAwaitingUser,
      messagesAdapter: scripted([
        () => [call('snapshot', {})],
        (request) => [
          call('upload', {
            ref: refIn(request, /button \\"Report\\"/),
            fileIds: [c.row.externalId],
          }),
        ],
      ]),
    });
    try {
      await vi.waitFor(() => expect(hasParkedSupercarHandle(taskId)).toBe(true));
      expect(onAwaitingUser).toHaveBeenCalledWith(
        expect.objectContaining({ question: expect.stringContaining('report.csv') }),
      );
      expect(onAwaitingUser.mock.calls[0]![0].question).toContain('https://fixture.browser.test');
      expect(supercarReply(taskId, '不要上传', [{ type: 'text', text: '确认执行' }])).toBe(true);
      expect((await running).status).toBe('cancelled');
      expect(await c.page.locator('#received').textContent()).toBe('');
    } finally {
      supercarAbort(taskId);
      await running.catch(() => undefined);
      await c.cleanup();
    }
  }, 20_000);
  it('does not deliver to a replaced input after the user confirms the original proposal', async () => {
    const taskId = 't_upload_replaced';
    const c = await uploadFixture(taskId);
    const running = runSupercarTask({
      taskId,
      intent: '请处理此附件和网页',
      browserTaskFiles: c.scope,
      executor: { getPage: async () => c.page } as never,
      messagesAdapter: scripted([
        () => [call('snapshot', {})],
        (request) => [
          call('upload', {
            ref: refIn(request, /button \\"Report\\"/),
            fileIds: [c.row.externalId],
          }),
        ],
        () => [call('snapshot', {}, 'after-replacement')],
        () => [call('finish', { status: 'failed', summary: '目标已变化，停止交付' })],
      ]),
    });
    try {
      await vi.waitFor(() => expect(hasParkedSupercarHandle(taskId)).toBe(true));
      await c.page.locator('#file').evaluate((node) => node.replaceWith(node.cloneNode(true)));
      expect(supercarReply(taskId, '确认执行')).toBe(true);
      expect((await running).status).toBe('failed');
      expect(await c.page.locator('#received').textContent()).toBe('');
      expect(
        await c.page.locator('#file').evaluate((node) => (node as HTMLInputElement).files?.length),
      ).toBe(0);
    } finally {
      supercarAbort(taskId);
      await running.catch(() => undefined);
      await c.cleanup();
    }
  }, 20_000);
  it('admits actual reply file references into the same parked task without granting other files', async () => {
    const taskId = 't_upload_reply';
    const c = await uploadFixture(taskId, false);
    const onAwaitingUser = vi.fn();
    const requests: NeutralMessagesRequest[] = [];
    const running = runSupercarTask({
      taskId,
      intent: '把附件 report.csv 上传到 fixture.browser.test 的文件控件',
      browserTaskFiles: c.scope,
      executor: { getPage: async () => c.page } as never,
      onAwaitingUser,
      messagesAdapter: scripted([
        () => [call('request_human', { reason: 'clarification', message: '请提供文件' })],
        (request) => {
          requests.push(request);
          return [call('snapshot', {})];
        },
        (request) => [
          call('upload', {
            ref: refIn(request, /button \\"Report\\"/),
            fileIds: [c.row.externalId],
          }),
        ],
        () => [call('snapshot', {}, 'after-upload')],
        () => [call('finish', { status: 'failed', summary: '只验证材料交付，不宣称完成其他工作' })],
      ]),
    });
    try {
      await vi.waitFor(() => expect(hasParkedSupercarHandle(taskId)).toBe(true));
      const parsed = await parseFileForPrompt(c.loaded[0]!.buffer, c.row.filename, c.row.mimetype);
      expect(
        supercarReply(
          taskId,
          '文件已提供，请继续',
          parsed.blocks,
          BrowserTaskFiles.validatedReferences(c.loaded, 7),
        ),
      ).toBe(true);
      await running;
      expect(JSON.stringify(requests[0]?.messages)).toContain(c.row.externalId);
      expect(await c.page.locator('#received').textContent()).toContain('A-731,31');
      expect(onAwaitingUser).toHaveBeenCalledTimes(1);
    } finally {
      supercarAbort(taskId);
      await running.catch(() => undefined);
      await c.cleanup();
    }
  }, 20_000);
  it.each([false, true])(
    'yields if real human input arrives during the second file read (collaboration=%s)',
    async (collaborationV2) => {
      const taskId = `t_upload_human_${collaborationV2}`;
      const c = await uploadFixture(taskId);
      let now = 10_000;
      const control = new BrowserControl(() => now, { collaborationV2 });
      let human: Promise<unknown> | undefined;
      let reads = 0;
      const load = c.f.service.loadMany.bind(c.f.service);
      const spy = vi.spyOn(c.f.service, 'loadMany').mockImplementation(async (...args) => {
        const result = await load(...args);
        if (++reads === 2)
          human = control
            .runHuman(() => c.page.locator('#note').fill('user kept'), 'insertText')
            .then(() => {
              now += 3_000;
            });
        return result;
      });
      try {
        const outcome = await runSupercarTask({
          taskId,
          intent: '把附件 report.csv 上传到 fixture.browser.test 的文件控件',
          browserTaskFiles: c.scope,
          browserControl: control,
          executor: { getPage: async () => c.page } as never,
          messagesAdapter: scripted([
            () => [call('snapshot', {})],
            (request) => [
              call('upload', {
                ref: refIn(request, /button \\"Report\\"/),
                fileIds: [c.row.externalId],
              }),
            ],
            () => [call('snapshot', {}, 'after-human')],
            () => [call('finish', { status: 'failed', summary: '人工介入，停止本次交付' })],
          ]),
        });
        await human;
        expect(outcome.status).toBe('failed');
        expect(await c.page.locator('#note').inputValue()).toBe('user kept');
        expect(await c.page.locator('#received').textContent()).toBe('');
      } finally {
        spy.mockRestore();
        await human?.catch(() => undefined);
        await c.cleanup();
      }
    },
    30_000,
  );
  it('retains the existing refusal for an authentication form even with an explicit upload request', async () => {
    const taskId = 't_upload_credential';
    const c = await uploadFixture(taskId, true, true);
    try {
      const outcome = await runSupercarTask({
        taskId,
        intent: '把附件 report.csv 上传到 fixture.browser.test 的文件控件',
        browserTaskFiles: c.scope,
        executor: { getPage: async () => c.page } as never,
        messagesAdapter: scripted([
          () => [call('snapshot', {})],
          (request) => [
            call('upload', {
              ref: refIn(request, /button \\"Report\\"/),
              fileIds: [c.row.externalId],
            }),
          ],
          () => [call('finish', { status: 'failed', summary: '登录验证文件控件不代操作' })],
        ]),
      });
      expect(outcome.status).toBe('failed');
      expect(await c.page.locator('#received').textContent()).toBe('');
    } finally {
      await c.cleanup();
    }
  }, 20_000);

  it.each([false, true])(
    'checks task scope before material exposure and honors the disabled flag (enabled=%s)',
    async (enabled) => {
      const taskId = `t_upload_flag_${enabled}`;
      const c = await uploadFixture(taskId);
      env.BROWSER_TASK_FILES_V1 = enabled;
      const requests: NeutralMessagesRequest[] = [];
      const active = vi.spyOn(c.scope, 'isActive').mockResolvedValue(false);
      try {
        const outcome = await runSupercarTask({
          taskId,
          intent: '读取页面',
          browserTaskFiles: c.scope,
          executor: { getPage: async () => c.page } as never,
          messagesAdapter: scripted([
            (request) => {
              requests.push(request);
              return [call('finish', { status: 'failed', summary: '只核对文件能力状态' })];
            },
          ]),
        });
        expect(outcome.status).toBe('failed');
        if (enabled) expect(requests).toHaveLength(0);
        else {
          expect(requests).toHaveLength(1);
          expect(requests[0]!.tools?.some((tool) => tool.name === 'upload')).toBe(false);
          expect(JSON.stringify(requests[0]!.messages)).not.toContain(c.row.externalId);
          expect(active).not.toHaveBeenCalled();
        }
      } finally {
        active.mockRestore();
        await c.cleanup();
      }
    },
  );
  it('stops disclosure when the feature is disabled while waiting for confirmation', async () => {
    const taskId = 't_upload_disabled_wait';
    const c = await uploadFixture(taskId);
    const running = runSupercarTask({
      taskId,
      intent: '请处理此附件和网页',
      browserTaskFiles: c.scope,
      executor: { getPage: async () => c.page } as never,
      messagesAdapter: scripted([
        () => [call('snapshot', {})],
        (request) => [
          call('upload', {
            ref: refIn(request, /button \\"Report\\"/),
            fileIds: [c.row.externalId],
          }),
        ],
        () => [call('snapshot', {}, 'disabled')],
        () => [call('finish', { status: 'failed', summary: '功能已停用，未交付文件' })],
      ]),
    });
    try {
      await vi.waitFor(() => expect(hasParkedSupercarHandle(taskId)).toBe(true));
      env.BROWSER_TASK_FILES_V1 = false;
      expect(supercarReply(taskId, '确认执行')).toBe(true);
      expect((await running).status).toBe('failed');
      expect(await c.page.locator('#received').textContent()).toBe('');
    } finally {
      supercarAbort(taskId);
      await running.catch(() => undefined);
      await c.cleanup();
    }
  }, 20_000);

  it('does not execute a stale real-page click after a human edit became idle during model thinking', async () => {
    let now = 10_000;
    const control = new BrowserControl(() => now, { collaborationV2: true });
    const page = await browser.newPage();
    await page.route('https://fixture.browser.test/', (route) =>
      route.fulfill({ contentType: 'text/html; charset=utf-8', body: PAGE }),
    );
    await page.goto('https://fixture.browser.test/');
    const onAction = vi.fn();
    try {
      const outcome = await runSupercarTask({
        taskId: 't_human_idle_replan',
        intent: '检查页面上的搜索按钮',
        executor: { getPage: async () => page } as never,
        browserControl: control,
        onAction,
        messagesAdapter: scripted([
          () => [call('snapshot', {})],
          async (request) => {
            const ref = refIn(request, /button/);
            await control.runHuman(() => page.locator('input').fill('user kept'), 'insertText');
            now += 3_000;
            return [call('click', { ref })];
          },
          () => [
            call('finish', {
              status: 'completed',
              summary: '已检查搜索按钮，保留用户输入。',
              evidence: '搜索',
            }),
          ],
        ]),
      });
      expect(outcome.status).toBe('completed');
      expect(onAction).not.toHaveBeenCalled();
      expect(await page.locator('input').inputValue()).toBe('user kept');
      expect(await page.locator('#r').textContent()).toBe('');
    } finally {
      await page.close();
    }
  }, 15_000);

  it('runs the unified tools with the shared tick, capture and evidence hooks', async () => {
    Object.assign(env, { BROWSER_EXECUTOR: 'unified' });
    const page = await browser.newPage();
    await page.route('https://fixture.browser.test/', (route) =>
      route.fulfill({ contentType: 'text/html; charset=utf-8', body: PAGE }),
    );
    await page.goto('https://fixture.browser.test/');
    const onTick = vi.fn();
    const onAction = vi.fn();
    const onEvidence = vi.fn();
    const outcome = await runSupercarTask({
      taskId: 't_unified',
      intent: '搜索收纳盒',
      executor: { getPage: async () => page } as never,
      messagesAdapter: scripted([
        () => [call('snapshot', {})],
        (request) => [call('type', { ref: refIn(request, /textbox/), text: '收纳盒' })],
        () => [call('snapshot', {}, 's2')],
        (request) => [call('click', { ref: refIn(request, /button/) })],
        () => [
          call('finish', { status: 'completed', summary: '已搜索', evidence: '结果：收纳盒' }),
        ],
      ]),
      onTick,
      onAction,
      onEvidence,
    });
    await page.close();
    expect(legacy.run).not.toHaveBeenCalled();
    expect(outcome).toMatchObject({ status: 'completed', summary: '已搜索' });
    expect(onTick.mock.calls.map((c) => c[0].execution.actionKind)).toEqual([
      'snapshot',
      'type',
      'snapshot',
      'click',
    ]);
    expect(onAction.mock.calls.map((c) => c[0].stepType)).toEqual(['type', 'click']);
    expect(onAction.mock.calls[0]?.[0]).toMatchObject({ inputValue: '收纳盒' });
    expect(onEvidence).toHaveBeenCalledWith(
      expect.objectContaining({ fact: '结果：收纳盒', confidence: 'observed' }),
    );
  }, 60_000);

  it('parks on a human handoff and resumes through supercarReply', async () => {
    Object.assign(env, { BROWSER_EXECUTOR: 'unified' });
    const page = await browser.newPage();
    await page.route('https://fixture.browser.test/', (route) =>
      route.fulfill({ contentType: 'text/html; charset=utf-8', body: PAGE }),
    );
    await page.goto('https://fixture.browser.test/');
    const onAwaitingUser = vi.fn();
    const running = runSupercarTask({
      taskId: 't_handoff',
      intent: '查订单',
      executor: { getPage: async () => page } as never,
      messagesAdapter: scripted([
        () => [call('request_human', { reason: 'login', message: '请先登录' })],
        (request) => {
          expect(JSON.stringify(request.messages.at(-1))).toContain('登录好了');
          expect(JSON.stringify(request.messages.at(-1))).not.toContain(
            '用户已在画面上处理完这一步',
          );
          return [call('finish', { status: 'failed', summary: '登录后仍无订单' })];
        },
      ]),
      onAwaitingUser,
    });
    await vi.waitFor(() => expect(hasParkedSupercarHandle('t_handoff')).toBe(true));
    expect(onAwaitingUser).toHaveBeenCalledWith(
      expect.objectContaining({ awaitingKind: 'login', question: '请先登录' }),
    );
    expect(supercarReply('t_handoff', '登录好了')).toBe(true);
    expect(await running).toMatchObject({ status: 'failed', reason: '登录后仍无订单' });
    expect(hasParkedSupercarHandle('t_handoff')).toBe(false);
    await page.close();
  }, 60_000);

  it('keeps actual reply text and parsed attachments after a clarification handoff', async () => {
    const page = await browser.newPage();
    await page.goto('about:blank');
    const parsed = await parseFileForPrompt(
      Buffer.from('period,total\n2026-11,741\n'),
      'reply.csv',
      'text/csv',
    );
    const requests: NeutralMessagesRequest[] = [];
    const running = runSupercarTask({
      taskId: 't_reply_attachment',
      intent: '按我提供的材料分析，不需要操作其他网页',
      executor: { getPage: async () => page } as never,
      messagesAdapter: scripted([
        () => [call('request_human', { reason: 'clarification', message: '请提供统计月份和材料' })],
        (request) => {
          requests.push(request);
          return [call('finish', { status: 'failed', summary: '只检查材料传递，不宣称完成分析' })];
        },
      ]),
    });
    try {
      await vi.waitFor(() => expect(hasParkedSupercarHandle('t_reply_attachment')).toBe(true));
      expect(supercarReply('t_reply_attachment', '只统计十一月', parsed.blocks)).toBe(true);
      await running;
      const content = JSON.stringify(requests[0]?.messages);
      expect(content).toContain('只统计十一月');
      expect(content).toContain('2026-11,741');
      expect(content).not.toContain('用户已在画面上处理完这一步');
      expect(hasParkedSupercarHandle('t_reply_attachment')).toBe(false);
    } finally {
      supercarAbort('t_reply_attachment');
      await page.close();
    }
  }, 15_000);
});

describe('unified runtime safety gate (legacy LIVE-VETO parity)', () => {
  let browser: Browser;
  const original = env.BROWSER_EXECUTOR;
  beforeAll(async () => {
    browser = await chromium.launch({ headless: true });
    Object.assign(env, { BROWSER_EXECUTOR: 'unified' });
  }, 60_000);
  afterAll(async () => {
    Object.assign(env, { BROWSER_EXECUTOR: original });
    await browser?.close();
  });

  const ORDER = `<!doctype html><title>确认订单</title>
    <p id="state">待提交</p>
    <button onclick="document.getElementById('state').textContent='已下单'">提交订单</button>
    <button onclick="document.getElementById('state').textContent='已搜索'">搜索</button>
    <form onsubmit="event.preventDefault();document.getElementById('state').textContent='已发送'">
      <label>留言 <input name="msg" /></label><button type="submit">发送消息</button>
    </form>
    <label>登录密码 <input id="pw" type="password" /></label>`;

  async function start(
    taskId: string,
    turns: Parameters<typeof scripted>[0],
    onBeforeAction: NonNullable<Parameters<typeof runSupercarTask>[0]['onBeforeAction']>,
    attachments?: Parameters<typeof runSupercarTask>[0]['attachments'],
  ) {
    const page = await browser.newPage();
    await page.route('https://fixture.browser.test/', (route) =>
      route.fulfill({ contentType: 'text/html; charset=utf-8', body: ORDER }),
    );
    await page.goto('https://fixture.browser.test/');
    const onAwaitingUser = vi.fn();
    const running = runSupercarTask({
      taskId,
      intent: '处理订单',
      attachments,
      executor: { getPage: async () => page } as never,
      messagesAdapter: scripted(turns),
      onAwaitingUser,
      onBeforeAction,
    });
    return { page, running, onAwaitingUser, state: () => page.textContent('#state') };
  }

  it('parks an irreversible click until the user confirms, then runs it', async () => {
    const policy = vi.fn(classifyRuntimeAction);
    const requests: NeutralMessagesRequest[] = [];
    const replyAttachment = await parseFileForPrompt(
      Buffer.from('confirmation-note,417\n'),
      'confirmation.csv',
      'text/csv',
    );
    const { page, running, onAwaitingUser, state } = await start(
      't_gate_confirm',
      [
        () => [call('snapshot', {})],
        (request) => [call('click', { ref: refIn(request, /button \\"提交订单\\"/) })],
        (request) => {
          requests.push(request);
          return [call('finish', { status: 'completed', summary: '已下单', evidence: '已下单' })];
        },
      ],
      policy,
    );
    await vi.waitFor(() => expect(hasParkedSupercarHandle('t_gate_confirm')).toBe(true));
    expect(onAwaitingUser).toHaveBeenCalledWith(
      expect.objectContaining({
        awaitingKind: 'browser_action',
        question: expect.stringContaining('提交订单'),
      }),
    );
    // Not executed while waiting for the user.
    expect(await state()).toBe('待提交');
    expect(policy).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'click', label: '提交订单', tagName: 'button' }),
    );
    expect(supercarReply('t_gate_confirm', '确认执行', replyAttachment.blocks)).toBe(true);
    expect(await running).toMatchObject({ status: 'completed' });
    expect(JSON.stringify(requests[0]?.messages)).toContain('confirmation-note,417');
    expect(await state()).toBe('已下单');
    await page.close();
  }, 60_000);

  it.each([
    { initial: 0, reply: 4_000_001 },
    { initial: 2_500_000, reply: 2_000_000 },
  ])(
    'retains the original park when reply images exceed the remaining budget (%o)',
    async (sizes) => {
      const { page, running, state, onAwaitingUser } = await start(
        't_bad_reply_image',
        [
          () => [call('snapshot', {})],
          (request) => [call('click', { ref: refIn(request, /button \\"提交订单\\"/) })],
          () => [call('finish', { status: 'completed', summary: '已下单', evidence: '已下单' })],
        ],
        classifyRuntimeAction,
        sizes.initial
          ? [
              {
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: 'image/png',
                  data: 'A'.repeat(sizes.initial),
                },
              },
            ]
          : undefined,
      );
      try {
        await vi.waitFor(() => expect(hasParkedSupercarHandle('t_bad_reply_image')).toBe(true));
        expect(
          supercarReply('t_bad_reply_image', '确认执行', [
            {
              type: 'image',
              source: { type: 'base64', media_type: 'image/png', data: 'A'.repeat(sizes.reply) },
            },
          ]),
        ).toBe(true);
        await vi.waitFor(() =>
          expect(onAwaitingUser).toHaveBeenCalledWith(
            expect.objectContaining({ question: expect.stringContaining('附件') }),
          ),
        );
        expect(hasParkedSupercarHandle('t_bad_reply_image')).toBe(true);
        expect(await state()).toBe('待提交');
        expect(supercarReply('t_bad_reply_image', '确认执行')).toBe(true);
        expect(await running).toMatchObject({ status: 'completed' });
        expect(await state()).toBe('已下单');
      } finally {
        supercarAbort('t_bad_reply_image');
        await running.catch(() => undefined);
        await page.close();
      }
    },
    15_000,
  );

  it('stops the task without running the action when the user does not confirm', async () => {
    const { page, running, state } = await start(
      't_gate_decline',
      [
        () => [call('snapshot', {})],
        (request) => [call('click', { ref: refIn(request, /button \\"提交订单\\"/) })],
      ],
      classifyRuntimeAction,
    );
    await vi.waitFor(() => expect(hasParkedSupercarHandle('t_gate_decline')).toBe(true));
    expect(supercarReply('t_gate_decline', '不要下单')).toBe(true);
    expect(await running).toMatchObject({
      status: 'cancelled',
      reason: '用户未确认不可逆操作，本次任务已停止，页面进度已保留。',
    });
    expect(await state()).toBe('待提交');
    await page.close();
  }, 60_000);

  it('hands password fields to the user and never replays the pending input', async () => {
    const { page, running, onAwaitingUser } = await start(
      't_gate_password',
      [
        () => [call('snapshot', {})],
        (request) => [
          call('type', { ref: refIn(request, /textbox \\"登录密码\\"/), text: 'hunter2' }),
        ],
        (request) => {
          expect(JSON.stringify(request.messages.at(-1))).toContain('刚才的操作没有由 Agent 执行');
          return [call('finish', { status: 'failed', summary: '等待用户登录后再试' })];
        },
      ],
      classifyRuntimeAction,
    );
    await vi.waitFor(() => expect(hasParkedSupercarHandle('t_gate_password')).toBe(true));
    expect(onAwaitingUser).toHaveBeenCalledWith(expect.objectContaining({ awaitingKind: 'login' }));
    expect(supercarReply('t_gate_password', '已登录')).toBe(true);
    expect(await running).toMatchObject({ status: 'failed' });
    expect(await page.inputValue('#pw')).toBe('');
    await page.close();
  }, 60_000);

  it('judges Enter-to-submit by the form submit control', async () => {
    const { page, running, state } = await start(
      't_gate_submit',
      [
        () => [call('snapshot', {})],
        (request) => [
          call('type', { ref: refIn(request, /textbox \\"留言\\"/), text: '你好', submit: true }),
        ],
      ],
      classifyRuntimeAction,
    );
    await vi.waitFor(() => expect(hasParkedSupercarHandle('t_gate_submit')).toBe(true));
    expect(await state()).toBe('待提交');
    expect(supercarReply('t_gate_submit', '取消')).toBe(true);
    expect(await running).toMatchObject({ status: 'cancelled' });
    expect(await state()).toBe('待提交');
    await page.close();
  }, 60_000);

  it('lets ordinary actions through and never gates read-only tools', async () => {
    const policy = vi.fn(classifyRuntimeAction);
    const { page, running, onAwaitingUser, state } = await start(
      't_gate_ordinary',
      [
        () => [call('snapshot', {})],
        (request) => [call('click', { ref: refIn(request, /button \\"搜索\\"/) })],
        () => [call('extract', { instruction: '状态' })],
        () => [call('finish', { status: 'completed', summary: '已搜索', evidence: '已搜索' })],
      ],
      policy,
    );
    expect(await running).toMatchObject({ status: 'completed' });
    expect(await state()).toBe('已搜索');
    expect(onAwaitingUser).not.toHaveBeenCalled();
    // The click before it ran, then its landed page; snapshot/extract never.
    expect(policy.mock.calls.map(([action]) => action.kind)).toEqual(['click', 'navigate']);
    await page.close();
  }, 60_000);

  it('cancels a task cancelled while it waits for confirmation', async () => {
    const { page, running, state } = await start(
      't_gate_abort',
      [
        () => [call('snapshot', {})],
        (request) => [call('click', { ref: refIn(request, /button \\"提交订单\\"/) })],
      ],
      classifyRuntimeAction,
    );
    await vi.waitFor(() => expect(hasParkedSupercarHandle('t_gate_abort')).toBe(true));
    expect(supercarAbort('t_gate_abort')).toBe(true);
    expect(await running).toMatchObject({ status: 'cancelled' });
    expect(await state()).toBe('待提交');
    await page.close();
  }, 60_000);

  it('applies the runtime policy even when the caller passes no onBeforeAction', async () => {
    const page = await browser.newPage();
    await page.route('https://fixture.browser.test/', (route) =>
      route.fulfill({ contentType: 'text/html; charset=utf-8', body: ORDER }),
    );
    await page.goto('https://fixture.browser.test/');
    const onAwaitingUser = vi.fn();
    const running = runSupercarTask({
      taskId: 't_gate_default',
      intent: '处理订单',
      executor: { getPage: async () => page } as never,
      messagesAdapter: scripted([
        () => [call('snapshot', {})],
        (request) => [call('click', { ref: refIn(request, /button \\"提交订单\\"/) })],
      ]),
      onAwaitingUser,
    });
    await vi.waitFor(() => expect(hasParkedSupercarHandle('t_gate_default')).toBe(true));
    expect(onAwaitingUser).toHaveBeenCalledWith(
      expect.objectContaining({ awaitingKind: 'browser_action' }),
    );
    expect(await page.textContent('#state')).toBe('待提交');
    expect(supercarAbort('t_gate_default')).toBe(true);
    expect(await running).toMatchObject({ status: 'cancelled' });
    expect(await page.textContent('#state')).toBe('待提交');
    await page.close();
  }, 60_000);

  it('fails the task when the policy refuses outright', async () => {
    const { page, running, state } = await start(
      't_gate_refuse',
      [
        () => [call('snapshot', {})],
        (request) => [call('click', { ref: refIn(request, /button \\"搜索\\"/) })],
      ],
      () => ({ allowed: false, reason: '探索模式禁止点击' }),
    );
    expect(await running).toMatchObject({ status: 'failed', reason: '探索模式禁止点击' });
    expect(await state()).toBe('待提交');
    await page.close();
  }, 60_000);
});

describe('canary task evidence and failure diagnostics', () => {
  it('uses the supplied snapshot, records original errors, and never calls a blank page a login wall', async () => {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 500, height: 679 } });
    const goto = vi
      .spyOn(page, 'goto')
      .mockRejectedValue(
        new Error(
          'page.goto: net::ERR_CONNECTION_RESET https://u:private@example.com/?token=hidden',
        ),
      );
    const onTick = vi.fn();
    try {
      const outcome = await runSupercarTask({
        taskId: 'tsk_blank_failure',
        intent: '打开公网页面',
        userExternalId: 'owner',
        executor: { getPage: async () => page } as never,
        browserCapabilities: {
          viewportV2: true,
          observationV2: true,
          replayV1: false,
          routingV2: false,
        },
        messagesAdapter: scripted([
          () => [call('navigate', { url: 'https://example.com' })],
          () => [call('finish', { status: 'failed', summary: '该网站需要登录才能继续' })],
        ]),
        onTick,
      });
      expect(page.viewportSize()).toEqual({ width: 1280, height: 800 });
      expect(outcome.status).toBe('failed');
      // FAILURE-COPY-1: a run that never opened a page is "not started".
      expect(outcome).toMatchObject({
        reason: '执行未开始：浏览器还没有打开目标页面就结束了。请重试。',
        failureSource: 'not_started',
      });
      expect(outcome.reason).not.toMatch(/登录/);
      expect(onTick).toHaveBeenCalledWith(
        expect.objectContaining({
          execution: expect.objectContaining({
            ok: false,
            errorCode: 'browser_network_failed',
            errorMessage: expect.stringContaining('ERR_CONNECTION_RESET'),
          }),
        }),
      );
      expect(JSON.stringify(onTick.mock.calls)).not.toMatch(/private|token=hidden/);
    } finally {
      goto.mockRestore();
      await browser.close();
    }
  });
});
