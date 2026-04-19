import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import {
  VISION_MODEL_JPEG_QUALITY,
  VISION_MODEL_MAX_LONG_EDGE,
  modelCoordToReal,
  resizeForVisionModel,
} from './image.js';

/**
 * Produce a synthetic JPEG of the given dimensions. Flat colour — we
 * only care about the dimensions and the JPEG header, not the content.
 */
async function makeJpeg(width: number, height: number): Promise<string> {
  const buffer = await sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 80, g: 120, b: 200 },
    },
  })
    .jpeg({ quality: VISION_MODEL_JPEG_QUALITY })
    .toBuffer();
  return buffer.toString('base64');
}

async function dimsFromBase64(b64: string): Promise<{ width: number; height: number }> {
  const meta = await sharp(Buffer.from(b64, 'base64')).metadata();
  if (!meta.width || !meta.height) throw new Error('sharp metadata missing dims');
  return { width: meta.width, height: meta.height };
}

describe('resizeForVisionModel', () => {
  it('passthrough when both dimensions are ≤ max long edge', async () => {
    const b64 = await makeJpeg(1280, 800);
    const out = await resizeForVisionModel(b64, 1280, 800);
    // Same bytes, scale=1 — the passthrough contract.
    expect(out.base64).toBe(b64);
    expect(out.scaleX).toBe(1);
    expect(out.scaleY).toBe(1);
    expect(out.resizedWidth).toBe(1280);
    expect(out.resizedHeight).toBe(800);
    expect(out.originalWidth).toBe(1280);
    expect(out.originalHeight).toBe(800);
  });

  it('resizes landscape viewport, clamping the long edge to the target', async () => {
    // 2560×1440 landscape → long edge 2560 > 1568. Expect width=1568, height=882.
    const b64 = await makeJpeg(2560, 1440);
    const out = await resizeForVisionModel(b64, 2560, 1440);
    expect(out.resizedWidth).toBe(VISION_MODEL_MAX_LONG_EDGE);
    // Aspect ratio preserved (±1 px for rounding at sharp's end).
    expect(out.resizedHeight).toBeGreaterThanOrEqual(881);
    expect(out.resizedHeight).toBeLessThanOrEqual(883);
    // Actual bytes differ from input (we JPEG-re-encoded at q80).
    expect(out.base64).not.toBe(b64);
    // Scale factors reflect what sharp actually produced.
    expect(out.scaleX).toBeCloseTo(out.resizedWidth / 2560, 5);
    expect(out.scaleY).toBeCloseTo(out.resizedHeight / 1440, 5);
    // And the image on the wire really is the reported size.
    const dims = await dimsFromBase64(out.base64);
    expect(dims.width).toBe(out.resizedWidth);
    expect(dims.height).toBe(out.resizedHeight);
  });

  it('resizes portrait viewport, clamping the taller edge', async () => {
    // 1080×1920 portrait → long edge 1920 > 1568. Expect height=1568, width≈882.
    const b64 = await makeJpeg(1080, 1920);
    const out = await resizeForVisionModel(b64, 1080, 1920);
    expect(out.resizedHeight).toBe(VISION_MODEL_MAX_LONG_EDGE);
    expect(out.resizedWidth).toBeGreaterThanOrEqual(881);
    expect(out.resizedWidth).toBeLessThanOrEqual(883);
    const dims = await dimsFromBase64(out.base64);
    expect(dims.width).toBe(out.resizedWidth);
    expect(dims.height).toBe(out.resizedHeight);
  });

  it('honours a custom maxLongEdge (future tuning)', async () => {
    const b64 = await makeJpeg(2000, 1000);
    const out = await resizeForVisionModel(b64, 2000, 1000, 1000);
    expect(out.resizedWidth).toBe(1000);
    expect(out.resizedHeight).toBe(500);
  });

  it('rejects nonsensical dims before reaching sharp', async () => {
    await expect(resizeForVisionModel('deadbeef', 0, 600)).rejects.toThrow(/invalid viewport/);
    await expect(resizeForVisionModel('deadbeef', 600, -1)).rejects.toThrow(/invalid viewport/);
  });
});

describe('modelCoordToReal', () => {
  it('inverts the scale so a click on the resized frame lands on the right real pixel', () => {
    // Simulate a 2560×1440 viewport resized to ~1568×882 (scale ≈ 0.6125).
    // Claude clicks at (800, 400) in model-space; expect ~1306, 653 real.
    const img = { scaleX: 1568 / 2560, scaleY: 882 / 1440 };
    const real = modelCoordToReal(800, 400, img);
    expect(real.x).toBe(1306);
    expect(real.y).toBe(653);
  });

  it('passes through 1:1 when scale=1 (passthrough path from resizeForVisionModel)', () => {
    const real = modelCoordToReal(640, 480, { scaleX: 1, scaleY: 1 });
    expect(real).toEqual({ x: 640, y: 480 });
  });

  it('throws on a zero scale factor rather than emit an Infinity coordinate', () => {
    expect(() => modelCoordToReal(100, 100, { scaleX: 0, scaleY: 0.5 })).toThrow(/zero scale/);
    expect(() => modelCoordToReal(100, 100, { scaleX: 0.5, scaleY: 0 })).toThrow(/zero scale/);
  });
});

describe('resizeForVisionModel ↔ modelCoordToReal round trip', () => {
  it('a click at the centre of the resized frame maps to the centre of the real viewport', async () => {
    const b64 = await makeJpeg(2560, 1440);
    const img = await resizeForVisionModel(b64, 2560, 1440);
    const centreX = Math.floor(img.resizedWidth / 2);
    const centreY = Math.floor(img.resizedHeight / 2);
    const real = modelCoordToReal(centreX, centreY, img);
    // 2560/2 = 1280, 1440/2 = 720. Allow ±2 px for rounding through
    // sharp's integer resize + our integer coord math.
    expect(real.x).toBeGreaterThanOrEqual(1278);
    expect(real.x).toBeLessThanOrEqual(1282);
    expect(real.y).toBeGreaterThanOrEqual(718);
    expect(real.y).toBeLessThanOrEqual(722);
  });
});
