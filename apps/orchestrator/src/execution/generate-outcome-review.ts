import type { Logger } from 'pino';

import { sanitizeFinalText } from '../agent/text-sanitizer.js';
import type { VerificationResult } from './answer-verifier.js';
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
} from './execution-pipeline.js';

export interface ReviewableGenerateOutcome {
  status: 'completed' | 'failed' | 'awaiting_user';
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
  let outcome = input.outcome;
  if (outcome.status === 'completed' && outcome.summary) {
    const summary = sanitizeFinalText(outcome.summary);
    if (summary !== outcome.summary) outcome = { ...outcome, summary };
  }

  let verification: VerificationResult | null = null;
  if (outcome.status === 'completed') {
    const observedUrls = new Set<string>();
    for (const rawUrl of outcome.sourceUrls ?? []) {
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
      recordEvidence(input.taskId, {
        fact: `web_search_url=${url}`,
        sourceType: 'tool_result',
        sourceDetail: 'generate web_search provider result',
        confidence: 'observed',
      });
    }
    recordEvidence(input.taskId, {
      fact: `response_length=${outcome.summary.length}`,
      sourceType: 'tool_result',
      sourceDetail: input.evidenceSourceDetail ?? 'llm_generate_response',
      confidence: 'observed',
    });
    input.onVerifying?.();
    const verified = await verifyAndFinalize({
      taskId: input.taskId,
      answerText: outcome.summary,
      semanticAdapter: input.semanticAdapter,
      logger: input.logger,
    });
    if (verified.finalText !== outcome.summary) {
      outcome = { ...outcome, summary: verified.finalText };
    }
    verification = verified.verification;
  }

  const sourceTrust = assessResultTrust({
    intent: input.intent,
    resultText: outcome.status === 'completed' ? outcome.summary : '',
  });
  const terminalStatus = deriveFinalStatus(outcome.status, verification, sourceTrust);
  const failureSummary =
    terminalStatus === 'failed'
      ? verification
        ? summariseVerificationFailure(verification)
        : (sourceTrust.failedChecks[0]?.detail ?? null)
      : null;
  const failedChecks = [
    ...(verification && !verification.passed ? extractFailedChecks(verification) : []),
    ...(verification && !verification.passed ? [] : sourceTrust.failedChecks),
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
