import {
  ffprobeDurationMs,
  inspectMediaIntegrity,
  type MediaIntegrityReport,
} from './ffmpeg-exec.js';

type DurationProbe = (source: string) => Promise<number>;
type IntegrityProbe = (source: string) => Promise<MediaIntegrityReport>;

function normalizedDurationSeconds(durationMs: number): number {
  const durationSeconds = durationMs / 1_000;
  if (durationSeconds < 2 || durationSeconds > 30) {
    throw new Error('参考视频时长必须在 2 到 30 秒之间。');
  }
  return Math.round(durationSeconds * 10) / 10;
}

export async function probeCloneReferenceDurationSeconds(
  source: string,
  probe: DurationProbe = ffprobeDurationMs,
): Promise<number> {
  return normalizedDurationSeconds(await probe(source));
}

export async function probeCloneReferenceQuoteFacts(
  source: string,
  probe: IntegrityProbe = inspectMediaIntegrity,
): Promise<{
  durationSeconds: number;
  hasAudibleAudio: boolean;
}> {
  const integrity = await probe(source);
  return {
    durationSeconds: normalizedDurationSeconds(integrity.durationMs),
    hasAudibleAudio:
      integrity.hasAudio &&
      integrity.audioMaxVolumeDb !== null &&
      integrity.audioMaxVolumeDb > -50,
  };
}
