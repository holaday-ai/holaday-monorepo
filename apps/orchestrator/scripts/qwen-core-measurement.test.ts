import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CoreModelRuntimeEnvironment } from '../src/llm/core-model-runtime.js';
import { runQwenCoreMeasurement } from './qwen-core-measurement.js';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const environment: CoreModelRuntimeEnvironment = {
  NODE_ENV: 'test',
  MODEL_RUNTIME_POLICY: 'qwen_only',
  QWEN_CORE_ROLLOUT_MODE: 'synthetic',
  QWEN_CORE_ALLOWLIST: 'usr_measurement_fixture',
  QWEN_CORE_ENABLED_LANES: 'verifier,suggestions',
  QWEN_MESSAGES_ADAPTER_ENABLED: true,
  QWEN_RESPONSES_ADAPTER_ENABLED: false,
  DASHSCOPE_API_KEY: '',
  DASHSCOPE_WORKSPACE_ID: '',
  DASHSCOPE_CN_API_KEY: 'PRIVATE_CN_KEY',
  DASHSCOPE_CN_ANTHROPIC_BASE_URL: 'https://dashscope.aliyuncs.com/apps/anthropic',
  DASHSCOPE_CN_RESPONSES_BASE_URL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  DASHSCOPE_CN_WORKSPACE_ID: '',
  DASHSCOPE_INTL_API_KEY: 'PRIVATE_INTL_KEY',
  DASHSCOPE_INTL_ANTHROPIC_BASE_URL: 'https://dashscope-intl.aliyuncs.com/apps/anthropic',
  DASHSCOPE_INTL_RESPONSES_BASE_URL: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
  DASHSCOPE_INTL_WORKSPACE_ID: '',
  QWEN_REASONING_MODEL: 'qwen3.8-max',
  QWEN_STANDARD_MODEL: 'qwen3.7-plus',
  QWEN_FAST_MODEL: 'qwen3.8-flash',
  QWEN_CODING_MODEL: 'qwen3-coder-plus',
  QWEN_VERIFIER_MODEL: 'qwen3.8-flash',
  QWEN_VERIFY_FAST_MODEL: 'qwen3.8-flash',
  QWEN_VERIFY_STRICT_MODEL: 'qwen3.8-max',
  QWEN_VISION_MODEL: 'qwen3.8-max',
};
const base = { environment, region: 'cn', actorExternalId: 'usr_measurement_fixture' };
const pass = '{"status":"pass","issues":[]}';
const reject =
  '{"status":"reject","issues":[{"code":"UNSUPPORTED_CONCLUSION","fixable":false,"summary":"PRIVATE_MODEL_TEXT"}]}';

function transport(options: { text?: string; fail?: boolean } = {}) {
  let clock = 1_000_000;
  let active = 0;
  let maxActive = 0;
  let shortCalls = 0;
  const requests: Array<{ url: string; body: Record<string, unknown> }> = [];
  const fetchImpl = vi.fn(async (url, init) => {
    active += 1;
    maxActive = Math.max(active, maxActive);
    const body = JSON.parse(String(init?.body));
    requests.push({ url: String(url), body });
    const short = body.max_tokens === 200;
    if (short) shortCalls += 1;
    clock += short ? shortCalls * 100 : 100;
    await Promise.resolve();
    active -= 1;
    if (options.fail) throw new Error('PRIVATE_NETWORK_DETAIL');
    return new Response(
      JSON.stringify({
        id: 'msg_synthetic_measurement',
        type: 'message',
        role: 'assistant',
        content: [
          {
            type: 'text',
            text: short ? '["整理会议待办清单","补充材料核对步骤"]' : (options.text ?? pass),
          },
        ],
        stop_reason: 'end_turn',
        usage: { input_tokens: 20, output_tokens: 10 },
      }),
      { status: 200 },
    );
  }) as typeof fetch;
  return {
    transport: { kind: 'fixture' as const, fetchImpl, now: () => clock },
    requests,
    maxActive: () => maxActive,
  };
}

describe('Qwen core measurement preparation', () => {
  it('never dispatches if the deadline expires between the loop check and adapter create', async () => {
    const f = transport();
    let reads = 0;
    const result = await runQwenCoreMeasurement({
      ...base,
      maxDurationMs: 1,
      transport: { ...f.transport, now: () => (++reads <= 2 ? 0 : 2) },
    });
    expect(result).toMatchObject({
      status: 'partial',
      stoppedBecause: 'TIME_BUDGET',
      calls: 0,
      quality: { semanticAttempted: 0 },
    });
    expect(f.requests).toEqual([]);
  });

  it('marks the report partial if the last successful short call crosses the total deadline', async () => {
    const f = transport();
    let clock = 0;
    const fetchImpl: typeof fetch = async (url, options) => {
      const response = await f.transport.fetchImpl(url, options);
      if (JSON.parse(String(options?.body)).max_tokens === 200) clock = 11;
      return response;
    };
    expect(
      await runQwenCoreMeasurement({
        ...base,
        shortCallSamples: 1,
        maxDurationMs: 10,
        transport: { kind: 'fixture', fetchImpl, now: () => clock },
      }),
    ).toMatchObject({ status: 'partial', stoppedBecause: 'TIME_BUDGET', calls: 8 });
  });

  it('bounds a verifier transport that never settles and does not start another request', async () => {
    vi.useFakeTimers();
    const signals: AbortSignal[] = [];
    const fetchImpl: typeof fetch = async (_url, options) => {
      if (options?.signal) signals.push(options.signal);
      return new Promise<Response>(() => {});
    };
    const pending = runQwenCoreMeasurement({
      ...base,
      maxDurationMs: 500,
      transport: { kind: 'fixture', fetchImpl, now: Date.now },
    });
    await vi.advanceTimersByTimeAsync(500);
    expect(await pending).toMatchObject({
      status: 'partial',
      stoppedBecause: 'TIME_BUDGET',
      calls: 1,
      quality: { semanticAttempted: 1, semanticUnavailable: 1 },
    });
    expect(signals).toHaveLength(1);
    expect(signals[0]?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('bounds a non-settling short call by remaining total time and clears its timers', async () => {
    vi.useFakeTimers();
    const f = transport();
    const signals: AbortSignal[] = [];
    const fetchImpl: typeof fetch = async (url, options) => {
      const body = JSON.parse(String(options?.body));
      if (body.max_tokens !== 200) return f.transport.fetchImpl(url, options);
      if (options?.signal) signals.push(options.signal);
      return new Promise<Response>(() => {});
    };
    const pending = runQwenCoreMeasurement({
      ...base,
      maxDurationMs: 1000,
      shortCallSamples: 2,
      transport: { kind: 'fixture', fetchImpl, now: Date.now },
    });
    await vi.advanceTimersByTimeAsync(1000);
    expect(await pending).toMatchObject({
      status: 'partial',
      stoppedBecause: 'TIME_BUDGET',
      calls: 8,
      shortCalls: { attempted: 1, unavailable: 1, p95Ms: null },
    });
    expect(signals).toHaveLength(1);
    expect(signals[0]?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('has no network side effects without explicit execution mode', async () => {
    const fetchImpl = vi.fn();
    vi.stubGlobal('fetch', fetchImpl);
    expect(await runQwenCoreMeasurement(base)).toMatchObject({
      status: 'blocked',
      reason: 'NETWORK_NOT_AUTHORIZED',
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each(['cn', 'intl'])(
    'measures actual %s verifier responses rather than preset gold outcomes',
    async (region) => {
      const f = transport();
      const result = await runQwenCoreMeasurement({ ...base, region, transport: f.transport });
      expect(result).toMatchObject({
        status: 'completed',
        mode: 'fixture',
        releaseEvidence: false,
        quality: {
          labelProvenance: 'synthetic_unreviewed',
          planned: 8,
          evaluated: 8,
          semanticAttempted: 7,
          semanticPass: 7,
          semanticUnavailable: 0,
          deterministicRejected: 1,
          semanticSevereIssueRecall: 0,
          semanticCorrectAnswerFalseRejectionRate: 0,
          structuredOutputValidity: 1,
          deterministicFailToPass: 0,
        },
      });
      expect(f.requests).toHaveLength(7);
      expect(new Set(f.requests.map((r) => r.url))).toEqual(
        new Set([
          region === 'cn'
            ? 'https://dashscope.aliyuncs.com/apps/anthropic/v1/messages'
            : 'https://dashscope-intl.aliyuncs.com/apps/anthropic/v1/messages',
        ]),
      );
      expect(f.requests.every((r) => r.body.model === 'qwen3.8-max')).toBe(true);
      expect(JSON.stringify(result)).not.toMatch(/PRIVATE_|usr_|answerDraft|messages|https:\/\//);
    },
  );

  it('records false rejections and semantic issue recall from real parsing', async () => {
    const f = transport({ text: reject });
    const result = await runQwenCoreMeasurement({ ...base, transport: f.transport });
    expect(result).toMatchObject({
      quality: {
        semanticReject: 7,
        semanticSevereIssueRecall: 1,
        semanticCorrectAnswerFalseRejectionRate: 1,
      },
      releaseEvidence: false,
    });
    expect(JSON.stringify(result)).not.toContain('PRIVATE_MODEL_TEXT');
  });

  it('keeps invalid structured responses unavailable instead of passing or dropping them', async () => {
    const f = transport({ text: 'PRIVATE_INVALID_JSON' });
    const result = await runQwenCoreMeasurement({ ...base, transport: f.transport });
    expect(result).toMatchObject({
      quality: {
        semanticUnavailable: 7,
        semanticPass: 0,
        structuredOutputValidity: 0,
        semanticSevereIssueRecall: 0,
      },
    });
    expect(JSON.stringify(result)).not.toContain('PRIVATE_');
  });

  it('runs the real short suggestions workload serially and calculates nearest-rank p95', async () => {
    const f = transport();
    const result = await runQwenCoreMeasurement({
      ...base,
      transport: f.transport,
      shortCallSamples: 20,
    });
    expect(result).toMatchObject({
      calls: 27,
      shortCalls: {
        requested: 20,
        attempted: 20,
        usable: 20,
        unavailable: 0,
        p95Ms: 1900,
        sampleStatus: 'descriptive_only',
        workload: 'suggestions_fast',
      },
      releaseEvidence: false,
    });
    expect(f.maxActive()).toBe(1);
    expect(f.requests.filter((r) => r.body.max_tokens === 200)).toHaveLength(20);
    expect(
      f.requests
        .filter((r) => r.body.max_tokens === 200)
        .every((r) => r.body.model === 'qwen3.8-flash'),
    ).toBe(true);
  });

  it('does not report a short-call p95 for a tiny sample', async () => {
    const f = transport();
    expect(
      await runQwenCoreMeasurement({ ...base, transport: f.transport, shortCallSamples: 2 }),
    ).toMatchObject({ shortCalls: { attempted: 2, p95Ms: null, sampleStatus: 'insufficient' } });
  });

  it('counts failures in attempted calls and does not calculate a success-only p95', async () => {
    const f = transport({ fail: true });
    const result = await runQwenCoreMeasurement({
      ...base,
      transport: f.transport,
      shortCallSamples: 20,
    });
    expect(result).toMatchObject({
      calls: 27,
      quality: { semanticUnavailable: 7, structuredOutputValidity: 0 },
      shortCalls: {
        attempted: 20,
        usable: 0,
        unavailable: 20,
        p95Ms: null,
        sampleStatus: 'unavailable',
      },
    });
    expect(f.requests).toHaveLength(27);
    expect(JSON.stringify(result)).not.toContain('PRIVATE_NETWORK_DETAIL');
  });

  it.each([
    { region: 'unknown' },
    { actorExternalId: 'usr_outside_canary' },
    { environment: { ...environment, QWEN_CORE_ROLLOUT_MODE: 'off' as const } },
    { environment: { ...environment, QWEN_CORE_ROLLOUT_MODE: 'all' as const } },
    { environment: { ...environment, QWEN_CORE_ALLOWLIST: 'usr_measurement_fixture,usr_other' } },
    { environment: { ...environment, QWEN_MESSAGES_ADAPTER_ENABLED: false } },
    { environment: { ...environment, QWEN_CORE_ENABLED_LANES: 'suggestions' } },
    { environment: { ...environment, DASHSCOPE_CN_API_KEY: '' } },
    { region: 'intl', environment: { ...environment, DASHSCOPE_INTL_API_KEY: '' } },
    {
      environment: {
        ...environment,
        DASHSCOPE_CN_ANTHROPIC_BASE_URL: 'https://dashscope-intl.aliyuncs.com/apps/anthropic',
      },
    },
  ])(
    'refuses unavailable region or canary configuration without invoking either provider',
    async (override) => {
      const f = transport();
      const result = await runQwenCoreMeasurement({ ...base, ...override, transport: f.transport });
      expect(result).toMatchObject({ status: 'blocked' });
      expect(f.requests).toEqual([]);
      expect(JSON.stringify(result)).not.toMatch(/PRIVATE_|usr_|https:\/\//);
    },
  );

  it('prechecks the optional suggestions lane before spending verifier calls', async () => {
    const f = transport();
    expect(
      await runQwenCoreMeasurement({
        ...base,
        transport: f.transport,
        shortCallSamples: 20,
        environment: { ...environment, QWEN_CORE_ENABLED_LANES: 'verifier' },
      }),
    ).toMatchObject({ status: 'blocked' });
    expect(f.requests).toEqual([]);
  });

  it.each([
    { shortCallSamples: 21 },
    { shortCallSamples: -1 },
    { shortCallSamples: 1.5 },
    { maxCalls: 0 },
    { maxCalls: 28 },
    { maxDurationMs: 120001 },
  ])('rejects invalid or excessive budgets', async (options) => {
    const f = transport();
    expect(
      await runQwenCoreMeasurement({ ...base, ...options, transport: f.transport }),
    ).toMatchObject({ status: 'blocked', reason: 'INVALID_BUDGET' });
    expect(f.requests).toEqual([]);
  });

  it('stops at the requested call budget and marks incomplete coverage', async () => {
    const f = transport();
    expect(
      await runQwenCoreMeasurement({ ...base, transport: f.transport, maxCalls: 3 }),
    ).toMatchObject({
      status: 'partial',
      calls: 3,
      stoppedBecause: 'CALL_BUDGET',
      quality: { planned: 8, evaluated: 3 },
      releaseEvidence: false,
    });
    expect(f.requests).toHaveLength(3);
  });

  it('stops at the time budget without starting the next call', async () => {
    const f = transport();
    expect(
      await runQwenCoreMeasurement({ ...base, transport: f.transport, maxDurationMs: 250 }),
    ).toMatchObject({ status: 'partial', calls: 3, stoppedBecause: 'TIME_BUDGET' });
    expect(f.requests).toHaveLength(3);
  });

  it('preserves the supplied environment and rejects a provider mode without explicit permission', async () => {
    const before = structuredClone(environment);
    expect(
      await runQwenCoreMeasurement({
        ...base,
        transport: { kind: 'provider', allowProviderCalls: false },
      }),
    ).toMatchObject({ status: 'blocked', reason: 'NETWORK_NOT_AUTHORIZED' });
    expect(environment).toEqual(before);
  });
});
