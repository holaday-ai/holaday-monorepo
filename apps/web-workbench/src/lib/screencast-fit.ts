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
