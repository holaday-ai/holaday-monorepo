import { taskActionError } from '@/lib/error-copy';

export type ComposerSubmitResult = void | { ok?: boolean; error?: string };

export const keepComposerOnSubmitFailure = { ok: false } as const;
export const clearComposerOnSubmitSuccess = { ok: true } as const;

export function shouldClearComposerAfterSubmit(result: unknown): boolean {
  if (result == null) return true;
  if (typeof result !== 'object') return true;

  const submitResult = result as { ok?: boolean; error?: string };
  if (submitResult.error) return false;
  return submitResult.ok !== false;
}

export function composerSubmitErrorMessage(
  raw: string | null | undefined,
): string {
  return taskActionError('提交失败', raw);
}
