export const PIXEL_COORDINATE_PROMPT = '坐标系以当前截图的像素为基准（左上 0,0）。';
export const NORMALIZED_COORDINATE_PROMPT =
  'coordinate 和 start_coordinate 的 X、Y 两轴均使用 0–1000 归一化坐标，左上为 (0,0)，右下边缘为 (1000,1000)；不要返回像素坐标。执行器按当前截图宽高分别换算为像素。';

/** Convert only at the executor boundary; assistant history retains model-space coordinates. */
export function toBrowserPixels<
  T extends { action?: string; coordinate?: unknown; start_coordinate?: unknown },
>(input: T, width: number, height: number): { ok: true; input: T } | { ok: false; reason: string } {
  if (![width, height].every((size) => Number.isInteger(size) && size > 0)) {
    return { ok: false, reason: 'invalid coordinate viewport' };
  }
  const converted = { ...input };
  for (const field of ['coordinate', 'start_coordinate'] as const) {
    const value = input[field];
    if (value === undefined) continue;
    if (
      !Array.isArray(value) ||
      value.length !== 2 ||
      !value.every((n) => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1000)
    ) {
      return {
        ok: false,
        reason: `invalid ${field}: expected two numbers in 0–1000; reobserve before retrying`,
      };
    }
    // 1000 is the declared far edge: use its last addressable pixel. Never clamp invalid input.
    converted[field] = value.map((n: number, axis: number) => {
      const extent = axis === 0 ? width : height;
      return n === 1000 ? extent - 1 : Math.floor((n * extent) / 1000);
    });
  }
  return { ok: true, input: converted };
}
