/**
 * Phase 1 Day 5 — execution-pipeline glue layer.
 *
 * The single point of contact between the agent loop / runners
 * and the Phase 1 Day 1-4 modules (contract, ledger, verifier,
 * autoFix, llm-verifier). The four call points are:
 *
 *   initExecution(inputs)       — at task start, BEFORE dispatch
 *   recordEvidence(taskId, e)   — during execution, on every fact
 *   verifyAndFinalize(...)      — after the runner returns, BEFORE persist
 *   persistExecution(...)       — after the existing persist call,
 *                                 fire-and-forget
 *
 * Every entry point is a no-op when the relevant feature flag is
 * off — production behaviour is unchanged on a fresh deploy until
 * the operator flips a flag. See feature-flags.ts for the env
 * contract and the staged flip plan.
 *
 * Design notes:
 *   - Contracts and ledgers live in module-scope `Map<taskId,...>`
 *     registries. Same process == same map; tasks are pinned to
 *     a single PM2 instance so cross-instance coordination isn't
 *     needed.
 *   - `disposeExecution` is the bookkeeping primitive for cleaning
 *     up after a task. Call it once the task hits a terminal state
 *     so the maps don't leak across long-running processes.
 *   - The pipeline never throws — all infra failures resolve to
 *     "no-op pass" with a logged note. Phase 1 is advisory; the
 *     existing runner persistence remains the source of truth.
 *
 * Naming note: the original Phase 1 spec referred to
 * `runDeterministicVerifier` / `runLlmVerifier`; the actual
 * exports from `answer-verifier.ts` / `llm-verifier.ts` are
 * `verifyDeterministic` / `verifyWithLlm`. This module bridges
 * the spec language to the actual symbol names.
 */
import type Anthropic from '@anthropic-ai/sdk';
import type { Logger } from 'pino';
import { eq } from 'drizzle-orm';
import { tasks as tasksTable } from '../db/schema/tasks.js';
import type { DB } from '../db/client.js';

import type { CheckResult, VerificationResult } from './answer-verifier.js';
import { verifyDeterministic } from './answer-verifier.js';
import { autoFix } from './auto-fix.js';
import type {
  ContractInputs,
  ExecutionContract,
} from './execution-contract.js';
import { buildContract } from './execution-contract.js';
import {
  disposeLedger,
  EvidenceLedger,
  getLedger,
  getOrCreateLedger,
  type EvidenceEntry,
} from './evidence-ledger.js';
import { getFeatureFlags } from './feature-flags.js';
import {
  shouldRunLlmVerifier,
  verifyWithLlm,
  type AnthropicLikeClient,
} from './llm-verifier.js';

// ---------------------------------------------------------------------------
// Contract registry (module-scope)
// ---------------------------------------------------------------------------

const contracts = new Map<string, ExecutionContract>();

function setContract(taskId: string, contract: ExecutionContract): void {
  contracts.set(taskId, contract);
}

export function getContract(taskId: string): ExecutionContract | undefined {
  return contracts.get(taskId);
}

/**
 * Test-only: clear both registries. Pair with feature-flags reset
 * in the test setup hook.
 */
export function _resetExecutionPipelineForTest(): void {
  contracts.clear();
}

// ---------------------------------------------------------------------------
// Phase A: init at task start
// ---------------------------------------------------------------------------

export interface InitExecutionResult {
  contract: ExecutionContract | null;
  ledger: EvidenceLedger | null;
}

/**
 * Synchronous, sub-millisecond. Caller passes whatever it knows
 * about the task at dispatch time; the pipeline returns the
 * contract + ledger handles (both possibly null when flags are
 * off). Caller doesn't need to thread these — every later entry
 * point looks up by taskId.
 */
export function initExecution(inputs: ContractInputs): InitExecutionResult {
  const flags = getFeatureFlags();
  let ledger: EvidenceLedger | null = null;
  if (flags.EVIDENCE_LEDGER) {
    ledger = getOrCreateLedger(inputs.taskId);
    // Seed user_input fact so the verifier has something to work with
    // before any runner-side recordEvidence calls happen. Trim to
    // 500 chars; the ledger truncates internally too.
    if (inputs.intent) {
      ledger.add({
        fact: inputs.intent,
        sourceType: 'user_input',
        sourceDetail: 'tasks.create intent',
        confidence: 'observed',
      });
    }
  }
  let contract: ExecutionContract | null = null;
  if (flags.EXECUTION_CONTRACT) {
    contract = buildContract(inputs);
    setContract(inputs.taskId, contract);
  }
  return { contract, ledger };
}

// ---------------------------------------------------------------------------
// Phase B: record evidence during execution
// ---------------------------------------------------------------------------

/**
 * Add a fact to the ledger. No-op when flags are off or the
 * ledger was never inited (e.g. flag flipped on mid-task).
 *
 * Cheap by design — single map lookup, single push. Safe to call
 * from hot paths (every page navigation, every tool result).
 */
export function recordEvidence(
  taskId: string,
  entry: Omit<EvidenceEntry, 'id' | 'timestamp' | 'taskId'>,
): void {
  if (!getFeatureFlags().EVIDENCE_LEDGER) return;
  const ledger = getLedger(taskId);
  if (!ledger) return;
  ledger.add(entry);
}

// ---------------------------------------------------------------------------
// Phase C: verify + autoFix loop, called from runner termination
// ---------------------------------------------------------------------------

export interface VerifyInputs {
  taskId: string;
  /** The runner's final answer text. */
  answerText: string;
  /** Browser-mode tasks pass the last URL the agent reached. */
  finalUrl?: string;
  /**
   * Anthropic client for the LLM tier. When null, the LLM tier
   * is skipped entirely (still passes if deterministic passes).
   * Most runners already have a client — pass it through.
   */
  client?: AnthropicLikeClient | Anthropic | null;
  /** Optional logger for non-blocking warnings. */
  logger?: Logger;
}

export interface VerifyOutput {
  verification: VerificationResult | null;
  /** The text after autoFix if any was applied; otherwise the input. */
  finalText: string;
}

const NULL_OUTPUT = (text: string): VerifyOutput => ({
  verification: null,
  finalText: text,
});

export async function verifyAndFinalize(
  inputs: VerifyInputs,
): Promise<VerifyOutput> {
  const flags = getFeatureFlags();
  if (!flags.EXECUTION_VERIFIER) return NULL_OUTPUT(inputs.answerText);

  const contract = getContract(inputs.taskId);
  const ledger = getLedger(inputs.taskId);
  if (!contract || !ledger) return NULL_OUTPUT(inputs.answerText);

  // Layer 1 — deterministic.
  const det = verifyDeterministic({
    contract,
    ledger,
    answerText: inputs.answerText,
    ...(inputs.finalUrl ? { finalUrl: inputs.finalUrl } : {}),
  });

  if (!det.passed) {
    return runFixLoop(contract, ledger, det, inputs);
  }

  // Layer 2 — LLM (only when tier=full and deterministic passed).
  if (
    inputs.client &&
    shouldRunLlmVerifier(det, contract)
  ) {
    try {
      const llm = await verifyWithLlm({
        contract,
        ledger,
        answerText: inputs.answerText,
        ...(inputs.finalUrl ? { finalUrl: inputs.finalUrl } : {}),
        client: inputs.client as AnthropicLikeClient,
      });
      if (!llm.passed) {
        return runFixLoop(contract, ledger, llm, inputs);
      }
      return { verification: llm, finalText: inputs.answerText };
    } catch (err) {
      // Belt-and-suspenders — verifyWithLlm is supposed to never
      // throw, but if it does we still don't block the user.
      inputs.logger?.warn(
        { err: err instanceof Error ? err.message : String(err), taskId: inputs.taskId },
        'execution-pipeline: llm verifier threw — falling through to deterministic verdict',
      );
      return { verification: det, finalText: inputs.answerText };
    }
  }

  return { verification: det, finalText: inputs.answerText };
}

/**
 * autoFix dispatcher. Only `fixable` failures get a fix attempt;
 * the others propagate up untouched. After a fix, re-run the
 * deterministic verifier; if that's still failing, demote to
 * `needs_clarification`.
 */
function runFixLoop(
  contract: ExecutionContract,
  ledger: EvidenceLedger,
  initialVerification: VerificationResult,
  inputs: VerifyInputs,
): VerifyOutput {
  if (initialVerification.failureLevel !== 'fixable') {
    return { verification: initialVerification, finalText: inputs.answerText };
  }
  const fix = autoFix({
    contract,
    ledger,
    verification: initialVerification,
    answerText: inputs.answerText,
  });
  if (fix.applied.length === 0) {
    // Nothing to fix — keep the original verdict but demote so
    // the caller doesn't try forever.
    const demoted: VerificationResult = {
      ...initialVerification,
      failureLevel: 'needs_clarification',
    };
    return { verification: demoted, finalText: inputs.answerText };
  }
  // Re-run deterministic only — the LLM tier is expensive and
  // shouldn't be repeated (the autoFix changes the answer text
  // but doesn't change the contract or ledger that an LLM judgement
  // would be reading anyway).
  const recheck = verifyDeterministic({
    contract,
    ledger,
    answerText: fix.fixed,
    ...(inputs.finalUrl ? { finalUrl: inputs.finalUrl } : {}),
  });
  if (recheck.passed) {
    return {
      verification: {
        ...recheck,
        // Annotate that autoFix ran so the persisted record reflects
        // the chain of operations, even on a passing recheck.
        checks: [
          ...recheck.checks,
          ...fix.applied.map(
            (op): CheckResult => ({
              criterionId: `autoFix.${op.kind}`,
              passed: true,
              checker: 'deterministic',
              detail: op.detail,
            }),
          ),
        ],
      },
      finalText: fix.fixed,
    };
  }
  // Recheck still failing → demote to needs_clarification.
  return {
    verification: {
      ...recheck,
      failureLevel: 'needs_clarification',
    },
    finalText: inputs.answerText,
  };
}

// ---------------------------------------------------------------------------
// Phase D: persistence (fire-and-forget)
// ---------------------------------------------------------------------------

export interface PersistInputs {
  taskId: string;
  /**
   * The verification result returned by `verifyAndFinalize`.
   * `null` (or pipeline disabled) means write nothing.
   */
  verification: VerificationResult | null;
  db: DB;
  logger?: Logger;
}

/**
 * Write contract / ledger / verification snapshots to the `tasks`
 * row. Resolves to `true` on success, `false` on any failure
 * (caller doesn't need to await; failures are logged and dropped).
 *
 * Reads contract+ledger from the module registries, so callers
 * only need taskId + verification.
 */
export async function persistExecution(
  inputs: PersistInputs,
): Promise<boolean> {
  const flags = getFeatureFlags();
  // If none of the flags ever fired, there's nothing to persist.
  if (
    !flags.EXECUTION_CONTRACT &&
    !flags.EVIDENCE_LEDGER &&
    !flags.EXECUTION_VERIFIER
  ) {
    return false;
  }
  const contract = getContract(inputs.taskId);
  const ledger = getLedger(inputs.taskId);
  if (!contract && !ledger && !inputs.verification) {
    return false;
  }
  try {
    await inputs.db
      .update(tasksTable)
      .set({
        contractJson: contract ? (contract as unknown as Record<string, unknown>) : null,
        evidenceJson: ledger
          ? (ledger.toJSON() as unknown as Record<string, unknown>)
          : null,
        verificationJson: inputs.verification
          ? (inputs.verification as unknown as Record<string, unknown>)
          : null,
        verificationPassed: inputs.verification?.passed ?? null,
        failureLevel: inputs.verification?.failureLevel ?? null,
      })
      .where(eq(tasksTable.externalId, inputs.taskId));
    return true;
  } catch (err) {
    inputs.logger?.warn(
      { err: err instanceof Error ? err.message : String(err), taskId: inputs.taskId },
      'execution-pipeline: persist failed (non-blocking)',
    );
    return false;
  }
}

// ---------------------------------------------------------------------------
// Phase E: cleanup
// ---------------------------------------------------------------------------

/**
 * Drop the contract + ledger for a task. Call after the task
 * reaches a terminal state and persistExecution has run, so the
 * registries don't leak. Idempotent.
 */
export function disposeExecution(taskId: string): void {
  contracts.delete(taskId);
  disposeLedger(taskId);
}
