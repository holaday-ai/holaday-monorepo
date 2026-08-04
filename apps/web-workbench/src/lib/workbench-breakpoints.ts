/**
 * The browser workbench has stricter space requirements than an ordinary
 * content page, so it owns explicit layout breakpoints instead of borrowing
 * Tailwind's generic ones:
 *
 *   - < 768px: bottom workspace (single focused surface)
 *   - 768-1359px: one focused inline surface (browser uses the full workbench)
 *   - >= 1360px: expanded/resizable desktop split
 */
export const WORKBENCH_MOBILE_BREAKPOINT_PX = 768;
export const WORKBENCH_DESKTOP_BREAKPOINT_PX = 768;
export const WORKBENCH_WIDE_BREAKPOINT_PX = 1360;

export function isWorkbenchMobileWidth(width: number): boolean {
  return Number.isFinite(width) && width < WORKBENCH_MOBILE_BREAKPOINT_PX;
}

export function isWorkbenchDesktopWidth(width: number): boolean {
  return Number.isFinite(width) && width >= WORKBENCH_DESKTOP_BREAKPOINT_PX;
}

export function isWorkbenchWideWidth(width: number): boolean {
  return Number.isFinite(width) && width >= WORKBENCH_WIDE_BREAKPOINT_PX;
}

export function workbenchInlineColumnMinimums(inputs: {
  isWideDesktop: boolean;
}): { main: number; browser: number } {
  return inputs.isWideDesktop
    ? { main: 560, browser: 360 }
    : { main: 320, browser: 320 };
}
