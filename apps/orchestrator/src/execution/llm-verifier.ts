import type { MessagesAdapter } from '../llm/messages-adapter.js';
import type { CheckResult, FailureLevel, VerificationResult } from './answer-verifier.js';
import type { EvidenceLedger } from './evidence-ledger.js';
import type { ExecutionContract } from './execution-contract.js';

export const DEFAULT_LLM_VERIFIER_TIMEOUT_MS = 15_000;
export const DEFAULT_LLM_VERIFIER_MAX_TOKENS = 768;
export const ANSWER_TRUNCATE_CHARS = 2_000;
export const MAX_SAFE_VERIFIER_SUMMARY_CHARS = 80;

const SYSTEM_PROMPT = [
  '你是 HOLA DAY 的语义质量核验器。',
  '确定性规则已经检查结构、数字、来源、权限和危险动作；不要重复或放宽这些规则。',
  '仅判断回复是否切题、必要内容是否完整、结论是否得到材料支持、证据关系是否明确。',
  '只输出 JSON，不要复述用户输入、答案原文或材料内容。',
  '格式：{"status":"pass|warn|reject","issues":[{"code":"固定问题码","fixable":true,"summary":"短说明"}]}。',
  '问题码只能是 UNSUPPORTED_CONCLUSION、MISSING_REQUIRED_SECTION、IRRELEVANT_OUTPUT、AMBIGUOUS_EVIDENCE。',
  'pass 必须配空 issues；warn 或 reject 必须至少有一个 issue。',
].join('\n');

export type SafeVerifierIssueCode =
  | 'UNSUPPORTED_CONCLUSION'
  | 'MISSING_REQUIRED_SECTION'
  | 'IRRELEVANT_OUTPUT'
  | 'AMBIGUOUS_EVIDENCE';

export interface SafeVerifierIssue {
  code: SafeVerifierIssueCode;
  fixable: boolean;
  summary: string;
}

export interface SemanticVerification {
  status: 'pass' | 'warn' | 'reject' | 'unavailable';
  issues: SafeVerifierIssue[];
}

export interface LlmVerifierInputs {
  contract: ExecutionContract;
  ledger: EvidenceLedger;
  answerText: string;
  finalUrl?: string;
  /** Region-bound Qwen Messages adapter. Null means the lane is unavailable. */
  adapter: MessagesAdapter | null;
  timeoutMs?: number;
}

const SAFE_SUMMARIES: Record<SafeVerifierIssueCode, string> = {
  UNSUPPORTED_CONCLUSION: '结论缺少足够材料支持。',
  MISSING_REQUIRED_SECTION: '结果缺少必要内容。',
  IRRELEVANT_OUTPUT: '结果与任务目标不够一致。',
  AMBIGUOUS_EVIDENCE: '关键证据关系不明确。',
};

const SAFE_CODES = new Set<SafeVerifierIssueCode>(
  Object.keys(SAFE_SUMMARIES) as SafeVerifierIssueCode[],
);

export function shouldRunLlmVerifier(
  deterministicResult: VerificationResult,
  contract: ExecutionContract,
): boolean {
  return contract.tier === 'full' && deterministicResult.passed;
}

/**
 * Run one bounded, region-bound Qwen semantic review. Infrastructure and
 * schema failures are explicit unavailability, never an implied pass.
 */
export async function verifyWithLlm(inputs: LlmVerifierInputs): Promise<SemanticVerification> {
  if (!inputs.adapter) return unavailable();

  const timeoutMs = inputs.timeoutMs ?? DEFAULT_LLM_VERIFIER_TIMEOUT_MS;
  const controller = new AbortController();
  try {
    const response = await withVerifierTimeout(
      inputs.adapter.create(
        {
          maxTokens: DEFAULT_LLM_VERIFIER_MAX_TOKENS,
          thinking: { type: 'disabled' },
          temperature: 0,
          system: SYSTEM_PROMPT,
          messages: [{ role: 'user', content: buildUserPayload(inputs) }],
        },
        {
          signal: controller.signal,
          timeoutMs,
          maxRetries: 0,
        },
      ),
      timeoutMs,
      controller,
    );
    const text = response.content.find((block) => block.type === 'text')?.text;
    if (!text) return unavailable();
    return parseSemanticVerification(text) ?? unavailable();
  } catch {
    return unavailable();
  }
}

/**
 * Monotonic merge: semantic review can annotate or tighten a deterministic
 * pass, but it can never alter a deterministic failure into a pass or warning.
 */
export function mergeDeterministicAndSemantic(
  deterministic: VerificationResult,
  semantic: SemanticVerification,
): VerificationResult {
  if (!deterministic.passed) {
    return { ...deterministic, semanticStatus: semantic.status };
  }
  if (semantic.status === 'unavailable') {
    return { ...deterministic, semanticStatus: 'unavailable' };
  }
  if (semantic.status === 'pass') {
    return {
      ...deterministic,
      tier: 'llm',
      semanticStatus: 'pass',
      checks: [
        ...deterministic.checks,
        {
          criterionId: 'semantic.overall',
          passed: true,
          checker: 'llm',
          detail: '语义核验已通过。',
        },
      ],
    };
  }

  const semanticChecks = semantic.issues.map(toCheckResult);
  if (semantic.status === 'warn') {
    return {
      ...deterministic,
      tier: 'llm',
      semanticStatus: 'warn',
      checks: [...deterministic.checks, ...semanticChecks],
      suggestedFix: '语义核验发现需要留意的内容，请核对相关结论与材料。',
    };
  }

  return {
    ...deterministic,
    passed: false,
    tier: 'llm',
    semanticStatus: 'reject',
    checks: [...deterministic.checks, ...semanticChecks],
    failureLevel: failureLevelFor(semantic.issues),
    suggestedFix: '语义核验未通过，请补充材料或修正相关结论。',
  };
}

export function buildUserPayload(
  inputs: Pick<LlmVerifierInputs, 'contract' | 'ledger' | 'answerText' | 'finalUrl'>,
): string {
  const answerDraft =
    inputs.answerText.length > ANSWER_TRUNCATE_CHARS
      ? `${inputs.answerText.slice(0, ANSWER_TRUNCATE_CHARS)}\n[...truncated]`
      : inputs.answerText;
  return JSON.stringify({
    contract: {
      tier: inputs.contract.tier,
      goal: inputs.contract.goal,
      expectedOutputType: inputs.contract.expectedOutputType,
      successCriteria: inputs.contract.successCriteria,
      constraints: inputs.contract.constraints,
      requiredInputs: inputs.contract.requiredInputs,
    },
    evidence: inputs.ledger.toJSON(),
    answerDraft,
    ...(inputs.finalUrl ? { finalUrl: inputs.finalUrl } : {}),
  });
}

function parseSemanticVerification(text: string): SemanticVerification | null {
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
  if (!parsed || typeof parsed !== 'object') return null;
  const object = parsed as Record<string, unknown>;
  if (object.status !== 'pass' && object.status !== 'warn' && object.status !== 'reject') {
    return null;
  }
  if (!Array.isArray(object.issues)) return null;

  const issues: SafeVerifierIssue[] = [];
  for (const candidate of object.issues) {
    if (!candidate || typeof candidate !== 'object') return null;
    const issue = candidate as Record<string, unknown>;
    if (
      typeof issue.code !== 'string' ||
      !SAFE_CODES.has(issue.code as SafeVerifierIssueCode) ||
      typeof issue.fixable !== 'boolean' ||
      typeof issue.summary !== 'string'
    ) {
      return null;
    }
    const code = issue.code as SafeVerifierIssueCode;
    issues.push({
      code,
      fixable: issue.fixable,
      summary: SAFE_SUMMARIES[code].slice(0, MAX_SAFE_VERIFIER_SUMMARY_CHARS),
    });
  }
  if (object.status === 'pass' && issues.length > 0) return null;
  if (object.status !== 'pass' && issues.length === 0) return null;
  return { status: object.status, issues };
}

function toCheckResult(issue: SafeVerifierIssue): CheckResult {
  return {
    criterionId: `semantic.${issue.code.toLowerCase()}`,
    passed: false,
    checker: 'llm',
    detail: issue.summary,
    severity: issue.fixable ? 'fixable' : 'needs_clarification',
  };
}

function failureLevelFor(issues: SafeVerifierIssue[]): FailureLevel {
  return issues.every((issue) => issue.fixable) ? 'fixable' : 'needs_clarification';
}

function unavailable(): SemanticVerification {
  return { status: 'unavailable', issues: [] };
}

function withVerifierTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  controller: AbortController,
): Promise<T> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      controller.abort();
      reject(new Error('SEMANTIC_VERIFIER_TIMEOUT'));
    }, timeoutMs);

    promise.then(
      (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}
