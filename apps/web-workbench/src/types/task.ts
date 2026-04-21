/**
 * UI-facing task model. The real backend types (TaskStatus from the
 * orchestrator DB + ServerMessage from shared-types) are richer; this
 * is the shape the sidebar / task stream render from. G3 populates it
 * from `tasks.list` + WS events; G2 seeds mock rows of the same shape
 * so the components compile against the final contract from day one.
 */
export type UiTaskStatus = 'executing' | 'paused' | 'completed' | 'failed' | 'cancelled';

export interface UiTask {
  taskId: string;
  intent: string;
  status: UiTaskStatus;
  /** Observed tick count — shown in the sidebar subtitle. */
  tickCount: number;
  /** Terminal summary (completed) or failure reason (failed/paused). */
  resultText?: string;
  createdAt: Date;
}

export function isActive(status: UiTaskStatus): boolean {
  return status === 'executing' || status === 'paused';
}
