import { humaniseTaskError } from './error-copy';

export function pageErrorMessage(
  error: unknown,
  fallback = '请稍后重试',
): string {
  const raw =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : '';
  const friendly = humaniseTaskError(raw);
  return friendly || fallback;
}

export function pageActionError(
  action: string,
  error: unknown,
  fallback = '请稍后重试',
): string {
  return `${action}：${pageErrorMessage(error, fallback)}`;
}
