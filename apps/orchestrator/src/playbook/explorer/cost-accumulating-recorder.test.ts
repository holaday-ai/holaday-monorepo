import { describe, expect, it } from 'vitest';
import { estimateCostUsd } from '../../agent/llm-call-recorder.js';
import type { LlmCallRecord, LlmCallRecorder } from '../../agent/llm-call-recorder.js';
import { CostAccumulatingRecorder } from './cost-accumulating-recorder.js';

const call = (over: Partial<LlmCallRecord> = {}): LlmCallRecord => ({
  userExternalId: 'usr_x',
  taskExternalId: 'tsk_x',
  provider: 'anthropic',
  model: 'claude-sonnet-4-6',
  purpose: 'supercar.turn',
  inputTokens: 1000,
  outputTokens: 500,
  latencyMs: 10,
  status: 'ok',
  ...over,
});

describe('CostAccumulatingRecorder — fail-closed in-memory cost (breaker source)', () => {
  it('sums cost across turns (matches estimateCostUsd)', async () => {
    const r = new CostAccumulatingRecorder();
    await r.record(call());
    await r.record(call({ inputTokens: 2000, outputTokens: 1000 }));
    const expected =
      estimateCostUsd('claude-sonnet-4-6', 1000, 500) +
      estimateCostUsd('claude-sonnet-4-6', 2000, 1000);
    expect(r.total).toBeCloseTo(expected, 10);
    expect(r.total).toBeGreaterThan(0);
  });

  it('🔒 fire-and-forget: total lands SYNCHRONOUSLY (not awaited) — breaker never reads $0 mid-flight', () => {
    const r = new CostAccumulatingRecorder();
    void r.record(call()); // NOT awaited — exactly how the supercar loop fires record()
    // the synchronous `+=` ran before the first await → total is already complete
    expect(r.total).toBeCloseTo(estimateCostUsd('claude-sonnet-4-6', 1000, 500), 10);
  });

  it('best-effort inner write: a THROWING inner recorder does NOT affect total (fail-closed)', async () => {
    const inner: LlmCallRecorder = {
      record: async () => {
        throw new Error('db down');
      },
    };
    const r = new CostAccumulatingRecorder(inner);
    await r.record(call());
    expect(r.total).toBeGreaterThan(0); // breaker cost intact despite the finance-write failure
  });

  it('delegates to the inner recorder (finance détail) when present', async () => {
    const seen: LlmCallRecord[] = [];
    const inner: LlmCallRecorder = {
      record: async (c) => {
        seen.push(c);
      },
    };
    const r = new CostAccumulatingRecorder(inner);
    await r.record(call());
    expect(seen).toHaveLength(1);
  });
});
