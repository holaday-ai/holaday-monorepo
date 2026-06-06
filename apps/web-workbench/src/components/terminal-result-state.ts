import type { UiTask } from '@/types/task';

export interface TerminalResultInsufficientInput {
  status: UiTask['status'];
  displayText: string;
  revealedText: string;
  intent?: string;
  attachmentCount: number;
}

export function terminalResultContentInsufficient({
  status,
  displayText,
  revealedText,
  intent,
  attachmentCount,
}: TerminalResultInsufficientInput): boolean {
  if (status === 'failed' || status === 'cancelled') return false;
  if (attachmentCount > 0) return false;

  const originalContentLen = displayText.replace(/\s/g, '').length;
  if (originalContentLen >= 200) return false;

  const meaningful = meaningfulTerminalText(revealedText);
  const hasContentChars = /[A-Za-z0-9一-鿿぀-ゟ゠-ヿ]/.test(meaningful);
  if (
    allowsConciseFactResult(intent) &&
    meaningful.length >= 3 &&
    hasContentChars
  ) {
    return false;
  }

  return meaningful.length < 20 || !hasContentChars;
}

export function meaningfulTerminalText(text: string): string {
  return text
    .replace(/^#{1,6}\s+.*$/gm, '')
    .replace(/^[-*]\s+/gm, '')
    .replace(/^\d+\.\s+/gm, '')
    .replace(/[|`*_>]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function allowsConciseFactResult(intent?: string): boolean {
  const goal = (intent ?? '').toLowerCase();
  if (!goal) return false;
  const asksForConciseAnswer =
    /只(回复|回答|输出)|仅(回复|回答|输出)|直接(回复|回答|输出)|only\s+(reply|answer|return|output)|just\s+(reply|answer|return|output)/i.test(
      goal,
    );
  const asksForSingleFact =
    /标题|title|是什么|what\s+is|页面名|名称|name|读取.*(标题|title|文本|text)|提取.*(标题|title|文本|text|名称|name)/i.test(
      goal,
    );
  const asksForLongForm =
    /报告|总结|分析|对比|列表|清单|多(个|条)|前\s*\d+|top\s*\d+|report|summary|analysis|compare|list/i.test(
      goal,
  );
  return (asksForConciseAnswer || asksForSingleFact) && !asksForLongForm;
}

export function taskCancelStateChangedMessage(state: string | null | undefined): string {
  const status = typeof state === 'string' ? state.trim() : '';
  if (status === 'completed' || status === 'failed' || status === 'cancelled') {
    return '任务已经结束，当前详情已保留。';
  }
  if (status === 'running' || status === 'awaiting_user') {
    return '任务状态刚刚变化，请刷新后再确认是否需要取消。';
  }
  return '任务状态已变化，请刷新后查看最新进度。';
}
