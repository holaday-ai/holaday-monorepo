/**
 * Phase 1 Playbook B2 — action-capture redaction (PURE, no DB, no imports).
 *
 * Decides whether a captured target field is sensitive (password / OTP /
 * card / etc.) so the B2 capture writer NEVER persists a raw secret in
 * `task_action_captures.input_value`. Kept dependency-free so the supercar
 * agent-loop can call it at emit time — BEFORE the value crosses the
 * callback boundary — and so the decision is directly unit-testable.
 *
 * Fail-safe by design: when the target descriptor is null/unknown (e.g. a
 * best-effort capture timed out) the field is treated as SENSITIVE. We
 * would rather drop a non-secret value than ever store a real one.
 */

/** The element attributes the capture descriptor reads at action time. */
export interface CapturedFieldAttrs {
  type?: string | null;
  autocomplete?: string | null;
  name?: string | null;
  id?: string | null;
  ariaLabel?: string | null;
}

/** WHATWG autocomplete tokens that always denote a secret. */
const SENSITIVE_AUTOCOMPLETE = new Set([
  'current-password',
  'new-password',
  'one-time-code',
  'cc-number',
  'cc-csc',
  'cc-exp',
]);

/** Substring signals in name / id / aria-label that denote a secret. */
const SENSITIVE_NAME_RE = /password|passwd|otp|cvv|cvc|card|ssn/i;

/** Placeholder stored in place of a sensitive typed value. */
export const REDACTED_INPUT_VALUE = '[REDACTED:sensitive]';

/**
 * True when the target field must be treated as sensitive. A null /
 * undefined descriptor returns true (fail-safe: when we can't tell, redact).
 */
export function isSensitiveField(attrs: CapturedFieldAttrs | null | undefined): boolean {
  if (!attrs) return true; // unknown target → fail-safe redact
  if ((attrs.type ?? '').toLowerCase() === 'password') return true;
  if (SENSITIVE_AUTOCOMPLETE.has((attrs.autocomplete ?? '').toLowerCase())) return true;
  const haystack = [attrs.name, attrs.id, attrs.ariaLabel].filter(Boolean).join(' ');
  if (haystack && SENSITIVE_NAME_RE.test(haystack)) return true;
  return false;
}

/**
 * The value to persist for a `type` action's `input_value`: null stays
 * null; a sensitive (or unknown) target → the redaction marker; otherwise
 * the raw text. The raw secret is therefore NEVER returned for a sensitive
 * field — call this before the value enters the capture event.
 */
export function redactTypedValue(
  attrs: CapturedFieldAttrs | null | undefined,
  rawText: string | null,
): string | null {
  if (rawText === null) return null;
  return isSensitiveField(attrs) ? REDACTED_INPUT_VALUE : rawText;
}
