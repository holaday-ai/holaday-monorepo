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
  if (
    !isPositiveFinite(input.contentWidth) ||
    !isPositiveFinite(input.hostWidth)
  ) {
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
