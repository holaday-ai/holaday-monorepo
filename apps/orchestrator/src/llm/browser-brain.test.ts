import { describe, expect, it } from 'vitest';
import {
  browserBrainRequestSchema,
  currentBrowserBrain,
  resolveBrowserBrainSelection,
  withBrowserBrain,
} from './browser-brain.js';

describe('browser brain policy', () => {
  it('keeps absent configuration inert', () => {
    expect(resolveBrowserBrainSelection({}, 'usr_a')).toEqual({});
  });
  it('requires exact account membership for task overrides, even when a prefix matches', () => {
    const requested = {
      execution: { provider: 'alibaba-model-studio' as const, model: 'qwen3.8-flash' },
    };
    expect(() =>
      resolveBrowserBrainSelection({ BROWSER_BRAIN_CANARY: 'usr_ab,usr_b' }, 'usr_a', requested),
    ).toThrow(/灰度/);
    expect(
      resolveBrowserBrainSelection({ BROWSER_BRAIN_CANARY: ' usr_a ,usr_b' }, 'usr_a', requested),
    ).toEqual(requested);
  });
  it('rejects disabled external models without using credentials or factories', () => {
    expect(() =>
      resolveBrowserBrainSelection(
        { BROWSER_BRAIN_EXECUTION: 'anthropic:claude-sonnet-4-6' },
        'usr_a',
      ),
    ).toThrow(/关闭/);
    expect(() =>
      resolveBrowserBrainSelection({ BROWSER_BRAIN_VERIFICATION: 'openai:gpt-4o' }, 'usr_a'),
    ).toThrow(/关闭/);
  });
  it('allows only the three approved providers and validates model identifiers', () => {
    expect(
      browserBrainRequestSchema.safeParse({ execution: { provider: 'deepseek', model: 'x' } })
        .success,
    ).toBe(false);
    expect(
      browserBrainRequestSchema.safeParse({
        execution: { provider: 'openai', model: 'http://gateway/key' },
      }).success,
    ).toBe(false);
    expect(() =>
      resolveBrowserBrainSelection(
        { BROWSER_BRAIN_PLANNING: 'alibaba-model-studio:deepseek-v4' },
        'usr_a',
      ),
    ).toThrow();
  });
  it('applies global role defaults then canary overrides independently', () => {
    expect(
      resolveBrowserBrainSelection(
        {
          BROWSER_BRAIN_CANARY: 'usr_a',
          BROWSER_BRAIN_PLANNING: 'alibaba-model-studio:qwen3.8-max',
        },
        'usr_a',
        { execution: { provider: 'alibaba-model-studio', model: 'qwen3.8-flash' } },
      ),
    ).toEqual({
      planning: { provider: 'alibaba-model-studio', model: 'qwen3.8-max' },
      execution: { provider: 'alibaba-model-studio', model: 'qwen3.8-flash' },
    });
  });
  it('keeps concurrent task choices isolated', async () => {
    const one = {
      execution: { provider: 'alibaba-model-studio' as const, model: 'qwen3.8-flash' },
    };
    const two = { planning: { provider: 'alibaba-model-studio' as const, model: 'qwen3.8-max' } };
    const values = await Promise.all([
      withBrowserBrain(one, async () => {
        await Promise.resolve();
        return currentBrowserBrain();
      }),
      withBrowserBrain(two, async () => {
        await Promise.resolve();
        return currentBrowserBrain();
      }),
    ]);
    expect(values).toEqual([one, two]);
    expect(currentBrowserBrain()).toBeUndefined();
  });
});
