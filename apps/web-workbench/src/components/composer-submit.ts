import { taskActionError } from '@/lib/error-copy';

export type ComposerSubmitResult = void | {
  ok?: boolean;
  error?: string;
  notice?: string;
  browserOperationId?: string;
};

export const keepComposerOnSubmitFailure = { ok: false } as const;
export const clearComposerOnSubmitSuccess = { ok: true } as const;

export function shouldClearComposerAfterSubmit(result: unknown): boolean {
  if (result == null) return true;
  if (typeof result !== 'object') return true;

  const submitResult = result as { ok?: boolean; error?: string };
  if (submitResult.error) return false;
  return submitResult.ok !== false;
}

export function composerSubmitErrorMessage(raw: string | null | undefined): string {
  return taskActionError('提交失败', raw);
}

export function composerSubmittingStatus(input: {
  readonly replyMode?: boolean;
  readonly hasFollowUpTarget?: boolean;
}): string {
  if (input.replyMode) {
    return '正在提交回复，等待确认…';
  }
  if (input.hasFollowUpTarget) {
    return '正在提交追问，等待确认…';
  }
  return '正在提交任务，等待确认…';
}
