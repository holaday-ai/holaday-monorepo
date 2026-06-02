const MAX_LOG_ERROR_REASON_CHARS = 160;
const SENSITIVE_KEY_PATTERN =
  /(^|[?&#\s])((?:access[_-]?token|auth[_-]?token|session[_-]?id|session|sid|token|secret|password))=([^?&#\s]+)/gi;

export function compactLogErrorReason(error: unknown): string {
  const raw =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : '';
  const text = raw.trim() || 'unknown_error';
  const redacted = text.replace(
    SENSITIVE_KEY_PATTERN,
    (_match, prefix: string, key: string) => `${prefix}${key}=redacted`,
  );
  return redacted.length > MAX_LOG_ERROR_REASON_CHARS
    ? `${redacted.slice(0, MAX_LOG_ERROR_REASON_CHARS)}...`
    : redacted;
}
