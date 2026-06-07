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
    return '已收到回复，正在继续当前任务…';
  }
  if (input.hasFollowUpTarget) {
    return '已收到追问，正在打开跟进任务…';
  }
  return '已收到任务，正在打开执行页…';
}
