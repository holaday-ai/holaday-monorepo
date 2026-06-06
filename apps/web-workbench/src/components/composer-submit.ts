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

export function composerSubmittingStatus(input: {
  readonly replyMode?: boolean;
  readonly hasFollowUpTarget?: boolean;
}): string {
  if (input.replyMode) {
    return '正在发送回复，HOLA DAY 会继续当前任务...';
  }
  if (input.hasFollowUpTarget) {
    return '正在创建追问任务，成功后会自动进入新任务页...';
  }
  return '正在创建任务，成功后会自动进入任务页...';
}
