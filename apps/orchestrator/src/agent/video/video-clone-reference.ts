import { ffprobeDurationMs } from './ffmpeg-exec.js';

type DurationProbe = (source: string) => Promise<number>;

export async function probeCloneReferenceDurationSeconds(
  source: string,
  probe: DurationProbe = ffprobeDurationMs,
): Promise<number> {
  const durationMs = await probe(source);
  const durationSeconds = durationMs / 1_000;
  if (durationSeconds < 2 || durationSeconds > 30) {
    throw new Error('参考视频时长必须在 2 到 30 秒之间。');
  }
  return Math.round(durationSeconds * 10) / 10;
}
