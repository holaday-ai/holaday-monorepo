import { describe, expect, it } from 'vitest';
import { toBrowserPixels } from './browser-coordinates.js';

describe('normalized browser coordinates', () => {
  it('converts both drag endpoints independently on a non-square viewport without mutation', () => {
    const input = {
      action: 'left_click_drag',
      start_coordinate: [250, 750],
      coordinate: [1000, 0],
      text: 'shift',
    };
    expect(toBrowserPixels(input, 800, 600)).toEqual({
      ok: true,
      input: { ...input, start_coordinate: [200, 450], coordinate: [799, 0] },
    });
    expect(input.start_coordinate).toEqual([250, 750]);
    expect(input.coordinate).toEqual([1000, 0]);
    expect(toBrowserPixels(input, 400, 300)).toEqual({
      ok: true,
      input: { ...input, start_coordinate: [100, 225], coordinate: [399, 0] },
    });
  });
  it.each(
    [
      [-1, 0],
      [1001, 5],
      [1],
      ['500', 500],
      [Number.NaN, 0],
      [Number.POSITIVE_INFINITY, 0],
      null,
    ].map((coordinate) => ({ coordinate })),
  )('rejects malformed coordinates $coordinate rather than clamping', ({ coordinate }) => {
    expect(toBrowserPixels({ action: 'left_click', coordinate }, 800, 600)).toMatchObject({
      ok: false,
    });
    expect(
      toBrowserPixels(
        { action: 'left_click_drag', coordinate: [100, 100], start_coordinate: coordinate },
        800,
        600,
      ),
    ).toMatchObject({ ok: false });
  });
  it.each([
    [0, 600],
    [800, -1],
    [Number.NaN, 600],
    [800, 0.5],
  ])('rejects invalid viewport %j', (width, height) => {
    expect(toBrowserPixels({ coordinate: [500, 500] }, width, height)).toMatchObject({ ok: false });
  });
  it('preserves actions with no coordinates', () => {
    expect(toBrowserPixels({ action: 'type', text: 'hello' }, 800, 600)).toEqual({
      ok: true,
      input: { action: 'type', text: 'hello' },
    });
  });
});
