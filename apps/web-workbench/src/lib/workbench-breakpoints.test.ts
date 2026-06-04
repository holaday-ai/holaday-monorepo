import { describe, expect, it } from 'vitest';
import {
  isWorkbenchDesktopWidth,
  isWorkbenchMobileWidth,
  WORKBENCH_DESKTOP_BREAKPOINT_PX,
  WORKBENCH_MOBILE_BREAKPOINT_PX,
} from './workbench-breakpoints';

describe('workbench breakpoints', () => {
  it('keeps 960px and wider in the tablet/desktop panel lanes', () => {
    expect(isWorkbenchMobileWidth(WORKBENCH_MOBILE_BREAKPOINT_PX - 1)).toBe(true);
    expect(isWorkbenchMobileWidth(WORKBENCH_MOBILE_BREAKPOINT_PX)).toBe(false);
    expect(isWorkbenchMobileWidth(1023)).toBe(false);
  });

  it('uses the inline desktop lane only at the desktop breakpoint', () => {
    expect(isWorkbenchDesktopWidth(WORKBENCH_DESKTOP_BREAKPOINT_PX - 1)).toBe(false);
    expect(isWorkbenchDesktopWidth(WORKBENCH_DESKTOP_BREAKPOINT_PX)).toBe(true);
  });
});
