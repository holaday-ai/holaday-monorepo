/**
 * Phase 2 Day 1 — Expert Workflow input parser.
 *
 * Pure function. Takes the user's text + a workflow contract,
 * runs each WorkflowInput's `extractPattern` against the text,
 * coerces capture group #1 to the field's `type`, and returns
 * a structured result the intake handler can act on:
 *
 *   - extracted        — { [WorkflowInput.name]: value }
 *   - missingRequired  — required fields whose pattern didn't match
 *   - missingOptional  — optional fields whose pattern didn't match
 *   - malformed        — pattern matched but coercion failed
 *
 * No LLM call. Cheap (regex-only) — runs on every reply turn so
 * the user can incrementally fill in missing fields without
 * paying a model round-trip.
 */
import type {
  ExpertWorkflowContract,
  ParseInputsResult,
  WorkflowInput,
} from './expert-workflow-contract.js';

/**
 * Strip thousand-separators and currency markers, translate Chinese
 * unit suffixes (万/亿/千/百), then parse as JS Number. Returns NaN
 * for unparseable input — caller handles.
 *
 *   "100,000"      → 100000
 *   "¥100,000.50"  → 100000.5
 *   "15万"         → 150000     (Chinese unit suffix, common in
 *                                user-pasted GMV / UV figures)
 *   "1.5万"        → 15000
 *   "2亿"          → 200000000
 *   "3%"           → 3          (% suffix stripped — caller decides
 *                                whether the field IS a percentage)
 *
 * Phase 2 Day 6 follow-up — earlier this rejected 万 / 亿 etc.,
 * forcing users to write canonical forms. Real users routinely
 * paste "GMV 15万" (the Compass UI shows it that way), so the
 * intake gate was rejecting valid input. Suffix translation lives
 * here so every workflow gets it for free.
 */
function coerceNumber(raw: string): number {
  let cleaned = raw
    .trim()
    .replace(/[¥￥$,，％%]/g, '')
    .replace(/\s+/g, '');
  if (!cleaned) return NaN;
  let multiplier = 1;
  // Order matters: check 亿 before 万 (亿 isn't a suffix of 万).
  if (cleaned.endsWith('亿')) {
    multiplier = 100_000_000;
    cleaned = cleaned.slice(0, -1);
  } else if (cleaned.endsWith('万')) {
    multiplier = 10_000;
    cleaned = cleaned.slice(0, -1);
  } else if (cleaned.endsWith('千')) {
    multiplier = 1_000;
    cleaned = cleaned.slice(0, -1);
  } else if (cleaned.endsWith('百')) {
    multiplier = 100;
    cleaned = cleaned.slice(0, -1);
  }
  if (!cleaned) return NaN;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n * multiplier : NaN;
}

/**
 * Apply a single field's regex + type coercion. Returns one of:
 *   { state: 'matched', value }      — pattern matched, coerced ok
 *   { state: 'malformed', raw }      — pattern matched, coerce failed
 *   { state: 'missing' }             — pattern did not match
 */
function extractOne(
  text: string,
  input: WorkflowInput,
):
  | { state: 'matched'; value: string | number }
  | { state: 'malformed'; raw: string }
  | { state: 'missing' } {
  if (!input.extractPattern) {
    // Author opted out of regex extraction (e.g. type='file' is
    // resolved upstream from attachments, not inline text). We
    // can't pull this field from the text — treat as missing
    // unless a fallback is set.
    if (input.fallback !== undefined) {
      return { state: 'matched', value: input.fallback };
    }
    return { state: 'missing' };
  }
  const m = text.match(input.extractPattern);
  // Phase 2 follow-up — accept the FIRST non-undefined capture
  // group. Lets workflow authors define multiple anchored
  // alternatives in one regex (e.g. orders' "订单 500" /
  // "一共 500 单") without needing an array of patterns.
  const captured = m
    ? (m.slice(1).find((g): g is string => typeof g === 'string' && g.length > 0) ?? null)
    : null;
  if (!m || captured == null) {
    if (input.fallback !== undefined) {
      return { state: 'matched', value: input.fallback };
    }
    return { state: 'missing' };
  }
  const raw = captured.trim();
  if (input.type === 'number') {
    const n = coerceNumber(raw);
    if (!Number.isFinite(n)) return { state: 'malformed', raw };
    return { state: 'matched', value: n };
  }
  if (input.type === 'enum') {
    const allowed = input.enumValues ?? [];
    const lower = raw.toLowerCase();
    const hit = allowed.find((v) => v.toLowerCase() === lower);
    if (!hit) return { state: 'malformed', raw };
    return { state: 'matched', value: hit };
  }
  // text / date / file → keep raw string. (date / file deeper coercion
  // can land in Phase 2 Day 5 once we have downstream consumers.)
  return { state: 'matched', value: raw };
}

/**
 * Top-level entrypoint. Runs every required + optional input
 * pattern against `text` and bundles the verdict.
 *
 * Multiple input fields can share the same regex (e.g. two
 * fields both pulled from "GMV: 100000"). They're independent —
 * each runs against the full text.
 */
export function parseInputs(
  text: string,
  workflow: ExpertWorkflowContract,
): ParseInputsResult {
  const extracted: Record<string, string | number> = {};
  const missingRequired: WorkflowInput[] = [];
  const missingOptional: WorkflowInput[] = [];
  const malformed: { input: WorkflowInput; rawCapture: string }[] = [];

  for (const input of workflow.requiredInputs) {
    const r = extractOne(text, input);
    if (r.state === 'matched') {
      extracted[input.name] = r.value;
    } else if (r.state === 'malformed') {
      malformed.push({ input, rawCapture: r.raw });
    } else {
      missingRequired.push(input);
    }
  }
  for (const input of workflow.optionalInputs) {
    const r = extractOne(text, input);
    if (r.state === 'matched') {
      extracted[input.name] = r.value;
    } else if (r.state === 'malformed') {
      malformed.push({ input, rawCapture: r.raw });
    } else {
      missingOptional.push(input);
    }
  }

  return { extracted, missingRequired, missingOptional, malformed };
}

/**
 * Build a human-facing clarification question for an awaiting_user
 * park when required inputs are missing. Lists every missing
 * required field with its label + unit hint, plus any malformed
 * captures with the raw value the user wrote so they can fix it.
 */
export function buildClarificationQuestion(
  workflow: ExpertWorkflowContract,
  result: ParseInputsResult,
): string {
  const lines: string[] = [`为了完成「${workflow.name}」，还需要以下信息：`, ''];
  for (const input of result.missingRequired) {
    const unit = input.unit ? `（${input.unit}）` : '';
    lines.push(`- **${input.label}**${unit}`);
  }
  if (result.malformed.length > 0) {
    lines.push('', '另外这几个字段格式没识别出来，请确认：');
    for (const { input, rawCapture } of result.malformed) {
      lines.push(`- **${input.label}**：你填的是「${rawCapture}」，期望 ${describeType(input)}`);
    }
  }
  lines.push(
    '',
    '可以一次回复全部，或一行一项。',
  );
  return lines.join('\n');
}

function describeType(input: WorkflowInput): string {
  switch (input.type) {
    case 'number':
      return input.unit ? `数字（单位：${input.unit}）` : '数字';
    case 'enum':
      return `枚举（${(input.enumValues ?? []).join(' / ')}）`;
    case 'date':
      return '日期（YYYY-MM-DD）';
    case 'file':
      return '文件附件';
    default:
      return '文本';
  }
}

// Internal — exported for tests only.
export const _internal = { coerceNumber, extractOne };
