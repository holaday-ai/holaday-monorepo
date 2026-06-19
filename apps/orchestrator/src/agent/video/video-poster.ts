import type { FfmpegExecOpts } from './ffmpeg-exec.js';

/**
 * First-frame JPEG poster for a finished 成片.
 *
 * The SPA's inline preview eagerly fetched the whole 5MB+ video blob and fed
 * it to a `<video>` that often stalled (readyState 0) — see batch-2 design.
 * Instead the backend extracts a ~50KB poster here (ffmpeg is already
 * installed + reliable server-side, no blob decode), the SPA shows the poster
 * `<img>` (images decode fine) + a download / click-to-play affordance.
 */
export interface PosterCommand {
  bin: string;
  args: string[];
}

/** ffmpeg argv to grab frame 0 as a quality-3 JPEG. */
export function buildPosterCommand(input: {
  videoPath: string;
  posterPath: string;
  ffmpegBin?: string;
}): PosterCommand {
  return {
    bin: input.ffmpegBin ?? 'ffmpeg',
    args: ['-y', '-i', input.videoPath, '-frames:v', '1', '-q:v', '3', input.posterPath],
  };
}

export interface PosterDeps {
  runFfmpeg: (cmd: { bin: string; args: readonly string[] }, opts?: FfmpegExecOpts) => Promise<void>;
  readFile: (path: string) => Promise<Buffer>;
  storeOutput: (i: { filename: string; mimetype: string; buffer: Buffer }) => Promise<{ fileId: string }>;
  logger: { warn: (obj: unknown, msg?: string) => void };
}

/**
 * Generate + store the poster. **NON-FATAL**: any failure (ffmpeg error /
 * unreadable frame / store error) is swallowed + logged — the 成片 itself is
 * already stored and must complete regardless; posterUrl just stays empty and
 * the SPA degrades to a generic placeholder. Returns the poster's fileId, or
 * null when it couldn't be produced.
 */
export async function generatePosterFile(input: {
  videoPath: string;
  posterPath: string;
  deps: PosterDeps;
  ffOpts?: FfmpegExecOpts;
}): Promise<string | null> {
  try {
    const cmd = buildPosterCommand({
      videoPath: input.videoPath,
      posterPath: input.posterPath,
      ...(input.ffOpts?.ffmpegBin ? { ffmpegBin: input.ffOpts.ffmpegBin } : {}),
    });
    await input.deps.runFfmpeg(cmd, input.ffOpts);
    const buffer = await input.deps.readFile(input.posterPath);
    const stored = await input.deps.storeOutput({ filename: 'poster.jpg', mimetype: 'image/jpeg', buffer });
    return stored.fileId;
  } catch (err) {
    input.deps.logger.warn(
      { err: err instanceof Error ? err.message : String(err) },
      'video: poster generation failed (non-fatal) — 成片照常完成，posterUrl 留空',
    );
    return null;
  }
}
