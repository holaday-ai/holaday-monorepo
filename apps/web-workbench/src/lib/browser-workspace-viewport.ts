export interface BrowserViewportSize {
  width: number;
  height: number;
}

const MIN_WIDTH = 320;
const MIN_HEIGHT = 360;
const MAX_WIDTH = 1440;
const MAX_HEIGHT = 1200;
const RESIZE_NOISE_PX = 6;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Turns the visible workbench canvas into the remote page viewport. The page
 * reflows to the space the user actually has instead of being rendered at a
 * fixed desktop size and shrunk into an unreadable thumbnail.
 */
export function browserViewportForHost(inputs: {
  hostWidth: number;
  hostHeight: number;
}): BrowserViewportSize | null {
  if (
    !Number.isFinite(inputs.hostWidth) ||
    !Number.isFinite(inputs.hostHeight) ||
    inputs.hostWidth <= 0 ||
    inputs.hostHeight <= 0
  ) {
    return null;
  }
  return {
    width: clamp(Math.round(inputs.hostWidth), MIN_WIDTH, MAX_WIDTH),
    height: clamp(Math.round(inputs.hostHeight), MIN_HEIGHT, MAX_HEIGHT),
  };
}

export function shouldSendBrowserViewport(
  previous: BrowserViewportSize | null,
  next: BrowserViewportSize,
): boolean {
  if (!previous) return true;
  return (
    Math.abs(previous.width - next.width) >= RESIZE_NOISE_PX ||
    Math.abs(previous.height - next.height) >= RESIZE_NOISE_PX
  );
}

export function browserViewportV2ForHost(input: {
  hostWidth: number; hostHeight: number; renderMode: 'desktop' | 'panel'; desktopViewport?: BrowserViewportSize;
}): BrowserViewportSize | null {
  if (![input.hostWidth,input.hostHeight].every(v=>Number.isFinite(v)&&v>0)) return null;
  if (input.renderMode === 'desktop') {
    const desktop=input.desktopViewport ?? {width:1280,height:800};
    if (![desktop.width,desktop.height].every(v=>Number.isFinite(v)&&v>0)) return null;
    return {width:clamp(Math.round(desktop.width),320,1920),height:clamp(Math.round(desktop.height),360,1600)};
  }
  return {width:clamp(Math.round(input.hostWidth),320,1920),height:clamp(Math.round(input.hostHeight),360,1600)};
}
