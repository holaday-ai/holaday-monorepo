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
