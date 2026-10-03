import { expect, it, vi } from 'vitest';
import {
  type MessagesAdapter,
  MessagesAdapterError,
  type NeutralMessagesResponse,
} from '../../llm/messages-adapter.js';
import { recordedBrowserAdapter } from './recorded-browser-adapter.js';

const metadata = {
  provider: 'alibaba-model-studio',
  model: 'qwen-fixture',
  region: 'cn',
  deploymentScope: 'china_mainland',
  endpointKind: 'public',
  protocol: 'messages',
} as const;
const response: NeutralMessagesResponse = {
  id: 'request-123',
  metadata,
  content: [],
  stopReason: 'end_turn',
  usage: {
    inputTokens: 0,
    outputTokens: null,
    cacheReadInputTokens: null,
    cacheCreationInputTokens: null,
    complete: false,
  },
};
const request = {
  maxTokens: 10,
  messages: [{ role: 'user' as const, content: 'private prompt must not be recorded' }],
};
const context = () => ({
  recorder: { record: vi.fn().mockResolvedValue(undefined) },
  userExternalId: 'usr_x',
  taskId: 'tsk_x',
  iteration: 2,
  onRecordError: vi.fn(),
});

it('preserves partial usage, route identity, and records no prompt/body', async () => {
  const ctx = context();
  const adapter: MessagesAdapter = { metadata, create: vi.fn().mockResolvedValue(response) };
  expect(await recordedBrowserAdapter(adapter, ctx).create(request)).toBe(response);
  expect(ctx.recorder.record).toHaveBeenCalledOnce();
  const record = ctx.recorder.record.mock.calls[0]?.[0];
  expect(record).toMatchObject({
    provider: metadata.provider,
    region: 'cn',
    model: 'qwen-fixture',
    providerRequestId: 'request-123',
    inputTokens: 0,
    outputTokens: null,
    status: 'ok',
  });
  expect(JSON.stringify(record)).not.toContain('private prompt');
});

it.each(['REQUEST_TIMEOUT', 'REQUEST_ABORTED', 'INVALID_RESPONSE'] as const)(
  'records %s once and preserves the original failure',
  async (code) => {
    const ctx = context();
    const error = new MessagesAdapterError(code, 'private provider body');
    const adapter = { metadata, create: vi.fn().mockRejectedValue(error) };
    await expect(recordedBrowserAdapter(adapter, ctx).create(request)).rejects.toBe(error);
    expect(ctx.recorder.record).toHaveBeenCalledOnce();
    expect(ctx.recorder.record.mock.calls[0]?.[0]).toMatchObject({
      status: 'error',
      errorMessage: code,
      inputTokens: null,
      outputTokens: null,
    });
    expect(JSON.stringify(ctx.recorder.record.mock.calls)).not.toContain('private provider body');
  },
);

it('a rejected recorder does not turn success into provider failure or duplicate the call', async () => {
  const ctx = context();
  ctx.recorder.record.mockRejectedValue(new Error('db unavailable'));
  const adapter = { metadata, create: vi.fn().mockResolvedValue(response) };
  expect(await recordedBrowserAdapter(adapter, ctx).create(request)).toBe(response);
  expect(ctx.onRecordError).toHaveBeenCalledOnce();
  expect(ctx.recorder.record).toHaveBeenCalledOnce();
  expect(adapter.create).toHaveBeenCalledOnce();
});

it('awaits the write before exposing a successful result', async () => {
  const ctx = context();
  let finish!: () => void;
  ctx.recorder.record.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  const resolved = vi.fn();
  const pending = recordedBrowserAdapter({ metadata, create: async () => response }, ctx)
    .create(request)
    .then(resolved);
  await vi.waitFor(() => expect(ctx.recorder.record).toHaveBeenCalled());
  expect(resolved).not.toHaveBeenCalled();
  finish();
  await pending;
  expect(resolved).toHaveBeenCalledWith(response);
});
