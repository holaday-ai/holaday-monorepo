import { describe, expect, it, vi } from 'vitest';
import { type LlmCallRecord, accountLlmCall } from './llm-call-recorder.js';
import {
  dashscopeCostRegion,
  observeMediaCall,
  withMediaCallContext,
} from './media-call-recorder.js';
describe('per task media costs', () => {
  it('records every provider success even when a subsequent quality rejection stops delivery', async () => {
    const calls: LlmCallRecord[] = [];
    await expect(
      withMediaCallContext(
        {
          recorder: {
            record: async (call) => {
              calls.push(call);
            },
          },
          userExternalId: 'usr_cost',
          taskExternalId: 'tsk_quality',
        },
        async () => {
          for (let i = 0; i < 2; i++)
            await observeMediaCall(
              { provider: 'fal', model: 'fal-ai/veo3.1/fast', purpose: 'media.video' },
              async () => ({ requestId: `req${i}` }),
              (result) => ({
                providerRequestId: result.requestId,
                mediaUsage: {
                  unit: 'second',
                  quantity: 8,
                  resolution: '1080p',
                  audio: false,
                  basis: 'request',
                },
              }),
            );
          throw new Error('quality rejection');
        },
      ),
    ).rejects.toThrow('quality rejection');
    expect(calls.map((c) => c.taskExternalId)).toEqual(['tsk_quality', 'tsk_quality']);
    expect(calls.reduce((cost, c) => cost + (accountLlmCall(c).costUsd ?? 0), 0)).toBe(1.6);
  });
  it('records unknown charges for a timed out job and never reruns it when persistence fails', async () => {
    const action = vi.fn().mockRejectedValue(new Error('timeout'));
    const record = vi.fn().mockRejectedValue(new Error('database unavailable'));
    await expect(
      withMediaCallContext(
        { recorder: { record }, userExternalId: 'usr_cost', taskExternalId: 'tsk_cost' },
        () =>
          observeMediaCall(
            { provider: 'fal', model: 'fal-ai/veo3.1/fast', purpose: 'media.video' },
            action,
            () => ({}),
          ),
      ),
    ).rejects.toThrow('timeout');
    expect(action).toHaveBeenCalledTimes(1);
    expect(record.mock.calls[0]?.[0]).toMatchObject({
      status: 'error',
      inputTokens: null,
      outputTokens: null,
    });
  });
  it('does not infer Mainland prices for custom endpoints', () => {
    expect(dashscopeCostRegion('https://dashscope.aliyuncs.com')).toBe('cn');
    expect(dashscopeCostRegion('https://dashscope-intl.aliyuncs.com')).toBe('intl');
    expect(dashscopeCostRegion('https://proxy.example.test')).toBeUndefined();
  });
});

it('does not turn a successful provider render into a retry when its accounting receipt is malformed', async () => {
  const record = vi.fn().mockResolvedValue(undefined);
  const action = vi.fn().mockResolvedValue(null);
  const result = await withMediaCallContext(
    { recorder: { record }, userExternalId: 'usr_cost', taskExternalId: 'tsk_cost' },
    () =>
      observeMediaCall(
        { provider: 'fal', model: 'fal-ai/veo3.1/fast', purpose: 'media.video' },
        action,
        () => {
          throw new Error('invalid receipt');
        },
      ),
  );
  expect(result).toBeNull();
  expect(action).toHaveBeenCalledTimes(1);
  expect(record.mock.calls[0]?.[0]).toMatchObject({ status: 'ok' });
});
