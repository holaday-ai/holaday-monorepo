/**
 * Phase 1 Day 4 — LLM verifier tier (Haiku-driven content judgement).
 *
 * Wraps the deterministic verifier's verdict with a content-quality
 * pass for expert-workflow tasks. Trigger condition (per spec):
 *   - contract.tier === 'full' AND
 *   - deterministic verifier passed all checks
 *
 * The deterministic tier already covers ground-truth-anchored
 * structural rules (URL grounding, number cross-validation,
 * constraint violations). The LLM tier judges harder-to-encode
 * quality dimensions: did the answer actually use the user's
 * input? Are the conclusions defensible? Is the format right?
 *
 * **Non-blocking on infrastructure failure.** A timeout, network
 * error, or malformed response returns `passed: true` rather than
 * stalling the user. The deterministic verifier is the
 * infrastructure-independent source of truth; the LLM tier is
 * advisory polish. This matches BOSS spec ("超时=通过，不阻塞").
 *
 * Independent module: zero changes to executionContract / answerVerifier /
 * evidenceLedger / autoFix. Callers that want the LLM tier import
 * `verifyWithLlm` and dispatch on `shouldRunLlmVerifier`.
 */
import type {
  CheckResult,
  FailureLevel,
  VerificationResult,
} from './answer-verifier.js';
import type { ExecutionContract } from './execution-contract.js';
import type { EvidenceLedger } from './evidence-ledger.js';

export const DEFAULT_LLM_VERIFIER_MODEL = 'claude-haiku-4-5';
export const DEFAULT_LLM_VERIFIER_TIMEOUT_MS = 15_000;
export const DEFAULT_LLM_VERIFIER_MAX_TOKENS = 1024;
export const ANSWER_TRUNCATE_CHARS = 2_000;

const SYSTEM_PROMPT =
  '你是质量检查员。对比合约和证据，判断回复是否满足要求。只输出 JSON。';

/**
 * Schema the LLM is asked to produce. Plain object — no class
 * methods — so it round-trips through JSON cleanly.
 */
export interface LlmVerifierIssue {
  criterion_id: string;
  problem: string;
  fixable: boolean;
}

export interface LlmVerifierRawResponse {
  passed: boolean;
  issues: LlmVerifierIssue[];
}

/**
 * Loose structural type for the Anthropic client. Matches the
 * SDK's `client.messages.create` signature on the calls this
 * module makes. Tests inject a minimal stub; production callers
 * pass a real `new Anthropic()`.
 */
export interface AnthropicMessageContentBlock {
  type: string;
  text?: string;
}

export interface AnthropicMessageResponse {
  content: AnthropicMessageContentBlock[];
}

export interface AnthropicMessageCreateParams {
  model: string;
  max_tokens: number;
  system?: string;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
}

export interface AnthropicRequestOptions {
  signal?: AbortSignal;
  timeout?: number;
  maxRetries?: number;
}

export interface AnthropicLikeClient {
  messages: {
    create(
      params: AnthropicMessageCreateParams,
      opts?: AnthropicRequestOptions,
    ): Promise<AnthropicMessageResponse>;
  };
}

export interface LlmVerifierInputs {
  contract: ExecutionContract;
  ledger: EvidenceLedger;
  answerText: string;
  finalUrl?: string;
  /**
   * Anthropic client. Caller injects so tests can mock cleanly.
   * No fallback to module-scope `new Anthropic()` — keeps the
   * module pure and side-effect-free.
   */
  client: AnthropicLikeClient;
  /** Override the model. Defaults to Haiku — cheapest tier per spec. */
  model?: string;
  /** Override the timeout. Defaults to 15s. */
  timeoutMs?: number;
}

/**
 * Pure predicate. Returns true iff this task should escalate to
 * the LLM tier after the deterministic tier passed. Caller
 * decides whether to actually call `verifyWithLlm`.
 */
export function shouldRunLlmVerifier(
  deterministicResult: VerificationResult,
  contract: ExecutionContract,
): boolean {
  return contract.tier === 'full' && deterministicResult.passed;
}

/**
 * Execute the LLM verifier. Always resolves (never rejects) — on
 * any infrastructure failure returns a non-blocking pass.
 */
export async function verifyWithLlm(
  inputs: LlmVerifierInputs,
): Promise<VerificationResult> {
  const timeoutMs = inputs.timeoutMs ?? DEFAULT_LLM_VERIFIER_TIMEOUT_MS;
  const model = inputs.model ?? DEFAULT_LLM_VERIFIER_MODEL;
  const userPayload = buildUserPayload(inputs);

  const ac = new AbortController();

  try {
    const response = await withVerifierTimeout(
      inputs.client.messages.create(
        {
          model,
          max_tokens: DEFAULT_LLM_VERIFIER_MAX_TOKENS,
          system: SYSTEM_PROMPT,
          messages: [{ role: 'user', content: userPayload }],
        },
        {
          signal: ac.signal,
          timeout: timeoutMs,
          maxRetries: 0,
        },
      ),
      timeoutMs,
      ac,
    );

    const text = extractText(response);
    if (!text) {
      return nonBlockingPass(
        inputs.contract.taskId,
        'llm verifier: empty response — non-blocking pass',
      );
    }
    const parsed = parseResponse(text);
    if (!parsed) {
      return nonBlockingPass(
        inputs.contract.taskId,
        `llm verifier: response not valid JSON or schema — non-blocking pass (raw: ${text.slice(0, 80)})`,
      );
    }
    return mapToVerification(inputs.contract, parsed);
  } catch (err) {
    const isAbort =
      err instanceof Error &&
      (err.name === 'AbortError' || /aborted/i.test(err.message));
    return nonBlockingPass(
      inputs.contract.taskId,
      isAbort
        ? `llm verifier: timed out after ${timeoutMs}ms — non-blocking pass`
        : `llm verifier: ${err instanceof Error ? err.message : String(err)} — non-blocking pass`,
    );
  }
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

/**
 * Spec-format payload: the contract, the ledger, and the truncated
 * answer draft. Exported for unit-test assertions on the request
 * shape. Returns the JSON string actually sent to Haiku.
 */
export function buildUserPayload(
  inputs: Pick<
    LlmVerifierInputs,
    'contract' | 'ledger' | 'answerText' | 'finalUrl'
  >,
): string {
  const truncated =
    inputs.answerText.length > ANSWER_TRUNCATE_CHARS
      ? `${inputs.answerText.slice(0, ANSWER_TRUNCATE_CHARS)}\n[...truncated]`
      : inputs.answerText;
  const payload: Record<string, unknown> = {
    contract: {
      taskId: inputs.contract.taskId,
      tier: inputs.contract.tier,
      goal: inputs.contract.goal,
      expectedOutputType: inputs.contract.expectedOutputType,
      successCriteria: inputs.contract.successCriteria,
      constraints: inputs.contract.constraints,
      requiredInputs: inputs.contract.requiredInputs,
    },
    evidence: inputs.ledger.toJSON(),
    answerDraft: truncated,
  };
  if (inputs.finalUrl) payload.finalUrl = inputs.finalUrl;
  return JSON.stringify(payload);
}

function extractText(response: AnthropicMessageResponse): string {
  for (const block of response.content) {
    if (block.type === 'text' && typeof block.text === 'string') {
      return block.text;
    }
  }
  return '';
}

/**
 * Strict parse. Accepts:
 *   - bare JSON object
 *   - JSON wrapped in ```json ... ``` fence (Haiku sometimes does this
 *     even when told not to)
 * Rejects anything that doesn't match the schema — that's a fallback
 * trigger.
 */
function parseResponse(text: string): LlmVerifierRawResponse | null {
  const stripped = text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripped);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const obj = parsed as Record<string, unknown>;
  if (typeof obj.passed !== 'boolean') return null;
  const issuesRaw = Array.isArray(obj.issues) ? obj.issues : [];
  const issues: LlmVerifierIssue[] = [];
  for (const i of issuesRaw) {
    if (typeof i !== 'object' || i === null) return null;
    const issue = i as Record<string, unknown>;
    if (
      typeof issue.criterion_id !== 'string' ||
      typeof issue.problem !== 'string' ||
      typeof issue.fixable !== 'boolean'
    ) {
      return null;
    }
    issues.push({
      criterion_id: issue.criterion_id,
      problem: issue.problem,
      fixable: issue.fixable,
    });
  }
  return { passed: obj.passed, issues };
}

/**
 * Translate the LLM's raw verdict into a VerificationResult that
 * the rest of the pipeline understands. Severity rules:
 *   - issue.fixable=true  → severity='fixable'
 *   - issue.fixable=false → severity='needs_clarification'
 *
 * Number contradictions never come through this path (they're
 * caught deterministically and short-circuit before LLM tier);
 * spec explicitly keeps them as needs_clarification — this
 * module doesn't override that.
 */
function mapToVerification(
  contract: ExecutionContract,
  raw: LlmVerifierRawResponse,
): VerificationResult {
  const checks: CheckResult[] = raw.issues.map((issue) => ({
    criterionId: issue.criterion_id,
    passed: false,
    checker: 'llm' as const,
    detail: issue.problem,
    severity: issue.fixable
      ? ('fixable' as FailureLevel)
      : ('needs_clarification' as FailureLevel),
  }));

  // When LLM accepts and emits no issues, surface a single
  // synthetic "ok" check so the result has positive evidence
  // (and downstream UI has something to render).
  if (raw.passed && checks.length === 0) {
    checks.push({
      criterionId: 'llm.overall',
      passed: true,
      checker: 'llm',
      detail: 'LLM verifier accepted the answer',
    });
  }

  let failureLevel: FailureLevel | undefined;
  if (!raw.passed) {
    if (checks.some((c) => c.severity === 'needs_clarification')) {
      failureLevel = 'needs_clarification';
    } else if (checks.some((c) => c.severity === 'fixable')) {
      failureLevel = 'fixable';
    } else {
      // LLM said passed=false but emitted no issues — treat as
      // needs_clarification (the agent would have to ask "what's
      // wrong" before producing a different answer).
      failureLevel = 'needs_clarification';
    }
  }

  const result: VerificationResult = {
    taskId: contract.taskId,
    passed: raw.passed,
    tier: 'llm',
    checks,
  };
  if (failureLevel) result.failureLevel = failureLevel;
  return result;
}

function nonBlockingPass(
  taskId: string,
  detail: string,
): VerificationResult {
  return {
    taskId,
    passed: true,
    tier: 'llm',
    checks: [
      {
        criterionId: 'llm.fallback',
        passed: true,
        checker: 'llm',
        detail,
      },
    ],
  };
}

function withVerifierTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  ac: AbortController,
): Promise<T> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      ac.abort();
      reject(new Error(`llm verifier timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    promise.then(
      (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}
