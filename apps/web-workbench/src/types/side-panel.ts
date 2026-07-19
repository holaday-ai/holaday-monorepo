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
 *   1. No selection                               → 'closed'
 *   2. User explicitly closed                     → 'closed'
 *   3. Agent needs the user in the viewport       → 'browser-live'
 *   4. Live browser task                          → 'browser-live'
 *   5. User explicitly opened the selected task   → 'browser-record'
 *   6. Composer is genuinely in new-task mode      → 'closed'
 *   7. Default                                    → 'closed'
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
  if (input.override === 'close') return 'closed';
  if (input.selectedNeedsBrowser) return 'browser-live';
  if (input.isLiveBrowserTask) return 'browser-live';
  if (input.override === 'open') return 'browser-record';
  if (input.isComposerNew) return 'closed';
  return 'closed';
}

/**
 * Whether the agent needs the user in the browser viewport for the selected
 * task — feeds `selectedNeedsBrowser` → computeSidePanelMode → 'browser-live'.
 * True for a captcha wait, or an awaiting-user state that's a genuine browser
 * hand-off (login / captcha / permission / browser_action). NOT for chat-only
 * awaits: 'clarification' and 'video_quote' (the video report card lives in
 * the chat stream and has no browser session — mounting the panel just shows a
 * futile "正在连接浏览器画面" over the quote card).
 */
export function needsBrowserViewport(input: {
  hasSelectedTask: boolean;
  captchaWait: boolean;
  needsUser: boolean;
  awaitingKind: string | null | undefined;
}): boolean {
  if (!input.hasSelectedTask) return false;
  if (input.captchaWait) return true;
  return (
    input.needsUser &&
    input.awaitingKind != null &&
    input.awaitingKind !== 'clarification' &&
    input.awaitingKind !== 'video_quote'
  );
}

export function sidePanelModeForToolbar({
  sidePanelMode,
  isMobile,
  browserSheetOpen,
}: {
  sidePanelMode: SidePanelMode;
  isMobile: boolean;
  browserSheetOpen: boolean;
}): SidePanelMode {
  if (isMobile && browserSheetOpen && sidePanelMode === 'closed') {
    return 'browser-record';
  }
  return sidePanelMode;
}
