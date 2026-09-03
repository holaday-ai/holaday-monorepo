import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const DEFAULT_ENDPOINT = 'https://dashscope-intl.aliyuncs.com/apps/anthropic';
const CRITICAL_CASES = new Set([
  'planning_dependencies',
  'coding_boundary',
  'evidence_verification',
]);

export const BENCHMARK_CASES = Object.freeze([
  {
    caseId: 'planning_dependencies',
    purpose: 'reasoning',
    model: 'qwen3.8-max',
    maxTokens: 300,
    prompt:
      'Synthetic scheduling test. One worker starts at 09:00. Task A takes 30 minutes. Tasks B and C both depend on A and take 20 and 10 minutes. Return JSON only with keys order (array), finish (HH:MM), risk (string).',
    score: scorePlanning,
  },
  {
    caseId: 'chinese_fact_summary',
    purpose: 'standard',
    model: 'qwen3.7-plus',
    maxTokens: 300,
    prompt:
      '合成数据摘要测试。已知：GMV 同比增长 18.7%；退款率较上期上升 5.2 个百分点；尚未查明退款原因。仅返回 JSON，字段为 summary 字符串、risks 字符串数组、nextAction 字符串。不得补充未给出的事实。',
    score: scoreChineseSummary,
  },
  {
    caseId: 'intent_classification',
    purpose: 'fast',
    model: 'qwen3.8-flash',
    maxTokens: 120,
    prompt:
      'Classify these synthetic requests in order using only research, creation, transaction, analysis: (1) Find recent battery-industry sources. (2) Draft a poster slogan. (3) Submit a purchase order. (4) Compare two supplied tables. Return one JSON array only.',
    score: scoreClassification,
  },
  {
    caseId: 'coding_boundary',
    purpose: 'coding',
    model: 'qwen3-coder-plus',
    maxTokens: 260,
    prompt:
      'Fix this synthetic JavaScript bug without eval and return only the corrected function: function sum(items) { let total = 0; for (let i = 0; i <= items.length; i += 1) total += items[i]; }',
    score: scoreCode,
  },
  {
    caseId: 'evidence_verification',
    purpose: 'verify',
    model: 'qwen3.8-flash',
    maxTokens: 180,
    prompt:
      'Synthetic evidence check. Evidence: revenue=120, cost=80. Claims: c1 revenue exceeds cost; c2 profit equals 50. Return JSON array only with objects {id, verdict}; verdict must be supported or unsupported.',
    score: scoreEvidence,
  },
  {
    caseId: 'tool_selection',
    purpose: 'standard',
    model: 'qwen3.7-plus',
    maxTokens: 160,
    prompt:
      'Synthetic tool-routing test. Available tools: search_web, read_url, write_report, send_email. Task: research current market news, inspect sources, and prepare a report, but do not contact anyone. Return the required tool names in execution order as one JSON array only.',
    score: scoreTools,
  },
]);

const PLAN_TOOL = Object.freeze({
  name: 'emit_plan',
  description: 'Return the ordered synthetic browser plan.',
  input_schema: {
    type: 'object',
    properties: {
      steps: {
        type: 'array',
        minItems: 2,
        maxItems: 2,
        items: {
          type: 'object',
          properties: {
            kind: { type: 'string', enum: ['goto', 'extract'] },
            target: { type: 'string' },
            risk: { type: 'string', enum: ['low', 'medium', 'high'] },
          },
          required: ['kind', 'target', 'risk'],
          additionalProperties: false,
        },
      },
    },
    required: ['steps'],
    additionalProperties: false,
  },
});

const STRUCTURED_REVIEW_SCHEMA = Object.freeze({
  type: 'object',
  properties: {
    status: { type: 'string', enum: ['ready', 'review'] },
    priority: { type: 'integer', minimum: 1, maximum: 3 },
  },
  required: ['status', 'priority'],
  additionalProperties: false,
});

export const PROTOCOL_CASES = Object.freeze([
  {
    caseId: 'forced_tool_plan',
    purpose: 'reasoning',
    model: 'qwen3.8-max',
    maxTokens: 300,
    prompt:
      'Synthetic browser planning test. First navigate to https://example.com/report, then extract the page title. Do not perform the actions. Call emit_plan with exactly two low-risk steps.',
    requestExtensions: {
      tools: [PLAN_TOOL],
      tool_choice: { type: 'tool', name: 'emit_plan' },
    },
    scorePayload: (payload) => forcedToolPlanFailure(payload) === null,
    failureReason: forcedToolPlanFailure,
  },
  {
    caseId: 'strict_json_schema',
    purpose: 'standard',
    model: 'qwen3.7-plus',
    maxTokens: 120,
    prompt:
      'Synthetic JSON classification. A supplied report has a material unresolved refund-rate increase, so it requires review with priority 2. Return the JSON result only.',
    requestExtensions: {
      output_config: {
        format: {
          type: 'json_schema',
          schema: STRUCTURED_REVIEW_SCHEMA,
        },
      },
    },
    score: scoreStructuredReview,
  },
]);

export async function runQwenBenchmark({
  runtimeEnv,
  fetchImpl = fetch,
  cases,
  suite = 'baseline',
  now = Date.now,
  timeoutMs = 60_000,
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

  const selectedCases = cases ?? (suite === 'protocol' ? PROTOCOL_CASES : BENCHMARK_CASES);
  const results = [];
  for (const benchmarkCase of selectedCases) {
    results.push(
      await runCase({
        benchmarkCase,
        apiKey,
        workspaceId,
        endpoint,
        fetchImpl,
        now,
        timeoutMs,
      }),
    );
  }

  const scoringInput = results.map((result) => ({
    caseId: result.caseId,
    passed: result.status === 'passed',
  }));
  const passed = scoringInput.filter((item) => item.passed).length;
  const inputTokens = results.reduce((total, item) => total + item.inputTokens, 0);
  const outputTokens = results.reduce((total, item) => total + item.outputTokens, 0);

  return {
    status: 'completed',
    region: 'intl',
    gate:
      suite === 'protocol'
        ? classifyQwenProtocolBenchmark(scoringInput)
        : classifyQwenBenchmark(scoringInput),
    passed,
    total: results.length,
    passRate: results.length === 0 ? 0 : passed / results.length,
    inputTokens,
    outputTokens,
    cases: results,
  };
}

export function classifyQwenProtocolBenchmark(results) {
  if (results.length !== PROTOCOL_CASES.length) return 'conditional';
  const passed = results.filter((item) => item.passed).length;
  if (passed === PROTOCOL_CASES.length) return 'pass';
  if (passed > 0) return 'conditional';
  return 'fail';
}

export function classifyQwenBenchmark(results) {
  if (results.length !== BENCHMARK_CASES.length) return 'conditional';
  const passed = results.filter((item) => item.passed).length;
  const criticalPassed = [...CRITICAL_CASES].every((caseId) =>
    results.some((item) => item.caseId === caseId && item.passed),
  );
  if (passed >= 5 && criticalPassed) return 'pass';
  if (passed >= 3) return 'conditional';
  return 'fail';
}

async function runCase({
  benchmarkCase,
  apiKey,
  workspaceId,
  endpoint,
  fetchImpl,
  now,
  timeoutMs,
}) {
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
        max_tokens: benchmarkCase.maxTokens,
        ...(benchmarkCase.model === 'qwen3-coder-plus' ? {} : { thinking: { type: 'disabled' } }),
        messages: [{ role: 'user', content: benchmarkCase.prompt }],
        ...(benchmarkCase.requestExtensions ?? {}),
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      return failedCase(benchmarkCase, Math.max(0, now() - startedAt), `http_${response.status}`);
    }

    let payload;
    try {
      payload = await response.json();
    } catch (error) {
      return failedCase(
        benchmarkCase,
        Math.max(0, now() - startedAt),
        error?.name === 'AbortError' ? 'timeout' : 'invalid_json',
      );
    }
    const latencyMs = Math.max(0, now() - startedAt);
    const responseText = Array.isArray(payload?.content)
      ? payload.content
          .filter((block) => block?.type === 'text' && typeof block.text === 'string')
          .map((block) => block.text)
          .join('')
          .trim()
      : '';
    const usage = {
      inputTokens: finiteNonNegative(payload?.usage?.input_tokens),
      outputTokens: finiteNonNegative(payload?.usage?.output_tokens),
    };
    if (!benchmarkCase.scorePayload && !responseText) {
      return failedCase(benchmarkCase, latencyMs, 'empty_response', usage);
    }
    const passed = benchmarkCase.scorePayload
      ? benchmarkCase.scorePayload(payload)
      : benchmarkCase.score(responseText);
    return {
      caseId: benchmarkCase.caseId,
      purpose: benchmarkCase.purpose,
      model: benchmarkCase.model,
      status: passed ? 'passed' : 'failed',
      ...(passed ? {} : { reason: benchmarkCase.failureReason?.(payload) ?? 'criteria_not_met' }),
      latencyMs,
      ...usage,
    };
  } catch (error) {
    const reason = error?.name === 'AbortError' ? 'timeout' : 'network_error';
    return failedCase(benchmarkCase, Math.max(0, now() - startedAt), reason);
  } finally {
    clearTimeout(timer);
  }
}

function failedCase(benchmarkCase, latencyMs, reason, usage = {}) {
  return {
    caseId: benchmarkCase.caseId,
    purpose: benchmarkCase.purpose,
    model: benchmarkCase.model,
    status: 'failed',
    reason,
    latencyMs,
    inputTokens: usage.inputTokens ?? 0,
    outputTokens: usage.outputTokens ?? 0,
  };
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

function parseJson(text) {
  const trimmed = text.trim();
  const unwrapped = trimmed.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try {
    return JSON.parse(unwrapped);
  } catch {
    return null;
  }
}

function scorePlanning(text) {
  const value = parseJson(text);
  return Boolean(
    value &&
      Array.isArray(value.order) &&
      value.order[0] === 'A' &&
      value.order.includes('B') &&
      value.order.includes('C') &&
      value.finish === '10:00' &&
      typeof value.risk === 'string' &&
      value.risk.trim(),
  );
}

function scoreChineseSummary(text) {
  const value = parseJson(text);
  return Boolean(
    value &&
      typeof value.summary === 'string' &&
      value.summary.includes('18.7') &&
      value.summary.includes('5.2') &&
      Array.isArray(value.risks) &&
      value.risks.some(
        (risk) =>
          typeof risk === 'string' &&
          risk.includes('退款') &&
          (risk.includes('上升') || risk.includes('增加') || risk.includes('升高')),
      ) &&
      typeof value.nextAction === 'string' &&
      value.nextAction.trim(),
  );
}

function scoreClassification(text) {
  const value = parseJson(text);
  return (
    Array.isArray(value) &&
    JSON.stringify(value) === JSON.stringify(['research', 'creation', 'transaction', 'analysis'])
  );
}

function scoreCode(text) {
  return (
    /i\s*<\s*items\.length/.test(text) &&
    /return\s+total\s*;?/.test(text) &&
    !/i\s*<=\s*items\.length/.test(text) &&
    !/\beval\s*\(/.test(text)
  );
}

function scoreEvidence(text) {
  const value = parseJson(text);
  if (!Array.isArray(value)) return false;
  const c1 = value.find((item) => item?.id === 'c1');
  const c2 = value.find((item) => item?.id === 'c2');
  return c1?.verdict === 'supported' && c2?.verdict === 'unsupported';
}

function scoreTools(text) {
  const value = parseJson(text);
  return (
    Array.isArray(value) &&
    JSON.stringify(value) === JSON.stringify(['search_web', 'read_url', 'write_report'])
  );
}

function forcedToolPlanFailure(payload) {
  const toolUse = Array.isArray(payload?.content)
    ? payload.content.find((block) => block?.type === 'tool_use' && block.name === 'emit_plan')
    : null;
  if (!toolUse) return 'missing_emit_plan';
  const steps = toolUse?.input?.steps;
  if (!Array.isArray(steps) || steps.length !== 2) return 'invalid_step_count';
  if (steps[0]?.kind !== 'goto' || steps[1]?.kind !== 'extract') return 'invalid_step_order';
  if (steps[0]?.target !== 'https://example.com/report') return 'invalid_navigation_target';
  if (typeof steps[1]?.target !== 'string' || !/title/i.test(steps[1].target)) {
    return 'invalid_extract_target';
  }
  if (steps[0]?.risk !== 'low' || steps[1]?.risk !== 'low') return 'invalid_risk';
  return null;
}

function scoreStructuredReview(text) {
  const value = parseJson(text);
  return Boolean(
    value && value.status === 'review' && value.priority === 2 && Object.keys(value).length === 2,
  );
}

function finiteNonNegative(value) {
  return Number.isFinite(value) && value >= 0 ? Number(value) : 0;
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
  const runtimeEnv = processName ? readPm2Environment(processName) : process.env;
  const suite = process.argv.includes('--protocol') ? 'protocol' : 'baseline';
  const cases = process.argv.includes('--smoke') ? [BENCHMARK_CASES[0]] : undefined;
  runQwenBenchmark({ runtimeEnv, cases, suite })
    .then((report) => {
      process.stdout.write(`${JSON.stringify(report)}\n`);
      if (report.status !== 'completed' || report.gate === 'fail') process.exitCode = 1;
    })
    .catch(() => {
      process.stdout.write(
        `${JSON.stringify({ status: 'blocked', region: 'intl', reason: 'runner_error' })}\n`,
      );
      process.exitCode = 1;
    });
}
