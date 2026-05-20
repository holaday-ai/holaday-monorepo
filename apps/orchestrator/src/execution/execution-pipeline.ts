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
import { getExpertWorkflowById } from './expert-workflow-registry.js';

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

/**
 * Codex Pack A3 — turn a verifier verdict into the runner's terminal
 * status. The runner's own `outcome.status` ('completed' / 'failed' /
 * 'awaiting_user') is taken as the input; verifier verdict overrides
 * a 'completed' that didn't actually clear the structural checks:
 *
 *   verification null OR passed                 → keep input status
 *   passed=false, failureLevel='hard_fail'      → 'failed'
 *   passed=false, failureLevel='fixable'        → 'partial_success'
 *   passed=false, failureLevel='needs_clarification'
 *                                                → 'partial_success'
 *                  (intake gate should have caught this earlier; if
 *                   we reach here with a summary, treat as partial)
 *
 * Returns the original status when input wasn't 'completed' — the
 * verifier never escalates a failed task and the intermediate
 * 'awaiting_user' status is the runner's call alone.
 */
export type FinalTerminalStatus =
  | 'completed'
  | 'failed'
  | 'partial_success'
  | 'awaiting_user'
  | 'cancelled'
  | 'paused';

export function deriveFinalStatus(
  runnerStatus: string,
  verification: VerificationResult | null,
): FinalTerminalStatus {
  // Coerce to the typed alphabet; any unrecognised status falls
  // through unchanged (the runner is the source of truth for those).
  const original = runnerStatus as FinalTerminalStatus;
  if (!verification || verification.passed) return original;
  if (runnerStatus !== 'completed') return original;
  if (verification.failureLevel === 'hard_fail') return 'failed';
  // 'fixable' AND 'needs_clarification' both map to partial_success
  // when the runner already produced a usable summary. The
  // alternative ('awaiting_user' for needs_clarification) would
  // re-open a task the user already closed; that's worse UX.
  return 'partial_success';
}

/**
 * Codex Round 2 P1-6 — extract a structured list of failed checks
 * for the terminal WS broadcast. Each entry carries the criterion's
 * machine-readable type (so the SPA's banner can pick a localised
 * label) and the raw detail string (for row-level extras like
 * "第 3 行缺少商品链接"). Returns empty when nothing failed.
 *
 * `criterionType` is set by the structural checkers (url_count /
 * result_count / price_sort / ecommerce_rows). The pre-Pack-A
 * generic checks use `criterionId === 'generic.<name>'`; we strip
 * the prefix into a synthetic type so the SPA dispatch is uniform.
 */
export function extractFailedChecks(
  verification: VerificationResult,
): Array<{ type: string; detail: string }> {
  return verification.checks
    .filter((c) => !c.passed)
    .map((c) => {
      const explicit = c.criterionType;
      if (explicit) return { type: explicit, detail: c.detail };
      // Fall back to the generic.<name> id form so the SPA still
      // gets a recognisable token.
      if (c.criterionId.startsWith('generic.')) {
        return { type: c.criterionId, detail: c.detail };
      }
      return { type: 'unknown', detail: c.detail };
    });
}

/**
 * Codex Pack A3 — synthesise a short Chinese failure reason from the
 * verifier's check list. Picks the first failing check with a
 * `severity` hint, falling back to the suggested-fix string.
 */
export function summariseVerificationFailure(
  verification: VerificationResult,
): string {
  const failed = verification.checks.find((c) => !c.passed && c.severity);
  if (failed) return `质量校验未通过：${failed.detail}`;
  const generic = verification.checks.find((c) => !c.passed);
  if (generic) return `质量校验未通过：${generic.detail}`;
  if (verification.suggestedFix) return verification.suggestedFix.split('\n')[0]!;
  return '质量校验未通过';
}

export async function verifyAndFinalize(
  inputs: VerifyInputs,
): Promise<VerifyOutput> {
  const flags = getFeatureFlags();
  if (!flags.EXECUTION_VERIFIER) return NULL_OUTPUT(inputs.answerText);

  const contract = getContract(inputs.taskId);
  const ledger = getLedger(inputs.taskId);
  if (!contract || !ledger) return NULL_OUTPUT(inputs.answerText);

  // Phase 2 Day 4 — resolve typed expert workflow contract for the
  // verifier's section_presence + source_annotation checks. Only
  // hits the registry when the contract was built from a workflow;
  // null on every other tier so the new checks no-op for them.
  const workflowContract = contract.expertWorkflowId
    ? getExpertWorkflowById(contract.expertWorkflowId)
    : null;

  // Layer 1 — deterministic.
  const det = verifyDeterministic({
    contract,
    ledger,
    answerText: inputs.answerText,
    ...(inputs.finalUrl ? { finalUrl: inputs.finalUrl } : {}),
    ...(workflowContract ? { workflowContract } : {}),
  });

  if (!det.passed) {
    // Optimization #2b (Codex P2) — VerifierFallback second-opinion
    // BEFORE we commit to runFixLoop. OpenAI may upgrade the
    // severity from 'fixable' to 'needs_clarification' if it sees
    // a concrete fabrication risk the autoFix path can't handle.
    // shouldTrigger gates internally; if no trigger / flag off /
    // OpenAI unreachable, the original det verdict is preserved.
    const augmented = await maybeApplyVerifierFallback(
      det,
      inputs,
      contract.goal,
    );
    return runFixLoop(contract, ledger, augmented, inputs, workflowContract);
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
        return runFixLoop(contract, ledger, llm, inputs, workflowContract);
      }
      // Optimization #2b (Codex P2) — VerifierFallback second-opinion
      // on Haiku's "passed but with reservations" verdict. If
      // OpenAI disagrees, it downgrades to passed=false +
      // needs_clarification → runFixLoop. Otherwise the LLM verdict
      // ships unchanged.
      const augmented = await maybeApplyVerifierFallback(
        llm,
        inputs,
        contract.goal,
      );
      if (!augmented.passed) {
        return runFixLoop(contract, ledger, augmented, inputs, workflowContract);
      }
      return { verification: augmented, finalText: inputs.answerText };
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
 * Optimization #2b — second-opinion via VerifierFallback. Inline
 * flag gate avoids loading the module + its `openai` dep on every
 * verification when the feature is off (production default).
 * Never throws: any infra failure returns the original verdict.
 */
async function maybeApplyVerifierFallback(
  verification: VerificationResult,
  inputs: VerifyInputs,
  contractGoal: string,
): Promise<VerificationResult> {
  const flag = (process.env.OPENAI_VERIFIER_FALLBACK_ENABLED ?? 'false').toLowerCase();
  if (flag !== 'true' && flag !== '1') return verification;
  if (!process.env.OPENAI_API_KEY) return verification;
  try {
    const { verifyFallback } = await import(
      '../response-layer/openai-verifier-fallback.js'
    );
    const fb = await verifyFallback(
      {
        original: verification,
        answerText: inputs.answerText,
        contractGoal,
        ...(inputs.finalUrl ? { finalUrl: inputs.finalUrl } : {}),
      },
      { logger: inputs.logger ?? makeNoopLogger() },
    );
    return fb.verification;
  } catch (err) {
    inputs.logger?.warn(
      {
        err: err instanceof Error ? err.message : String(err),
        taskId: inputs.taskId,
      },
      'execution-pipeline: verifier-fallback threw — keeping original verdict',
    );
    return verification;
  }
}

/**
 * Cheap stub for callers that didn't pass a logger. Keeps the
 * fallback module's `deps.logger.warn(...)` happy without forcing
 * every verify caller to thread pino through.
 */
function makeNoopLogger(): Logger {
  const noop = () => undefined;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return {
    info: noop,
    warn: noop,
    error: noop,
    debug: noop,
    trace: noop,
    fatal: noop,
    level: 'silent',
    silent: noop,
    child: () => makeNoopLogger(),
  } as any;
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
  workflowContract: import('./expert-workflow-contract.js').ExpertWorkflowContract | null,
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
    ...(workflowContract ? { workflowContract } : {}),
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
  // Codex Round 2 P0-1 — recheck still failing → return the
  // SANITISED text (`fix.fixed`), not the original. autoFix has
  // already stripped the fabricated URLs / placeholders; returning
  // `inputs.answerText` would re-introduce them on the persisted
  // result + the user-visible card. Verdict drops to
  // `partial_success` via the deriveFinalStatus mapping of
  // `fixable` rather than escalating to `needs_clarification` —
  // the answer is genuinely partial (urls removed) and we want the
  // SPA's yellow banner to show, not a re-opened awaiting card.
  return {
    verification: {
      ...recheck,
      failureLevel: 'fixable',
    },
    finalText: fix.fixed,
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
