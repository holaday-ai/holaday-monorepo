// @vitest-environment happy-dom
import { expect, it } from 'vitest';
import { installVncPointerPrecisionBridge } from './vnc-pointer-precision';
it('preserves subpixel coordinates for noVNC framebuffer conversion and suppresses duplicate mouse events', () => {
  const canvas = document.createElement('canvas');
  const dispose = installVncPointerPrecisionBridge(canvas);
  const points: number[] = [];
  canvas.addEventListener('mousedown', (e) => points.push(e.clientX));
  canvas.dispatchEvent(
    new PointerEvent('pointerdown', {
      clientX: 31.6875,
      clientY: 40.125,
      pointerType: 'mouse',
      button: 0,
      bubbles: true,
    }),
  );
  canvas.dispatchEvent(new MouseEvent('mousedown', { clientX: 31, clientY: 40, bubbles: true }));
  expect(points).toEqual([31.6875]);
  dispose();
  canvas.dispatchEvent(new MouseEvent('mousedown', { clientX: 10 }));
  expect(points).toEqual([31.6875, 10]);
});
