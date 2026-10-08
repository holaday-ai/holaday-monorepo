/** Cosmetic wording changes must not create a new retry budget. Keep word
 * boundaries in Latin text; spaces between adjacent Han characters are cosmetic. */
export function normalizeVideoRetryIntent(intent: string): string {
  return intent
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\s+/gu, ' ')
    .replace(/(?<=\p{Script=Han}) (?=\p{Script=Han})/gu, '')
    .trim()
    .replace(/[。.!！?？,，;；]+$/u, '')
    .trim();
}

/** The caller supplies only the safe mapped reason and host-owned retry count. */
export function videoRejectionReason(
  reason: string,
  priorQualityRejects: number,
  limit: number,
): string {
  return priorQualityRejects + 1 >= limit
    ? `${reason} 同一制作要求已连续 ${limit} 次未通过质检，请修改素材或描述；不会继续扣费重试。`
    : reason;
}
