/**
 * Phase 2 Day 2 — Expert Workflow intake gate.
 *
 * Wraps parser + validators into a single decision function.
 * Caller (generate-runner) gets one of three outcomes:
 *
 *   { kind: 'missing'      }  → required inputs missing → ask user
 *   { kind: 'contradiction' } → validators failed → ask user to confirm
 *   { kind: 'ready'        }  → all data + arithmetic ok → run report
 *
 * Pure function. No I/O, no LLM. Runs in <1ms — cheap to invoke
 * on every reply turn so incremental data fill-in works.
 */
import {
  buildClarificationQuestion,
  parseInputs,
} from './expert-workflow-parser.js';
import type {
  ExpertWorkflowContract,
  ParseInputsResult,
  ValidationResult,
} from './expert-workflow-contract.js';

export interface IntakeMissing {
  kind: 'missing';
  /**
   * Human-readable Markdown question — ready to render via
   * ReactMarkdown. Lists every missing required field with its
   * label + unit hint.
   */
  question: string;
  /** The parser's structured output (for diagnostics / logging). */
  parseResult: ParseInputsResult;
}

export interface IntakeContradiction {
  kind: 'contradiction';
  /**
   * Composite message: every validator failure's `message`,
   * followed by every `suggestedFix`. Markdown-friendly.
   */
  question: string;
  parseResult: ParseInputsResult;
  /**
   * Per-validator results. Caller can persist as evidence /
   * surface in the failure record.
   */
  validatorResults: readonly NamedValidatorResult[];
}

export interface IntakeReady {
  kind: 'ready';
  parseResult: ParseInputsResult;
  validatorResults: readonly NamedValidatorResult[];
}

export type IntakeResult = IntakeMissing | IntakeContradiction | IntakeReady;

export interface NamedValidatorResult extends ValidationResult {
  validatorId: string;
  description: string;
}

/**
 * Entrypoint. Parses → checks missing → runs validators → returns
 * a decision. Side-effect-free.
 *
 * `text` is the combined intent (original task intent + any user
 * replies merged in). Caller is responsible for combining; this
 * module just parses whatever text it gets.
 *
 * Validators ALWAYS run, even when some required inputs are
 * missing. A validator that lacks its inputs vacuous-passes
 * (per the contract); validators that have enough data still
 * flag arithmetic conflicts. The result lets the missing-field
 * clarification ALSO surface "by the way, the 转化率 and 客单价
 * you gave don't match" in the same turn — saves a round-trip
 * vs. the user filling in the missing field, then being told
 * the rest is wrong.
 */
export function runIntake(
  workflow: ExpertWorkflowContract,
  text: string,
): IntakeResult {
  const parseResult = parseInputs(text, workflow);

  // Always run validators — vacuous-pass on missing inputs is a
  // contract on the validator side, so we get useful early signal
  // on validator failures even when the "missing" path will park.
  const validatorResults: NamedValidatorResult[] = workflow.dataValidators.map(
    (v) => {
      const result = v.check(parseResult.extracted);
      return {
        validatorId: v.id,
        description: v.description,
        passed: result.passed,
        ...(result.message ? { message: result.message } : {}),
        ...(result.suggestedFix ? { suggestedFix: result.suggestedFix } : {}),
      };
    },
  );
  const failed = validatorResults.filter((r) => !r.passed);

  // 1. Required inputs missing → park. If validators ALSO caught
  //    something, prepend their flags to the clarification so the
  //    user fixes everything at once.
  if (parseResult.missingRequired.length > 0 || parseResult.malformed.length > 0) {
    const baseQuestion = buildClarificationQuestion(workflow, parseResult);
    const question =
      failed.length > 0
        ? combineQuestions(workflow, failed, baseQuestion)
        : baseQuestion;
    return {
      kind: 'missing',
      question,
      parseResult,
      // Surface the validator results too — caller may want them
      // for logging or evidence. Only the additional `validatorResults`
      // field; the discriminated-union `kind` is unchanged.
      validatorResults,
    } as IntakeMissing & { validatorResults: readonly NamedValidatorResult[] };
  }

  // 2. All required present + validator failure → contradiction.
  if (failed.length > 0) {
    return {
      kind: 'contradiction',
      question: buildContradictionQuestion(workflow, failed),
      parseResult,
      validatorResults,
    };
  }

  return {
    kind: 'ready',
    parseResult,
    validatorResults,
  };
}

/**
 * Build a combined question that surfaces both validator
 * failures (校验/矛盾 framing) and missing-field prompts in
 * the same message, so the user can fix everything in one
 * reply turn.
 */
function combineQuestions(
  workflow: ExpertWorkflowContract,
  failed: readonly NamedValidatorResult[],
  baseQuestion: string,
): string {
  const lines: string[] = [];
  lines.push(`「${workflow.name}」数据校验提示：`);
  lines.push('');
  for (const f of failed) {
    if (f.message) lines.push(`⚠️ ${f.message}`);
    if (f.suggestedFix) lines.push(`💡 ${f.suggestedFix}`);
    lines.push('');
  }
  lines.push('---');
  lines.push('');
  lines.push(baseQuestion);
  return lines.join('\n').trim();
}

/**
 * Compose the user-facing message for a contradiction park. Lists
 * every failed validator's message + suggested fix, headed by a
 * "数据校验未通过" notice.
 */
function buildContradictionQuestion(
  workflow: ExpertWorkflowContract,
  failed: readonly NamedValidatorResult[],
): string {
  const lines: string[] = [];
  lines.push(`「${workflow.name}」数据校验未通过：`);
  lines.push('');
  for (const f of failed) {
    if (f.message) lines.push(`⚠️ ${f.message}`);
    if (f.suggestedFix) lines.push(`💡 ${f.suggestedFix}`);
    lines.push('');
  }
  lines.push('请确认数据后我再继续生成复盘报告。');
  return lines.join('\n').trim();
}
