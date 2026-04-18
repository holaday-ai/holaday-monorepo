import { describe, expect, it } from 'vitest';
import { NoopLlmCallRecorder, estimateCostUsd } from './llm-call-recorder.js';

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
