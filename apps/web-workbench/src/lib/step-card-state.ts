import type { UiStep } from '@/types/task';

export type StepExecutionStatus = UiStep['status'];

export interface StepDetailSummary {
  readonly total: number;
  readonly done: number;
  readonly failed: number;
  readonly running: number;
  readonly cancelled: number;
  readonly label: string;
  readonly tone: 'idle' | 'running' | 'done' | 'failed' | 'cancelled';
}

export function stepStatusLabel(status: StepExecutionStatus, tickIndex: number): string {
  const stepNumber = Math.max(0, tickIndex) + 1;
  const statusLabel = stepStatusText(status);
  return `步骤 ${stepNumber} · ${statusLabel}`;
}

export function stepStatusText(status: StepExecutionStatus): string {
  if (status === 'done') return '已完成';
  if (status === 'failed') return '失败';
  if (status === 'cancelled') return '已取消';
  return '执行中';
}

export function stepFailureMessage(step: Pick<UiStep, 'actionKind' | 'message'>): string | null {
  const message = step.message?.trim();
  if (!message) return null;
  const haystack = `${step.actionKind ?? ''} ${message}`.toLowerCase();

  if (
    /扩展工具调用超时|extension tool.*timeout|browser tool.*timeout|navigate.*timeout|navigation.*timeout|timed out after/.test(
      haystack,
    )
  ) {
    return '浏览器响应超时，可能是页面仍在加载或扩展连接短暂中断。可以重试当前任务。';
  }
  if (/browser not allocated|no browser allocated|409|hibernat|idle-timeout|休眠/.test(haystack)) {
    return '浏览器会话已休眠。重新执行任务时会拉起新的浏览器。';
  }
  if (
    /target closed|session closed|websocket.*closed|cdp|frame.*detached|browser disconnected|连接.*中断/.test(
      haystack,
    )
  ) {
    return '浏览器连接中断，重试会重新建立会话。';
  }
  if (/captcha|recaptcha|hcaptcha|cloudflare|人机|验证码|滑块/.test(haystack)) {
    return '网站要求人机验证。请在浏览器里完成验证后继续，或重新执行任务。';
  }

  return message;
}

export function stepDetailSummary(
  steps: readonly Pick<UiStep, 'status'>[],
): StepDetailSummary {
  const total = steps.length;
  const done = steps.filter((step) => step.status === 'done').length;
  const failed = steps.filter((step) => step.status === 'failed').length;
  const running = steps.filter((step) => step.status === 'running').length;
  const cancelled = steps.filter((step) => step.status === 'cancelled').length;
  const parts =
    total > 0
      ? [`${done}/${total} 步完成`]
      : ['暂无详细步骤'];
  if (running > 0) parts.push(`${running} 执行中`);
  if (failed > 0) parts.push(`${failed} 失败`);
  if (cancelled > 0) parts.push(`${cancelled} 取消`);
  const tone =
    failed > 0
      ? 'failed'
      : running > 0
        ? 'running'
        : cancelled > 0 && done + cancelled === total
          ? 'cancelled'
          : total > 0 && done === total
            ? 'done'
            : 'idle';
  return {
    total,
    done,
    failed,
    running,
    cancelled,
    label: parts.join(' · '),
    tone,
  };
}
