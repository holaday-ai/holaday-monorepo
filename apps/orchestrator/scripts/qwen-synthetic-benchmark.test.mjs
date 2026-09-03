import assert from 'node:assert/strict';
import { describe, it, mock } from 'node:test';
import {
  BENCHMARK_CASES,
  PROTOCOL_CASES,
  classifyQwenBenchmark,
  runQwenBenchmark,
} from './qwen-synthetic-benchmark.mjs';

const RUNTIME_ENV = {
  DASHSCOPE_API_KEY: 'test-only-placeholder',
  DASHSCOPE_INTL_ANTHROPIC_BASE_URL: 'https://dashscope-intl.aliyuncs.com/apps/anthropic',
};

const PASSING_OUTPUTS = [
  JSON.stringify({ order: ['A', 'B', 'C'], finish: '10:00', risk: 'single worker capacity' }),
  JSON.stringify({
    summary: 'GMV 增长 18.7%，退款率上升 5.2 个百分点。',
    risks: ['退款率上升 5.2 个百分点'],
    nextAction: '核查退款原因',
  }),
  JSON.stringify(['research', 'creation', 'transaction', 'analysis']),
  'function sum(items) { let total = 0; for (let i = 0; i < items.length; i += 1) total += items[i]; return total; }',
  JSON.stringify([
    { id: 'c1', verdict: 'supported' },
    { id: 'c2', verdict: 'unsupported' },
  ]),
  JSON.stringify(['search_web', 'read_url', 'write_report']),
];

function responseFor(text, usage = { input_tokens: 10, output_tokens: 5 }) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ content: [{ type: 'text', text }], usage }),
  };
}

describe('Qwen international synthetic benchmark', () => {
  it('fails closed before network when credentials are absent', async () => {
    const fetchImpl = mock.fn();
    const report = await runQwenBenchmark({ runtimeEnv: {}, fetchImpl });

    assert.deepEqual(report, {
      status: 'blocked',
      region: 'intl',
      reason: 'missing_credentials',
    });
    assert.equal(fetchImpl.mock.callCount(), 0);
  });

  it('rejects any endpoint outside the Singapore Anthropic-compatible boundary', async () => {
    const fetchImpl = mock.fn();
    const report = await runQwenBenchmark({
      runtimeEnv: {
        ...RUNTIME_ENV,
        DASHSCOPE_INTL_ANTHROPIC_BASE_URL: 'https://dashscope.aliyuncs.com/apps/anthropic',
      },
      fetchImpl,
    });

    assert.deepEqual(report, {
      status: 'blocked',
      region: 'intl',
      reason: 'invalid_endpoint',
    });
    assert.equal(fetchImpl.mock.callCount(), 0);
  });

  it('forwards the configured international workspace on every request', async () => {
    const fetchImpl = mock.fn(async () => responseFor(PASSING_OUTPUTS[0]));
    await runQwenBenchmark({
      runtimeEnv: {
        ...RUNTIME_ENV,
        DASHSCOPE_INTL_WORKSPACE_ID: 'workspace-test',
      },
      fetchImpl,
      cases: [BENCHMARK_CASES[0]],
    });

    assert.equal(fetchImpl.mock.callCount(), 1);
    assert.equal(
      fetchImpl.mock.calls[0].arguments[1].headers['x-dashscope-workspace'],
      'workspace-test',
    );
  });

  it('measures successful latency after the response body is consumed', async () => {
    let currentTime = 100;
    const report = await runQwenBenchmark({
      runtimeEnv: RUNTIME_ENV,
      cases: [BENCHMARK_CASES[0]],
      now: () => currentTime,
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        json: async () => {
          currentTime = 175;
          return {
            content: [{ type: 'text', text: PASSING_OUTPUTS[0] }],
            usage: { input_tokens: 10, output_tokens: 5 },
          };
        },
      }),
    });

    assert.equal(report.cases[0].latencyMs, 75);
  });

  it('classifies an abort while reading a response body as a timeout', async () => {
    const report = await runQwenBenchmark({
      runtimeEnv: RUNTIME_ENV,
      cases: [BENCHMARK_CASES[0]],
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        json: async () => {
          throw new DOMException('aborted', 'AbortError');
        },
      }),
    });

    assert.equal(report.cases[0].reason, 'timeout');
  });

  it('calls the Singapore Messages endpoint and returns no credentials or model output', async () => {
    const fetchImpl = mock.fn(async () => responseFor(PASSING_OUTPUTS[0]));
    const report = await runQwenBenchmark({
      runtimeEnv: RUNTIME_ENV,
      fetchImpl,
      cases: [BENCHMARK_CASES[0]],
      now: (() => {
        let value = 100;
        return () => {
          value += 25;
          return value;
        };
      })(),
    });

    assert.equal(fetchImpl.mock.callCount(), 1);
    const [url, request] = fetchImpl.mock.calls[0].arguments;
    assert.equal(url, 'https://dashscope-intl.aliyuncs.com/apps/anthropic/v1/messages');
    assert.equal(request.headers['x-api-key'], 'test-only-placeholder');
    const requestBody = JSON.parse(request.body);
    assert.equal(requestBody.model, 'qwen3.8-max');
    assert.deepEqual(requestBody.thinking, { type: 'disabled' });
    assert.deepEqual(report, {
      status: 'completed',
      region: 'intl',
      gate: 'conditional',
      passed: 1,
      total: 1,
      passRate: 1,
      inputTokens: 10,
      outputTokens: 5,
      cases: [
        {
          caseId: 'planning_dependencies',
          purpose: 'reasoning',
          model: 'qwen3.8-max',
          status: 'passed',
          latencyMs: 25,
          inputTokens: 10,
          outputTokens: 5,
        },
      ],
    });
    const serialized = JSON.stringify(report);
    assert.doesNotMatch(serialized, /test-only-placeholder|dashscope-intl|single worker capacity/);
  });

  it('passes all six fixed capability cases with deterministic valid outputs', async () => {
    const outputs = [...PASSING_OUTPUTS];
    const fetchImpl = mock.fn(async () => responseFor(outputs.shift()));

    const report = await runQwenBenchmark({ runtimeEnv: RUNTIME_ENV, fetchImpl });

    assert.equal(report.status, 'completed');
    assert.equal(report.gate, 'pass');
    assert.equal(report.passed, 6);
    assert.equal(report.total, 6);
    assert.equal(report.passRate, 1);
    assert.equal(fetchImpl.mock.callCount(), 6);
    const requestBodies = fetchImpl.mock.calls.map((call) => JSON.parse(call.arguments[1].body));
    assert.equal(
      requestBodies
        .filter((body) => body.model !== 'qwen3-coder-plus')
        .every((body) => body.thinking?.type === 'disabled'),
      true,
    );
    assert.equal(
      Object.hasOwn(
        requestBodies.find((body) => body.model === 'qwen3-coder-plus'),
        'thinking',
      ),
      false,
    );
    assert.equal(
      report.cases.every((item) => item.status === 'passed'),
      true,
    );
  });

  it('accepts a faithful risk summary without requiring the same figure twice', async () => {
    const report = await runQwenBenchmark({
      runtimeEnv: RUNTIME_ENV,
      cases: [BENCHMARK_CASES[1]],
      fetchImpl: async () =>
        responseFor(
          JSON.stringify({
            summary: 'GMV 同比增长 18.7%，退款率较上期上升 5.2 个百分点。',
            risks: ['退款率上升，原因尚未查明'],
            nextAction: '核查退款原因',
          }),
        ),
    });

    assert.equal(report.cases[0].status, 'passed');
  });

  it('validates forced tool use and strict JSON schema requests as a separate protocol gate', async () => {
    const responses = [
      {
        ok: true,
        status: 200,
        json: async () => ({
          content: [
            {
              type: 'tool_use',
              id: 'synthetic-tool-id',
              name: 'emit_plan',
              input: {
                steps: [
                  { kind: 'goto', target: 'https://example.com/report', risk: 'low' },
                  { kind: 'extract', target: 'page_title', risk: 'low' },
                ],
              },
            },
          ],
          usage: { input_tokens: 20, output_tokens: 10 },
        }),
      },
      responseFor(JSON.stringify({ status: 'review', priority: 2 })),
    ];
    const fetchImpl = mock.fn(async () => responses.shift());

    const report = await runQwenBenchmark({
      runtimeEnv: RUNTIME_ENV,
      fetchImpl,
      suite: 'protocol',
    });

    assert.equal(fetchImpl.mock.callCount(), 2);
    assert.equal(report.gate, 'pass');
    assert.equal(report.passed, 2);
    assert.equal(report.total, PROTOCOL_CASES.length);
    const toolRequest = JSON.parse(fetchImpl.mock.calls[0].arguments[1].body);
    assert.deepEqual(toolRequest.tool_choice, { type: 'tool', name: 'emit_plan' });
    assert.equal(toolRequest.tools[0].name, 'emit_plan');
    assert.deepEqual(toolRequest.thinking, { type: 'disabled' });
    const structuredRequest = JSON.parse(fetchImpl.mock.calls[1].arguments[1].body);
    assert.equal(structuredRequest.output_config.format.type, 'json_schema');
    assert.equal(structuredRequest.output_config.format.schema.additionalProperties, false);
    assert.doesNotMatch(
      JSON.stringify(report),
      /synthetic-tool-id|example\.com\/report|"status":"review"/,
    );
  });

  it('reports a safe structural tool failure without returning tool input', async () => {
    const report = await runQwenBenchmark({
      runtimeEnv: RUNTIME_ENV,
      suite: 'protocol',
      cases: [PROTOCOL_CASES[0]],
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          content: [
            {
              type: 'tool_use',
              id: 'private-synthetic-id',
              name: 'emit_plan',
              input: {
                steps: [{ kind: 'goto', target: 'https://example.com/private', risk: 'low' }],
              },
            },
          ],
          usage: { input_tokens: 10, output_tokens: 5 },
        }),
      }),
    });

    assert.equal(report.cases[0].reason, 'invalid_step_count');
    assert.doesNotMatch(JSON.stringify(report), /private-synthetic-id|example\.com\/private/);
  });

  it('sanitizes HTTP failures without reading or returning the provider body', async () => {
    const json = mock.fn(async () => ({ error: { message: 'test-only-placeholder' } }));
    const report = await runQwenBenchmark({
      runtimeEnv: RUNTIME_ENV,
      cases: [BENCHMARK_CASES[0]],
      fetchImpl: async () => ({ ok: false, status: 401, json }),
    });

    assert.equal(report.status, 'completed');
    assert.equal(report.cases[0].status, 'failed');
    assert.equal(report.cases[0].reason, 'http_401');
    assert.equal(json.mock.callCount(), 0);
    assert.doesNotMatch(JSON.stringify(report), /test-only-placeholder/);
  });

  it('keeps partial runs conditional and requires critical cases for a pass', () => {
    assert.equal(
      classifyQwenBenchmark([{ caseId: 'planning_dependencies', passed: true }]),
      'conditional',
    );
    assert.equal(
      classifyQwenBenchmark([
        { caseId: 'planning_dependencies', passed: true },
        { caseId: 'chinese_fact_summary', passed: true },
        { caseId: 'intent_classification', passed: true },
        { caseId: 'coding_boundary', passed: false },
        { caseId: 'evidence_verification', passed: true },
        { caseId: 'tool_selection', passed: true },
      ]),
      'conditional',
    );
  });
});
