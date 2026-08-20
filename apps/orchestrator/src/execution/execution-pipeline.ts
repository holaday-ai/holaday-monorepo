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
import { and, eq, inArray } from 'drizzle-orm';
import { tasks as tasksTable } from '../db/schema/tasks.js';
import type { DB } from '../db/client.js';
import { readAffectedRows } from '../db/mysql-result.js';

import type { CheckResult, ParsedItem, VerificationResult } from './answer-verifier.js';
import { extractStructuredItems, verifyDeterministic } from './answer-verifier.js';
import type { OutputFileDescriptor } from './file-artifact-consistency.js';
import { autoFix } from './auto-fix.js';
import type {
  ContractInputs,
  ExecutionContract,
} from './execution-contract.js';
import {
  buildContract,
  classifyIntentForOutputRequirement,
  isResearchOrRetrievalIntent,
} from './execution-contract.js';
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

const EXECUTION_PERSIST_SOURCE_STATUSES = [
  'completed',
  'partial_success',
  'failed',
  'cancelled',
] as const;

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
  /**
   * Output files created during this task (task_files, kind='output',
   * non-expired). Feeds the file-artifact consistency check: a download
   * claim with no fence AND no matching DOCUMENT output (the
   * auto-screenshot doesn't count) is flagged fixable. Omit when the
   * lane can't create files (generate / scrape).
   */
  outputFiles?: ReadonlyArray<OutputFileDescriptor>;
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
 *   verification null OR passed + no source gap → keep input status
 *   completed research with no clickable source → 'partial_success'
 *   passed=false, failureLevel='hard_fail'      → 'failed'
 *   passed=false, failureLevel='fixable'        → 'partial_success'
 *   passed=false, failureLevel='needs_clarification'
 *                                                → 'partial_success'
 *                  (intake gate should have caught this earlier; if
 *                   we reach here with a summary, treat as partial)
 *
 * Returns the original status when input wasn't 'completed' — neither
 * the verifier nor the source guard escalates a failed task, and the
 * intermediate 'awaiting_user' status is the runner's call alone.
 */
export type FinalTerminalStatus =
  | 'completed'
  | 'failed'
  | 'partial_success'
  | 'awaiting_user'
  | 'cancelled'
  | 'paused';

export interface ResearchSourceTrustReview {
  requiresReview: boolean;
  /** True when the output is unusable, rather than useful-but-unverified. */
  blocking: boolean;
  failedChecks: Array<{ type: string; detail: string }>;
}

export function assessResearchSourceTrust(input: {
  intent?: string;
  resultText?: string;
  currentUrl?: string | null;
}): ResearchSourceTrustReview {
  const hasClickableSource = [input.resultText ?? '', input.currentUrl ?? ''].some(
    (value) => /https?:\/\/[^\s,;'")\]>]+/i.test(value),
  );
  if (
    !input.resultText?.trim() ||
    !isResearchOrRetrievalIntent(input.intent ?? '') ||
    hasClickableSource
  ) {
    return { requiresReview: false, blocking: false, failedChecks: [] };
  }
  return {
    requiresReview: true,
    blocking: false,
    failedChecks: [
      {
        type: 'source_count',
        detail: '研究或检索结果缺少可点击来源，关键事实未验证',
      },
    ],
  };
}

/**
 * Always-on minimum trust gate for result types where an unverified
 * answer is worse than no answer. This deliberately does not depend on
 * the staged execution-verifier flags: stock quotes and ecommerce
 * rankings must never become "completed" merely because the rollout
 * flag is off.
 */
export function assessResultTrust(input: {
  intent?: string;
  resultText?: string;
  currentUrl?: string | null;
}): ResearchSourceTrustReview {
  const intent = input.intent?.trim() ?? '';
  const resultText = input.resultText?.trim() ?? '';
  if (!intent || !resultText) {
    return { requiresReview: false, blocking: false, failedChecks: [] };
  }

  const { kind, requirement } = classifyIntentForOutputRequirement(intent);
  const failedChecks: Array<{ type: string; detail: string }> = [];
  const hasClickableSource = [resultText, input.currentUrl ?? ''].some((value) =>
    /https?:\/\/[^\s,;'\")\]>]+/i.test(value),
  );

  if (kind === 'stock_quote') {
    const hasPrice =
      /(?:当前|最新|实时|收盘)?\s*(?:股价|价格|现价|最新价)[^\d\n]{0,16}(?:RMB\s*)?[¥$]?\s*\d+(?:\.\d+)?/iu.test(
        resultText,
      );
    const hasTimestamp =
      /(?:更新(?:时间)?|数据时间|时间|截至)[^\n。]{0,36}(?:\d{4}[-/.年]\d{1,2}[-/.月]\d{1,2}|\d{1,2}:\d{2}|今天|今日)/u.test(
        resultText,
      );
    if (!hasClickableSource) {
      failedChecks.push({
        type: 'source_count',
        detail: '实时股价缺少可点击行情来源，无法核对当前价格',
      });
    }
    if (!hasPrice) {
      failedChecks.push({
        type: 'stock_price',
        detail: '回复没有可识别的当前股价字段',
      });
    }
    if (!hasTimestamp) {
      failedChecks.push({
        type: 'stock_timestamp',
        detail: '回复没有明确的数据日期或更新时间，无法判断是否为最新行情',
      });
    }
    const hasClosedState = /(?:已(?:经)?|今日|当前)?\s*(?:收盘|休市|闭市)/u.test(resultText);
    const hasNotOpenedState = /(?:尚未|还未|未)\s*(?:开盘|开市)/u.test(resultText);
    const weekdayMismatch = findDateWeekdayMismatch(resultText);
    if (hasClosedState && hasNotOpenedState) {
      failedChecks.push({
        type: 'temporal_consistency',
        detail: '同一条行情同时声称市场已收盘和尚未开盘，时间状态相互矛盾',
      });
    }
    if (weekdayMismatch) {
      failedChecks.push({
        type: 'temporal_consistency',
        detail: weekdayMismatch,
      });
    }
  } else if (kind === 'ecommerce_listing' && requirement?.kind === 'ecommerce') {
    const rows = extractStructuredItems(resultText);
    const completeRows = rows.filter(
      (row) => Boolean(row.name) && row.price != null && Boolean(row.url),
    );
    const uniqueUrls = new Set(completeRows.map((row) => row.url));
    if (
      completeRows.length < requirement.minItems ||
      uniqueUrls.size < requirement.minItems
    ) {
      failedChecks.push({
        type: 'ecommerce_rows',
        detail: `可核验商品只有 ${completeRows.length} 条、独立链接 ${uniqueUrls.size} 个，要求至少 ${requirement.minItems} 条名称/价格/商品链接完整的结果`,
      });
    }
  }

  if (failedChecks.length > 0) {
    return { requiresReview: true, blocking: true, failedChecks };
  }
  return assessResearchSourceTrust(input);
}

function findDateWeekdayMismatch(text: string): string | null {
  const match = text.match(
    /(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})日?\s*(?:\(|（)?(?:星期|周)?([一二三四五六日天])/u,
  );
  if (!match) return null;
  const [, yearRaw, monthRaw, dayRaw, weekdayRaw] = match;
  const year = Number(yearRaw);
  const month = Number(monthRaw);
  const day = Number(dayRaw);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    !Number.isFinite(date.getTime()) ||
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return '回复中的行情日期无效';
  }
  const expected = '日一二三四五六'[date.getUTCDay()];
  const actual = weekdayRaw === '天' ? '日' : weekdayRaw;
  if (expected === actual) return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')} 的星期标注不一致`;
}

export function deriveFinalStatus(
  runnerStatus: string,
  verification: VerificationResult | null,
  sourceTrust?: ResearchSourceTrustReview,
): FinalTerminalStatus {
  // Coerce to the typed alphabet; any unrecognised status falls
  // through unchanged (the runner is the source of truth for those).
  const original = runnerStatus as FinalTerminalStatus;
  if (runnerStatus !== 'completed') return original;
  if (verification && !verification.passed) {
    const failedVerificationChecks = verification.checks.filter((check) => !check.passed);
    const hasOnlyNonBlockingSourceFailures =
      sourceTrust?.requiresReview === true &&
      sourceTrust.blocking === false &&
      failedVerificationChecks.length > 0 &&
      failedVerificationChecks.every((check) => check.criterionType === 'url_count');
    if (hasOnlyNonBlockingSourceFailures) return 'partial_success';

    const hasCriticalStructuralFailure = verification.checks.some(
      (check) =>
        !check.passed &&
        ['url_count', 'ecommerce_rows', 'result_count'].includes(
          check.criterionType ?? '',
        ),
    );
    if (
      verification.failureLevel === 'hard_fail' ||
      verification.failureLevel === 'needs_clarification' ||
      hasCriticalStructuralFailure
    ) {
      return 'failed';
    }
    return 'partial_success';
  }
  if (sourceTrust?.requiresReview) {
    return sourceTrust.blocking ? 'failed' : 'partial_success';
  }
  return original;
}

/**
 * Codex Round 2 P1-5 — post-formatter lightweight recheck.
 *
 * The response-layer formatter runs AFTER the verifier verdict and
 * BEFORE persist; in rare cases it can drop URLs or merge items
 * (the OpenAI post-check usually catches this and falls back to the
 * original, but the safety net there is itself opt-in). This helper
 * compares structured-item + URL counts before/after format and
 * reports a downgrade signal when either count regressed.
 *
 * Zero-cost no-op when the formatter didn't change the text (same
 * reference). Re-uses `extractStructuredItems` so the comparison
 * uses the same parser as the original verifier.
 */
export function recheckPostFormat(
  before: string,
  after: string,
): { downgrade: boolean; reason: string | null } {
  if (before === after) return { downgrade: false, reason: null };
  const itemsBefore = extractStructuredItems(before);
  const itemsAfter = extractStructuredItems(after);
  const urlsBefore = countUrls(before, itemsBefore);
  const urlsAfter = countUrls(after, itemsAfter);
  const reasons: string[] = [];
  if (itemsAfter.length < itemsBefore.length) {
    reasons.push(`结构化结果数减少：${itemsBefore.length} → ${itemsAfter.length}`);
  }
  if (urlsAfter < urlsBefore) {
    reasons.push(`链接数减少：${urlsBefore} → ${urlsAfter}`);
  }
  if (reasons.length === 0) return { downgrade: false, reason: null };
  return { downgrade: true, reason: reasons.join('；') };
}

function countUrls(text: string, items: ParsedItem[]): number {
  // Mirror checkUrlCount's strategy: prefer parsed-item URLs; fall
  // back to global URL scan when no items are present (e.g. stock
  // quote prose).
  if (items.length > 0) {
    return items.filter((it) => Boolean(it.url)).length;
  }
  return (text.match(/https?:\/\/[^\s,;'")\]>]+/g) ?? []).length;
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
    ...(inputs.outputFiles ? { outputFiles: inputs.outputFiles } : {}),
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
    return {
      verification: initialVerification,
      finalText: buildSafeVerificationBoundary(initialVerification, inputs.answerText),
    };
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
    return {
      verification: demoted,
      finalText: buildSafeVerificationBoundary(demoted, inputs.answerText),
    };
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

function buildSafeVerificationBoundary(
  verification: VerificationResult,
  answerText: string,
): string {
  const failed = verification.checks.find((check) => !check.passed);
  const reason = failed?.detail ?? verification.suggestedFix ?? '关键条件尚未验证';
  const failedChecks = verification.checks.filter((check) => !check.passed);
  const canPreserveDraft =
    verification.failureLevel === 'needs_clarification' &&
    failedChecks.every(
      (check) => !check.criterionType && check.severity !== 'hard_fail',
    );
  const parts = [
    '未能给出可验证的结果，本次不会把未通过校验的内容作为结论。',
    '',
    `原因：${reason}`,
    '',
    '请补充必要信息、更换可访问来源，或调整条件后重试。',
  ];
  if (canPreserveDraft && answerText.trim()) {
    parts.push(
      '',
      '已保留的中间结果（仅供继续处理，不应直接作为最终事实或决策依据）：',
      answerText.trim(),
    );
  }
  return parts.join('\n');
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
    const result = await inputs.db
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
      .where(
        and(
          eq(tasksTable.externalId, inputs.taskId),
          inArray(tasksTable.status, [...EXECUTION_PERSIST_SOURCE_STATUSES]),
        ),
      );
    return readAffectedRows(result) > 0;
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
