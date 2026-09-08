import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { FailureLevel, VerificationResult } from '../execution/answer-verifier.js';
import {
  type ResearchSourceTrustReview,
  deriveFinalStatus,
} from '../execution/execution-pipeline.js';
import type { GenerationCompletion } from '../execution/generation-completion.js';
import type { SafeVerifierIssueCode } from '../execution/llm-verifier.js';
import {
  VERIFICATION_INPUT_LIMITS,
  type VerificationInputCoverage,
  type VerificationInputIssue,
} from '../execution/verification-input-budget.js';
import {
  type CoreAdmission,
  type CoreTaskScope,
  assertPreparedCoreAdmission,
} from './core-task-admission.js';

type SettlementPayload =
  | { status: 'completed' | 'partial_success'; result: { summary: string } }
  | { status: 'failed'; result: { reason: string } }
  | { status: 'awaiting_user'; result: { question: string; planText?: string } };
type IssueCode =
  | SafeVerifierIssueCode
  | VerificationInputIssue
  | 'GENERATION_INCOMPLETE'
  | 'DETERMINISTIC_CHECK_FAILED'
  | 'SEMANTIC_CHECK_FAILED'
  | 'SOURCE_TRUST_FAILED';

export interface CoreSettlement {
  readonly scope: CoreTaskScope;
  readonly executionId: string;
  readonly executionRevision: number;
  readonly expectedRecordVersion: number;
  readonly recordVersion: number;
  readonly commitId: string;
  readonly status: SettlementPayload['status'];
  readonly result: Readonly<{ tickCount: 1; summary?: string; reason?: string; planText?: string }>;
  readonly awaitingQuestion: string | null;
  readonly awaitingKind: 'clarification' | null;
  readonly verificationPassed: boolean;
  readonly verification: Readonly<{
    schemaVersion: 1;
    executionId: string;
    executionRevision: number;
    commitId: string;
    generation: Readonly<GenerationCompletion>;
    inputCoverage: Readonly<VerificationInputCoverage>;
    semanticStatus: NonNullable<VerificationResult['semanticStatus']>;
    issueCodes: readonly IssueCode[];
    failureLevel: FailureLevel | null;
  }>;
}

export class CoreSettlementError extends Error {
  constructor(
    code:
      | 'CORE_SETTLEMENT_INVALID'
      | 'CORE_SETTLEMENT_WRITE_INVALID'
      | 'CORE_SETTLEMENT_UNCONFIRMED'
      | 'CORE_SETTLEMENT_READ_UNAVAILABLE',
  ) {
    super(code);
    this.name = 'CoreSettlementError';
  }
}

const failure = z.enum(['fixable', 'needs_clarification', 'hard_fail']);
const coverageCode = z.enum([
  'VERIFICATION_CONTEXT_INVALID',
  'VERIFICATION_INPUT_LIMIT',
  'VERIFICATION_MATERIALS_INCOMPLETE',
]);
const generationSchema = z.discriminatedUnion('completeness', [
  z
    .object({
      completeness: z.literal('complete'),
      stopReason: z.enum(['end_turn', 'deterministic', 'awaiting_user']),
    })
    .strict(),
  z
    .object({
      completeness: z.literal('partial'),
      stopReason: z.enum([
        'continuation_limit',
        'continuation_failed',
        'timeout',
        'empty_response',
        'provider_error',
        'invalid_response',
        'quality_rejected',
      ]),
    })
    .strict(),
]);
const verificationSchema = z.object({
  taskId: z.string(),
  executionId: z.string(),
  executionRevision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  passed: z.boolean(),
  tier: z.enum(['deterministic', 'llm']),
  semanticStatus: z.enum(['pass', 'warn', 'reject', 'unavailable']),
  inputCoverage: z
    .object({ complete: z.boolean(), codes: z.array(coverageCode).max(3) })
    .strict()
    .refine((value) => value.complete === (value.codes.length === 0)),
  // Drop detail/suggestedFix and every other uncontrolled field before projection.
  checks: z.array(
    z.object({
      criterionId: z.string(),
      criterionType: z.string().optional(),
      passed: z.boolean(),
      checker: z.enum(['deterministic', 'llm']),
      severity: failure.optional(),
    }),
  ),
  failureLevel: failure.optional(),
});
const content = z
  .string()
  .refine(
    (text) =>
      text.trim().length > 0 &&
      Buffer.byteLength(text, 'utf8') <= VERIFICATION_INPUT_LIMITS.answerBytes,
  );
// These existing columns are MySQL TEXT, unlike the JSON summary body.
const waitingText = content.refine((text) => Buffer.byteLength(text, 'utf8') <= 65_535);
const payloadSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('completed'), result: z.object({ summary: content }).strict() }),
  z.object({
    status: z.literal('partial_success'),
    result: z.object({ summary: content }).strict(),
  }),
  z.object({ status: z.literal('failed'), result: z.object({ reason: z.string() }).strict() }),
  z.object({
    status: z.literal('awaiting_user'),
    result: z.object({ question: waitingText, planText: waitingText.optional() }).strict(),
  }),
]);
const inputSchema = z
  .object({
    admission: z.unknown(),
    status: z.unknown(),
    result: z.unknown(),
    generation: generationSchema,
    verification: verificationSchema,
    sourceTrust: z
      .object({
        requiresReview: z.boolean(),
        blocking: z.boolean(),
        failedChecks: z.array(z.object({ type: z.string() })),
      })
      .optional(),
  })
  .strict();
const semanticCodes: Readonly<Record<string, SafeVerifierIssueCode>> = Object.freeze({
  'semantic.unsupported_conclusion': 'UNSUPPORTED_CONCLUSION',
  'semantic.missing_required_section': 'MISSING_REQUIRED_SECTION',
  'semantic.irrelevant_output': 'IRRELEVANT_OUTPUT',
  'semantic.ambiguous_evidence': 'AMBIGUOUS_EVIDENCE',
});
const prepared = new WeakSet<object>();

/** Pure, server-only capsule. It validates provenance, not authorization or DB commit.
 * Retain this exact frozen capsule for bounded persistence retries; never regenerate it.
 */
export function prepareCoreSettlement(
  input: SettlementPayload & {
    admission: CoreAdmission;
    generation: GenerationCompletion;
    verification: VerificationResult;
    sourceTrust?: ResearchSourceTrustReview;
  },
): CoreSettlement {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) throw new CoreSettlementError('CORE_SETTLEMENT_INVALID');
  const payload = payloadSchema.safeParse(parsed.data);
  if (!payload.success) throw new CoreSettlementError('CORE_SETTLEMENT_INVALID');
  try {
    assertPreparedCoreAdmission(parsed.data.admission);
  } catch {
    throw new CoreSettlementError('CORE_SETTLEMENT_INVALID');
  }
  const admission = parsed.data.admission;
  const { generation, verification } = parsed.data;
  const sourceTrust = parsed.data.sourceTrust
    ? {
        ...parsed.data.sourceTrust,
        failedChecks: parsed.data.sourceTrust.failedChecks.map((check) => ({
          ...check,
          detail: '',
        })),
      }
    : undefined;
  // Use the existing policy, including critical structural failures and the
  // explicit non-blocking URL exception. No model/DB work is done by this function.
  const qualityStatus = deriveFinalStatus(
    'completed',
    { ...verification, checks: verification.checks.map((check) => ({ ...check, detail: '' })) },
    sourceTrust,
  );
  const { status } = payload.data;
  if (
    (status !== 'failed' && qualityStatus === 'failed') ||
    (status === 'completed' && qualityStatus !== 'completed') ||
    verification.taskId !== admission.scope.taskId ||
    verification.executionId !== admission.executionId ||
    verification.executionRevision !== admission.executionRevision ||
    admission.recordVersion >= Number.MAX_SAFE_INTEGER
  )
    throw new CoreSettlementError('CORE_SETTLEMENT_INVALID');

  const failedChecks = verification.checks.filter((check) => !check.passed);
  const hardFailure =
    (sourceTrust?.requiresReview === true && sourceTrust.blocking) ||
    verification.failureLevel === 'hard_fail' ||
    failedChecks.some((check) => check.severity === 'hard_fail');
  const clarificationFailure =
    verification.failureLevel === 'needs_clarification' ||
    (!verification.passed &&
      failedChecks.some((check) => check.severity === 'needs_clarification'));
  const deterministicFailure = failedChecks.some((check) => check.checker === 'deterministic');
  const waiting = generation.stopReason === 'awaiting_user';
  if (
    (status !== 'failed' && (hardFailure || clarificationFailure)) ||
    (status !== 'failed' &&
      verification.passed &&
      (deterministicFailure || verification.semanticStatus === 'reject')) ||
    (status === 'completed' &&
      (!verification.passed ||
        generation.completeness !== 'complete' ||
        !verification.inputCoverage.complete ||
        waiting)) ||
    (status === 'awaiting_user' &&
      (!waiting || !verification.passed || !verification.inputCoverage.complete)) ||
    (status === 'partial_success' && waiting)
  )
    throw new CoreSettlementError('CORE_SETTLEMENT_INVALID');

  const result: { tickCount: 1; summary?: string; reason?: string; planText?: string } = {
    tickCount: 1,
  };
  let awaitingQuestion: string | null = null;
  if (payload.data.status === 'failed') {
    // Never retain a raw provider/model reason or a rejected candidate in a failure.
    result.reason =
      !verification.passed || hardFailure || qualityStatus === 'failed'
        ? '质量校验未通过'
        : '生成未完成，请稍后重试';
  } else if (payload.data.status === 'awaiting_user') {
    awaitingQuestion = payload.data.result.question;
    if (payload.data.result.planText !== undefined) result.planText = payload.data.result.planText;
    if (
      Buffer.byteLength(awaitingQuestion, 'utf8') +
        Buffer.byteLength(result.planText ?? '', 'utf8') >
      VERIFICATION_INPUT_LIMITS.answerBytes
    )
      throw new CoreSettlementError('CORE_SETTLEMENT_INVALID');
  } else {
    result.summary = payload.data.result.summary;
  }

  const issueCodes = new Set<IssueCode>(verification.inputCoverage.codes);
  if (sourceTrust?.requiresReview) issueCodes.add('SOURCE_TRUST_FAILED');
  if (generation.completeness === 'partial') issueCodes.add('GENERATION_INCOMPLETE');
  for (const check of failedChecks) {
    const knownSemantic = Object.hasOwn(semanticCodes, check.criterionId)
      ? semanticCodes[check.criterionId]
      : undefined;
    const knownCoverage = coverageCode.safeParse(check.criterionType);
    issueCodes.add(
      knownSemantic ??
        (knownCoverage.success
          ? knownCoverage.data
          : check.checker === 'deterministic'
            ? 'DETERMINISTIC_CHECK_FAILED'
            : 'SEMANTIC_CHECK_FAILED'),
    );
  }
  const failureLevel = hardFailure
    ? 'hard_fail'
    : clarificationFailure
      ? 'needs_clarification'
      : (verification.failureLevel ??
        (!verification.passed ||
        generation.completeness === 'partial' ||
        !verification.inputCoverage.complete ||
        sourceTrust?.requiresReview
          ? 'fixable'
          : null));
  const commitId = randomUUID();
  const operation: CoreSettlement = Object.freeze({
    scope: admission.scope,
    executionId: admission.executionId,
    executionRevision: admission.executionRevision,
    expectedRecordVersion: admission.recordVersion,
    recordVersion: admission.recordVersion + 1,
    status,
    commitId,
    result: Object.freeze(result),
    awaitingQuestion,
    awaitingKind: status === 'awaiting_user' ? 'clarification' : null,
    verificationPassed:
      status !== 'failed' &&
      verification.passed &&
      !sourceTrust?.requiresReview &&
      generation.completeness === 'complete' &&
      verification.inputCoverage.complete,
    verification: Object.freeze({
      schemaVersion: 1,
      executionId: admission.executionId,
      executionRevision: admission.executionRevision,
      commitId,
      generation: Object.freeze(generation),
      inputCoverage: Object.freeze({
        complete: verification.inputCoverage.complete,
        codes: Object.freeze([...verification.inputCoverage.codes]),
      }),
      semanticStatus: verification.semanticStatus,
      issueCodes: Object.freeze([...issueCodes]),
      failureLevel,
    }),
  });
  prepared.add(operation);
  return operation;
}

export function assertPreparedCoreSettlement(
  operation: unknown,
): asserts operation is CoreSettlement {
  if (!operation || typeof operation !== 'object' || !prepared.has(operation))
    throw new CoreSettlementError('CORE_SETTLEMENT_INVALID');
}
