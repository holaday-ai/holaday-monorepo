export type TaskStatus =
  | 'planning'
  | 'executing'
  | 'awaiting_user'
  | 'paused'
  | 'completed'
  | 'partial_success'
  | 'failed'
  | 'cancelled';

export interface VisionProgressView {
  phase: 'observing' | 'deciding' | 'acting' | 'completed' | 'failed';
  tickIndex?: number;
  actionKind?: string;
  detail?: string;
}

export interface TaskView {
  taskId: string;
  status: TaskStatus;
  steps: { id: string; kind: string; status: string }[];
  lastUpdated: number;
  visionProgress?: VisionProgressView;
}

const TASK_STATUSES = new Set<TaskStatus>([
  'planning',
  'executing',
  'awaiting_user',
  'paused',
  'completed',
  'partial_success',
  'failed',
  'cancelled',
]);

const VISION_PHASES = new Set<VisionProgressView['phase']>([
  'observing',
  'deciding',
  'acting',
  'completed',
  'failed',
]);

export function normalizeTaskSnapshot(raw: unknown): TaskView[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item) => {
    const task = normalizeTaskView(item);
    return task ? [task] : [];
  });
}

function normalizeTaskView(raw: unknown): TaskView | null {
  if (!isRecord(raw)) return null;
  const taskId = typeof raw.taskId === 'string' ? raw.taskId.trim() : '';
  const status = normalizeTaskStatus(raw.status);
  if (!taskId || !status) return null;
  const steps = Array.isArray(raw.steps) ? raw.steps.flatMap(normalizeTaskStep) : [];
  const lastUpdated =
    typeof raw.lastUpdated === 'number' && Number.isFinite(raw.lastUpdated)
      ? raw.lastUpdated
      : 0;
  const visionProgress = normalizeVisionProgress(raw.visionProgress);
  return {
    taskId,
    status,
    steps,
    lastUpdated,
    ...(visionProgress ? { visionProgress } : {}),
  };
}

function normalizeTaskStatus(raw: unknown): TaskStatus | null {
  return typeof raw === 'string' && TASK_STATUSES.has(raw as TaskStatus)
    ? (raw as TaskStatus)
    : null;
}

function normalizeTaskStep(raw: unknown): { id: string; kind: string; status: string }[] {
  if (!isRecord(raw)) return [];
  const id = typeof raw.id === 'string' ? raw.id : '';
  const kind = typeof raw.kind === 'string' ? raw.kind : '';
  const status = typeof raw.status === 'string' ? raw.status : '';
  if (!id || !kind || !status) return [];
  return [{ id, kind, status }];
}

function normalizeVisionProgress(raw: unknown): VisionProgressView | null {
  if (!isRecord(raw)) return null;
  const phase =
    typeof raw.phase === 'string' && VISION_PHASES.has(raw.phase as VisionProgressView['phase'])
      ? (raw.phase as VisionProgressView['phase'])
      : null;
  if (!phase) return null;
  const tickIndex =
    typeof raw.tickIndex === 'number' && Number.isFinite(raw.tickIndex) && raw.tickIndex >= 0
      ? Math.floor(raw.tickIndex)
      : undefined;
  const actionKind = typeof raw.actionKind === 'string' ? raw.actionKind : undefined;
  const detail = typeof raw.detail === 'string' ? raw.detail : undefined;
  return {
    phase,
    ...(typeof tickIndex === 'number' ? { tickIndex } : {}),
    ...(actionKind ? { actionKind } : {}),
    ...(detail ? { detail } : {}),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
