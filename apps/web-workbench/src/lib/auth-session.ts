export function isAuthSessionError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const record = err as {
    data?: { code?: unknown; httpStatus?: unknown };
    shape?: { data?: { code?: unknown; httpStatus?: unknown } };
    message?: unknown;
  };

  const code = record.data?.code ?? record.shape?.data?.code;
  if (code === 'UNAUTHORIZED') return true;

  const status = record.data?.httpStatus ?? record.shape?.data?.httpStatus;
  if (status === 401 || status === 403) return true;

  const message = typeof record.message === 'string' ? record.message : '';
  return /\b(401|403)\b|unauthorized|forbidden/i.test(message);
}

export function authGateFailureStatus(
  err: unknown,
): 'no-auth' | 'error' {
  return isAuthSessionError(err) ? 'no-auth' : 'error';
}

export function authSessionExpiredMessage(): string {
  return '登录状态已过期，请重新登录。';
}
