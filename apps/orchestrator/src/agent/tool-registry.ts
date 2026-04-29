/**
 * Tool registry — task-type-driven tool whitelist for agent calls.
 *
 * Replaces the implicit "every task sees every tool" model. Each task
 * is classified into one of three buckets and only the tools listed
 * for that bucket are passed to Anthropic. Anything else the model
 * tries to call is filtered out at the consumer (commander.ts /
 * agent-loop.ts) before execution.
 *
 * Why a registry rather than per-call wiring: the same task type
 * means the same tool set across both vision-loop and supercar, so
 * one source of truth keeps them in sync. It also makes BANNED_TOOLS
 * a hard wall — any tool name in that list can never reach the model
 * regardless of how the call site assembled its array.
 *
 * Not enforced inside this module — call sites filter their own tool
 * arrays via `filterTools()`. That's deliberate so the existing
 * Anthropic.Tool typing in each call site stays untouched.
 */

import { classifyAsSimpleSearch } from './supercar/execution-router.js';

export type TaskType = 'browser' | 'search' | 'hybrid';

/**
 * Anthropic-side tool names allowed per task type.
 *
 * - **browser**: pure UI driving (click, type, navigate, screenshot).
 *   Used when the user said "open X" / "log into Y" / "post to Z".
 * - **search**: pure information lookup. Only the Anthropic-managed
 *   web_search tool plus the terminal task_done. No browser, no
 *   custom tools.
 * - **hybrid**: default. Browser + web_search both allowed; the model
 *   chooses per turn. Falls back to this whenever the classifier is
 *   uncertain.
 */
/**
 * Browser-driving tool names. Same set re-used by `browser` and
 * `hybrid` task types — split out so the lists stay in sync and we
 * can add an entry once instead of twice.
 *
 * Includes BOTH the screenshot-mode names (`computer_*`) and the
 * accessibility-mode names (`a11y_*`). Task-runner picks one of the
 * two modes per task; the registry doesn't know which is active so
 * it allows both — `filterTools()` only sees the array a particular
 * call site assembles, so the unused variant is naturally absent.
 */
const BROWSER_TOOLS: readonly string[] = [
  // Anthropic beta computer-use tool (assembled by supercar)
  'computer',
  // Vision-loop screenshot-mode tools
  'computer_click',
  'computer_type',
  'computer_key',
  'computer_scroll',
  'computer_navigate',
  'computer_wait',
  'computer_wait_for_human',
  'computer_screenshot',
  // Vision-loop accessibility-mode tools
  'a11y_click_ref',
  'a11y_type_in_ref',
  'a11y_press_key',
  'a11y_scroll',
  'a11y_wait',
  'a11y_screenshot',
  'a11y_navigate',
  'a11y_wait_for_human',
  'a11y_task_done',
  'a11y_task_give_up',
  // Custom tools
  'navigate',
  'create_file',
  // Terminal tools (always allowed)
  'task_done',
  'task_give_up',
];

export const TOOL_SETS: Record<TaskType, readonly string[]> = {
  browser: BROWSER_TOOLS,
  search: ['web_search', 'create_file', 'task_done', 'task_give_up'],
  hybrid: [...BROWSER_TOOLS, 'web_search'],
} as const;

/**
 * Names that must NEVER reach the model. Even if a future code path
 * accidentally adds them to its tool array, `filterTools()` strips
 * them. These are the "agent goes off the rails" failure modes — bash
 * code execution, file editing, raw shells.
 */
export const BANNED_TOOLS: readonly string[] = [
  'bash_code_execution',
  'code_execution',
  'text_editor',
  'file_operations',
  'shell',
  'bash',
];

/**
 * Classify a free-form intent into a task type.
 *
 * Reuses the existing `classifyAsSimpleSearch` from execution-router
 * (which is already battle-tested for the Brave-vs-browser routing
 * decision) — promoting "this is a pure information query" into the
 * task type. Anything else lands in `hybrid` so the model keeps both
 * affordances. We do NOT classify into `browser` automatically —
 * that bucket is reserved for callers who explicitly know they only
 * need UI driving (e.g. "click that button" follow-ups).
 */
export function classifyTaskType(intent: string): TaskType {
  if (classifyAsSimpleSearch(intent)) return 'search';
  return 'hybrid';
}

/**
 * Return true when the given tool name is permitted for the task
 * type (and not on the banned list).
 *
 * Matches by the tool's `name` property (Anthropic-side identifier).
 * Tools whose name is on `BANNED_TOOLS` always fail this check
 * regardless of task type.
 */
export function isToolAllowed(toolName: string, taskType: TaskType): boolean {
  if (BANNED_TOOLS.includes(toolName)) return false;
  return TOOL_SETS[taskType].includes(toolName);
}

/**
 * Filter an array of tool descriptors (anything with a `name` field)
 * down to those allowed for the task type. Generic so vision-loop's
 * VISION_TOOLS, supercar's inline beta tool array, and any future
 * tool descriptor shape can pass through unchanged.
 *
 * Caller passes its own array; we never mutate. If the filter would
 * remove every tool (unusual — usually means the task type was wrong)
 * we still return the empty array rather than fall back, so the
 * caller's logs make the misconfiguration visible.
 */
export function filterTools<T extends { name?: string; type?: string }>(
  tools: readonly T[],
  taskType: TaskType,
): T[] {
  return tools.filter((t) => {
    // Anthropic beta tools sometimes have `type` instead of `name`
    // (e.g. `{ type: 'computer_20251124', name: 'computer' }`). Match
    // by `name` first, fall back to `type` so beta tools resolve.
    const ident = t.name ?? t.type;
    if (!ident) return false;
    return isToolAllowed(ident, taskType);
  });
}
