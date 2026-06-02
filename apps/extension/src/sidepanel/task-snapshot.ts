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

const MAX_TASK_ID_CHARS = 128;
const MAX_STEP_FIELD_CHARS = 80;
const MAX_VISION_ACTION_KIND_CHARS = 80;
const MAX_VISION_DETAIL_CHARS = 1_000;

export function normalizeTaskSnapshot(raw: unknown): TaskView[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item) => {
    const task = normalizeTaskView(item);
    return task ? [task] : [];
  });
}

function normalizeTaskView(raw: unknown): TaskView | null {
  if (!isRecord(raw)) return null;
  const taskId = clipString(raw.taskId, MAX_TASK_ID_CHARS).trim();
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
  const id = clipString(raw.id, MAX_STEP_FIELD_CHARS).trim();
  const kind = clipString(raw.kind, MAX_STEP_FIELD_CHARS).trim();
  const status = clipString(raw.status, MAX_STEP_FIELD_CHARS).trim();
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
  const actionKind = clipString(raw.actionKind, MAX_VISION_ACTION_KIND_CHARS).trim();
  const detail = clipString(raw.detail, MAX_VISION_DETAIL_CHARS).trim();
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

function clipString(value: unknown, maxChars: number): string {
  if (typeof value !== 'string') return '';
  return value.length > maxChars ? value.slice(0, maxChars) : value;
}
