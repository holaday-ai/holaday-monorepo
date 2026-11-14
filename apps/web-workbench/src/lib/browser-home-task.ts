import { useTaskStore } from '@/stores/task-store';
import type { UiSkillSelection } from '@/types/task';

export interface BrowserHomeTaskInput {
  readonly intent: string;
  readonly fileIds: string[];
  readonly mode?: 'auto' | 'plan';
  readonly expertMode?: 'normal' | 'expert' | 'auto';
  readonly skillSelection?: UiSkillSelection;
}

/**
 * BROWSER-HOME-1 — the one place the「云浏览器」floating composer creates a task.
 *
 * For now this is an ordinary task (its own browser). Plan step 4 runs it in the person's cloud
 * browser instead: that change belongs here only (pass `browserHomeSession: true` through to
 * `tasks.create`).
 */
export function createBrowserHomeTask(
  input: BrowserHomeTaskInput,
): Promise<{ taskId: string } | { error: string }> {
  return useTaskStore
    .getState()
    .createTask(
      input.intent,
      input.fileIds,
      undefined,
      input.mode,
      input.expertMode,
      undefined,
      undefined,
      input.skillSelection,
    );
}
