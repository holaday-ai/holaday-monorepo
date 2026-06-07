export const WORKBENCH_MOBILE_BREAKPOINT_PX = 1100;
export const WORKBENCH_DESKTOP_BREAKPOINT_PX = 1360;

export function isWorkbenchMobileWidth(width: number): boolean {
  return Number.isFinite(width) && width < WORKBENCH_MOBILE_BREAKPOINT_PX;
}

export function isWorkbenchDesktopWidth(width: number): boolean {
  return Number.isFinite(width) && width >= WORKBENCH_DESKTOP_BREAKPOINT_PX;
}
