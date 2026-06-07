import { describe, expect, it } from 'vitest';
import {
  isWorkbenchDesktopWidth,
  isWorkbenchMobileWidth,
  WORKBENCH_DESKTOP_BREAKPOINT_PX,
  WORKBENCH_MOBILE_BREAKPOINT_PX,
} from './workbench-breakpoints';

describe('workbench breakpoints', () => {
  it('keeps narrow tablets in the mobile browser sheet lane', () => {
    expect(isWorkbenchMobileWidth(WORKBENCH_MOBILE_BREAKPOINT_PX - 1)).toBe(true);
    expect(isWorkbenchMobileWidth(WORKBENCH_MOBILE_BREAKPOINT_PX)).toBe(false);
    expect(isWorkbenchMobileWidth(1024)).toBe(true);
  });

  it('uses the inline desktop lane only at the desktop breakpoint', () => {
    expect(isWorkbenchDesktopWidth(WORKBENCH_DESKTOP_BREAKPOINT_PX - 1)).toBe(false);
    expect(isWorkbenchDesktopWidth(WORKBENCH_DESKTOP_BREAKPOINT_PX)).toBe(true);
  });
});
