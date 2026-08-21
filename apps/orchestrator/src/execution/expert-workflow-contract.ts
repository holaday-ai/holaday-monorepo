/**
 * Phase 2 Day 1 — Expert Workflow Framework: type definitions.
 *
 * Phase 1 introduced a loose `expertWorkflowId` flag on ExecutionContract
 * that flipped the tier to 'full'. The system that ACTUALLY drove
 * douyin-review intake (`apps/orchestrator/src/agent/supercar/
 * expert-workflows.ts`) was text-prompt only — it told the model "ask
 * the user for missing inputs", then trusted the model to extract +
 * cross-check arithmetic in the prompt. Result: brittle (BOSS observed
 * the model parking after one reply because of contradiction #1, but
 * not surfacing #2/#3, etc.).
 *
 * Phase 2 makes the workflow *typed*:
 *
 *   1. WorkflowInput — declarative field list. Each field has a
 *      regex `extractPattern` so we can DETERMINISTICALLY pull
 *      values from the user's text (or attached file content).
 *   2. DataValidator — pure function that checks arithmetic /
 *      structural constraints across extracted inputs.
 *      Failure → needs_clarification with a precise message.
 *   3. ReportSection — required / optional sections the verifier
 *      must see in the model's output. Some sections require
 *      source-annotation markers ([用户提供] / [系统计算] /
 *      [模型假设] / [外部来源]).
 *   4. FollowUpAction — labelled prompts the SPA renders as chips
 *      under the report ("生成下场直播 SOP", etc.).
 *   5. ExpertWorkflowContract — the bundle of all four for one
 *      workflow ('douyin-review' / 'content-topic' / 'ecom-daily').
 *
 * This file is types-only. Pure data, no runtime imports. The runtime
 * lives in:
 *   - `expert-workflow-parser.ts` — input extraction
 *   - `expert-workflow-douyin.ts` — the first workflow definition
 *   - (Day 2+) intake handler in tasks.ts / generate-runner.ts
 *   - (Day 4) section-aware verifier extension
 */

/**
 * One declarative field of a workflow's input schema. Required
 * inputs whose `extractPattern` doesn't match the user's text
 * trigger an awaiting_user park with a structured "please provide
 * the following" question.
 */
export interface WorkflowInput {
  /** Stable id used in extracted record + validator dispatch. */
  name: string;
  /** Human-facing field name shown in clarification prompts. */
  label: string;
  /**
   * Coercion target. The parser converts the regex capture
   * group #1 to this type:
   *   number — strip thousand-separators, parse Number()
   *   text   — verbatim string, trimmed
   *   enum   — string, must be one of `enumValues`
   *   file   — Phase 2b — attachment id
   *   date   — Phase 2c — ISO 8601 string
   */
  type: 'number' | 'text' | 'enum' | 'file' | 'date';
  /** Required when `type === 'enum'`. */
  enumValues?: readonly string[];
  /**
   * Regex with at least ONE capture group. Group 1 = the value.
   * Case-insensitive recommended ('i' flag) so users can write
   * "GMV: 100000" or "gmv 100000" interchangeably. Anchor with
   * key terms ("GMV[：:]\s*", etc.) so a number floating in a
   * sentence doesn't get mis-attributed.
   */
  extractPattern?: RegExp;
  /** Display unit for clarification prompts ("元", "%", "次"). */
  unit?: string;
  /**
   * Optional default applied when parser doesn't find the field
   * AND the field is in `optionalInputs`. Lets workflow authors
   * fill in safe assumptions (e.g. duration=2 hours) without
   * blocking on it.
   */
  fallback?: string | number;
}

/**
 * Outcome of a single DataValidator check.
 *
 * `passed: true`  — no issue. `message` may still carry an info note.
 * `passed: false` — the workflow must NOT generate the report yet.
 *                   Caller surfaces `message` to the user verbatim
 *                   plus `suggestedFix` as the proposed clarification
 *                   question.
 */
export interface ValidationResult {
  passed: boolean;
  message?: string;
  suggestedFix?: string;
}

/**
 * One arithmetic / structural check. Pure function — no I/O.
 * Receives the parser's extracted input map (keyed by
 * `WorkflowInput.name`); returns a verdict.
 *
 * Convention: a validator that lacks its required inputs returns
 * `{passed: true}` (passes vacuously). The MISSING-input flow is
 * the parser's job, not the validator's.
 */
export interface DataValidator {
  id: string;
  description: string;
  check: (extracted: Readonly<Record<string, unknown>>) => ValidationResult;
}

/**
 * A required slot in the final report. The verifier (Day 4) looks
 * for the section's title or id in the model's output and flags
 * a missing required section as failure.
 *
 * `sourceAnnotation: true` — the section's content must include
 * source markers. Verifier scans for them.
 */
export interface ReportSection {
  id: string;
  title: string;
  required: boolean;
  sourceAnnotation: boolean;
  /**
   * Optional one-line guidance shown in the model's prompt so the
   * report writer knows what belongs in this section. Not
   * persisted, not user-facing.
   */
  guidance?: string;
}

/**
 * Chip rendered below the finished report. Tapping the chip
 * pre-fills the SPA composer with `prompt` so the user can
 * trigger a follow-up task with one click.
 */
export interface FollowUpAction {
  label: string;
  prompt: string;
}

/**
 * Bounded generation envelope for one typed report. `targetChars` is a
 * prompt-level brevity target; `maxTokens` is the hard Anthropic request cap.
 * Keeping both on the workflow makes report depth explicit without changing
 * the global budget for ordinary generate tasks.
 */
export interface ExpertWorkflowGenerationBudget {
  maxTokens: number;
  targetChars: {
    min: number;
    max: number;
  };
}

/**
 * Full workflow definition. Hangs off a stable `workflowId` and
 * is matched by either an explicit `role_id` choice or a keyword
 * scan against the user's intent (Phase 2 Day 2 will wire the
 * matcher).
 */
export interface ExpertWorkflowContract {
  workflowId: string;
  /** User-facing name shown in clarification copy. */
  name: string;
  /** Workflow-specific output envelope used by the prompt and runner. */
  generationBudget: ExpertWorkflowGenerationBudget;
  /**
   * Role ids that this workflow can serve as the backing role —
   * lets the existing skill/role picker route into the workflow.
   */
  roleIds: readonly string[];
  /**
   * Required: missing → workflow asks user to fill in before
   * generating the report.
   */
  requiredInputs: readonly WorkflowInput[];
  /**
   * Optional: missing → workflow proceeds, report annotates
   * those fields as "未提供" (not supplied) to set expectations.
   */
  optionalInputs: readonly WorkflowInput[];
  /**
   * Run after parser, before report. Any failure halts the flow
   * and returns a clarification question.
   */
  dataValidators: readonly DataValidator[];
  /**
   * Output structure. Verifier asserts every `required: true`
   * section appears in the report.
   */
  reportSections: readonly ReportSection[];
  /** Suggestion chips rendered after the report. */
  followUpActions: readonly FollowUpAction[];
  /**
   * Phase 2 Day 3 — Sonnet system-prompt addon. The intake +
   * report-generation steps build the actual prompt from the
   * workflow's structure plus this preamble. Kept inline on the
   * contract so all workflow knowledge lives in one place.
   */
  systemPromptPreamble: string;
}

/**
 * Combined output of the parser. The intake handler uses
 * `missingRequired` to decide whether to park; if non-empty,
 * stop and ask. Otherwise pass `extracted` to the validators.
 */
export interface ParseInputsResult {
  /** Map of WorkflowInput.name → coerced value. */
  extracted: Record<string, string | number>;
  /** Required inputs whose extractPattern did NOT match. */
  missingRequired: readonly WorkflowInput[];
  /** Optional inputs whose extractPattern did NOT match. */
  missingOptional: readonly WorkflowInput[];
  /**
   * Inputs whose pattern matched but value coercion failed
   * (e.g. captured non-numeric for a `number` field). The intake
   * handler can route these to `needs_clarification` with the
   * raw capture so the user can correct.
   */
  malformed: readonly { input: WorkflowInput; rawCapture: string }[];
}
