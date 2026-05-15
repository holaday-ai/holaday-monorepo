/**
 * Side-panel state machine for the workbench. Replaces the three
 * scattered booleans (browserCollapsed / userOpenedBrowserPanel /
 * showBrowserPanel) that were fighting each other.
 *
 * Codex IA close-out: the panel has one canonical mode at any moment
 * and the visible surface (live frame / static evidence / fallback)
 * is decided from that mode + the underlying task data.
 *
 *   'closed'           – panel not mounted; the main column owns the
 *                        full width.
 *   'browser-live'     – live screencast or interactive takeover.
 *                        Auto-entered for executing browser tasks and
 *                        awaiting-user (login / captcha / browser_action).
 *   'browser-record'   – static evidence for a terminal browser task:
 *                        finalScreenshot, finalUrl-only fallback, or
 *                        the "no evidence saved" placeholder. User
 *                        opens this explicitly via the TaskToolbar.
 *   'file-preview'     – reserved for future file-preview lane.
 *   'task-evidence'    – reserved for future evidence-summary lane.
 */
export type SidePanelMode =
  | 'closed'
  | 'browser-live'
  | 'browser-record'
  | 'file-preview'
  | 'task-evidence';

/**
 * User intent toggle. `null` means use the default for the current
 * task (live → open, terminal → closed). Explicit `'open'` / `'close'`
 * overrides the default. Resets to `null` on task switch.
 */
export type SidePanelOverride = 'open' | 'close' | null;

/**
 * Pure mode computation. Pulled out of WorkbenchApp so the rule is
 * readable in one place and easy to test.
 *
 * Priority order:
 *   1. No selection or composer in new-task mode  → 'closed'
 *   2. User explicitly closed                     → 'closed'
 *   3. Agent needs the user in the viewport       → 'browser-live'
 *   4. Live browser task                          → 'browser-live'
 *   5. User explicitly opened (terminal task)     → 'browser-record'
 *   6. Default                                    → 'closed'
 */
export interface SidePanelComputeInput {
  hasSelectedTask: boolean;
  isComposerNew: boolean;
  selectedNeedsBrowser: boolean;
  isLiveBrowserTask: boolean;
  override: SidePanelOverride;
}
export function computeSidePanelMode(
  input: SidePanelComputeInput,
): SidePanelMode {
  if (!input.hasSelectedTask) return 'closed';
  if (input.isComposerNew) return 'closed';
  if (input.override === 'close') return 'closed';
  if (input.selectedNeedsBrowser) return 'browser-live';
  if (input.isLiveBrowserTask) return 'browser-live';
  if (input.override === 'open') return 'browser-record';
  return 'closed';
}
