import type { BrowserFrameGeometry } from '@holaday/shared-types';
export interface ScreencastFitInput {
  hostWidth: number;
  hostHeight: number;
  sourceWidth: number;
  sourceHeight: number;
}

export interface ScreencastFitSize {
  width: number;
  height: number;
  scale: number;
}

export type TerminalEvidenceViewMode = 'contain' | 'readable';

export interface ScreencastContainPlacement extends ScreencastFitSize {
  offsetX: number;
  offsetY: number;
}

export interface ScreencastPointInput {
  clientX: number;
  clientY: number;
  rectLeft: number;
  rectTop: number;
  rectWidth: number;
  rectHeight: number;
  sourceWidth: number;
  sourceHeight: number;
}

export interface ScreencastPoint {
  x: number;
  y: number;
}

export function readableScreencastStartScrollLeft(input: {
  contentWidth: number;
  hostWidth: number;
}): number {
  if (!isPositiveFinite(input.contentWidth) || !isPositiveFinite(input.hostWidth)) {
    return 0;
  }
  return Math.max(0, Math.floor((input.contentWidth - input.hostWidth) / 2));
}

export function readableScreencastAutoScrollKey(input: {
  frameKey: string | null | undefined;
  hostWidth: number;
  hostHeight: number;
  contentWidth: number;
  viewMode?: string | null;
}): string | null {
  if (!input.frameKey) return null;
  if (
    !isPositiveFinite(input.hostWidth) ||
    !isPositiveFinite(input.hostHeight) ||
    !isPositiveFinite(input.contentWidth)
  ) {
    return input.viewMode ? `${input.viewMode}:${input.frameKey}` : input.frameKey;
  }
  const prefix = input.viewMode ? `${input.viewMode}:` : '';
  return `${prefix}${input.frameKey}:${Math.round(input.hostWidth)}x${Math.round(
    input.hostHeight,
  )}:${Math.round(input.contentWidth)}`;
}

export function fitScreencastContain({
  hostWidth,
  hostHeight,
  sourceWidth,
  sourceHeight,
}: ScreencastFitInput): ScreencastFitSize | null {
  if (
    !isPositiveFinite(hostWidth) ||
    !isPositiveFinite(hostHeight) ||
    !isPositiveFinite(sourceWidth) ||
    !isPositiveFinite(sourceHeight)
  ) {
    return null;
  }

  const scale = Math.min(hostWidth / sourceWidth, hostHeight / sourceHeight);
  return {
    width: Math.max(1, Math.floor(sourceWidth * scale)),
    height: Math.max(1, Math.floor(sourceHeight * scale)),
    scale,
  };
}

/**
 * Mobile sheets often have less room than the remote browser viewport.
 * Pure contain makes a frame technically fit, but it can shrink a
 * desktop page into a tiny strip in portrait sheets, or a portrait
 * browser into a narrow column in short landscape sheets. Prefer a
 * readable width/height compromise and let the sheet scroll instead
 * of shrinking all text to dust.
 */
export function fitScreencastReadable({
  hostWidth,
  hostHeight,
  sourceWidth,
  sourceHeight,
}: ScreencastFitInput): ScreencastFitSize | null {
  const fit = fitScreencastContain({
    hostWidth,
    hostHeight,
    sourceWidth,
    sourceHeight,
  });
  if (!fit) return null;

  const hostAspect = hostWidth / hostHeight;
  const sourceAspect = sourceWidth / sourceHeight;
  const portraitHost = hostAspect < 0.86;
  const wideSource = sourceAspect > 1.12;
  const shortLandscapeHost = hostAspect > 1.12;
  const portraitSource = sourceAspect < 0.9;
  if (shortLandscapeHost && portraitSource && fit.scale < 0.72) {
    const readableScale = Math.min(1, Math.max(fit.scale, hostWidth / sourceWidth));
    return {
      width: Math.max(1, Math.floor(sourceWidth * readableScale)),
      height: Math.max(1, Math.floor(sourceHeight * readableScale)),
      scale: readableScale,
    };
  }

  if (!portraitHost || !wideSource || fit.scale >= 0.62) {
    return fit;
  }

  const heightScale = hostHeight / sourceHeight;
  const readableScale = Math.min(1, Math.max(fit.scale, heightScale));
  return {
    width: Math.max(1, Math.floor(sourceWidth * readableScale)),
    height: Math.max(1, Math.floor(sourceHeight * readableScale)),
    scale: readableScale,
  };
}

/**
 * Terminal screenshots are evidence, so the default must preserve the whole
 * captured page. A user may explicitly opt into the larger, scrollable view
 * when they need to inspect text at its captured size.
 */
export function fitTerminalEvidence(
  input: ScreencastFitInput & { viewMode?: TerminalEvidenceViewMode },
): ScreencastFitSize | null {
  return input.viewMode === 'readable' ? fitScreencastReadable(input) : fitScreencastContain(input);
}

export function placeScreencastContainTop({
  hostWidth,
  hostHeight,
  sourceWidth,
  sourceHeight,
}: ScreencastFitInput): ScreencastContainPlacement | null {
  const fit = fitScreencastContain({
    hostWidth,
    hostHeight,
    sourceWidth,
    sourceHeight,
  });
  if (!fit) return null;

  return {
    ...fit,
    offsetX: Math.max(0, (hostWidth - fit.width) / 2),
    offsetY: 0,
  };
}

export function placeScreencastReadableTop({
  hostWidth,
  hostHeight,
  sourceWidth,
  sourceHeight,
}: ScreencastFitInput): ScreencastContainPlacement | null {
  const fit = fitScreencastReadable({
    hostWidth,
    hostHeight,
    sourceWidth,
    sourceHeight,
  });
  if (!fit) return null;

  return {
    ...fit,
    offsetX: Math.max(0, (hostWidth - fit.width) / 2),
    offsetY: 0,
  };
}

/**
 * FIX-33 「100% 原尺寸」: one page CSS pixel per screen pixel (a device-scale frame is
 * drawn at 1/pixelRatio); the host scrolls instead of shrinking the page.
 */
export function placeScreencastActual({
  sourceWidth,
  sourceHeight,
  pixelRatio = 1,
}: {
  sourceWidth: number;
  sourceHeight: number;
  pixelRatio?: number;
}): ScreencastContainPlacement | null {
  if (!isPositiveFinite(sourceWidth) || !isPositiveFinite(sourceHeight)) return null;
  const scale = 1 / (isPositiveFinite(pixelRatio) ? pixelRatio : 1);
  return {
    width: Math.max(1, Math.round(sourceWidth * scale)),
    height: Math.max(1, Math.round(sourceHeight * scale)),
    scale,
    offsetX: 0,
    offsetY: 0,
  };
}

/**
 * FIX-34: a frame's device scale without v2 geometry — its width over the CSS viewport the
 * panel asked for (default desktop 1280), in half steps (1, 1.5, 2).
 */
export function framePixelRatio(sourceWidth: number, cssWidth = 1280): number {
  if (!isPositiveFinite(sourceWidth) || !isPositiveFinite(cssWidth)) return 1;
  return Math.max(1, Math.round((sourceWidth / cssWidth) * 2) / 2);
}

export function mapClientPointToScreencast({
  clientX,
  clientY,
  rectLeft,
  rectTop,
  rectWidth,
  rectHeight,
  sourceWidth,
  sourceHeight,
}: ScreencastPointInput): ScreencastPoint {
  if (
    !isPositiveFinite(rectWidth) ||
    !isPositiveFinite(rectHeight) ||
    !isPositiveFinite(sourceWidth) ||
    !isPositiveFinite(sourceHeight)
  ) {
    return { x: 0, y: 0 };
  }

  return {
    x: Math.round((clientX - rectLeft) * (sourceWidth / rectWidth)),
    y: Math.round((clientY - rectTop) * (sourceHeight / rectHeight)),
  };
}

function isPositiveFinite(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

interface DisplayRect {
  left: number;
  top: number;
  width: number;
  height: number;
}
export function mapClientPointToBrowserFrame(input: {
  clientX: number;
  clientY: number;
  rect: DisplayRect;
  frame: BrowserFrameGeometry;
}): ScreencastPoint | null {
  const { rect, frame } = input;
  if (
    ![
      rect.width,
      rect.height,
      frame.cssWidth,
      frame.cssHeight,
      frame.imageWidth,
      frame.imageHeight,
      frame.pageScaleFactor,
    ].every(isPositiveFinite)
  )
    return null;
  const u = (input.clientX - rect.left) / rect.width;
  const v = (input.clientY - rect.top) / rect.height;
  if (!Number.isFinite(u) || !Number.isFinite(v) || u < 0 || v < 0 || u >= 1 || v >= 1) return null;
  // Screencast pixels include compositor page scale. Input coordinates are
  // unscaled viewport CSS coordinates. Scroll belongs only to document refs.
  const x = (u * frame.cssWidth) / frame.pageScaleFactor;
  // DEPLOY-61 重跑 #2: an image may show only the top of the layout at the same scale (seen: a
  // 1280x657 frame of a 1280x800 page before a watcher's size is applied). Map by the rows the
  // image really covers, or a press on Google's box at y=352 lands on its button at y=428.
  const coveredHeight = (frame.imageHeight * frame.cssWidth) / frame.imageWidth;
  const height =
    Math.abs(coveredHeight - frame.cssHeight) > frame.cssHeight * 0.01
      ? Math.min(frame.cssHeight, coveredHeight)
      : frame.cssHeight;
  const y = (v * height - frame.offsetTop) / frame.pageScaleFactor;
  return y < 0 ? null : { x, y };
}
export function mapClientPointToFramebuffer(input: {
  clientX: number;
  clientY: number;
  rect: DisplayRect;
  width: number;
  height: number;
}): ScreencastPoint | null {
  const { rect } = input;
  if (![rect.width, rect.height, input.width, input.height].every(isPositiveFinite)) return null;
  const x = ((input.clientX - rect.left) * input.width) / rect.width;
  const y = ((input.clientY - rect.top) * input.height) / rect.height;
  if (
    !Number.isFinite(x) ||
    !Number.isFinite(y) ||
    x < 0 ||
    y < 0 ||
    x >= input.width ||
    y >= input.height
  )
    return null;
  return { x, y };
}

/** CAPTCHA-UX-1 第 2 条: the captcha box, in CSS pixels of the page's viewport. */
export interface ScreencastCaptchaBox {
  x: number;
  y: number;
  width: number;
  height: number;
}
/** Margin around the captcha box when zoomed, in CSS pixels of the page. */
export const CAPTCHA_ZOOM_MARGIN = 24;
/** Below this panel width (a phone) the box fills the width, top-aligned. */
export const CAPTCHA_ZOOM_PHONE_WIDTH = 640;
/** At most this many screen pixels per CSS pixel of the page (a tiny checkbox stays legible). */
const CAPTCHA_ZOOM_MAX_CSS_SCALE = 6;

/**
 * CAPTCHA-UX-1 第 2 条: place the frame so the captcha box (plus a margin) fills the panel — on a
 * phone, its width. Only this screen's picture is scaled; the page keeps its size. Points still map
 * through the canvas's displayed rect, so a click lands where it is shown.
 */
export function placeScreencastCaptchaZoom(input: {
  hostWidth: number;
  hostHeight: number;
  sourceWidth: number;
  sourceHeight: number;
  cssWidth: number;
  box: ScreencastCaptchaBox;
}): ScreencastContainPlacement | null {
  const { hostWidth, hostHeight, sourceWidth, sourceHeight, cssWidth, box } = input;
  if (hostWidth <= 0 || hostHeight <= 0 || sourceWidth <= 0 || sourceHeight <= 0 || cssWidth <= 0)
    return null;
  if (!(box.width > 0 && box.height > 0)) return null;
  const k = sourceWidth / cssWidth;
  const m = CAPTCHA_ZOOM_MARGIN;
  const bx = Math.max(0, box.x - m) * k;
  const by = Math.max(0, box.y - m) * k;
  const bw = Math.min(sourceWidth - bx, (box.width + 2 * m) * k);
  const bh = Math.min(sourceHeight - by, (box.height + 2 * m) * k);
  if (bw <= 0 || bh <= 0) return null;
  const phone = hostWidth < CAPTCHA_ZOOM_PHONE_WIDTH;
  const scale = Math.min(
    CAPTCHA_ZOOM_MAX_CSS_SCALE / k,
    phone ? hostWidth / bw : Math.min(hostWidth / bw, hostHeight / bh),
  );
  return {
    scale,
    width: hostWidth,
    height: hostHeight,
    offsetX: (hostWidth - bw * scale) / 2 - bx * scale,
    offsetY: phone ? -by * scale : Math.max(0, (hostHeight - bh * scale) / 2) - by * scale,
  };
}
