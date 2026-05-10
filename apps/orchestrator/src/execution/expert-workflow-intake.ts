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
 */
export function runIntake(
  workflow: ExpertWorkflowContract,
  text: string,
): IntakeResult {
  const parseResult = parseInputs(text, workflow);

  // 1. Required inputs missing → cannot proceed. Build the
  //    clarification question and surface as 'missing'.
  if (parseResult.missingRequired.length > 0 || parseResult.malformed.length > 0) {
    return {
      kind: 'missing',
      question: buildClarificationQuestion(workflow, parseResult),
      parseResult,
    };
  }

  // 2. Run every data validator.
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
