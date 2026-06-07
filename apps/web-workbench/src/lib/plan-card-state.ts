export type PlanStepState = 'pending' | 'running' | 'done' | 'failed';

export interface PlanProgressSummary {
  readonly total: number;
  readonly done: number;
  readonly failed: number;
  readonly running: number;
  readonly percent: number;
  readonly label: string;
  readonly tone: 'idle' | 'running' | 'done' | 'failed';
}

export function planProgressSummary(
  planStatus: readonly { readonly status: PlanStepState }[] | null | undefined,
): PlanProgressSummary {
  const steps = planStatus ?? [];
  const total = steps.length;
  const done = steps.filter((step) => step.status === 'done').length;
  const failed = steps.filter((step) => step.status === 'failed').length;
  const running = steps.filter((step) => step.status === 'running').length;
  const percent = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;
  const tone =
    failed > 0 ? 'failed' : running > 0 ? 'running' : total > 0 && done === total ? 'done' : 'idle';
  const label =
    total > 0
      ? `${done}/${total} 阶段完成${failed > 0 ? ` · ${failed} 阶段失败` : ''}`
      : '等待计划步骤';
  return {
    total,
    done,
    failed,
    running,
    percent,
    label,
    tone,
  };
}
