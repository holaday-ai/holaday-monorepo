/**
 * Optimization #2b — OpenAI VerifierFallback.
 *
 * Second opinion on the existing verifier verdict via gpt-4o-mini.
 * Runs AFTER the deterministic + (optional) Haiku verifier and
 * BEFORE `runFixLoop` / persistence — when the existing verdict is
 * UNCERTAIN we ask OpenAI to render a tiebreaker before deciding
 * whether to ship or to ask the user.
 *
 * # Trigger surface (kept tight on purpose)
 *
 *   1. Deterministic verifier failed with at least one
 *      `severity='fixable'` check (`deterministic_uncertain`):
 *      these are the soft-fails autoFix attempts to recover.
 *      OpenAI may escalate to `needs_clarification` if it disagrees
 *      with the "looks autofixable" assessment.
 *   2. Haiku verifier returned `passed=true` BUT some check still
 *      has `passed=false` (`llm_passed_with_issues`): Haiku
 *      sometimes accepts a draft with noted reservations. OpenAI
 *      reviews those reservations and either confirms the pass or
 *      downgrades to a hard fail.
 *
 * No trigger → return the original verification unchanged. Caller
 * sees `metadata.fallbackReason = 'no_trigger'`.
 *
 * # Risk-aware degradation (BOSS spec)
 *
 *   - Timeout / API error: caller keeps the ORIGINAL verdict. We
 *     NEVER auto-improve a verdict on infrastructure failure —
 *     a fabricated-URL detection or a severe mismatch flagged by
 *     the upstream verifier is preserved even when the fallback
 *     can't reach OpenAI. Low-risk uncertain cases similarly keep
 *     their uncertain state on timeout (caller's choice whether to
 *     allow the original answer through).
 *   - Invalid OpenAI response (non-JSON, schema mismatch): same as
 *     timeout — keep original.
 *   - OpenAI's verdict only AUGMENTS the existing verification: it
 *     can flip a `passed=true` to `passed=false` (downgrade), but
 *     it cannot flip a `passed=false` to `passed=true` (no upgrades
 *     — that's `autoFix`'s job, not a polishing layer's).
 *
 * # Feature flag (independent from response-layer formatter)
 *
 *   `OPENAI_VERIFIER_FALLBACK_ENABLED=false` (default). Flipping it
 *   on additionally requires `OPENAI_API_KEY`. The deployment story
 *   is the same as the response-layer formatter so the two ship
 *   together when ops is comfortable.
 */

import OpenAI from 'openai';
import type { Logger } from 'pino';
import type {
  CheckResult,
  VerificationResult,
} from '../execution/answer-verifier.js';

export const DEFAULT_VERIFIER_FALLBACK_MODEL = 'gpt-4o-mini';
export const DEFAULT_VERIFIER_FALLBACK_TIMEOUT_MS = 8_000;

/**
 * Dedicated undici dispatcher. The orchestrator's long-running process shares
 * undici state with the Anthropic SDK + long-lived browser fetches;
 * we hit a reproducible "in-process OpenAI call times out at 30s
 * while a standalone Node + same env succeeds in ~1s" symptom that
 * goes away when each OpenAI client gets its own dispatcher.
 *
 * Codex P2 follow-up — this also pairs with `maxRetries: 0` on the
 * client so the 8s timeout in the spec actually bounds the
 * verifier-fallback's user-visible latency. Default `maxRetries: 2`
 * turned 8s into 24s = directly contradicts the "non-blocking" spec.
 */
let verifierDispatcher: unknown | null = null;
async function getVerifierDispatcher(): Promise<unknown> {
  if (!verifierDispatcher) {
    const { Agent } = await import('undici');
    verifierDispatcher = new Agent({
      connect: { timeout: 5_000 },
      keepAliveTimeout: 30_000,
      keepAliveMaxTimeout: 60_000,
      pipelining: 0,
    });
  }
  return verifierDispatcher;
}
/** Cap on the answer text we send to OpenAI; longer drafts are
 *  truncated with a marker line. The verifier-fallback prompt is
 *  intentionally compact — Haiku already handled the deep judgement,
 *  this is a tiebreaker so we only need a quick read. */
export const ANSWER_TRUNCATE_CHARS = 1_500;

export type FallbackTriggerReason =
  | 'deterministic_uncertain'
  | 'llm_passed_with_issues';

export interface VerifierFallbackRequest {
  /** The verifier result we're second-opinion-ing. */
  original: VerificationResult;
  /** The answer text being verified. */
  answerText: string;
  /** Contract goal — gives OpenAI context for the judgement. */
  contractGoal: string;
  /** Optional final URL (browser tasks). */
  finalUrl?: string;
}

export interface VerifierFallbackMetadata {
  model: string;
  latencyMs: number;
  triggered: boolean;
  triggerReason?: FallbackTriggerReason;
  /**
   * Set when the fallback didn't actually change the verdict. The
   * caller stores this for audit. When non-null, the returned
   * `verification` is the original input verification.
   */
  fallbackReason?:
    | 'flag_off'
    | 'no_trigger'
    | 'missing_api_key'
    | 'timeout'
    | 'api_error'
    | 'invalid_response'
    | 'empty_output'
    | 'agreed';
}

export interface VerifierFallbackResult {
  verification: VerificationResult;
  metadata: VerifierFallbackMetadata;
}

export interface VerifierFallbackDeps {
  logger: Logger;
  /** Override-able for tests; defaults to a real OpenAI client. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  openaiClient?: any;
}

/**
 * Standalone flag check — callers gate integration on this before
 * even loading the module.
 */
export function isVerifierFallbackEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const flag = (env.OPENAI_VERIFIER_FALLBACK_ENABLED ?? 'false').toLowerCase();
  if (flag !== 'true' && flag !== '1') return false;
  if (!env.OPENAI_API_KEY) return false;
  return true;
}

/**
 * Decide whether the verification warrants a second opinion. Returns
 * the trigger reason for metadata; null when the fallback should
 * silently pass through.
 */
export function shouldTrigger(
  verification: VerificationResult,
): FallbackTriggerReason | null {
  // Deterministic trigger — soft-fail with at least one fixable
  // check. autoFix would normally run; we want OpenAI to weigh in
  // BEFORE that costly path.
  if (
    verification.tier === 'deterministic' &&
    !verification.passed &&
    verification.checks.some((c) => !c.passed && c.severity === 'fixable')
  ) {
    return 'deterministic_uncertain';
  }
  // LLM trigger — Haiku said pass but flagged individual checks as
  // failing. The pass verdict is suspicious; second-opinion before
  // shipping.
  if (
    verification.tier === 'llm' &&
    verification.passed &&
    verification.checks.some((c) => !c.passed)
  ) {
    return 'llm_passed_with_issues';
  }
  return null;
}

/**
 * Run the second-opinion fallback. Always resolves to a usable
 * VerificationResult — original on any fallback path.
 */
export async function verifyFallback(
  req: VerifierFallbackRequest,
  deps: VerifierFallbackDeps,
  env: NodeJS.ProcessEnv = process.env,
): Promise<VerifierFallbackResult> {
  const startedAt = Date.now();
  const model = env.OPENAI_VERIFIER_FALLBACK_MODEL ?? DEFAULT_VERIFIER_FALLBACK_MODEL;
  if (!isVerifierFallbackEnabled(env)) {
    return {
      verification: req.original,
      metadata: {
        model,
        latencyMs: 0,
        triggered: false,
        fallbackReason: !env.OPENAI_API_KEY ? 'missing_api_key' : 'flag_off',
      },
    };
  }
  const trigger = shouldTrigger(req.original);
  if (!trigger) {
    return {
      verification: req.original,
      metadata: { model, latencyMs: 0, triggered: false, fallbackReason: 'no_trigger' },
    };
  }
  // Dedicated dispatcher + maxRetries=0 so the 8s timeout from the
  // spec actually bounds latency. Without these, the SDK's default
  // maxRetries=2 turned every fallback failure into a 24s wait,
  // contradicting the "non-blocking second opinion" design.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const dispatcherFetch: any = async (url: string | URL, init?: any) => {
    const { fetch: undiciFetch } = await import('undici');
    return undiciFetch(url as never, {
      ...(init ?? {}),
      dispatcher: await getVerifierDispatcher(),
    });
  };
  const client =
    deps.openaiClient ??
    new OpenAI({
      apiKey: env.OPENAI_API_KEY,
      timeout: DEFAULT_VERIFIER_FALLBACK_TIMEOUT_MS,
      maxRetries: 0,
      fetch: dispatcherFetch,
    });
  let raw: string;
  try {
    raw = await callOpenAI(client, model, req, trigger);
  } catch (err) {
    const isTimeout =
      err instanceof Error && /timeout|aborted|ETIMEDOUT/i.test(err.message);
    deps.logger.warn(
      {
        err: err instanceof Error ? err.message : String(err),
        isTimeout,
        model,
        triggerReason: trigger,
        taskId: req.original.taskId,
      },
      'openai-verifier-fallback: API call failed → keep original verdict',
    );
    return {
      verification: req.original,
      metadata: {
        model,
        latencyMs: Date.now() - startedAt,
        triggered: true,
        triggerReason: trigger,
        fallbackReason: isTimeout ? 'timeout' : 'api_error',
      },
    };
  }
  const latencyMs = Date.now() - startedAt;
  const trimmed = raw.trim();
  if (!trimmed) {
    return {
      verification: req.original,
      metadata: {
        model,
        latencyMs,
        triggered: true,
        triggerReason: trigger,
        fallbackReason: 'empty_output',
      },
    };
  }
  const parsed = parseJsonVerdict(trimmed);
  if (!parsed) {
    deps.logger.warn(
      { model, latencyMs, raw: trimmed.slice(0, 120), taskId: req.original.taskId },
      'openai-verifier-fallback: response not valid JSON / schema — keep original verdict',
    );
    return {
      verification: req.original,
      metadata: {
        model,
        latencyMs,
        triggered: true,
        triggerReason: trigger,
        fallbackReason: 'invalid_response',
      },
    };
  }
  if (parsed.verdict === 'agree') {
    // Fallback agreed with the existing verifier — no change.
    return {
      verification: req.original,
      metadata: {
        model,
        latencyMs,
        triggered: true,
        triggerReason: trigger,
        fallbackReason: 'agreed',
      },
    };
  }
  // verdict === 'disagree' → augment the verification: append a
  // fallback-injected check + mark passed=false + set failureLevel
  // to needs_clarification (most conservative path; gives the SPA
  // a clear "ask the user" signal).
  const reasons = (parsed.reasons ?? []).filter((s) => typeof s === 'string' && s.length > 0);
  const fallbackCheck: CheckResult = {
    criterionId: 'verifier_fallback',
    passed: false,
    checker: 'llm',
    detail:
      reasons.length > 0
        ? `OpenAI 2b second-opinion disagrees: ${reasons.join('; ').slice(0, 800)}`
        : 'OpenAI 2b second-opinion disagrees with the upstream verifier verdict.',
    severity: 'needs_clarification',
  };
  const augmented: VerificationResult = {
    ...req.original,
    passed: false,
    // Tier stays the upstream tier — the fallback is an annotation,
    // not a tier replacement. SPA filtering / analytics still see
    // the original chain.
    checks: [...req.original.checks, fallbackCheck],
    failureLevel: 'needs_clarification',
    ...(parsed.suggestedFix && typeof parsed.suggestedFix === 'string'
      ? { suggestedFix: parsed.suggestedFix.slice(0, 500) }
      : {}),
  };
  return {
    verification: augmented,
    metadata: {
      model,
      latencyMs,
      triggered: true,
      triggerReason: trigger,
    },
  };
}

/**
 * Build the prompt + call the OpenAI Chat Completions API. Isolated
 * so tests can stub the client at the SDK boundary. The user message
 * is JSON so the model is biased toward returning JSON back.
 */
async function callOpenAI(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: any,
  model: string,
  req: VerifierFallbackRequest,
  trigger: FallbackTriggerReason,
): Promise<string> {
  const system = [
    'You are a SECOND-OPINION verifier for an autonomous agent product.',
    'Another verifier already reviewed the answer and reached a tentative verdict.',
    '',
    'Your job: read the answer + the existing checks + the goal, and decide whether',
    'to AGREE with the existing verdict or to DISAGREE (override to fail).',
    '',
    'HARD RULES:',
    '1. You may ONLY override pass→fail (escalate concerns). You may NOT override fail→pass.',
    '2. Disagree only when you see a CONCRETE risk (fabricated fact, contradicted claim,',
    '   missing required element). Do not disagree on style / verbosity / preference.',
    '3. Return JSON ONLY: {"verdict": "agree"|"disagree", "reasons": ["..."], "suggestedFix": "..."}.',
    '   `reasons` is required when verdict=disagree (1-3 short sentences). `suggestedFix` is optional.',
    '4. Output the JSON only — no markdown fences, no commentary.',
  ].join('\n');
  const truncatedAnswer =
    req.answerText.length > ANSWER_TRUNCATE_CHARS
      ? `${req.answerText.slice(0, ANSWER_TRUNCATE_CHARS)}\n[...truncated]`
      : req.answerText;
  const payload = {
    triggerReason: trigger,
    contractGoal: req.contractGoal,
    ...(req.finalUrl ? { finalUrl: req.finalUrl } : {}),
    existingVerification: {
      tier: req.original.tier,
      passed: req.original.passed,
      failureLevel: req.original.failureLevel,
      checks: req.original.checks.map((c) => ({
        criterionId: c.criterionId,
        passed: c.passed,
        detail: c.detail.slice(0, 400),
        severity: c.severity,
      })),
    },
    answerDraft: truncatedAnswer,
  };
  const completion = await client.chat.completions.create(
    {
      model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: JSON.stringify(payload) },
      ],
      temperature: 0.0,
      max_tokens: 768,
    },
    {
      timeout: DEFAULT_VERIFIER_FALLBACK_TIMEOUT_MS,
    },
  );
  const content = completion?.choices?.[0]?.message?.content;
  if (typeof content !== 'string') {
    throw new Error('openai verifier-fallback: missing string content');
  }
  return content;
}

interface ParsedVerdict {
  verdict: 'agree' | 'disagree';
  reasons?: string[];
  suggestedFix?: string;
}

/**
 * Strict-but-tolerant parse. Accepts bare JSON object or JSON wrapped
 * in `\`\`\`json ... \`\`\`` fence (some models still do this). Returns
 * null on any structural mismatch — caller treats null as
 * invalid_response and keeps the original verdict.
 */
function parseJsonVerdict(raw: string): ParsedVerdict | null {
  let s = raw.trim();
  const fence = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(s);
  if (fence && fence[1]) s = fence[1].trim();
  let obj: unknown;
  try {
    obj = JSON.parse(s);
  } catch {
    return null;
  }
  if (!obj || typeof obj !== 'object') return null;
  const o = obj as Record<string, unknown>;
  if (o.verdict !== 'agree' && o.verdict !== 'disagree') return null;
  const reasons = Array.isArray(o.reasons)
    ? o.reasons.filter((x): x is string => typeof x === 'string')
    : undefined;
  if (o.verdict === 'disagree' && (!reasons || reasons.length === 0)) {
    // Spec says reasons[] is required on disagree. Empty reasons →
    // treat as invalid (keep original verdict). Better than blindly
    // flipping pass→fail with no explanation.
    return null;
  }
  const suggestedFix =
    typeof o.suggestedFix === 'string' ? o.suggestedFix : undefined;
  return {
    verdict: o.verdict,
    ...(reasons ? { reasons } : {}),
    ...(suggestedFix ? { suggestedFix } : {}),
  };
}
