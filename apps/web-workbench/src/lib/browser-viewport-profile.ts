import type { BrowserViewportProfile } from '@holaday/shared-types';

export interface BrowserViewportProfileInput {
  viewportWidth: number;
  viewportHeight: number;
  panelWidth: number | null;
  panelHeight: number | null;
  fullscreen?: boolean;
}

const MOBILE_BREAKPOINT_PX = 960;
const LANDSCAPE_PANEL_ASPECT = 0.9;
const WIDE_DESKTOP_PANEL_PX = 1040;

export function pickBrowserViewportProfile({
  viewportWidth,
  viewportHeight,
  panelWidth,
  panelHeight,
  fullscreen = false,
}: BrowserViewportProfileInput): BrowserViewportProfile {
  if (fullscreen) return 'fullscreen';
  if (viewportWidth < MOBILE_BREAKPOINT_PX) return 'mobile';

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
