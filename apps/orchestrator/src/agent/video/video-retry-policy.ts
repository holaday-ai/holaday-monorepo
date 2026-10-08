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
