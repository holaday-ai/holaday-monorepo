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
 * Step 4: the task runs IN the person's open cloud browser, from the page it shows
 * (`browserHomeSession: true`); the server lends the browser to the task and gives it back when
 * the task ends, so the page's screen (`bhs_<userId>`) keeps showing it throughout.
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
      undefined,
      undefined,
      undefined,
      undefined,
      { browserHomeSession: true },
    );
}
