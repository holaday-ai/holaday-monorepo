export const RETAINED_PAYMENT_METADATA_KEYS = [
  'provider',
  'environment',
  'cycle',
  'packId',
  'providerStatus',
  'currency',
  'settledAt',
  'refundedAt',
  'disputeStatus',
] as const;

const MAX_RETAINED_STRING_LENGTH = 256;

export function sanitizePaymentMetadataForClosure(metadata: unknown): Record<string, unknown> {
  if (!isPlainRecord(metadata)) return {};
  const sanitized: Record<string, unknown> = {};
  for (const key of RETAINED_PAYMENT_METADATA_KEYS) {
    const value = metadata[key];
    if (isSafeRetainedScalar(value)) sanitized[key] = value;
  }
  return sanitized;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isSafeRetainedScalar(value: unknown): value is string | null {
  return (
    value === null || (typeof value === 'string' && value.length <= MAX_RETAINED_STRING_LENGTH)
  );
}
