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
  return 0;
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
 * Mobile sheets are tall portrait surfaces. When the remote page is a
 * wide desktop-only viewport, pure contain makes it technically fit
 * but often unreadable, with a large empty band below. Prefer a
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
