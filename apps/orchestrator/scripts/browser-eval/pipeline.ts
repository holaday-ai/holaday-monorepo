/**
 * FIX-BATCH-A — production result pipeline for browser eval runs.
 *
 * `runUnifiedBrowserLoop` alone stops at the model's finish(). The answer the
 * user sees has also gone through the execution contract, the evidence
 * ledger, the deterministic verifier + auto-fix and `deriveFinalStatus` (see
 * the supercar branch of `tasks.create`). This module replays that sequence
 * around the production unified runner so an eval run scores the delivered
 * text and terminal status, not the raw model summary.
 */
import { runUnifiedSupercarTask } from '../../src/agent/browser-tools/unified-supercar-runner.js';
import type { WebSearchHit } from '../../src/agent/browser-tools/unified-browser-loop.js';
import type { PlaywrightExecutor } from '../../src/agent/vision-loop/playwright-executor.js';
import {
  type FinalTerminalStatus,
  assessResultTrust,
  deriveFinalStatus,
  disposeExecution,
  finalizeAnswerForPersistence,
  initExecution,
  recordEvidence,
  summariseVerificationFailure,
  verifyAndFinalize,
} from '../../src/execution/execution-pipeline.js';
import type { MessagesAdapter } from '../../src/llm/messages-adapter.js';

export interface PipelineRunResult {
  /** Terminal status the user would see (after verification). */
  status: FinalTerminalStatus | 'timeout';
  /** Runner status before verification. */
  runnerStatus: string;
  rawSummary: string;
  deliveredText: string;
  verificationPassed: boolean | null;
  failedChecks: Array<{ type: string; detail: string }>;
  failureSummary: string | null;
  finalUrl: string;
  steps: number;
  handoff: string | null;
}

export async function runPipelineTask(input: {
  taskId: string;
  intent: string;
  executor: PlaywrightExecutor;
  adapter: MessagesAdapter;
  webSearch?: (query: string) => Promise<WebSearchHit[]>;
  maxSteps: number;
  timeoutMs: number;
  onStep?: (step: { kind: string; summary: string; ok: boolean; message?: string }) => void;
}): Promise<PipelineRunResult> {
  initExecution({ taskId: input.taskId, intent: input.intent, executionMode: 'browser' });
  let handoff: string | null = null;
  try {
    let outcome = await runUnifiedSupercarTask({
      taskId: input.taskId,
      intent: input.intent,
      executor: input.executor,
      messagesAdapter: input.adapter,
      ...(input.webSearch ? { unifiedWebSearch: input.webSearch } : {}),
      maxIterations: input.maxSteps,
      timeoutMs: input.timeoutMs,
      // No human in the eval: a handoff is the scored outcome.
      isTaskCancelled: () => handoff !== null,
      onAwaitingUser: (event) => {
        handoff = event.question;
      },
      onEvidence: (event) => recordEvidence(input.taskId, event),
      onTick: (tick) => {
        if (tick.execution)
          input.onStep?.({
            kind: tick.execution.actionKind,
            summary: tick.execution.actionSummary,
            ok: tick.execution.ok,
            ...(tick.execution.message ? { message: tick.execution.message } : {}),
          });
      },
    });
    const page = await input.executor.getPage().catch(() => null);
    const finalUrl = page?.url() ?? '';
    const rawSummary = outcome.summary ?? '';
    let verification: Awaited<ReturnType<typeof verifyAndFinalize>>['verification'] = null;
    // Same order as tasks.create: terminal evidence → verify → persistence gate.
    if (outcome.status === 'completed' && outcome.summary) {
      if (finalUrl)
        recordEvidence(input.taskId, {
          fact: `final_url=${finalUrl}`,
          sourceType: 'browser_state',
          sourceDetail: 'supercar terminal state',
          confidence: 'observed',
        });
      recordEvidence(input.taskId, {
        fact: `response_length=${outcome.summary.length}`,
        sourceType: 'tool_result',
        sourceDetail: 'supercar agent response',
        confidence: 'observed',
      });
      const verified = await verifyAndFinalize({
        taskId: input.taskId,
        answerText: outcome.summary,
        ...(finalUrl ? { finalUrl } : {}),
      });
      verification = verified.verification;
      const finalVerified = await finalizeAnswerForPersistence({
        taskId: input.taskId,
        answerText: verified.finalText,
        priorVerification: verification,
        ...(finalUrl ? { finalUrl } : {}),
      });
      verification = finalVerified.verification;
      outcome = { ...outcome, summary: finalVerified.finalText };
    }
    const trust = assessResultTrust({
      intent: input.intent,
      resultText: outcome.status === 'completed' ? (outcome.summary ?? '') : '',
      currentUrl: finalUrl,
    });
    const status =
      handoff !== null
        ? 'awaiting_user'
        : outcome.status === 'timeout'
          ? 'timeout'
          : deriveFinalStatus(outcome.status, verification, trust);
    const failedChecks = [
      ...(verification && !verification.passed
        ? verification.checks
            .filter((check) => !check.passed)
            .map((check) => ({
              type: check.criterionType ?? check.criterionId,
              detail: check.detail,
            }))
        : []),
      ...(verification && !verification.passed ? [] : trust.failedChecks),
    ];
    return {
      status,
      runnerStatus: outcome.status,
      rawSummary,
      deliveredText: outcome.status === 'completed' ? (outcome.summary ?? '') : '',
      verificationPassed: verification ? verification.passed : null,
      failedChecks,
      failureSummary:
        status === 'failed'
          ? verification
            ? summariseVerificationFailure(verification)
            : (trust.failedChecks[0]?.detail ?? outcome.reason ?? null)
          : null,
      finalUrl,
      steps: outcome.iterations,
      handoff,
    };
  } finally {
    disposeExecution(input.taskId);
  }
}
