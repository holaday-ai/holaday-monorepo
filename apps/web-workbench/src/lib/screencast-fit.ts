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

function isPositiveFinite(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}
