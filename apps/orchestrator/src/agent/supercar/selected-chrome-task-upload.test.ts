import { rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { selectedChromeUploadCommandSchema } from '@holaday/shared-types';
import type { CDPSession } from 'playwright';
import { chromium } from 'playwright';
import { describe, expect, it, vi } from 'vitest';
import { SelectedTargetResolver } from '../../../../../packages/browser-driver/src/selected-target.js';
import { SelectedChromeSession } from '../../../../extension/src/background/selected-chrome-session.js';
import { createBrowserTaskFileScope } from '../../files/browser-task-file-scope.js';
import { browserOutputFixture } from '../../files/testing/browser-output-fixture.js';
import type { MessagesAdapter, NeutralMessagesRequest } from '../../llm/messages-adapter.js';
import { BrowserTaskFiles } from '../browser-tools/browser-task-files.js';
import { createBrowserUploadGate } from '../browser-tools/browser-upload-gate.js';
import { BrowserControl } from './browser-control.js';
import { supercarReply } from './qwen-only-agent-loop.js';
import { classifyRuntimeAction } from './runtime-action-policy.js';
import { SelectedChromeClient } from './selected-chrome-client.js';
import { runSelectedChromeTask } from './selected-chrome-runner.js';
import { PreparedChromeUpload } from './selected-chrome-task-upload.js';

const selector = {
  description: 'Report',
  strategies: [{ kind: 'css' as const, value: '#report' }],
  scope: { timeoutMs: 2000 },
  selfHeal: false,
};
const content = 'sku,qty\nA-731,31\n';
const sorted = (value: unknown): unknown =>
  Array.isArray(value)
    ? value.map(sorted)
    : value && typeof value === 'object'
      ? Object.fromEntries(
          Object.entries(value)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([k, v]) => [k, sorted(v)]),
        )
      : value;

async function fixture(clientTaskId = 'tsk_alice', open = true) {
  const disk = await browserOutputFixture();
  const row = await disk.service.storeUpload({
    userIdInternal: 7,
    userExternalId: 'usr_alice',
    filename: 'report.csv',
    mimetype: 'text/csv',
    buffer: Buffer.from(content),
  });
  const scope = createBrowserTaskFileScope({
    db: disk.db,
    files: disk.service,
    taskId: 'tsk_alice',
    userId: 7,
    origin: 'user',
    inputs: BrowserTaskFiles.validatedReferences(
      await disk.service.loadMany([row.externalId], 7),
      7,
    ),
  });
  const server = createServer((_req, res) => {
    res.setHeader('content-type', 'text/html');
    res.end(
      '<form action="/receive?ticket=PRIVATE-731" method="post"><label>Report<input hidden id="report" type="file" accept=".csv"></label></form><p></p><script>document.querySelector("input").onchange=async function(){document.body.dataset.effects=String(Number(document.body.dataset.effects||0)+1);document.querySelector("p").textContent=await this.files[0].text()}</script>',
    );
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const browser = await chromium.launch({ args: ['--renderer-process-limit=2'] });
  const page = await browser.newPage();
  await page.goto(origin);
  const cdp: CDPSession = await page.context().newCDPSession(page);
  const native = new SelectedTargetResolver(page as never, 42, [origin], async (method, params) =>
    sorted(await cdp.send(method as never, params as never)),
  );
  let revision = 0;
  const session = new SelectedChromeSession({
    owner: () => 'usr_alice',
    makeDriver: () => ({
      attachExistingTab: async () => ({ status: 'ok', data: { tabId: 42 } }),
      observeCurrentPage: async () => {
        await native.observe();
        return {
          status: 'ok',
          data: {
            tabId: 42,
            origin,
            title: 'Report',
            bodyText: await page.locator('body').innerText(),
            ariaSnapshot: '',
            truncated: false,
            observationRevision: ++revision,
          },
        };
      },
      describeTarget: async (action, expected) => {
        try {
          return { status: 'ok', data: await native.describe(action, expected) };
        } catch (error) {
          return {
            status: 'error',
            error: { code: (error as Error).message, message: 'rejected' },
          };
        }
      },
      uploadBound: async (action, binding, files, allowed) => {
        try {
          await native.execute(
            action,
            binding,
            files.map((file) => ({
              name: file.name,
              mimeType: file.mimeType,
              buffer: Buffer.from(file.bytes),
            })),
            allowed,
          );
          return { status: 'ok' };
        } catch (error) {
          return {
            status: 'error',
            error: { code: (error as Error).message, message: 'rejected' },
          };
        }
      },
      execute: async () => ({ status: 'ok' }),
      executeBound: async () => ({ status: 'ok' }),
      dispose: async () => {},
    }),
  });
  const control = new BrowserControl();
  const client = new SelectedChromeClient({
    userId: 'usr_alice',
    taskId: clientTaskId,
    extensionClientId: 'chrome-a',
    routingV2: true,
    taskFilesV1: true,
    control,
    send: async (_user, options) => {
      const command = options.args?.session;
      if (!command) throw new Error('missing command');
      const result =
        command.op === 'open'
          ? await session.open({
              taskId: options.taskId!,
              tabId: 42,
              validate: async () => {},
              protocol: command.protocol,
              grantedOrigins: command.grantedOrigins,
            })
          : command.op === 'close'
            ? { ...(await session.close(options.taskId!, command.sessionId)), closed: true }
            : command.op === 'observe'
              ? await session.observe(options.taskId!, command.sessionId)
              : await session.upload(
                  options.taskId!,
                  selectedChromeUploadCommandSchema.parse(command),
                );
      return { ok: result.ok, result };
    },
  });
  if (open)
    expect(
      await client.open({
        tabId: 42,
        expectedUrl: origin,
        selectionId: '22222222-2222-4222-8222-222222222222',
      }),
    ).toMatchObject({ ok: true });
  return {
    ...disk,
    row,
    scope,
    client,
    control,
    page,
    origin,
    prepare: () =>
      PreparedChromeUpload.capture({
        taskId: 'tsk_alice',
        files: scope,
        client,
        fileIds: [row.externalId],
        selector,
      }),
    close: async () => {
      await client.close();
      await browser.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await rm(disk.root, { recursive: true, force: true });
    },
  };
}

describe('scoped task files and shared disclosure gate on a real native target', () => {
  it('admits a validated file supplied during a real Chrome clarification wait to the original task', async () => {
    const f = await fixture('tsk_alice', false);
    const scope = createBrowserTaskFileScope({
      db: f.db,
      files: f.service,
      taskId: 'tsk_alice',
      userId: 7,
      origin: 'user',
      inputs: [],
    });
    const references = BrowserTaskFiles.validatedReferences(
      await f.service.loadMany([f.row.externalId], 7),
      7,
    );
    let calls = 0;
    const metadata: MessagesAdapter['metadata'] = {
      provider: 'alibaba-model-studio',
      model: 'synthetic',
      region: 'cn',
      deploymentScope: 'china_mainland',
      endpointKind: 'public',
      protocol: 'messages',
    };
    const adapter: MessagesAdapter = {
      metadata,
      create: async (request) => {
        calls++;
        if (calls > 1) expect(JSON.stringify(request)).toContain(f.row.externalId);
        return {
          id: 'local-reply-file',
          metadata,
          stopReason: 'tool_use',
          content: [
            {
              type: 'tool_use',
              id: `tool-${calls}`,
              name:
                calls === 1 ? 'request_human' : calls === 2 ? 'browser_upload' : 'browser_finish',
              input:
                calls === 1
                  ? { reason: 'clarification', message: '请提供 report.csv' }
                  : calls === 2
                    ? { selector, fileIds: [f.row.externalId] }
                    : {
                        status: 'completed',
                        summary: '页面已展示 A-731,31',
                        evidenceText: 'A-731,31',
                      },
            },
          ],
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
    try {
      const outcome = await runSelectedChromeTask({
        taskId: 'tsk_alice',
        intent: `把附件 report.csv 上传到 ${f.origin}，核对页面读到 A-731,31`,
        browserTaskFiles: scope,
        messagesAdapter: adapter,
        client: f.client,
        control: f.control,
        target: {
          tabId: 42,
          expectedUrl: f.origin,
          selectionId: '22222222-2222-4222-8222-222222222222',
        },
        maxIterations: 4,
        timeoutMs: 20_000,
        onAwaitingUser: async (event) => {
          expect(event.awaitingKind).toBe('clarification');
          expect(supercarReply('tsk_alice', 'report.csv已提供', [], references)).toBe(true);
        },
      });
      expect(outcome).toMatchObject({ status: 'completed' });
      expect(scope.references()).toMatchObject([{ fileId: f.row.externalId }]);
      await vi.waitFor(async () => expect(await f.page.locator('p').textContent()).toBe(content));
      expect(await f.page.locator('body').getAttribute('data-effects')).toBe('1');
    } finally {
      await f.close();
    }
  });
  it('cannot finish from old page text after an admitted file was rejected by the native target', async () => {
    const f = await fixture('tsk_alice', false);
    await f.page.locator('#report').evaluate((node) => {
      (node as HTMLInputElement).accept = '.pdf';
    });
    let calls = 0;
    const metadata: MessagesAdapter['metadata'] = {
      provider: 'alibaba-model-studio',
      model: 'synthetic',
      region: 'cn',
      deploymentScope: 'china_mainland',
      endpointKind: 'public',
      protocol: 'messages',
    };
    const adapter: MessagesAdapter = {
      metadata,
      create: async () => ({
        id: 'local-native-refused',
        metadata,
        stopReason: 'tool_use',
        content: [
          {
            type: 'tool_use',
            id: `tool-${++calls}`,
            name: calls === 1 ? 'browser_upload' : 'browser_finish',
            input:
              calls === 1
                ? { selector, fileIds: [f.row.externalId] }
                : { status: 'completed', summary: '上传完成', evidenceText: 'Report' },
          },
        ],
        usage: {
          inputTokens: 1,
          outputTokens: 1,
          cacheReadInputTokens: null,
          cacheCreationInputTokens: null,
          complete: true,
        },
      }),
    };
    try {
      const outcome = await runSelectedChromeTask({
        taskId: 'tsk_alice',
        intent: `把附件 report.csv 上传到 ${f.origin}`,
        browserTaskFiles: f.scope,
        messagesAdapter: adapter,
        client: f.client,
        control: f.control,
        target: {
          tabId: 42,
          expectedUrl: f.origin,
          selectionId: '22222222-2222-4222-8222-222222222222',
        },
        maxIterations: 3,
        timeoutMs: 20_000,
      });
      expect(outcome.status).not.toBe('completed');
      expect(await f.page.locator('body').getAttribute('data-effects')).toBeNull();
    } finally {
      await f.close();
    }
  });
  it('runs the real selected task loop from admitted file IDs to native delivery and page evidence', async () => {
    const f = await fixture('tsk_alice', false);
    const requests: NeutralMessagesRequest[] = [];
    const metadata: MessagesAdapter['metadata'] = {
      provider: 'alibaba-model-studio',
      model: 'synthetic',
      region: 'cn',
      deploymentScope: 'china_mainland',
      endpointKind: 'public',
      protocol: 'messages',
    };
    const adapter: MessagesAdapter = {
      metadata,
      create: async (request) => {
        requests.push(request);
        expect(request.tools?.some((tool) => tool.name === 'browser_upload')).toBe(true);
        expect(JSON.stringify(request)).toContain(f.row.externalId);
        return {
          id: 'local-native-file',
          metadata,
          stopReason: 'tool_use',
          content: [
            {
              type: 'tool_use',
              id: `tool-${requests.length}`,
              name: requests.length === 1 ? 'browser_upload' : 'browser_finish',
              input:
                requests.length === 1
                  ? { selector, fileIds: [f.row.externalId] }
                  : {
                      status: 'completed',
                      summary: '页面已展示 A-731,31',
                      evidenceText: 'A-731,31',
                    },
            },
          ],
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
    try {
      const outcome = await runSelectedChromeTask({
        taskId: 'tsk_alice',
        intent: `把附件 report.csv 上传到 ${f.origin}，核对页面读到 A-731,31`,
        browserTaskFiles: f.scope,
        messagesAdapter: adapter,
        client: f.client,
        control: f.control,
        target: {
          tabId: 42,
          expectedUrl: f.origin,
          selectionId: '22222222-2222-4222-8222-222222222222',
        },
        maxIterations: 3,
        timeoutMs: 20_000,
      });
      expect(outcome).toMatchObject({ status: 'completed' });
      expect(outcome.toolsUsed).toContain('browser_upload');
      await vi.waitFor(async () => expect(await f.page.locator('p').textContent()).toBe(content));
      expect(await f.page.locator('body').getAttribute('data-effects')).toBe('1');
      expect(JSON.stringify(requests)).not.toContain(Buffer.from(content).toString('base64'));
      expect(requests).toHaveLength(2);
    } finally {
      await f.close();
    }
  });
  it('rejects an actual client belonging to a different task even with the same account and page', async () => {
    const f = await fixture('tsk_bob');
    try {
      await expect(f.prepare()).rejects.toThrow();
      expect(await f.page.locator('body').getAttribute('data-effects')).toBeNull();
    } finally {
      await f.close();
    }
  });
  it('stops an approved upload when the original account enters closure', async () => {
    const f = await fixture();
    try {
      const prepared = await f.prepare();
      prepared.approve();
      f.faults.ownerStatus = 'closing';
      expect(await prepared.deliver()).toMatchObject({ ok: false, actionOutcome: 'not_applied' });
      expect(await f.page.locator('body').getAttribute('data-effects')).toBeNull();
    } finally {
      await f.close();
    }
  });
  it('delivers actual FileService bytes only after the existing named-file/site authorization', async () => {
    const f = await fixture();
    try {
      const prepared = await f.prepare();
      await expect(prepared.deliver()).rejects.toThrow();
      const questions: string[] = [];
      const gate = createBrowserUploadGate(prepared, {
        userIntent: `把附件 report.csv 上传到 ${f.origin}`,
        onBeforeAction: classifyRuntimeAction,
        aborted: () => false,
        park: async (question) => {
          questions.push(question);
          return '确认执行';
        },
      });
      expect(
        (
          await gate(
            { tool: 'upload', ref: 'remote-host-target', fileIds: [f.row.externalId] },
            'before',
          )
        ).kind,
      ).toBe('proceed');
      expect(questions).toEqual([]);
      prepared.approve();
      expect(await prepared.deliver()).toMatchObject({
        ok: true,
        uploadReceipt: { status: 'handed_to_page' },
      });
      await vi.waitFor(async () => expect(await f.page.locator('p').textContent()).toBe(content));
      expect(await prepared.deliver()).toMatchObject({
        ok: true,
        uploadReceipt: { status: 'handed_to_page' },
      });
      expect(await f.page.locator('body').getAttribute('data-effects')).toBe('1');
    } finally {
      await f.close();
    }
  });
  it('does not turn a general analysis request into permission to send the file', async () => {
    const f = await fixture();
    try {
      const prepared = await f.prepare();
      const questions: string[] = [];
      const gate = createBrowserUploadGate(prepared, {
        userIntent: '分析附件并处理网页',
        onBeforeAction: classifyRuntimeAction,
        aborted: () => false,
        park: async (question) => {
          questions.push(question);
          return '不要';
        },
      });
      expect(
        (
          await gate(
            { tool: 'upload', ref: 'remote-host-target', fileIds: [f.row.externalId] },
            'before',
          )
        ).kind,
      ).toBe('stop');
      expect(questions).toHaveLength(1);
      expect(questions[0]).toContain('report.csv');
      expect(
        await f.page
          .locator('#report')
          .evaluate((node) => (node as HTMLInputElement).files?.length),
      ).toBe(0);
    } finally {
      await f.close();
    }
  });
  it('invalidates a confirmation when the real node is replaced during the user reply', async () => {
    const f = await fixture();
    try {
      const prepared = await f.prepare();
      const gate = createBrowserUploadGate(prepared, {
        userIntent: '处理网页附件',
        onBeforeAction: classifyRuntimeAction,
        aborted: () => false,
        park: async () => {
          await f.page.locator('#report').evaluate((node) => node.replaceWith(node.cloneNode()));
          return '确认执行';
        },
      });
      expect(
        (
          await gate(
            { tool: 'upload', ref: 'remote-host-target', fileIds: [f.row.externalId] },
            'before',
          )
        ).kind,
      ).toBe('skip');
      expect(await prepared.isCurrent()).toBe(false);
      expect(
        await f.page
          .locator('#report')
          .evaluate((node) => (node as HTMLInputElement).files?.length),
      ).toBe(0);
    } finally {
      await f.close();
    }
  });
  it('preserves a user-selected file when replacement is not confirmed', async () => {
    const f = await fixture();
    try {
      await f.page.locator('#report').setInputFiles({
        name: 'personal.csv',
        mimeType: 'text/csv',
        buffer: Buffer.from('personal,731'),
      });
      await f.client.observe();
      const prepared = await f.prepare();
      const questions: string[] = [];
      const gate = createBrowserUploadGate(prepared, {
        userIntent: `把附件 report.csv 上传到 ${f.origin}`,
        onBeforeAction: classifyRuntimeAction,
        aborted: () => false,
        park: async (question) => {
          questions.push(question);
          return '不要替换';
        },
      });
      expect(
        (
          await gate(
            { tool: 'upload', ref: 'remote-host-target', fileIds: [f.row.externalId] },
            'before',
          )
        ).kind,
      ).toBe('stop');
      expect(questions).toHaveLength(1);
      expect(
        await f.page
          .locator('#report')
          .evaluate(async (node) => (node as HTMLInputElement).files![0]!.text()),
      ).toBe('personal,731');
    } finally {
      await f.close();
    }
  });
  it('cannot prepare another task or an unprovided account file', async () => {
    const f = await fixture();
    try {
      await expect(
        PreparedChromeUpload.capture({
          taskId: 'tsk_other',
          files: f.scope,
          client: f.client,
          fileIds: [f.row.externalId],
          selector,
        }),
      ).rejects.toThrow();
      const other = await f.service.storeUpload({
        userIdInternal: 7,
        userExternalId: 'usr_alice',
        filename: 'private.csv',
        mimetype: 'text/csv',
        buffer: Buffer.from('private'),
      });
      await expect(
        PreparedChromeUpload.capture({
          taskId: 'tsk_alice',
          files: f.scope,
          client: f.client,
          fileIds: [other.externalId],
          selector,
        }),
      ).rejects.toThrow();
      expect(await f.page.locator('body').getAttribute('data-effects')).toBeNull();
    } finally {
      await f.close();
    }
  });
});
