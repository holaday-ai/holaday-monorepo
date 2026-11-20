import { createHash } from 'node:crypto';
import { USER_BROWSER_PROTOCOL } from '@holaday/shared-types';
import { describe, expect, it, vi } from 'vitest';
import type { MessagesAdapter, NeutralMessagesResponse } from '../../llm/messages-adapter.js';
import type { ExtensionToolCallOptions } from '../../ws/server.js';
import type { StoreTaskScreenshot } from '../browser-tools/browser-screenshot.js';
import { BrowserControl } from './browser-control.js';
import { SelectedChromeClient } from './selected-chrome-client.js';
import { runSelectedChromeTask } from './selected-chrome-runner.js';

const sid = 'e2215e8d-7b6c-4711-ab15-460f51e558a4';
const activity = {
  tabId: 42,
  stamp: 'a'.repeat(64),
  keys: 0,
  pointers: 0,
  composing: false,
  interrupted: false,
};
const bytes = Buffer.from([255, 216, 255, 1, 255, 217]);
function harness(capability = true) {
  const control = new BrowserControl();
  const send = vi.fn(async (_: string, input: ExtensionToolCallOptions) => {
    const command = input.args!.session!;
    if (command.op === 'close') return { ok: true, result: { ok: true, closed: true } };
    if (command.op === 'activity')
      return { ok: true, result: { ok: true, sessionId: sid, activity } };
    if (command.op === 'screenshot')
      return {
        ok: true,
        result: {
          ok: true,
          sessionId: sid,
          screenshot: {
            captureId: command.captureId,
            tabId: 42,
            origin: 'https://work.example',
            observationRevision: 1,
            mediaType: 'image/jpeg',
            sizeBytes: bytes.length,
            sha256: createHash('sha256').update(bytes).digest('hex'),
            data: bytes.toString('base64'),
            capturedAt: Date.now(),
          },
        },
      };
    return {
      ok: true,
      result: {
        ok: true,
        sessionId: sid,
        protocol: {
          ...USER_BROWSER_PROTOCOL,
          capabilities: [
            ...USER_BROWSER_PROTOCOL.capabilities,
            'human_activity_v1',
            ...(capability ? ['task_screenshot_v1'] : []),
          ],
        },
        observation: {
          tabId: 42,
          origin: 'https://work.example',
          title: '',
          bodyText: 'Draft',
          ariaSnapshot: '',
          truncated: false,
          observationRevision: 1,
          activity,
        },
      },
    };
  });
  const client = new SelectedChromeClient({
    userId: 'a',
    taskId: 'task-a',
    extensionClientId: 'chrome-a',
    routingV2: true,
    collaborationV2: true,
    control,
    send,
  });
  return {
    client,
    control,
    send,
    open: () => client.open({ tabId: 42, expectedUrl: 'https://work.example', selectionId: sid }),
  };
}

describe('selected screenshot receipt', () => {
  it('negotiates a read-only capture bound to the current observation', async () => {
    const h = harness();
    await h.open();
    expect(await h.client.screenshot()).toMatchObject({
      ok: true,
      screenshot: { tabId: 42, sizeBytes: bytes.length },
    });
    expect(h.send.mock.calls[1]![1].args!.session).toMatchObject({
      op: 'screenshot',
      observationRevision: 1,
    });
  });
  it('keeps old extensions compatible and does not dispatch unsupported captures', async () => {
    const h = harness(false);
    expect(await h.open()).toMatchObject({ ok: true });
    expect(await h.client.screenshot()).toMatchObject({ ok: false, error: 'capability_missing' });
    expect(h.send).toHaveBeenCalledOnce();
  });
  it.each(['sha256', 'tabId', 'captureId'] as const)(
    'rejects foreign or corrupt %s without declaring unknown input',
    async (field) => {
      const h = harness();
      await h.open();
      const original = h.send.getMockImplementation()!;
      h.send.mockImplementationOnce(async (...args) => {
        const reply = await original(...args);
        const screenshot = (reply.result as unknown as { screenshot: Record<string, unknown> })
          .screenshot;
        screenshot[field] = field === 'tabId' ? 99 : 'invalid';
        return reply;
      });
      expect(await h.client.screenshot()).toMatchObject({ ok: false });
      expect(h.control.snapshot().phase).toBe('agent');
    },
  );
  it('discards capture after control closes during transport', async () => {
    const h = harness();
    await h.open();
    const original = h.send.getMockImplementation()!;
    h.send.mockImplementationOnce(async (...args) => {
      const reply = await original(...args);
      h.control.close();
      return reply;
    });
    expect(await h.client.screenshot()).toMatchObject({ ok: false });
  });
});

const metadata = {
  provider: 'alibaba-model-studio',
  model: 'fixture',
  region: 'intl',
  deploymentScope: 'international',
  endpointKind: 'public',
  protocol: 'messages',
} as const;
function model(tools: Array<{ name: string; input: unknown }>): MessagesAdapter {
  let index = 0;
  return {
    metadata,
    async create() {
      const tool = tools[Math.min(index++, tools.length - 1)]!;
      return {
        id: `r${index}`,
        metadata,
        content: [{ type: 'tool_use', id: `t${index}`, ...tool }],
        stopReason: 'tool_use',
        usage: {
          inputTokens: 1,
          outputTokens: 1,
          cacheReadInputTokens: null,
          cacheCreationInputTokens: null,
          complete: true,
        },
      } as NeutralMessagesResponse;
    },
  };
}
describe('selected screenshot delivery', () => {
  it('rejects an unsolicited screenshot completion claim without a saved capture', async () => {
    const h = harness();
    const outcome = await runSelectedChromeTask({
      taskId: 'task-a',
      intent: 'Read the page',
      client: h.client,
      control: h.control,
      target: { tabId: 42, expectedUrl: 'https://work.example', selectionId: sid },
      messagesAdapter: model([
        { name: 'browser_finish', input: { summary: '已截图', evidenceText: 'Draft' } },
      ]),
      maxIterations: 1,
    });
    expect(outcome.status).not.toBe('completed');
  });
  it('does not advertise input-file analysis fields for a screenshot-only task', async () => {
    const h = harness();
    const adapter = model([
      { name: 'browser_finish', input: { status: 'failed', summary: 'inspection only' } },
    ]);
    const create = adapter.create;
    adapter.create = async (request, options) => {
      const properties = request.tools!.find((tool) => tool.name === 'browser_finish')!.inputSchema
        .properties as Record<string, unknown>;
      expect(properties).not.toHaveProperty('fields');
      return create(request, options);
    };
    const outcome = await runSelectedChromeTask({
      taskId: 'task-a',
      intent: '截图',
      client: h.client,
      control: h.control,
      target: { tabId: 42, expectedUrl: 'https://work.example', selectionId: sid },
      messagesAdapter: adapter,
      maxIterations: 1,
    });
    expect(outcome).toMatchObject({ status: 'failed', reason: 'inspection only' });
  });
  it('does not publish a file when control closes while its write is in flight', async () => {
    const h = harness();
    const saved = vi.fn();
    const store: StoreTaskScreenshot = async (input) => {
      h.control.close();
      return {
        fileId: 'late',
        filename: input.filename,
        sizeBytes: input.buffer.length,
        sha256: input.sha256,
        mimetype: input.mimetype,
        expiresAt: new Date(Date.now() + 60000).toISOString(),
        downloadUrl: '/api/files/late/download',
      };
    };
    const outcome = await runSelectedChromeTask({
      taskId: 'task-a',
      intent: '截图',
      client: h.client,
      control: h.control,
      target: { tabId: 42, expectedUrl: 'https://work.example', selectionId: sid },
      onBrowserScreenshot: store,
      onBrowserScreenshotSaved: saved,
      messagesAdapter: model([{ name: 'browser_screenshot', input: {} }]),
      maxIterations: 2,
    });
    expect(outcome.status).not.toBe('completed');
    expect(saved).not.toHaveBeenCalled();
  });
  it('requires a saved output receipt before completing and delivers its actual card', async () => {
    const h = harness();
    const store = vi.fn(async (input: Parameters<StoreTaskScreenshot>[0]) => ({
      fileId: 'fil_image',
      filename: input.filename,
      sizeBytes: input.buffer.length,
      sha256: input.sha256,
      mimetype: 'image/jpeg',
      expiresAt: new Date(Date.now() + 60000).toISOString(),
      downloadUrl: '/api/files/fil_image/download',
    }));
    const outcome = await runSelectedChromeTask({
      taskId: 'task-a',
      intent: '截图，不提交',
      client: h.client,
      control: h.control,
      target: { tabId: 42, expectedUrl: 'https://work.example', selectionId: sid },
      onBrowserScreenshot: store,
      messagesAdapter: model([
        { name: 'browser_screenshot', input: {} },
        { name: 'browser_finish', input: { summary: '已截图', evidenceText: 'Draft' } },
      ]),
      maxIterations: 3,
    });
    expect(outcome).toMatchObject({
      status: 'completed',
      summary: expect.stringContaining('fil_image'),
    });
    expect(store).toHaveBeenCalledOnce();
    expect(store.mock.calls[0]![0].buffer).toEqual(bytes);
  });
  it('refuses fabricated screenshot completion without a capture or saved receipt', async () => {
    const h = harness();
    const outcome = await runSelectedChromeTask({
      taskId: 'task-a',
      intent: '截图',
      client: h.client,
      control: h.control,
      target: { tabId: 42, expectedUrl: 'https://work.example', selectionId: sid },
      messagesAdapter: model([
        { name: 'browser_finish', input: { summary: '已截图', evidenceText: 'Draft' } },
      ]),
      maxIterations: 2,
    });
    expect(outcome.status).not.toBe('completed');
  });
  it('stops after unknown storage outcome and never retries', async () => {
    const h = harness();
    const store = vi.fn(async () => {
      throw new Error('write receipt lost');
    });
    const outcome = await runSelectedChromeTask({
      taskId: 'task-a',
      intent: '截图',
      client: h.client,
      control: h.control,
      target: { tabId: 42, expectedUrl: 'https://work.example', selectionId: sid },
      onBrowserScreenshot: store,
      messagesAdapter: model([{ name: 'browser_screenshot', input: {} }]),
      maxIterations: 3,
    });
    expect(outcome.status).toBe('failed');
    expect(store).toHaveBeenCalledOnce();
  });
});
