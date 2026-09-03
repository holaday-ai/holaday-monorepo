import assert from 'node:assert/strict';
import { describe, it, mock } from 'node:test';
import { runQwenRuntimeBenchmark } from './qwen-runtime-benchmark.mjs';

const RUNTIME_ENV = {
  DASHSCOPE_API_KEY: 'test-only-placeholder',
  DASHSCOPE_INTL_ANTHROPIC_BASE_URL: 'https://dashscope-intl.aliyuncs.com/apps/anthropic',
};

const STREAM_FIXTURE = [
  'event: message_start',
  'data: {"type":"message_start","message":{"usage":{"input_tokens":23,"output_tokens":0}}}',
  '',
  'event: content_block_start',
  'data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}',
  '',
  'event: content_block_delta',
  'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"STREAM_"}}',
  '',
  'event: content_block_delta',
  'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"OK"}}',
  '',
  'event: message_delta',
  'data: {"type":"message_delta","delta":{"stop_reason":"end_turn","stop_sequence":null},"usage":{"output_tokens":4}}',
  '',
  'event: message_stop',
  'data: {"type":"message_stop"}',
  '',
].join('\n');

function incrementalResponse(chunks, onCancel = () => {}) {
  const encoder = new TextEncoder();
  let index = 0;
  return {
    ok: true,
    status: 200,
    body: {
      getReader() {
        return {
          async read() {
            const chunk = chunks[index];
            index += 1;
            if (!chunk) return { done: true, value: undefined };
            chunk.beforeRead?.();
            return { done: false, value: encoder.encode(chunk.text) };
          },
          async cancel() {
            onCancel();
          },
        };
      },
    },
  };
}

describe('Qwen international runtime benchmark', () => {
  it('fails closed before network access without credentials', async () => {
    const fetchImpl = mock.fn();
    const report = await runQwenRuntimeBenchmark({ runtimeEnv: {}, fetchImpl });

    assert.deepEqual(report, {
      status: 'blocked',
      region: 'intl',
      reason: 'missing_credentials',
    });
    assert.equal(fetchImpl.mock.callCount(), 0);
  });

  it('rejects a mainland endpoint before network access', async () => {
    const fetchImpl = mock.fn();
    const report = await runQwenRuntimeBenchmark({
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

  it('forwards the configured international workspace on streaming and JSON requests', async () => {
    const fetchImpl = mock.fn(async (_url, request) => {
      const body = JSON.parse(request.body);
      if (body.stream) {
        return { ok: true, status: 200, text: async () => STREAM_FIXTURE };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          content: [
            {
              type: 'text',
              text: '{"record":"SYNTHETIC-1777","status":"amber","value":314159}',
            },
          ],
          stop_reason: 'end_turn',
          usage: { input_tokens: 18_400, output_tokens: 22 },
        }),
      };
    });

    await runQwenRuntimeBenchmark({
      runtimeEnv: {
        ...RUNTIME_ENV,
        DASHSCOPE_INTL_WORKSPACE_ID: 'workspace-test',
      },
      fetchImpl,
      cases: ['streaming_text', 'long_context_retrieval'],
    });

    assert.equal(fetchImpl.mock.callCount(), 2);
    for (const call of fetchImpl.mock.calls) {
      assert.equal(call.arguments[1].headers['x-dashscope-workspace'], 'workspace-test');
    }
  });

  it('measures streaming latency after the response body is consumed', async () => {
    let currentTime = 100;
    const report = await runQwenRuntimeBenchmark({
      runtimeEnv: RUNTIME_ENV,
      cases: ['streaming_text'],
      now: () => currentTime,
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        text: async () => {
          currentTime = 175;
          return STREAM_FIXTURE;
        },
      }),
    });

    assert.equal(report.cases[0].latencyMs, 75);
  });

  it('measures first-token latency from the first text delta instead of the completed body', async () => {
    let currentTime = 100;
    const report = await runQwenRuntimeBenchmark({
      runtimeEnv: RUNTIME_ENV,
      cases: ['streaming_text'],
      now: () => currentTime,
      fetchImpl: async () =>
        incrementalResponse([
          {
            beforeRead: () => {
              currentTime = 120;
            },
            text: [
              'data: {"type":"message_start","message":{"usage":{"input_tokens":23,"output_tokens":0}}}',
              '',
              'data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}',
              '',
            ].join('\n'),
          },
          {
            beforeRead: () => {
              currentTime = 140;
            },
            text: [
              'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"STREAM_"}}',
              '',
            ].join('\n'),
          },
          {
            beforeRead: () => {
              currentTime = 200;
            },
            text: [
              'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"OK"}}',
              '',
              'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":4}}',
              '',
              'data: {"type":"message_stop"}',
              '',
            ].join('\n'),
          },
        ]),
    });

    assert.equal(report.cases[0].status, 'passed');
    assert.equal(report.cases[0].firstTokenLatencyMs, 40);
    assert.equal(report.cases[0].latencyMs, 100);
    assert.doesNotMatch(JSON.stringify(report), /STREAM_OK|test-only-placeholder/);
  });

  it('actively aborts and cancels a synthetic stream immediately after its first text delta', async () => {
    let currentTime = 100;
    let cancelCalls = 0;
    let observedSignal;
    const report = await runQwenRuntimeBenchmark({
      runtimeEnv: RUNTIME_ENV,
      cases: ['streaming_cancel'],
      now: () => currentTime,
      fetchImpl: async (_url, request) => {
        observedSignal = request.signal;
        return incrementalResponse(
          [
            {
              beforeRead: () => {
                currentTime = 130;
              },
              text: [
                'data: {"type":"message_start","message":{"usage":{"input_tokens":19,"output_tokens":0}}}',
                '',
              ].join('\n'),
            },
            {
              beforeRead: () => {
                currentTime = 160;
              },
              text: [
                'data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}',
                '',
                'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"1"}}',
                '',
              ].join('\n'),
            },
            {
              beforeRead: () => {
                currentTime = 500;
              },
              text: 'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"private tail"}}\n\n',
            },
          ],
          () => {
            cancelCalls += 1;
          },
        );
      },
    });

    assert.equal(observedSignal.aborted, true);
    assert.equal(cancelCalls, 1);
    assert.equal(report.tokenUsageComplete, false);
    assert.deepEqual(report.cases[0], {
      caseId: 'streaming_cancel',
      model: 'qwen3.8-flash',
      status: 'passed',
      latencyMs: 60,
      firstTokenLatencyMs: 60,
      cancellation: 'confirmed',
      inputTokens: null,
      outputTokens: null,
      calls: 1,
    });
    assert.doesNotMatch(JSON.stringify(report), /private tail|test-only-placeholder/);
  });

  it('does not confirm cancellation when the first text delta arrives with a terminal event', async () => {
    let cancelCalls = 0;
    let observedSignal;
    const report = await runQwenRuntimeBenchmark({
      runtimeEnv: RUNTIME_ENV,
      cases: ['streaming_cancel'],
      now: () => 100,
      fetchImpl: async (_url, request) => {
        observedSignal = request.signal;
        return incrementalResponse(
          [
            {
              text: STREAM_FIXTURE,
            },
          ],
          () => {
            cancelCalls += 1;
          },
        );
      },
    });

    assert.equal(observedSignal.aborted, false);
    assert.equal(cancelCalls, 0);
    assert.equal(report.cases[0].status, 'failed');
    assert.equal(report.cases[0].reason, 'cancellation_not_confirmed');
  });

  it('does not confirm cancellation when a terminal SSE event has a fragmented data payload', async () => {
    let cancelCalls = 0;
    let observedSignal;
    const report = await runQwenRuntimeBenchmark({
      runtimeEnv: RUNTIME_ENV,
      cases: ['streaming_cancel'],
      now: () => 100,
      fetchImpl: async (_url, request) => {
        observedSignal = request.signal;
        return incrementalResponse(
          [
            {
              text: [
                'event: message_start',
                'data: {"type":"message_start","message":{"usage":{"input_tokens":19,"output_tokens":0}}}',
                '',
                'event: content_block_delta',
                'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"1"}}',
                '',
                'event: message_stop',
                'data: {"type":"mess',
              ].join('\n'),
            },
            {
              text: 'age_stop"}\n\n',
            },
          ],
          () => {
            cancelCalls += 1;
          },
        );
      },
    });

    assert.equal(observedSignal.aborted, false);
    assert.equal(cancelCalls, 0);
    assert.equal(report.cases[0].status, 'failed');
    assert.equal(report.cases[0].reason, 'cancellation_not_confirmed');
  });

  it('classifies response-body aborts as timeouts for streaming and JSON requests', async () => {
    const streaming = await runQwenRuntimeBenchmark({
      runtimeEnv: RUNTIME_ENV,
      cases: ['streaming_text'],
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        text: async () => {
          throw new DOMException('aborted', 'AbortError');
        },
      }),
    });
    const json = await runQwenRuntimeBenchmark({
      runtimeEnv: RUNTIME_ENV,
      cases: ['long_context_retrieval'],
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        json: async () => {
          throw new DOMException('aborted', 'AbortError');
        },
      }),
    });

    assert.equal(streaming.cases[0].reason, 'timeout');
    assert.equal(json.cases[0].reason, 'timeout');
    assert.equal(streaming.cases[0].inputTokens, null);
    assert.equal(streaming.cases[0].outputTokens, null);
    assert.equal(streaming.tokenUsageComplete, false);
    assert.equal(json.tokenUsageComplete, false);
  });

  it('validates the documented SSE event sequence without returning streamed text', async () => {
    const fetchImpl = mock.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => STREAM_FIXTURE,
    }));

    const report = await runQwenRuntimeBenchmark({
      runtimeEnv: RUNTIME_ENV,
      fetchImpl,
      cases: ['streaming_text'],
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
    const body = JSON.parse(request.body);
    assert.equal(body.model, 'qwen3.8-flash');
    assert.equal(body.stream, true);
    assert.deepEqual(body.thinking, { type: 'disabled' });
    assert.deepEqual(report, {
      status: 'completed',
      region: 'intl',
      gate: 'conditional',
      passed: 1,
      total: 1,
      passRate: 1,
      inputTokens: 23,
      outputTokens: 4,
      tokenUsageComplete: true,
      calls: 1,
      cases: [
        {
          caseId: 'streaming_text',
          model: 'qwen3.8-flash',
          status: 'passed',
          latencyMs: 50,
          firstTokenLatencyMs: 25,
          inputTokens: 23,
          outputTokens: 4,
          calls: 1,
        },
      ],
    });
    assert.doesNotMatch(JSON.stringify(report), /STREAM_OK|test-only-placeholder/);
  });

  it('fails a stream whose required events arrive out of order', async () => {
    const outOfOrder = [
      'data: {"type":"message_start","message":{"usage":{"input_tokens":1,"output_tokens":0}}}',
      '',
      'data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}',
      '',
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"STREAM_OK"}}',
      '',
      'data: {"type":"message_stop"}',
      '',
      'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":1}}',
      '',
    ].join('\n');
    const report = await runQwenRuntimeBenchmark({
      runtimeEnv: RUNTIME_ENV,
      cases: ['streaming_text'],
      now: () => 100,
      fetchImpl: async () => ({ ok: true, status: 200, text: async () => outOfOrder }),
    });

    assert.equal(report.cases[0].status, 'failed');
    assert.equal(report.cases[0].reason, 'stream_contract_failed');
  });

  it('sanitizes an HTTP error without reading its provider body', async () => {
    const text = mock.fn(async () => 'private provider error');
    const report = await runQwenRuntimeBenchmark({
      runtimeEnv: RUNTIME_ENV,
      cases: ['streaming_text'],
      fetchImpl: async () => ({ ok: false, status: 429, text }),
    });

    assert.equal(report.cases[0].reason, 'http_429');
    assert.equal(text.mock.callCount(), 0);
    assert.doesNotMatch(JSON.stringify(report), /private provider error/);
  });

  it('returns a matching synthetic tool result in a second request without exposing payloads', async () => {
    const responses = [
      {
        ok: true,
        status: 200,
        json: async () => ({
          id: 'message-one',
          type: 'message',
          role: 'assistant',
          model: 'qwen3.8-max',
          content: [
            {
              type: 'tool_use',
              id: 'toolu-private-synthetic-id',
              name: 'lookup_record',
              input: { recordId: 'REC-7' },
            },
          ],
          stop_reason: 'tool_use',
          stop_sequence: null,
          usage: { input_tokens: 31, output_tokens: 12 },
        }),
      },
      {
        ok: true,
        status: 200,
        json: async () => ({
          id: 'message-two',
          type: 'message',
          role: 'assistant',
          model: 'qwen3.8-max',
          content: [
            {
              type: 'text',
              text: '{"recordId":"REC-7","status":"READY","score":91}',
            },
          ],
          stop_reason: 'end_turn',
          stop_sequence: null,
          usage: { input_tokens: 59, output_tokens: 17 },
        }),
      },
    ];
    const fetchImpl = mock.fn(async () => responses.shift());

    const report = await runQwenRuntimeBenchmark({
      runtimeEnv: RUNTIME_ENV,
      fetchImpl,
      cases: ['tool_roundtrip'],
      now: () => 100,
    });

    assert.equal(fetchImpl.mock.callCount(), 2);
    const firstBody = JSON.parse(fetchImpl.mock.calls[0].arguments[1].body);
    assert.equal(firstBody.model, 'qwen3.8-max');
    assert.deepEqual(firstBody.tool_choice, { type: 'tool', name: 'lookup_record' });
    assert.equal(firstBody.tools[0].name, 'lookup_record');
    const secondBody = JSON.parse(fetchImpl.mock.calls[1].arguments[1].body);
    assert.deepEqual(secondBody.tool_choice, { type: 'none' });
    assert.equal(secondBody.messages[1].role, 'assistant');
    assert.equal(secondBody.messages[1].content[0].id, 'toolu-private-synthetic-id');
    assert.equal(secondBody.messages[2].role, 'user');
    assert.equal(secondBody.messages[2].content[0].tool_use_id, 'toolu-private-synthetic-id');
    assert.equal(report.passed, 1);
    assert.equal(report.inputTokens, 90);
    assert.equal(report.outputTokens, 29);
    assert.equal(report.calls, 2);
    assert.deepEqual(report.cases[0], {
      caseId: 'tool_roundtrip',
      model: 'qwen3.8-max',
      status: 'passed',
      latencyMs: 0,
      inputTokens: 90,
      outputTokens: 29,
      calls: 2,
    });
    assert.doesNotMatch(
      JSON.stringify(report),
      /toolu-private-synthetic-id|REC-7|READY|314159|test-only-placeholder/,
    );
  });

  it('normalizes the Alibaba end_turn variant when a valid tool block is present', async () => {
    const responses = [
      {
        ok: true,
        status: 200,
        json: async () => ({
          content: [
            {
              type: 'tool_use',
              id: 'private-id',
              name: 'lookup_record',
              input: { recordId: 'REC-7' },
            },
          ],
          stop_reason: 'end_turn',
          usage: { input_tokens: 10, output_tokens: 5 },
        }),
      },
      {
        ok: true,
        status: 200,
        json: async () => ({
          content: [
            {
              type: 'text',
              text: '{"recordId":"REC-7","status":"READY","score":91}',
            },
          ],
          stop_reason: 'end_turn',
          usage: { input_tokens: 12, output_tokens: 6 },
        }),
      },
    ];
    const report = await runQwenRuntimeBenchmark({
      runtimeEnv: RUNTIME_ENV,
      cases: ['tool_roundtrip'],
      now: () => 100,
      fetchImpl: async () => responses.shift(),
    });

    assert.equal(report.cases[0].status, 'passed');
    assert.equal(report.cases[0].calls, 2);
    assert.doesNotMatch(JSON.stringify(report), /private-id|REC-7/);
  });

  it('retrieves one deterministic marker from a synthetic long context without returning source data', async () => {
    const fetchImpl = mock.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        id: 'message-long-context',
        type: 'message',
        role: 'assistant',
        model: 'qwen3.7-plus',
        content: [
          {
            type: 'text',
            text: '{"record":"SYNTHETIC-1777","status":"amber","value":314159}',
          },
        ],
        stop_reason: 'end_turn',
        stop_sequence: null,
        usage: { input_tokens: 18_400, output_tokens: 22 },
      }),
    }));

    const report = await runQwenRuntimeBenchmark({
      runtimeEnv: RUNTIME_ENV,
      fetchImpl,
      cases: ['long_context_retrieval'],
      now: () => 100,
    });

    assert.equal(fetchImpl.mock.callCount(), 1);
    const body = JSON.parse(fetchImpl.mock.calls[0].arguments[1].body);
    assert.equal(body.model, 'qwen3.7-plus');
    assert.deepEqual(body.thinking, { type: 'disabled' });
    assert.equal(body.output_config.format.type, 'json_schema');
    assert.equal(body.output_config.format.schema.additionalProperties, false);
    assert.ok(body.messages[0].content.length > 60_000);
    assert.match(
      body.messages[0].content,
      /row=1777 record=SYNTHETIC-1777 status=amber value=314159/,
    );
    assert.equal(report.passed, 1);
    assert.equal(report.inputTokens, 18_400);
    assert.equal(report.outputTokens, 22);
    assert.equal(report.calls, 1);
    assert.doesNotMatch(
      JSON.stringify(report),
      /SYNTHETIC-1777|amber|314159|test-only-placeholder/,
    );
  });
});
