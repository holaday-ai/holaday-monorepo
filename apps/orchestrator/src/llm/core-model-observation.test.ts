import { Writable } from 'node:stream';
import { pino } from 'pino';
import { describe, expect, it } from 'vitest';
import { createCoreModelObserver } from './core-model-observation.js';

const EVENT = {
  provider: 'alibaba-model-studio',
  region: 'cn',
  deploymentScope: 'china_mainland',
  lane: 'scrape',
  protocol: 'responses',
  purpose: 'standard',
  model: 'qwen3.7-plus',
  outcome: 'success',
  inputTokens: 12,
  outputTokens: 8,
  latencyMs: 40,
};

function recorder() {
  const lines: string[] = [];
  const sink = new Writable({
    write(chunk, _encoding, done) {
      lines.push(String(chunk));
      done();
    },
  });
  return { lines, observe: createCoreModelObserver(pino({ base: null, timestamp: false }, sink)) };
}

describe('core model operational observations', () => {
  it('serializes only allowlisted metadata, never arbitrary input fields', () => {
    const { lines, observe } = recorder();
    observe({
      ...EVENT,
      userId: 'private-user',
      prompt: 'private-prompt',
      reply: 'private-reply',
      url: 'https://private.test',
      apiKey: 'private-key',
      error: { body: 'private-error' },
    });
    expect(JSON.parse(lines.join(''))).toEqual({
      level: 30,
      event: 'qwen.core.call',
      ...EVENT,
      msg: 'Qwen core model call',
    });
    expect(lines.join('')).not.toContain('private');
  });

  it.each([
    { model: 'https://private.test/secret' },
    { region: 'private-region' },
    { purpose: 'private-purpose' },
    { latencyMs: Number.NaN },
    { inputTokens: -1 },
    { region: 'intl' },
    { provider: 'anthropic' },
  ])(
    'drops malformed or region-inconsistent observations without logging raw data: %j',
    (change) => {
      const { lines, observe } = recorder();
      observe({ ...EVENT, ...change });
      expect(lines).toEqual([]);
    },
  );

  it('records incomplete responses and failed calls separately from success', () => {
    const { lines, observe } = recorder();
    observe({ ...EVENT, outcome: 'incomplete' });
    observe({ ...EVENT, outcome: 'error', inputTokens: null, outputTokens: null });
    expect(lines.map((line) => JSON.parse(line).outcome)).toEqual(['incomplete', 'error']);
  });
});
