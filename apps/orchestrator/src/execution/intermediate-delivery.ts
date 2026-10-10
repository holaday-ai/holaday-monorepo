import type { VerificationResult } from './answer-verifier.js';

/** Appended to a plan or clarification that is delivered without a full verification pass. */
export const UNVERIFIED_INTERMEDIATE_NOTICE =
  '（提示：部分材料未能核验，以上内容仅供参考，确认前请留意。）';

const DELIVERABLE_COVERAGE_CHECKS = new Set([
  'VERIFICATION_MATERIALS_INCOMPLETE',
  'VERIFICATION_CONTEXT_INVALID',
]);

/**
 * A plan or clarification question is a waiting step, not a final answer. When
 * its review did not pass only for "could not fully verify" reasons (materials
 * partly unreadable, semantic review unavailable, a fixable check), the user
 * still gets the plan with a notice instead of a failed task. Serious problems
 * — hard failures, clarification failures, a semantic reject, any failed
 * deterministic safety check or an over-limit payload that cannot be stored —
 * still fail.
 */
export function canDeliverUnverifiedIntermediate(
  verification: VerificationResult | null | undefined,
): boolean {
  if (!verification || verification.passed) return false;
  if (
    verification.failureLevel === 'hard_fail' ||
    verification.failureLevel === 'needs_clarification'
  )
    return false;
  if (verification.semanticStatus === 'reject') return false;
  if (verification.inputCoverage?.codes.includes('VERIFICATION_INPUT_LIMIT')) return false;
  // Deterministic safety checks (unobserved URLs, nonexistent files, empty
  // question, structural rows…) still fail. Only "could not fully verify"
  // coverage gaps and fixable semantic warnings are delivered with a notice.
  return verification.checks.every(
    (check) =>
      check.passed ||
      (check.severity !== 'hard_fail' &&
        check.severity !== 'needs_clarification' &&
        (DELIVERABLE_COVERAGE_CHECKS.has(check.criterionType ?? '') ||
          (check.checker === 'llm' && check.severity === 'fixable'))),
  );
}
