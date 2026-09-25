import { describe, expect, it } from 'vitest';
import type { DB } from '../db/client.js';
import {
  DrizzleLlmCallRecorder,
  NoopLlmCallRecorder,
  estimateCostUsd,
} from './llm-call-recorder.js';
import type { LlmCallRecord } from './llm-call-recorder.js';

describe('persistent provider-aware accounting', () => {
  it.each([
    ['alibaba-model-studio', 'qwen-test', 10, 10, null, 'unpriced', 'complete'],
    ['anthropic', 'claude-opus-4-7', 2000, 500, '0.022500', 'estimated', 'complete'],
    ['anthropic', 'claude-unknown', 10, 10, null, 'unpriced', 'complete'],
    ['alibaba-model-studio', 'qwen-test', 10, null, null, 'usage_missing', 'partial'],
    ['alibaba-model-studio', 'qwen-test', null, null, null, 'usage_missing', 'missing'],
    ['anthropic', 'claude-opus-4-7', 0, 0, '0.000000', 'estimated', 'complete'],
    ['anthropic', 'claude-opus-4-7', -1, 10, null, 'usage_missing', 'partial'],
  ] as const)(
    '%s/%s usage %s/%s persists honestly',
    async (provider, model, inputTokens, outputTokens, costUsd, costStatus, usageStatus) => {
      const inserted: Record<string, unknown>[] = [];
      const db = {
        select: () => ({ from: () => ({ where: () => ({ limit: async () => [{ id: 7 }] }) }) }),
        insert: () => ({
          values: async (row: Record<string, unknown>) => {
            inserted.push(row);
          },
        }),
      } as unknown as DB;
      await new DrizzleLlmCallRecorder(db).record({
        userExternalId: 'usr_accounting',
        taskExternalId: 'tsk_accounting',
        provider,
        model,
        purpose: 'supercar.turn',
        inputTokens,
        outputTokens,
        latencyMs: 5,
        status: 'ok',
      } as LlmCallRecord);
      expect(inserted).toHaveLength(1);
      expect(inserted[0]).toMatchObject({
        userId: 7,
        taskId: 7,
        provider,
        model,
        costUsd,
        costStatus,
        usageStatus,
        promptTokens: inputTokens === -1 ? null : inputTokens,
        completionTokens: outputTokens,
      });
    },
  );
});

describe('estimateCostUsd', () => {
  it('opus 4.7 with no cache: 2000 in / 500 out ≈ $0.0225', () => {
    const c = estimateCostUsd('claude-opus-4-7', 2000, 500);
    expect(c).toBeCloseTo(0.0225, 6);
  });

  it('sonnet 4.6: 1500 in / 700 out ≈ $0.0150', () => {
    const c = estimateCostUsd('claude-sonnet-4-6', 1500, 700);
    // (1500*3 + 700*15) / 1_000_000 = 0.0045 + 0.0105 = 0.015
    expect(c).toBeCloseTo(0.015, 6);
  });

  it('haiku 4.5: 24 in / 4 out is a fraction of a cent', () => {
    const c = estimateCostUsd('claude-haiku-4-5', 24, 4);
    // (24*1 + 4*5) / 1_000_000 = 0.000044
    expect(c).toBeCloseTo(0.000044, 9);
  });

  it('cache reads are 0.1× input price; cache writes are 1.25×', () => {
    // Opus: 1000 cache-read inputs worth $0.0005; 1000 cache-write worth $0.00625.
    const read = estimateCostUsd('claude-opus-4-7', 0, 0, 1000, 0);
    expect(read).toBeCloseTo(0.0005, 6);
    const write = estimateCostUsd('claude-opus-4-7', 0, 0, 0, 1000);
    expect(write).toBeCloseTo(0.00625, 6);
  });

  it('strips date suffix from model id when pricing', () => {
    // Real response model field looks like "claude-haiku-4-5-20251001".
    const c = estimateCostUsd('claude-haiku-4-5-20251001', 1000, 500);
    expect(c).toBeCloseTo((1000 * 1 + 500 * 5) / 1_000_000, 9);
  });

  it('unknown model defaults to Opus-tier (conservative)', () => {
    const c = estimateCostUsd('claude-banana-9-9', 1000, 500);
    expect(c).toBeCloseTo((1000 * 5 + 500 * 25) / 1_000_000, 9);
  });
});

describe('NoopLlmCallRecorder', () => {
  it('record() resolves without side effects', async () => {
    const r = new NoopLlmCallRecorder();
    await expect(
      r.record({
        userExternalId: 'usr_x',
        provider: 'anthropic',
        model: 'claude-opus-4-7',
        purpose: 'commander.plan',
        inputTokens: 100,
        outputTokens: 50,
        latencyMs: 1234,
        status: 'ok',
      }),
    ).resolves.toBeUndefined();
  });
});
