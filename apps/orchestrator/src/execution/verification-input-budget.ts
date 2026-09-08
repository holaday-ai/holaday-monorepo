export type VerificationInputIssue =
  | 'VERIFICATION_CONTEXT_INVALID'
  | 'VERIFICATION_INPUT_LIMIT'
  | 'VERIFICATION_MATERIALS_INCOMPLETE';

export type VerificationBudgetResult =
  | { ok: true }
  | { ok: false; code: 'VERIFICATION_INPUT_LIMIT' };

export const VERIFICATION_INPUT_LIMITS = Object.freeze({
  contextBytes: 64 * 1024,
  materialsBytes: 64 * 1024,
  answerBytes: 96 * 1024,
  requestBytes: 256 * 1024,
});

export function checkVerificationAdmission(
  contextJson: string,
  materialTexts: readonly string[],
): VerificationBudgetResult {
  if (Buffer.byteLength(contextJson, 'utf8') > VERIFICATION_INPUT_LIMITS.contextBytes) {
    return { ok: false, code: 'VERIFICATION_INPUT_LIMIT' };
  }
  let materialBytes = 0;
  for (const text of materialTexts) {
    materialBytes += Buffer.byteLength(text, 'utf8');
    if (materialBytes > VERIFICATION_INPUT_LIMITS.materialsBytes) {
      return { ok: false, code: 'VERIFICATION_INPUT_LIMIT' };
    }
  }
  return { ok: true };
}

export function checkVerificationCandidate(
  answerText: string,
  serializedRequest: string,
): VerificationBudgetResult {
  if (
    Buffer.byteLength(answerText, 'utf8') > VERIFICATION_INPUT_LIMITS.answerBytes ||
    Buffer.byteLength(serializedRequest, 'utf8') > VERIFICATION_INPUT_LIMITS.requestBytes
  ) {
    return { ok: false, code: 'VERIFICATION_INPUT_LIMIT' };
  }
  return { ok: true };
}
