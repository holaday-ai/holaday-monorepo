/**
 * Optimization #3 R1 — browser viewport profile.
 *
 * Picks the Brave + Xvfb + CDP-streamer geometry for a task at
 * allocation time. Set ONCE per task — switching mid-flight would
 * shift the agent's click coordinates relative to its plan, so we
 * intentionally don't support dynamic re-profile.
 *
 * The four flavours map to real UX surfaces the user inhabits:
 *
 *   sidepanel  — desktop right-rail panel (the "second pane"
 *                next to TaskStream). 900×900 keeps Chinese site
 *                text legible without horizontal squish.
 *   desktop    — pre-Phase-19 default + the legacy 1280×800
 *                Xvfb size. Keep as DEFAULT_BROWSER_VIEWPORT_PROFILE
 *                so existing callers + back-compat code paths keep
 *                their original geometry.
 *   fullscreen — panel takeover (sidebar + main column hidden).
 *                1440×960 trades a bit of CPU for a noticeably
 *                sharper canvas.
 *   mobile     — narrow sheet on phones; mimics iPhone-class
 *                viewport so the rendered page is actually the
 *                mobile layout, not a desktop layout scaled down.
 *
 * Picked WITHOUT looking at concrete device pixel ratio — the
 * CDP streamer caps frame dimensions to these values, but the
 * browser's logical viewport matches them too (window-size flag).
 */

export type BrowserViewportProfile =
  | 'sidepanel'
  | 'desktop'
  | 'fullscreen'
  | 'mobile';

export interface ViewportDimensions {
  /** CSS pixels of the browser's logical viewport. */
  width: number;
  /** CSS pixels of the browser's logical viewport. */
  height: number;
}

export const VIEWPORT_PROFILES: Readonly<
  Record<BrowserViewportProfile, ViewportDimensions>
> = Object.freeze({
  sidepanel: { width: 900, height: 900 },
  desktop: { width: 1280, height: 800 },
  fullscreen: { width: 1440, height: 960 },
  mobile: { width: 390, height: 844 },
});

/**
 * The profile picked when a caller doesn't specify. Matches the
 * pre-refactor Xvfb / Brave / streamer defaults so existing tests
 * + back-compat paths see no behaviour change.
 */
export const DEFAULT_BROWSER_VIEWPORT_PROFILE: BrowserViewportProfile = 'desktop';

/**
 * Convenience: resolve a profile to its (width, height) tuple,
 * falling back to the default when the input is undefined / not a
 * known profile. Used by both server-side (Brave / Xvfb) and the
 * CDP streamer's maxWidth / maxHeight wiring.
 */
export function dimensionsForProfile(
  profile: BrowserViewportProfile | undefined,
): ViewportDimensions {
  if (!profile || !(profile in VIEWPORT_PROFILES)) {
    return VIEWPORT_PROFILES[DEFAULT_BROWSER_VIEWPORT_PROFILE];
  }
  return VIEWPORT_PROFILES[profile];
}

/**
 * Server-side spawn helpers want their geometry as the strings the
 * underlying processes expect. Centralising here keeps the formats
 * consistent across spawn.ts + the X11 / CDP layers.
 */
export function xvfbScreenForProfile(
  profile: BrowserViewportProfile | undefined,
): string {
  const { width, height } = dimensionsForProfile(profile);
  return `${width}x${height}x24`;
}

export function braveWindowSizeForProfile(
  profile: BrowserViewportProfile | undefined,
): string {
  const { width, height } = dimensionsForProfile(profile);
  return `${width},${height}`;
}

/**
 * Typeguard for runtime input (zod / route handlers). Useful when
 * a string comes in from an HTTP body and we want to treat unknown
 * values as "fall back to default" rather than 400-ing the request.
 */
export function isBrowserViewportProfile(
  v: unknown,
): v is BrowserViewportProfile {
  return (
    typeof v === 'string' &&
    (v === 'sidepanel' || v === 'desktop' || v === 'fullscreen' || v === 'mobile')
  );
}
