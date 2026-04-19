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

import sharp from 'sharp';

export const VISION_MODEL_MAX_LONG_EDGE = 1568;
/** JPEG quality for resized frames. 80 = sweet spot: ~70 KB per 1568×882
 *  viewport, indistinguishable from q95 at the Claude preprocessing resolution. */
export const VISION_MODEL_JPEG_QUALITY = 80;

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
   * Model→real scale factor. `scaleX = resizedWidth / originalWidth`
   * — i.e. fraction of original the model sees. To translate a click
   * at model-space x back to real viewport x, divide: `realX = modelX /
   * scaleX`. `modelCoordToReal` encapsulates this so call sites don't
   * have to remember the direction.
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
 * passthrough (scale=1, original bytes). That lets small viewports
 * (e.g. a 1280×800 laptop display) skip the CPU cost of a JPEG
 * round-trip.
 *
 * Sharp's resize uses Lanczos3 by default — the quality-preserving
 * choice for downsampling natural images. We re-encode to JPEG at
 * quality 80; PNG would be 3-10× the bytes with no Claude-side benefit.
 *
 * Never stretches. `fit: 'inside'` means the result is ≤ target on
 * both dimensions, not padded to exactly target — so a 2560×1440
 * frame going to 1568px-long-edge lands at 1568×882, not 1568×1568.
 */
export async function resizeForVisionModel(
  base64Jpeg: string,
  originalWidth: number,
  originalHeight: number,
  maxLongEdge: number = VISION_MODEL_MAX_LONG_EDGE,
): Promise<ResizedImage> {
  if (originalWidth <= 0 || originalHeight <= 0) {
    throw new Error(
      `resizeForVisionModel: invalid viewport dims ${originalWidth}×${originalHeight}`,
    );
  }
  const longEdge = Math.max(originalWidth, originalHeight);
  // Passthrough branch: driver's frame is already ≤ threshold, so
  // Claude won't resample it. Save the CPU and emit a scale=1
  // descriptor with the original bytes untouched.
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
  const buffer = Buffer.from(base64Jpeg, 'base64');
  // Ask sharp for post-resize dims rather than trusting our own math —
  // sharp's rounding matches what downstream tools will see, and that
  // exact number is what we need for scaleX/scaleY so clicks land true.
  const { data, info } = await sharp(buffer)
    .resize({
      width: originalWidth >= originalHeight ? maxLongEdge : undefined,
      height: originalHeight > originalWidth ? maxLongEdge : undefined,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .jpeg({ quality: VISION_MODEL_JPEG_QUALITY })
    .toBuffer({ resolveWithObject: true });
  return {
    base64: data.toString('base64'),
    originalWidth,
    originalHeight,
    resizedWidth: info.width,
    resizedHeight: info.height,
    scaleX: info.width / originalWidth,
    scaleY: info.height / originalHeight,
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
