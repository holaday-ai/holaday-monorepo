/**
 * Image prep + coordinate translation for the vision loop.
 *
 * Claude's vision models have a cap on the longest image edge they'll
 * accept without down-sampling themselves (documented ~1568px). We
 * pre-resize on our side so (a) we know the exact model-space the
 * coordinates are returned in and (b) we don't pay tokens for oversized
 * frames we're going to down-sample anyway.
 *
 * Pipeline each tick:
 *   1. driver captures JPEG at real viewport size (e.g. 1280×800 → small,
 *      no resize; or 2560×1440 → 1568×882 after scale 0.6125)
 *   2. commander sends the resized frame to Claude
 *   3. Claude returns a click at model-space (x,y)
 *   4. commander calls `modelCoordToReal(x, y, img)` → real viewport (x',y')
 *   5. driver dispatches CDP `Input.dispatchMouseEvent` at (x',y')
 */

export const VISION_MODEL_MAX_LONG_EDGE = 1568;

export interface ResizedImage {
  /** Base64 JPEG of the resized frame — raw bytes, no `data:` prefix. */
  base64: string;
  /** Actual viewport pixels before resize (what the driver captured). */
  originalWidth: number;
  originalHeight: number;
  /** Post-resize model-space pixels (what Claude sees). */
  resizedWidth: number;
  resizedHeight: number;
  /**
   * Model→real scale factor. Multiply Claude's x by `realPerModelX` to
   * get the real viewport x. `scaleX = resizedWidth / originalWidth`;
   * `realPerModelX = 1 / scaleX = originalWidth / resizedWidth`. We
   * keep both precomputed for clarity at call sites.
   */
  scaleX: number;
  scaleY: number;
}

/**
 * Resize a viewport JPEG so its longer edge is ≤ `maxLongEdge`,
 * preserving aspect ratio. Returns both the resized bytes and the
 * scale factors the caller needs to translate model-space coordinates
 * back to real viewport pixels.
 *
 * If the input is already ≤ `maxLongEdge` on both sides, returns a
 * passthrough (scale=1). That lets small viewports (e.g. a 1280×800
 * laptop display) skip the CPU cost of a JPEG round-trip.
 *
 * TODO Phase A: implement using `sharp` (bundled with Node; streaming,
 * no tempfile). Skeleton returns a passthrough so the types line up
 * but the resize is a no-op; coordinates won't need translation
 * until we start actually shrinking.
 */
export async function resizeForVisionModel(
  base64Jpeg: string,
  originalWidth: number,
  originalHeight: number,
  maxLongEdge: number = VISION_MODEL_MAX_LONG_EDGE,
): Promise<ResizedImage> {
  const longEdge = Math.max(originalWidth, originalHeight);
  // Passthrough branch: the driver's frame is already small enough
  // that Claude won't resample it, so we save the CPU and emit a
  // scale=1 descriptor. Real implementation lands next commit.
  if (longEdge <= maxLongEdge) {
    return {
      base64: base64Jpeg,
      originalWidth,
      originalHeight,
      resizedWidth: originalWidth,
      resizedHeight: originalHeight,
      scaleX: 1,
      scaleY: 1,
    };
  }
  // TODO(vision-loop): wire sharp() resize here. For now the caller
  // gets the original bytes back with a scale descriptor that would
  // be correct IF we had resized — so downstream code can already
  // be written against the scaled coordinates and will Just Work
  // once the resize lands.
  const scale = maxLongEdge / longEdge;
  const resizedWidth = Math.round(originalWidth * scale);
  const resizedHeight = Math.round(originalHeight * scale);
  return {
    base64: base64Jpeg,
    originalWidth,
    originalHeight,
    resizedWidth,
    resizedHeight,
    scaleX: scale,
    scaleY: scale,
  };
}

/**
 * Translate a point Claude returned in model-space coordinates back
 * to the real viewport. Rounds to integer pixels so the driver can
 * dispatch the CDP event with an integral (x,y).
 *
 * Example: real viewport 2560×1440, resized to 1568×882 (scale ≈ 0.6125),
 * Claude clicks at (800, 400) in model-space → real (1306, 653).
 */
export function modelCoordToReal(
  x: number,
  y: number,
  img: Pick<ResizedImage, 'scaleX' | 'scaleY'>,
): { x: number; y: number } {
  if (img.scaleX === 0 || img.scaleY === 0) {
    throw new Error('modelCoordToReal: zero scale factor (malformed ResizedImage)');
  }
  return {
    x: Math.round(x / img.scaleX),
    y: Math.round(y / img.scaleY),
  };
}
