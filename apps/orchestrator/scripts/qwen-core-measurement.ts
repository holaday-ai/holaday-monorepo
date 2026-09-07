import { performance } from 'node:perf_hooks';
import { generateSuggestions } from '../src/agent/suggestions-generator.js';
import { verifyDeterministic } from '../src/execution/answer-verifier.js';
import { EvidenceLedger } from '../src/execution/evidence-ledger.js';
import { buildContract } from '../src/execution/execution-contract.js';
import {
  mergeDeterministicAndSemantic,
  shouldRunLlmVerifier,
  verifyWithLlm,
} from '../src/execution/llm-verifier.js';
import {
  type CoreModelRuntimeEnvironment,
  resolveCoreModelRuntime,
} from '../src/llm/core-model-runtime.js';
import { type MessagesAdapter, createQwenMessagesAdapter } from '../src/llm/messages-adapter.js';
import { MEASUREMENT_CASES } from './qwen-core-measurement-cases.js';

interface MeasurementInput {
  environment: CoreModelRuntimeEnvironment;
  actorExternalId: string;
  region: unknown;
  /** Omitted means no execution. Fixture responses can never be labelled live. */
  transport?:
    | { kind: 'fixture'; fetchImpl: typeof fetch; now?: () => number }
    | { kind: 'provider'; allowProviderCalls: boolean };
  shortCallSamples?: number;
  maxCalls?: number;
  maxDurationMs?: number;
}

const blocked = (reason: string) => ({
  status: 'blocked' as const,
  reason,
  releaseEvidence: false,
});

/**
 * Explicitly invoked diagnostic only: no CLI, env loading, PM2/proc access,
 * database writes, user tasks, policy mutation, or preflight-file generation.
 * A caller must separately obtain authorization before using provider mode.
 */
export async function runQwenCoreMeasurement(input: MeasurementInput) {
  const transport = input.transport;
  if (!transport || (transport.kind === 'provider' && transport.allowProviderCalls !== true)) {
    return blocked('NETWORK_NOT_AUTHORIZED');
  }
  if (transport.kind !== 'fixture' && transport.kind !== 'provider') {
    return blocked('NETWORK_NOT_AUTHORIZED');
  }
  if (transport.kind === 'fixture' && typeof transport.fetchImpl !== 'function') {
    return blocked('INVALID_FIXTURE_TRANSPORT');
  }
  const shortSamples = input.shortCallSamples ?? 0;
  const maxCalls = input.maxCalls ?? 27;
  const maxDurationMs = input.maxDurationMs ?? 120_000;
  if (
    !Number.isInteger(shortSamples) ||
    shortSamples < 0 ||
    shortSamples > 20 ||
    !Number.isInteger(maxCalls) ||
    maxCalls < 1 ||
    maxCalls > 27 ||
    !Number.isInteger(maxDurationMs) ||
    maxDurationMs < 1 ||
    maxDurationMs > 120_000
  )
    return blocked('INVALID_BUDGET');
  const region = input.region;
  if (region !== 'cn' && region !== 'intl') return blocked('INVALID_REGION');
  const env = input.environment;
  const allowlist = env.QWEN_CORE_ALLOWLIST.split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (
    env.MODEL_RUNTIME_POLICY !== 'qwen_only' ||
    env.QWEN_CORE_ROLLOUT_MODE !== 'synthetic' ||
    allowlist.length !== 1 ||
    allowlist[0] !== input.actorExternalId
  )
    return blocked('EXACT_SYNTHETIC_SCOPE_REQUIRED');

  // The supplied runtime must already allow this actor/region/lane. Never turn
  // on a flag or copy credentials from another region to make a probe run.
  let verifier: MessagesAdapter;
  let suggestions: MessagesAdapter | null = null;
  try {
    const resolve = (lane: 'verifier' | 'suggestions') =>
      resolveCoreModelRuntime({
        environment: env,
        actorExternalId: input.actorExternalId,
        lane,
        ownership: { scope: 'personal', userRegion: region },
        observe: () => {}, // Only the aggregate report is returned.
        ...(transport.kind === 'fixture'
          ? {
              createMessages: (options: Parameters<typeof createQwenMessagesAdapter>[0]) =>
                createQwenMessagesAdapter({ ...options, fetchImpl: transport.fetchImpl }),
            }
          : {}),
      });
    const verifierRuntime = resolve('verifier');
    if (verifierRuntime.kind !== 'ready') return blocked(verifierRuntime.reason);
    verifier = verifierRuntime.messages('verify_strict');
    if (shortSamples > 0) {
      const shortRuntime = resolve('suggestions');
      if (shortRuntime.kind !== 'ready') return blocked(shortRuntime.reason);
      suggestions = shortRuntime.messages('fast');
    }
  } catch {
    return blocked('INVALID_RUNTIME_CONFIGURATION');
  }

  const now =
    transport.kind === 'fixture' && transport.now ? transport.now : () => performance.now();
  const started = now();
  if (!Number.isFinite(started)) return blocked('INVALID_CLOCK');
  let calls = 0;
  let stoppedBecause: 'CALL_BUDGET' | 'TIME_BUDGET' | 'INVALID_CLOCK' | null = null;
  const availableTime = () => {
    const left = maxDurationMs - (now() - started);
    if (!Number.isFinite(left) || left > maxDurationMs) stoppedBecause = 'INVALID_CLOCK';
    else if (left <= 0) stoppedBecause = 'TIME_BUDGET';
    return stoppedBecause === null ? left : 0;
  };
  const checkBudget = () => {
    const left = availableTime();
    if (left > 0 && calls >= maxCalls) stoppedBecause = 'CALL_BUDGET';
    return stoppedBecause === null ? left : 0;
  };
  // Called inside adapter.create, after payload construction, immediately
  // before dispatch. Count only requests that actually acquire a permit.
  const reserveCall = () => {
    const left = checkBudget();
    if (left > 0) calls += 1;
    return left;
  };
  const quality = {
    labelProvenance: 'synthetic_unreviewed' as const,
    planned: MEASUREMENT_CASES.length,
    evaluated: 0,
    semanticAttempted: 0,
    semanticPass: 0,
    semanticWarn: 0,
    semanticReject: 0,
    semanticUnavailable: 0,
    deterministicRejected: 0,
    deterministicFailToPass: 0,
    correctEvaluated: 0,
    correctRejected: 0,
    severeEvaluated: 0,
    severeRejected: 0,
  };
  for (const [index, sample] of MEASUREMENT_CASES.entries()) {
    if (checkBudget() <= 0) break;
    const contract = buildContract({
      taskId: `tsk_measurement_${index}`,
      intent: sample.intent,
      executionMode: 'generate',
      expertMode: 'expert',
    });
    const ledger = new EvidenceLedger(contract.taskId);
    ledger.add({
      fact: sample.material,
      sourceType: 'user_input',
      sourceDetail: 'synthetic_measurement',
      confidence: 'observed',
    });
    const verifierInput = { contract, ledger, answerText: sample.answer };
    const deterministic = verifyDeterministic(verifierInput);
    if (!shouldRunLlmVerifier(deterministic, contract)) {
      quality.evaluated += 1;
      if (!deterministic.passed) quality.deterministicRejected += 1;
      // Exercise the real monotonic merge, without spending a model request.
      const final = mergeDeterministicAndSemantic(deterministic, {
        status: 'unavailable',
        issues: [],
      });
      if (!deterministic.passed && final.passed) quality.deterministicFailToPass += 1;
      continue;
    }
    const priorCalls = calls;
    const semantic = await verifyWithLlm({
      ...verifierInput,
      adapter: boundAdapter(verifier, 15_000, reserveCall),
      timeoutMs: 15_000,
    });
    if (calls === priorCalls) break;
    quality.evaluated += 1;
    quality.semanticAttempted += 1;
    if (semantic.status === 'pass') quality.semanticPass += 1;
    else if (semantic.status === 'warn') quality.semanticWarn += 1;
    else if (semantic.status === 'reject') quality.semanticReject += 1;
    else quality.semanticUnavailable += 1;
    if (sample.expected === 'correct') {
      quality.correctEvaluated += 1;
      if (semantic.status === 'reject') quality.correctRejected += 1;
    } else {
      quality.severeEvaluated += 1;
      if (semantic.status === 'reject') quality.severeRejected += 1;
    }
  }

  const shortLatencies: number[] = [];
  let shortUsable = 0;
  for (let i = 0; i < shortSamples && suggestions; i += 1) {
    if (checkBudget() <= 0) break;
    const priorCalls = calls;
    const before = now();
    const result = await generateSuggestions({
      messagesAdapter: boundAdapter(suggestions, 4_000, reserveCall),
      intent: '整理这份会议材料的后续待办，仅准备草稿，不要发送。',
      summary: '会议材料已经整理，场地还未确认，下一步需要核对材料并明确待办。',
    });
    if (calls === priorCalls) break;
    const latency = now() - before;
    shortLatencies.push(Number.isFinite(latency) && latency >= 0 ? latency : Number.NaN);
    if (result.length > 0) shortUsable += 1;
  }
  const shortUnavailable = shortLatencies.length - shortUsable;
  const invalidLatency = shortLatencies.some((ms) => !Number.isFinite(ms));
  const shortComplete = shortLatencies.length === shortSamples;
  const sampleStatus =
    shortUnavailable > 0 || invalidLatency
      ? 'unavailable'
      : !shortComplete || shortLatencies.length < 20
        ? 'insufficient'
        : 'descriptive_only';
  const elapsed = now() - started;
  // The last call has no following loop iteration to enforce the deadline.
  if (!Number.isFinite(elapsed) || elapsed < 0) stoppedBecause = 'INVALID_CLOCK';
  else if (elapsed >= maxDurationMs) stoppedBecause = 'TIME_BUDGET';
  return {
    status: stoppedBecause ? ('partial' as const) : ('completed' as const),
    mode: transport.kind,
    region,
    // Neither unreviewed synthetic labels nor a small fixed workload qualifies
    // the model for release. This tool never writes a production preflight.
    releaseEvidence: false,
    stoppedBecause,
    calls,
    durationMs: Number.isFinite(elapsed) && elapsed >= 0 ? Math.round(elapsed) : null,
    quality: {
      ...quality,
      semanticSevereIssueRecall: ratio(quality.severeRejected, quality.severeEvaluated),
      semanticCorrectAnswerFalseRejectionRate: ratio(
        quality.correctRejected,
        quality.correctEvaluated,
      ),
      structuredOutputValidity: ratio(
        quality.semanticAttempted - quality.semanticUnavailable,
        quality.semanticAttempted,
      ),
    },
    shortCalls: {
      workload: 'suggestions_fast',
      requested: shortSamples,
      attempted: shortLatencies.length,
      usable: shortUsable,
      unavailable: shortUnavailable,
      sampleStatus,
      p95Ms:
        sampleStatus === 'descriptive_only'
          ? ([...shortLatencies].sort((a, b) => a - b)[
              Math.ceil(shortLatencies.length * 0.95) - 1
            ] ?? null)
          : null,
    },
  };
}

function ratio(numerator: number, denominator: number) {
  return denominator > 0 ? numerator / denominator : null;
}

function boundAdapter(
  adapter: MessagesAdapter,
  perCallTimeoutMs: number,
  reserveCall: () => number,
): MessagesAdapter {
  return {
    metadata: adapter.metadata,
    async create(request, options) {
      const remainingMs = reserveCall();
      if (remainingMs <= 0) throw new Error('MEASUREMENT_BUDGET_EXHAUSTED');
      const timeoutMs = Math.min(perCallTimeoutMs, remainingMs);
      const controller = new AbortController();
      const signal = options?.signal
        ? AbortSignal.any([options.signal, controller.signal])
        : controller.signal;
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        return await Promise.race([
          adapter.create(request, {
            ...options,
            signal,
            timeoutMs,
            maxRetries: 0,
          }),
          new Promise<never>((_resolve, reject) => {
            timer = setTimeout(() => {
              controller.abort();
              reject(new Error('MEASUREMENT_TIMEOUT'));
            }, timeoutMs);
          }),
        ]);
      } finally {
        if (timer !== undefined) clearTimeout(timer);
      }
    },
  };
}
