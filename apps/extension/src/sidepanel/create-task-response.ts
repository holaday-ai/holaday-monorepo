const MAX_TASK_ID_CHARS = 128;

export interface CreateTaskResponse {
  result?: {
    data?: {
      taskId?: unknown;
    };
  };
}

export function extractCreatedTaskId(response: CreateTaskResponse | null | undefined): string | null {
  const raw = response?.result?.data?.taskId;
  if (typeof raw !== 'string') return null;
  const id = raw.trim();
  if (!id) return null;
  return id.length > MAX_TASK_ID_CHARS ? id.slice(0, MAX_TASK_ID_CHARS) : id;
}

export function didTokenSwitchDuringTaskCreate(
  currentToken: string | null,
  submittedToken: string,
): boolean {
  return currentToken !== submittedToken;
}
