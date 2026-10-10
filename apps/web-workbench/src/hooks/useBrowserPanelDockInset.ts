import * as React from 'react';

export const BROWSER_PANEL_DOCK_INSET_PROPERTY = '--holaday-browser-panel-inset';

/**
 * Publishes the right-hand browser panel's width as a CSS variable so the
 * fixed desktop account dock (bell + user menu, AppShell) shifts left of the
 * panel instead of sitting on top of the panel's own header controls.
 *
 * Every panel that occupies the right rail must call this — the local
 * Chrome panel used to skip it, so the dock covered its close button.
 * A zero width (collapsed to nothing / hidden) clears the variable rather
 * than leaving a stale offset behind.
 */
export function useBrowserPanelDockInset<T extends Element>(
  ref: React.RefObject<T>,
  enabled: boolean,
): void {
  React.useEffect(() => {
    if (!enabled) return;
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const root = document.documentElement;
    const apply = (width: number): void => {
      if (width > 0) root.style.setProperty(BROWSER_PANEL_DOCK_INSET_PROPERTY, `${Math.ceil(width) + 16}px`);
      else root.style.removeProperty(BROWSER_PANEL_DOCK_INSET_PROPERTY);
    };
    const ro = new ResizeObserver((entries) => {
      apply(entries[0]?.contentRect.width ?? el.clientWidth);
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
      root.style.removeProperty(BROWSER_PANEL_DOCK_INSET_PROPERTY);
    };
  }, [enabled, ref]);
}
