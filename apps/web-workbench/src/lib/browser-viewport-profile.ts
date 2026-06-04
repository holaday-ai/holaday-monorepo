import type { BrowserViewportProfile } from '@holaday/shared-types';
import { WORKBENCH_MOBILE_BREAKPOINT_PX } from './workbench-breakpoints';

export interface BrowserViewportProfileInput {
  viewportWidth: number;
  viewportHeight: number;
  panelWidth: number | null;
  panelHeight: number | null;
  fullscreen?: boolean;
}

const LANDSCAPE_PANEL_ASPECT = 0.9;
const WIDE_DESKTOP_PANEL_PX = 1040;
const INLINE_PANEL_FLEX_SHARE = 0.6;
const DEFAULT_INLINE_MAIN_MIN_PX = 420;
const DEFAULT_PANEL_MIN_PX = 300;
const DEFAULT_PANEL_CHROME_PX = 140;

export interface WorkbenchBrowserViewportInput {
  viewportWidth: number;
  viewportHeight: number;
  rowWidth: number | null;
  rowHeight: number | null;
  explicitPanelWidth: number | null;
  isTablet: boolean;
  fullscreen?: boolean;
  panelMinWidth?: number;
  mainMinWidth?: number;
  panelChromeHeight?: number;
}

export function pickBrowserViewportProfile({
  viewportWidth,
  viewportHeight,
  panelWidth,
  panelHeight,
  fullscreen = false,
}: BrowserViewportProfileInput): BrowserViewportProfile {
  if (fullscreen) return 'fullscreen';
  if (viewportWidth < WORKBENCH_MOBILE_BREAKPOINT_PX) return 'mobile';

  const safePanelWidth =
    typeof panelWidth === 'number' && Number.isFinite(panelWidth) && panelWidth > 0
      ? panelWidth
      : null;
  const safePanelHeight =
    typeof panelHeight === 'number' && Number.isFinite(panelHeight) && panelHeight > 0
      ? panelHeight
      : null;

  if (safePanelWidth != null && safePanelWidth >= WIDE_DESKTOP_PANEL_PX) {
    return 'desktop';
  }

  const effectivePanelWidth =
    safePanelWidth ?? Math.min(560, Math.round(viewportWidth * 0.9));
  const effectivePanelHeight =
    safePanelHeight ?? Math.max(480, Math.round(viewportHeight * 0.72));
  const aspect = effectivePanelWidth / effectivePanelHeight;

  return aspect >= LANDSCAPE_PANEL_ASPECT ? 'desktop' : 'sidepanel';
}

export function estimateInlineBrowserPanelWidth(input: {
  rowWidth: number | null;
  explicitPanelWidth: number | null;
  panelMinWidth?: number;
  mainMinWidth?: number;
}): number | null {
  const explicit = positiveFinite(input.explicitPanelWidth);
  if (explicit != null) return explicit;

  const rowWidth = positiveFinite(input.rowWidth);
  if (rowWidth == null) return null;

  const panelMinWidth = input.panelMinWidth ?? DEFAULT_PANEL_MIN_PX;
  const mainMinWidth = input.mainMinWidth ?? DEFAULT_INLINE_MAIN_MIN_PX;
  const maxWidth = Math.max(panelMinWidth, rowWidth - mainMinWidth);
  const flexWidth = Math.round(rowWidth * INLINE_PANEL_FLEX_SHARE);
  return Math.min(maxWidth, Math.max(panelMinWidth, flexWidth));
}

export function pickWorkbenchBrowserViewportProfile({
  viewportWidth,
  viewportHeight,
  rowWidth,
  rowHeight,
  explicitPanelWidth,
  isTablet,
  fullscreen = false,
  panelMinWidth,
  mainMinWidth,
  panelChromeHeight = DEFAULT_PANEL_CHROME_PX,
}: WorkbenchBrowserViewportInput): BrowserViewportProfile {
  const safeRowWidth = positiveFinite(rowWidth);
  const safeRowHeight = positiveFinite(rowHeight);
  const panelHeight =
    safeRowHeight != null && !fullscreen
      ? Math.max(360, safeRowHeight - panelChromeHeight)
      : (safeRowHeight ?? null);
  const overlayPanelWidth = Math.min(560, Math.round(viewportWidth * 0.9));

  return pickBrowserViewportProfile({
    viewportWidth,
    viewportHeight,
    panelWidth: fullscreen
      ? (safeRowWidth ?? viewportWidth)
      : isTablet
        ? overlayPanelWidth
        : estimateInlineBrowserPanelWidth({
            rowWidth: safeRowWidth,
            explicitPanelWidth,
            panelMinWidth,
            mainMinWidth,
          }),
    panelHeight,
    fullscreen,
  });
}

export function pickDefaultBrowserViewportProfile(): BrowserViewportProfile {
  if (typeof window === 'undefined') {
    return 'desktop';
  }
  return pickBrowserViewportProfile({
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight,
    panelWidth: null,
    panelHeight: null,
  });
}

function positiveFinite(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : null;
}
