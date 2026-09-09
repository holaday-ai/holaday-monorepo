import type { Logger } from 'pino';

import { sanitizeFinalText } from '../agent/text-sanitizer.js';
import type { VerificationResult } from './answer-verifier.js';
import {
  type CoreExecutionHandle,
  type CoreExecutionRegistry,
  coreExecutionRegistry,
} from './core-execution-registry.js';
import type { EvidenceEntry } from './evidence-ledger.js';
import {
  type FinalTerminalStatus,
  type ResearchSourceTrustReview,
  type VerifyInputs,
  assessResultTrust,
  deriveFinalStatus,
  extractFailedChecks,
  recordEvidence,
  summariseVerificationFailure,
  verifyAndFinalize,
  verifyCoreAndFinalize,
} from './execution-pipeline.js';
import type { GenerationCompletion } from './generation-completion.js';
import {
  VerificationContextError,
  renderVerificationUserIntent,
} from './task-verification-context.js';

export interface ReviewableGenerateOutcome {
  status: 'completed' | 'failed' | 'awaiting_user';
  /** Absent only on legacy paths; core runner always supplies explicit completeness. */
  generation?: GenerationCompletion;
  summary: string;
  reason?: string;
  /** Provider-observed web-search URLs, never model-authored prose URLs. */
  sourceUrls?: ReadonlyArray<string>;
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
}

export interface ReviewGenerateOutcomeInput {
  taskId: string;
  intent: string;
  outcome: ReviewableGenerateOutcome;
  semanticAdapter?: VerifyInputs['semanticAdapter'];
  logger?: Logger;
  evidenceSourceDetail?: string;
  onVerifying?: () => void;
  /** Core executions never consult or write the legacy taskId registry. */
  coreExecution?: { handle: CoreExecutionHandle; registry?: CoreExecutionRegistry };
}

export interface ReviewedGenerateOutcome {
  outcome: ReviewableGenerateOutcome;
  verification: VerificationResult | null;
  sourceTrust: ResearchSourceTrustReview;
  terminalStatus: FinalTerminalStatus;
  failureSummary: string | null;
  failedChecks: Array<{ type: string; detail: string }>;
}

/**
 * Apply the same terminal quality review to first-run and resumed generate
 * tasks. Keeping this outside the router prevents clarification resumes from
 * silently skipping sanitisation, evidence, verification, or source checks.
 */
export async function reviewGenerateOutcome(
  input: ReviewGenerateOutcomeInput,
): Promise<ReviewedGenerateOutcome> {
  const core = input.coreExecution;
  const registry = core?.registry ?? coreExecutionRegistry;
  if (core && !input.outcome.generation)
    throw new VerificationContextError('VERIFICATION_CONTEXT_INVALID');
  if (core && core.handle?.taskId !== input.taskId)
    throw new VerificationContextError('VERIFICATION_CONTEXT_INVALID');
  if (
    core &&
    input.outcome.status === 'awaiting_user' &&
    (input.outcome.generation?.completeness !== 'complete' ||
      input.outcome.generation.stopReason !== 'awaiting_user' ||
      Object.keys(input.outcome.generation).some(
        (key) => key !== 'completeness' && key !== 'stopReason',
      ))
  )
    throw new VerificationContextError('VERIFICATION_CONTEXT_INVALID');
  const state = core ? registry.read(core.handle) : null;
  const intent = core ? (state ? renderVerificationUserIntent(state.context) : '') : input.intent;
  const record = (entry: Omit<EvidenceEntry, 'id' | 'timestamp' | 'taskId'>) =>
    core ? registry.record(core.handle, entry) : recordEvidence(input.taskId, entry);
  let outcome = input.outcome;
  if (
    (outcome.status === 'completed' || (core && outcome.status === 'awaiting_user')) &&
    outcome.summary
  ) {
    const summary = sanitizeFinalText(outcome.summary);
    if (summary !== outcome.summary) outcome = { ...outcome, summary };
  }

  let verification: VerificationResult | null = null;
  if (outcome.status === 'completed' || core) {
    const observedUrls = new Set<string>();
    for (const rawUrl of outcome.status === 'failed' ? [] : (outcome.sourceUrls ?? [])) {
      let url: URL;
      try {
        url = new URL(rawUrl);
      } catch {
        continue;
      }
      if (url.protocol !== 'https:' && url.protocol !== 'http:') continue;
      observedUrls.add(url.href);
      if (observedUrls.size >= 10) break;
    }
    for (const url of observedUrls) {
      record({
        fact: `web_search_url=${url}`,
        sourceType: 'tool_result',
        sourceDetail: 'generate web_search provider result',
        confidence: 'observed',
      });
    }
    record({
      fact: `response_length=${outcome.summary.length}`,
      sourceType: 'tool_result',
      sourceDetail: input.evidenceSourceDetail ?? 'llm_generate_response',
      confidence: 'observed',
    });
    input.onVerifying?.();
    const verificationInputs = {
      answerText: outcome.summary,
      semanticAdapter: input.semanticAdapter,
      logger: input.logger,
    };
    const verified = core
      ? await verifyCoreAndFinalize({
          ...verificationInputs,
          handle: core.handle,
          registry,
          runnerStatus: outcome.status,
          observedSourceUrls: [...observedUrls],
        })
      : await verifyAndFinalize({ ...verificationInputs, taskId: input.taskId });
    if (verified.finalText !== outcome.summary) {
      outcome = { ...outcome, summary: verified.finalText };
    }
    verification = verified.verification;
  }

  const sourceTrust =
    core && outcome.status !== 'completed'
      ? { requiresReview: false, blocking: false, failedChecks: [] }
      : assessResultTrust({
          intent,
          resultText: outcome.status === 'completed' ? outcome.summary : '',
        });
  const qualityStatus =
    core && outcome.status === 'awaiting_user' && !verification?.passed
      ? 'failed'
      : deriveFinalStatus(outcome.status, verification, sourceTrust);
  const generationPartial = outcome.generation?.completeness === 'partial';
  const terminalStatus =
    qualityStatus === 'completed' && generationPartial ? 'partial_success' : qualityStatus;
  const failureSummary =
    terminalStatus === 'failed'
      ? verification
        ? summariseVerificationFailure(verification)
        : (sourceTrust.failedChecks[0]?.detail ?? null)
      : null;
  const failedChecks = [
    ...(verification && !verification.passed ? extractFailedChecks(verification) : []),
    ...(verification && !verification.passed ? [] : sourceTrust.failedChecks),
    ...(generationPartial && outcome.status === 'completed'
      ? [
          {
            type: 'GENERATION_INCOMPLETE',
            detail: '生成未完整结束，当前内容为部分草稿。',
          },
        ]
      : []),
  ];

  return {
    outcome,
    verification,
    sourceTrust,
    terminalStatus,
    failureSummary,
    failedChecks,
  };
}
