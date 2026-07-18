import { describe, expect, it } from 'vitest';
import {
  isWorkbenchDesktopWidth,
  isWorkbenchMobileWidth,
  isWorkbenchWideWidth,
  workbenchInlineColumnMinimums,
  WORKBENCH_DESKTOP_BREAKPOINT_PX,
  WORKBENCH_MOBILE_BREAKPOINT_PX,
  WORKBENCH_WIDE_BREAKPOINT_PX,
} from './workbench-breakpoints';

describe('workbench breakpoints', () => {
  it('uses the browser sheet only for compact widths', () => {
    expect(isWorkbenchMobileWidth(WORKBENCH_MOBILE_BREAKPOINT_PX - 1)).toBe(true);
    expect(isWorkbenchMobileWidth(WORKBENCH_MOBILE_BREAKPOINT_PX)).toBe(false);
    expect(isWorkbenchMobileWidth(767)).toBe(true);
    expect(isWorkbenchMobileWidth(768)).toBe(false);
    expect(isWorkbenchMobileWidth(1024)).toBe(false);
  });

  it('keeps tablet and desktop widths on the same inline plane', () => {
    expect(isWorkbenchDesktopWidth(767)).toBe(false);
    expect(isWorkbenchDesktopWidth(768)).toBe(true);
    expect(isWorkbenchDesktopWidth(1024)).toBe(true);
    expect(isWorkbenchDesktopWidth(WORKBENCH_DESKTOP_BREAKPOINT_PX - 1)).toBe(false);
    expect(isWorkbenchDesktopWidth(WORKBENCH_DESKTOP_BREAKPOINT_PX)).toBe(true);
    expect(isWorkbenchDesktopWidth(1440)).toBe(true);
  });

  it('reserves the expanded-sidebar split for wide desktop windows', () => {
    expect(isWorkbenchWideWidth(WORKBENCH_DESKTOP_BREAKPOINT_PX)).toBe(false);
    expect(isWorkbenchWideWidth(WORKBENCH_WIDE_BREAKPOINT_PX - 1)).toBe(false);
    expect(isWorkbenchWideWidth(WORKBENCH_WIDE_BREAKPOINT_PX)).toBe(true);
  });

  it('keeps task and browser as same-plane columns at every inline width', () => {
    expect(workbenchInlineColumnMinimums({ isWideDesktop: false })).toEqual({
      main: 320,
      browser: 320,
    });
    expect(workbenchInlineColumnMinimums({ isWideDesktop: true })).toEqual({
      main: 560,
      browser: 360,
    });
  });
});
