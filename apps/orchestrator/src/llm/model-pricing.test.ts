import { describe, expect, it } from 'vitest';
import { type LlmCallRecord, accountLlmCall } from '../agent/llm-call-recorder.js';
const call: LlmCallRecord = {
  userExternalId: 'usr_cost',
  provider: 'alibaba-model-studio',
  model: 'qwen3.8-max',
  region: 'cn',
  purpose: 'supercar.turn',
  inputTokens: 1000,
  outputTokens: 100,
  cacheReadInputTokens: 0,
  cacheCreationInputTokens: 0,
  status: 'ok',
  latencyMs: 1,
};
describe('official regional and media pricing', () => {
  it('prices Qwen by actual data region and preserves an unknown region', () => {
    expect(accountLlmCall(call).costUsd).toBeCloseTo(0.0021451, 9);
    expect(accountLlmCall({ ...call, region: 'intl' }).costUsd).toBeCloseTo(0.0026, 9);
    expect(accountLlmCall({ ...call, region: undefined }).costUsd).toBeNull();
  });
  it('uses total input including cache to select Plus long-input tiers', () => {
    const result = accountLlmCall({
      ...call,
      model: 'qwen3.7-plus',
      inputTokens: 256000,
      cacheReadInputTokens: 1,
    });
    expect(result.costUsd).toBeCloseTo((256000 * 0.826 + 0.826 * 0.2 + 100 * 3.301) / 1e6, 9);
  });
  it('uses the official special Max cache price, and preserves missing usage or unsupported tiers', () => {
    expect(accountLlmCall({ ...call, cacheReadInputTokens: 5 }).costUsd).toBeCloseTo(
      0.00214613,
      10,
    );
    expect(accountLlmCall({ ...call, cacheReadInputTokens: null }).costUsd).toBeNull();
    expect(accountLlmCall({ ...call, inputTokens: 1_000_001 }).costUsd).toBeNull();
  });
  it('accounts each successful provider render including later rejected renders', () => {
    const result = accountLlmCall({
      ...call,
      provider: 'fal',
      model: 'fal-ai/veo3.1/fast',
      inputTokens: null,
      outputTokens: null,
      mediaUsage: {
        unit: 'second',
        quantity: 8,
        resolution: '1080p',
        audio: false,
        basis: 'request',
      },
    });
    expect(result).toMatchObject({
      costUsd: 0.8,
      usageStatus: 'complete',
      costStatus: 'estimated',
    });
  });
  it('keeps failed/unknown media usage unpriced instead of reporting zero', () => {
    expect(
      accountLlmCall({
        ...call,
        status: 'error',
        provider: 'fal',
        model: 'fal-ai/veo3.1/fast',
        inputTokens: null,
        outputTokens: null,
      }).costUsd,
    ).toBeNull();
  });
  it('uses provider image counts and lip-sync seconds rather than task quote prices', () => {
    expect(
      accountLlmCall({
        ...call,
        model: 'qwen-image-2.0-pro',
        mediaUsage: { unit: 'image', quantity: 2, basis: 'provider' },
      }).costUsd,
    ).toBeCloseTo(0.143352, 8);
    expect(
      accountLlmCall({
        ...call,
        provider: 'fal',
        model: 'fal-ai/sync-lipsync/v3',
        mediaUsage: { unit: 'second', quantity: 15, basis: 'measured' },
      }).costUsd,
    ).toBe(2);
  });
});

it('distinguishes explicit Max cache creation and hits from implicit caching', () => {
  expect(
    accountLlmCall({
      ...call,
      cacheMode: 'explicit',
      cacheReadInputTokens: 5,
      cacheCreationInputTokens: 10,
    }).costUsd,
  ).toBeCloseTo(0.002166415, 10);
  expect(
    accountLlmCall({ ...call, cacheMode: 'explicit', cacheReadInputTokens: 5 }).costUsd,
  ).toBeCloseTo(0.002145785, 10);
});
