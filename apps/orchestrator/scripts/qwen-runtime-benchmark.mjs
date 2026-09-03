import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const DEFAULT_ENDPOINT = 'https://dashscope-intl.aliyuncs.com/apps/anthropic';
const RUNTIME_CASE_IDS = Object.freeze([
  'streaming_text',
  'streaming_cancel',
  'tool_roundtrip',
  'long_context_retrieval',
]);

export async function runQwenRuntimeBenchmark({
  runtimeEnv,
  fetchImpl = fetch,
  now = Date.now,
  timeoutMs = 60_000,
  cases = RUNTIME_CASE_IDS,
}) {
  const apiKey = String(
    runtimeEnv.DASHSCOPE_INTL_API_KEY || runtimeEnv.DASHSCOPE_API_KEY || '',
  ).trim();
  if (!apiKey) return blocked('missing_credentials');

  const endpoint = normalizeSingaporeEndpoint(
    runtimeEnv.DASHSCOPE_INTL_ANTHROPIC_BASE_URL || DEFAULT_ENDPOINT,
  );
  if (!endpoint) return blocked('invalid_endpoint');
  const workspaceId = String(
    runtimeEnv.DASHSCOPE_INTL_WORKSPACE_ID || runtimeEnv.DASHSCOPE_WORKSPACE_ID || '',
  ).trim();

  const results = [];
  for (const caseId of cases) {
    if (caseId === 'streaming_text') {
      results.push(
        await runStreamingCase({ apiKey, workspaceId, endpoint, fetchImpl, now, timeoutMs }),
      );
    } else if (caseId === 'streaming_cancel') {
      results.push(
        await runStreamingCancellationCase({
          apiKey,
          workspaceId,
          endpoint,
          fetchImpl,
          now,
          timeoutMs,
        }),
      );
    } else if (caseId === 'tool_roundtrip') {
      results.push(
        await runToolRoundtripCase({ apiKey, workspaceId, endpoint, fetchImpl, now, timeoutMs }),
      );
    } else if (caseId === 'long_context_retrieval') {
      results.push(
        await runLongContextCase({ apiKey, workspaceId, endpoint, fetchImpl, now, timeoutMs }),
      );
    }
  }

  const passed = results.filter((result) => result.status === 'passed').length;
  const inputTokens = results.reduce(
    (total, result) => total + (Number.isFinite(result.inputTokens) ? result.inputTokens : 0),
    0,
  );
  const outputTokens = results.reduce(
    (total, result) => total + (Number.isFinite(result.outputTokens) ? result.outputTokens : 0),
    0,
  );
  const tokenUsageComplete = results.every(
    (result) => Number.isFinite(result.inputTokens) && Number.isFinite(result.outputTokens),
  );
  const calls = results.reduce((total, result) => total + result.calls, 0);

  return {
    status: 'completed',
    region: 'intl',
    gate:
      results.length === RUNTIME_CASE_IDS.length && passed === RUNTIME_CASE_IDS.length
        ? 'pass'
        : passed === 0
          ? 'fail'
          : 'conditional',
    passed,
    total: results.length,
    passRate: results.length === 0 ? 0 : passed / results.length,
    inputTokens,
    outputTokens,
    tokenUsageComplete,
    calls,
    cases: results,
  };
}

export function parseAnthropicSse(raw) {
  if (typeof raw !== 'string') return null;

  const events = [];
  for (const line of raw.split(/\r?\n/)) {
    if (!line.startsWith('data:')) continue;
    const data = line.slice('data:'.length).trim();
    if (!data || data === '[DONE]') continue;
    try {
      events.push(JSON.parse(data));
    } catch {
      return null;
    }
  }
  if (events.length === 0) return null;

  const eventTypes = events.map((event) => event?.type).filter((type) => typeof type === 'string');
  const text = events
    .filter(
      (event) =>
        event?.type === 'content_block_delta' &&
        event?.delta?.type === 'text_delta' &&
        typeof event.delta.text === 'string',
    )
    .map((event) => event.delta.text)
    .join('');
  const start = events.find((event) => event?.type === 'message_start');
  const delta = events.findLast((event) => event?.type === 'message_delta');

  return {
    text,
    eventTypes,
    stopReason: delta?.delta?.stop_reason ?? null,
    usage: {
      inputTokens: finiteNonNegative(start?.message?.usage?.input_tokens),
      outputTokens: finiteNonNegative(delta?.usage?.output_tokens),
    },
  };
}

async function runStreamingCase({ apiKey, workspaceId, endpoint, fetchImpl, now, timeoutMs }) {
  const benchmarkCase = { caseId: 'streaming_text', model: 'qwen3.8-flash' };
  const startedAt = now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(`${endpoint}/v1/messages`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'anthropic-version': '2023-06-01',
        'x-api-key': apiKey,
        ...(workspaceId ? { 'x-dashscope-workspace': workspaceId } : {}),
      },
      body: JSON.stringify({
        model: benchmarkCase.model,
        max_tokens: 64,
        thinking: { type: 'disabled' },
        stream: true,
        messages: [
          {
            role: 'user',
            content: 'Synthetic streaming test. Return exactly STREAM_OK and nothing else.',
          },
        ],
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      return failedCase(benchmarkCase, Math.max(0, now() - startedAt), `http_${response.status}`);
    }

    let streamed;
    try {
      streamed = await consumeAnthropicSse({ response, controller, now, startedAt });
    } catch (error) {
      return failedCase(
        benchmarkCase,
        Math.max(0, now() - startedAt),
        error?.name === 'AbortError' ? 'timeout' : 'invalid_stream',
      );
    }
    const latencyMs = Math.max(0, now() - startedAt);
    const parsed = parseAnthropicSse(streamed.raw);
    if (!parsed) return failedCase(benchmarkCase, latencyMs, 'invalid_stream');

    const requiredTypes = [
      'message_start',
      'content_block_start',
      'content_block_delta',
      'message_delta',
      'message_stop',
    ];
    let priorIndex = -1;
    const validSequence = requiredTypes.every((type) => {
      const index = parsed.eventTypes.indexOf(type, priorIndex + 1);
      if (index < 0) return false;
      priorIndex = index;
      return true;
    });
    const validUsage =
      Number.isFinite(parsed.usage.inputTokens) && Number.isFinite(parsed.usage.outputTokens);
    if (
      !validSequence ||
      parsed.stopReason !== 'end_turn' ||
      parsed.text.trim() !== 'STREAM_OK' ||
      !validUsage
    ) {
      return failedCase(benchmarkCase, latencyMs, 'stream_contract_failed', parsed.usage);
    }

    return passedCase(benchmarkCase, latencyMs, parsed.usage, 1, {
      firstTokenLatencyMs: streamed.firstTokenLatencyMs,
    });
  } catch (error) {
    const reason = error?.name === 'AbortError' ? 'timeout' : 'network_error';
    return failedCase(benchmarkCase, Math.max(0, now() - startedAt), reason);
  } finally {
    clearTimeout(timer);
  }
}

async function runStreamingCancellationCase({
  apiKey,
  workspaceId,
  endpoint,
  fetchImpl,
  now,
  timeoutMs,
}) {
  const benchmarkCase = { caseId: 'streaming_cancel', model: 'qwen3.8-flash' };
  const startedAt = now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(`${endpoint}/v1/messages`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'anthropic-version': '2023-06-01',
        'x-api-key': apiKey,
        ...(workspaceId ? { 'x-dashscope-workspace': workspaceId } : {}),
      },
      body: JSON.stringify({
        model: benchmarkCase.model,
        max_tokens: 2_048,
        thinking: { type: 'disabled' },
        stream: true,
        messages: [
          {
            role: 'user',
            content:
              'Synthetic cancellation test. Output the integers from 1 through 1000 in ascending order, separated by commas. Start immediately and do not summarize.',
          },
        ],
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      return failedCase(benchmarkCase, Math.max(0, now() - startedAt), `http_${response.status}`);
    }
    if (!response.body || typeof response.body.getReader !== 'function') {
      return failedCase(benchmarkCase, Math.max(0, now() - startedAt), 'stream_unavailable');
    }

    const streamed = await consumeAnthropicSse({
      response,
      controller,
      now,
      startedAt,
      cancelAfterFirstText: true,
    });
    const latencyMs = Math.max(0, now() - startedAt);
    if (streamed.status !== 'cancelled' || streamed.firstTokenLatencyMs === null) {
      return failedCase(benchmarkCase, latencyMs, 'cancellation_not_confirmed');
    }
    return passedCase(benchmarkCase, latencyMs, { inputTokens: null, outputTokens: null }, 1, {
      firstTokenLatencyMs: streamed.firstTokenLatencyMs,
      cancellation: 'confirmed',
    });
  } catch (error) {
    const reason = error?.name === 'AbortError' ? 'timeout' : 'network_error';
    return failedCase(benchmarkCase, Math.max(0, now() - startedAt), reason);
  } finally {
    clearTimeout(timer);
  }
}

async function consumeAnthropicSse({
  response,
  controller,
  now,
  startedAt,
  cancelAfterFirstText = false,
}) {
  if (!response.body || typeof response.body.getReader !== 'function') {
    const raw = await response.text();
    return {
      status: 'completed',
      raw,
      firstTokenLatencyMs: hasTextDelta(raw) ? Math.max(0, now() - startedAt) : null,
    };
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let raw = '';
  let firstTokenLatencyMs = null;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    raw += decoder.decode(value, { stream: true });
    if (firstTokenLatencyMs === null && hasTextDelta(raw)) {
      firstTokenLatencyMs = Math.max(0, now() - startedAt);
      if (cancelAfterFirstText) {
        if (hasTerminalEvent(raw)) {
          return { status: 'completed', raw: '', firstTokenLatencyMs };
        }
        controller.abort();
        try {
          await reader.cancel();
        } catch (error) {
          if (error?.name !== 'AbortError') throw error;
        }
        return { status: 'cancelled', raw: '', firstTokenLatencyMs };
      }
    }
  }
  raw += decoder.decode();
  if (firstTokenLatencyMs === null && hasTextDelta(raw)) {
    firstTokenLatencyMs = Math.max(0, now() - startedAt);
  }
  return { status: 'completed', raw, firstTokenLatencyMs };
}

function hasTextDelta(raw) {
  for (const line of raw.split(/\r?\n/)) {
    if (!line.startsWith('data:')) continue;
    const data = line.slice('data:'.length).trim();
    if (!data || data === '[DONE]') continue;
    try {
      const event = JSON.parse(data);
      if (
        event?.type === 'content_block_delta' &&
        event?.delta?.type === 'text_delta' &&
        typeof event.delta.text === 'string' &&
        event.delta.text.length > 0
      ) {
        return true;
      }
    } catch {
      // A JSON event may be split across transport chunks; wait for the next chunk.
    }
  }
  return false;
}

function hasTerminalEvent(raw) {
  for (const line of raw.split(/\r?\n/)) {
    if (!line.startsWith('data:')) continue;
    const data = line.slice('data:'.length).trim();
    if (!data || data === '[DONE]') continue;
    try {
      const event = JSON.parse(data);
      if (event?.type === 'message_delta' || event?.type === 'message_stop') return true;
    } catch {
      // A JSON event may be split across transport chunks; wait for the next chunk.
    }
  }
  return false;
}

const LOOKUP_TOOL = Object.freeze({
  name: 'lookup_record',
  description: 'Read one synthetic benchmark record by identifier.',
  input_schema: {
    type: 'object',
    properties: {
      recordId: { type: 'string' },
    },
    required: ['recordId'],
    additionalProperties: false,
  },
});

const TOOL_PROMPT =
  'Synthetic tool round-trip. Read record REC-7 using lookup_record, then return its tool result as JSON only.';
const TOOL_RESULT = '{"recordId":"REC-7","status":"READY","score":91}';

async function runToolRoundtripCase({ apiKey, workspaceId, endpoint, fetchImpl, now, timeoutMs }) {
  const benchmarkCase = { caseId: 'tool_roundtrip', model: 'qwen3.8-max' };
  const startedAt = now();
  const first = await postJson({
    apiKey,
    workspaceId,
    endpoint,
    fetchImpl,
    timeoutMs,
    body: {
      model: benchmarkCase.model,
      max_tokens: 160,
      thinking: { type: 'disabled' },
      messages: [{ role: 'user', content: TOOL_PROMPT }],
      tools: [LOOKUP_TOOL],
      tool_choice: { type: 'tool', name: 'lookup_record' },
    },
  });
  if (first.status !== 'ok') {
    return failedCase(benchmarkCase, Math.max(0, now() - startedAt), first.reason);
  }

  const firstUsage = readUsage(first.payload);
  const toolBlocks = Array.isArray(first.payload?.content)
    ? first.payload.content.filter((block) => block?.type === 'tool_use')
    : [];
  const toolUse = toolBlocks[0];
  const firstFailure = toolRequestFailure(first.payload, toolBlocks, toolUse, firstUsage);
  if (firstFailure) {
    return failedCase(
      benchmarkCase,
      Math.max(0, now() - startedAt),
      firstFailure,
      firstUsage ?? undefined,
    );
  }

  const second = await postJson({
    apiKey,
    workspaceId,
    endpoint,
    fetchImpl,
    timeoutMs,
    body: {
      model: benchmarkCase.model,
      max_tokens: 120,
      thinking: { type: 'disabled' },
      messages: [
        { role: 'user', content: TOOL_PROMPT },
        { role: 'assistant', content: [toolUse] },
        {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: toolUse.id,
              content: TOOL_RESULT,
            },
          ],
        },
      ],
      tools: [LOOKUP_TOOL],
      tool_choice: { type: 'none' },
    },
  });
  if (second.status !== 'ok') {
    return failedCase(benchmarkCase, Math.max(0, now() - startedAt), second.reason, firstUsage, 2);
  }

  const secondUsage = readUsage(second.payload);
  const responseText = Array.isArray(second.payload?.content)
    ? second.payload.content
        .filter((block) => block?.type === 'text' && typeof block.text === 'string')
        .map((block) => block.text)
        .join('')
        .trim()
    : '';
  const parsed = parseJson(responseText);
  const usage = secondUsage
    ? {
        inputTokens: firstUsage.inputTokens + secondUsage.inputTokens,
        outputTokens: firstUsage.outputTokens + secondUsage.outputTokens,
      }
    : firstUsage;
  const passed =
    second.payload?.stop_reason === 'end_turn' &&
    secondUsage !== null &&
    parsed?.recordId === 'REC-7' &&
    parsed?.status === 'READY' &&
    parsed?.score === 91;
  if (!passed) {
    return failedCase(
      benchmarkCase,
      Math.max(0, now() - startedAt),
      'tool_result_contract_failed',
      usage,
      2,
    );
  }

  return passedCase(benchmarkCase, Math.max(0, now() - startedAt), usage, 2);
}

function toolRequestFailure(payload, toolBlocks, toolUse, usage) {
  if (toolBlocks.length === 0) return 'missing_tool_use';
  if (toolBlocks.length !== 1) return 'invalid_tool_count';
  if (typeof toolUse?.id !== 'string' || toolUse.id.length === 0) return 'missing_tool_id';
  if (toolUse.name !== 'lookup_record') return 'invalid_tool_name';
  if (toolUse.input?.recordId !== 'REC-7') return 'invalid_tool_input';
  if (!['tool_use', 'end_turn'].includes(payload?.stop_reason)) return 'invalid_tool_stop_reason';
  if (!usage) return 'invalid_tool_usage';
  return null;
}

async function postJson({ apiKey, workspaceId, endpoint, fetchImpl, timeoutMs, body }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(`${endpoint}/v1/messages`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'anthropic-version': '2023-06-01',
        'x-api-key': apiKey,
        ...(workspaceId ? { 'x-dashscope-workspace': workspaceId } : {}),
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!response.ok) return { status: 'failed', reason: `http_${response.status}` };
    try {
      return { status: 'ok', payload: await response.json() };
    } catch (error) {
      return {
        status: 'failed',
        reason: error?.name === 'AbortError' ? 'timeout' : 'invalid_json',
      };
    }
  } catch (error) {
    return {
      status: 'failed',
      reason: error?.name === 'AbortError' ? 'timeout' : 'network_error',
    };
  } finally {
    clearTimeout(timer);
  }
}

const LONG_CONTEXT_SCHEMA = Object.freeze({
  type: 'object',
  properties: {
    record: { type: 'string' },
    status: { type: 'string' },
    value: { type: 'integer' },
  },
  required: ['record', 'status', 'value'],
  additionalProperties: false,
});

function buildLongContextPrompt() {
  const rows = [];
  for (let index = 1; index <= 2_048; index += 1) {
    if (index === 1_777) {
      rows.push('row=1777 record=SYNTHETIC-1777 status=amber value=314159');
    } else {
      const padded = String(index).padStart(4, '0');
      rows.push(`row=${padded} id=S${padded} s=clear v=${100_000 + index}`);
    }
  }
  return [
    'Synthetic long-context retrieval benchmark.',
    'Find the only row whose status is amber. Return its record, status, and integer value.',
    'Do not infer values from any other row.',
    '',
    ...rows,
  ].join('\n');
}

async function runLongContextCase({ apiKey, workspaceId, endpoint, fetchImpl, now, timeoutMs }) {
  const benchmarkCase = { caseId: 'long_context_retrieval', model: 'qwen3.7-plus' };
  const startedAt = now();
  const response = await postJson({
    apiKey,
    workspaceId,
    endpoint,
    fetchImpl,
    timeoutMs,
    body: {
      model: benchmarkCase.model,
      max_tokens: 120,
      thinking: { type: 'disabled' },
      messages: [{ role: 'user', content: buildLongContextPrompt() }],
      output_config: {
        format: {
          type: 'json_schema',
          schema: LONG_CONTEXT_SCHEMA,
        },
      },
    },
  });
  const latencyMs = Math.max(0, now() - startedAt);
  if (response.status !== 'ok') {
    return failedCase(benchmarkCase, latencyMs, response.reason);
  }

  const usage = readUsage(response.payload);
  const responseText = Array.isArray(response.payload?.content)
    ? response.payload.content
        .filter((block) => block?.type === 'text' && typeof block.text === 'string')
        .map((block) => block.text)
        .join('')
        .trim()
    : '';
  const parsed = parseJson(responseText);
  const passed =
    response.payload?.stop_reason === 'end_turn' &&
    usage !== null &&
    parsed?.record === 'SYNTHETIC-1777' &&
    parsed?.status === 'amber' &&
    parsed?.value === 314_159;
  if (!passed) {
    return failedCase(benchmarkCase, latencyMs, 'long_context_contract_failed', usage ?? undefined);
  }

  return passedCase(benchmarkCase, latencyMs, usage);
}

function readUsage(payload) {
  const inputTokens = finiteNonNegative(payload?.usage?.input_tokens);
  const outputTokens = finiteNonNegative(payload?.usage?.output_tokens);
  return inputTokens === null || outputTokens === null ? null : { inputTokens, outputTokens };
}

function parseJson(text) {
  const unwrapped = String(text)
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');
  try {
    return JSON.parse(unwrapped);
  } catch {
    return null;
  }
}

function passedCase(benchmarkCase, latencyMs, usage, calls = 1, details = {}) {
  return {
    caseId: benchmarkCase.caseId,
    model: benchmarkCase.model,
    status: 'passed',
    latencyMs,
    ...details,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    calls,
  };
}

function failedCase(
  benchmarkCase,
  latencyMs,
  reason,
  usage = { inputTokens: null, outputTokens: null },
  calls = 1,
) {
  return {
    caseId: benchmarkCase.caseId,
    model: benchmarkCase.model,
    status: 'failed',
    reason,
    latencyMs,
    inputTokens: usage.inputTokens ?? null,
    outputTokens: usage.outputTokens ?? null,
    calls,
  };
}

function finiteNonNegative(value) {
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function blocked(reason) {
  return { status: 'blocked', region: 'intl', reason };
}

function normalizeSingaporeEndpoint(value) {
  try {
    const url = new URL(value);
    const path = url.pathname.replace(/\/$/, '');
    const publicHost = url.hostname === 'dashscope-intl.aliyuncs.com';
    const dedicatedHost =
      url.hostname.endsWith('.ap-southeast-1.maas.aliyuncs.com') &&
      url.hostname.length > '.ap-southeast-1.maas.aliyuncs.com'.length;
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.port ||
      url.search ||
      url.hash ||
      path !== '/apps/anthropic' ||
      (!publicHost && !dedicatedHost)
    ) {
      return null;
    }
    return `${url.origin}${path}`;
  } catch {
    return null;
  }
}

function readPm2Environment(processName) {
  if (!/^[A-Za-z0-9_-]+$/.test(processName)) throw new Error('invalid process name');
  const pid = execFileSync('pm2', ['pid', processName], { encoding: 'utf8' })
    .trim()
    .split(/\s+/)[0];
  if (!/^\d+$/.test(pid) || pid === '0') throw new Error('process unavailable');
  const entries = readFileSync(`/proc/${pid}/environ`, 'utf8').split('\0');
  return Object.fromEntries(
    entries
      .filter((entry) => entry.includes('='))
      .map((entry) => {
        const separator = entry.indexOf('=');
        return [entry.slice(0, separator), entry.slice(separator + 1)];
      }),
  );
}

if (process.argv.includes('--run')) {
  const pm2Index = process.argv.indexOf('--pm2-process');
  const processName = pm2Index >= 0 ? process.argv[pm2Index + 1] : null;
  const caseIndex = process.argv.indexOf('--case');
  const caseId = caseIndex >= 0 ? process.argv[caseIndex + 1] : null;
  try {
    if (caseId && !RUNTIME_CASE_IDS.includes(caseId)) throw new Error('invalid case');
    const runtimeEnv = processName ? readPm2Environment(processName) : process.env;
    runQwenRuntimeBenchmark({ runtimeEnv, cases: caseId ? [caseId] : undefined })
      .then((report) => {
        process.stdout.write(`${JSON.stringify(report)}\n`);
        if (report.status !== 'completed' || report.passed !== report.total || report.total === 0) {
          process.exitCode = 1;
        }
      })
      .catch(() => {
        process.stdout.write(
          `${JSON.stringify({ status: 'blocked', region: 'intl', reason: 'runner_error' })}\n`,
        );
        process.exitCode = 1;
      });
  } catch {
    process.stdout.write(
      `${JSON.stringify({ status: 'blocked', region: 'intl', reason: 'runner_error' })}\n`,
    );
    process.exitCode = 1;
  }
}
