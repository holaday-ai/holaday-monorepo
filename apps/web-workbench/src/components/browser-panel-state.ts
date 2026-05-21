import type { UiTaskStatus } from '@/types/task';

export function shouldShowBrowserHeader(inputs: {
  taskIsTerminal: boolean;
  hasCurrentFrame: boolean;
  hasFinalEvidence: boolean;
  interactiveActive: boolean;
}): boolean {
  if (!inputs.taskIsTerminal) return true;
  return (
    inputs.hasCurrentFrame ||
    inputs.hasFinalEvidence ||
    inputs.interactiveActive
  );
}

export function terminalEvidenceStatusLabel(
  status: UiTaskStatus | null | undefined,
): string {
  switch (status) {
    case 'completed':
      return '任务已完成';
    case 'partial_success':
      return '部分完成';
    case 'failed':
      return '任务未完成';
    case 'cancelled':
      return '任务已取消';
    default:
      return '任务已结束';
  }
}
