/**
 * FFmpeg / ffprobe subprocess layer for the video lane (step ⑥ + audio
 * duration measurement for the timeline).
 *
 * `spawn` is injected so the command construction + ffprobe parsing are
 * unit-testable without a real binary; the lane (3e wiring) calls these
 * against the real ffmpeg 4.4.2 installed on Vultr (libx264 + aac verified).
 */

import { spawn as nodeSpawn, type SpawnOptions } from 'node:child_process';

export interface ProcLike {
  stdout: { on(ev: 'data', cb: (chunk: Buffer | string) => void): void } | null;
  stderr: { on(ev: 'data', cb: (chunk: Buffer | string) => void): void } | null;
  on(ev: 'close', cb: (code: number | null) => void): void;
  on(ev: 'error', cb: (err: Error) => void): void;
  kill(signal?: NodeJS.Signals | number): void;
}
export type SpawnFn = (cmd: string, args: readonly string[], options?: SpawnOptions) => ProcLike;

export interface FfmpegExecOpts {
  ffmpegBin?: string;
  ffprobeBin?: string;
  spawnFn?: SpawnFn;
  /** Wall-clock cap. Default 10min (a multi-clip vertical compose can be slow). */
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 600_000;

/** Run a binary; capture stdout/stderr; reject on non-zero exit, spawn error, or timeout. */
async function runProcess(
  bin: string,
  args: readonly string[],
  opts: FfmpegExecOpts,
): Promise<{ stdout: string; stderr: string }> {
  const spawnFn = opts.spawnFn ?? (nodeSpawn as unknown as SpawnFn);
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  return new Promise((resolve, reject) => {
    let child: ProcLike;
    try {
      child = spawnFn(bin, args, {});
    } catch (err) {
      reject(err);
      return;
    }
    let stdout = '';
    let stderr = '';
    let done = false;
    const finish = (fn: () => void) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      fn();
    };
    const timer = setTimeout(() => {
      finish(() => {
        try {
          child.kill('SIGKILL');
        } catch {
          /* already gone */
        }
        reject(new Error(`${bin} timed out after ${timeoutMs}ms`));
      });
    }, timeoutMs);
    child.stdout?.on('data', (c) => {
      stdout += c.toString();
    });
    child.stderr?.on('data', (c) => {
      stderr += c.toString();
    });
    child.on('error', (err) => finish(() => reject(err)));
    child.on('close', (code) =>
      finish(() => {
        if (code === 0) resolve({ stdout, stderr });
        else reject(new Error(`${bin} exited ${code}: ${stderr.slice(0, 500)}`));
      }),
    );
  });
}

/** Probe a media file's duration → milliseconds. Throws on a missing/invalid duration. */
export async function ffprobeDurationMs(filePath: string, opts: FfmpegExecOpts = {}): Promise<number> {
  const args = [
    '-v',
    'error',
    '-show_entries',
    'format=duration',
    '-of',
    'default=noprint_wrappers=1:nokey=1',
    filePath,
  ];
  const { stdout } = await runProcess(opts.ffprobeBin ?? 'ffprobe', args, opts);
  const sec = Number.parseFloat(stdout.trim());
  if (!Number.isFinite(sec) || sec <= 0) {
    throw new Error(`ffprobe: bad duration "${stdout.trim()}" for ${filePath}`);
  }
  return Math.round(sec * 1000);
}

export interface VideoMetadata {
  readonly width: number;
  readonly height: number;
  readonly durationMs: number;
}

export interface MediaIntegrityReport {
  readonly durationMs: number;
  readonly hasVideo: boolean;
  readonly hasAudio: boolean;
  /** Fraction of the container duration covered by ffmpeg's freeze detector. */
  readonly frozenRatio: number;
  readonly audioMeanVolumeDb: number | null;
  readonly audioMaxVolumeDb: number | null;
}

function parseDbValue(stderr: string, key: 'mean_volume' | 'max_volume'): number | null {
  const value = stderr.match(new RegExp(`${key}:\\s*(-?(?:\\d+(?:\\.\\d+)?|inf))\\s*dB`, 'i'))?.[1];
  if (!value || value.toLowerCase() === '-inf') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function frozenDurationSeconds(stderr: string, durationSeconds: number): number {
  const starts = [...stderr.matchAll(/lavfi\.freezedetect\.freeze_start:\s*([\d.]+)/g)].map(
    (match) => Number(match[1]),
  );
  const durations = [
    ...stderr.matchAll(/lavfi\.freezedetect\.freeze_duration:\s*([\d.]+)/g),
  ].map((match) => Number(match[1]));
  let total = durations.reduce(
    (sum, duration) => sum + (Number.isFinite(duration) && duration > 0 ? duration : 0),
    0,
  );
  if (starts.length > durations.length) {
    const trailingStart = starts.at(-1);
    if (trailingStart !== undefined && Number.isFinite(trailingStart)) {
      total += Math.max(0, durationSeconds - trailingStart);
    }
  }
  return Math.min(durationSeconds, Math.max(0, total));
}

/**
 * Deterministic media gate used before the visual LLM verifier. Static frame
 * sampling cannot prove that a video moves or that its audio is audible.
 */
export async function inspectMediaIntegrity(
  filePath: string,
  opts: FfmpegExecOpts = {},
): Promise<MediaIntegrityReport> {
  const { stdout } = await runProcess(
    opts.ffprobeBin ?? 'ffprobe',
    [
      '-v',
      'error',
      '-show_entries',
      'stream=codec_type:format=duration',
      '-of',
      'json',
      filePath,
    ],
    opts,
  );
  let payload: {
    streams?: Array<{ codec_type?: string }>;
    format?: { duration?: string | number };
  };
  try {
    payload = JSON.parse(stdout) as typeof payload;
  } catch {
    throw new Error(`ffprobe: bad media integrity metadata for ${filePath}`);
  }
  const durationSeconds = Number(payload.format?.duration);
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    throw new Error(`ffprobe: bad media integrity duration for ${filePath}`);
  }
  const hasVideo = payload.streams?.some((stream) => stream.codec_type === 'video') ?? false;
  const hasAudio = payload.streams?.some((stream) => stream.codec_type === 'audio') ?? false;

  let frozenRatio = 0;
  if (hasVideo) {
    const { stderr } = await runProcess(
      opts.ffmpegBin ?? 'ffmpeg',
      [
        '-hide_banner',
        '-i',
        filePath,
        '-map',
        '0:v:0',
        '-vf',
        'freezedetect=n=-40dB:d=0.5',
        '-an',
        '-f',
        'null',
        '-',
      ],
      opts,
    );
    frozenRatio = Number(
      (frozenDurationSeconds(stderr, durationSeconds) / durationSeconds).toFixed(4),
    );
  }

  let audioMeanVolumeDb: number | null = null;
  let audioMaxVolumeDb: number | null = null;
  if (hasAudio) {
    const { stderr } = await runProcess(
      opts.ffmpegBin ?? 'ffmpeg',
      [
        '-hide_banner',
        '-i',
        filePath,
        '-map',
        '0:a:0',
        '-af',
        'volumedetect',
        '-vn',
        '-sn',
        '-dn',
        '-f',
        'null',
        '-',
      ],
      opts,
    );
    audioMeanVolumeDb = parseDbValue(stderr, 'mean_volume');
    audioMaxVolumeDb = parseDbValue(stderr, 'max_volume');
  }

  return {
    durationMs: Math.round(durationSeconds * 1000),
    hasVideo,
    hasAudio,
    frozenRatio,
    audioMeanVolumeDb,
    audioMaxVolumeDb,
  };
}

/** Probe the first video stream plus container duration in one ffprobe call. */
export async function ffprobeVideoMetadata(
  filePath: string,
  opts: FfmpegExecOpts = {},
): Promise<VideoMetadata> {
  const args = [
    '-v',
    'error',
    '-select_streams',
    'v:0',
    '-show_entries',
    'stream=width,height:format=duration',
    '-of',
    'json',
    filePath,
  ];
  const { stdout } = await runProcess(opts.ffprobeBin ?? 'ffprobe', args, opts);
  let payload: {
    streams?: Array<{ width?: number; height?: number }>;
    format?: { duration?: string | number };
  };
  try {
    payload = JSON.parse(stdout) as typeof payload;
  } catch {
    throw new Error(`ffprobe: bad video metadata for ${filePath}`);
  }
  const stream = payload.streams?.[0];
  const width = Number(stream?.width);
  const height = Number(stream?.height);
  const durationSeconds = Number(payload.format?.duration);
  if (
    !Number.isFinite(width) ||
    width <= 0 ||
    !Number.isFinite(height) ||
    height <= 0 ||
    !Number.isFinite(durationSeconds) ||
    durationSeconds <= 0
  ) {
    throw new Error(`ffprobe: bad video metadata for ${filePath}`);
  }
  return {
    width: Math.round(width),
    height: Math.round(height),
    durationMs: Math.round(durationSeconds * 1000),
  };
}

export interface RenderImageClipInput {
  imagePath: string;
  audioPath: string;
  outPath: string;
  durationMs: number;
  width?: number;
  height?: number;
  fps?: number;
}

/**
 * Render a still B-roll image over its narration audio into a fixed-length
 * vertical mp4 clip (so a B-roll segment becomes a concat-able clip the same
 * requested by the pipeline). Short narration is padded with silence so it
 * cannot truncate the selected visual duration.
 */
export async function renderImageClip(
  input: RenderImageClipInput,
  opts: FfmpegExecOpts = {},
): Promise<void> {
  const W = input.width ?? 1080;
  const H = input.height ?? 1920;
  const FPS = input.fps ?? 30;
  const durSec = (input.durationMs / 1000).toFixed(3);
  const args = [
    '-y',
    '-loop',
    '1',
    '-framerate',
    String(FPS),
    '-i',
    input.imagePath,
    '-i',
    input.audioPath,
    '-t',
    durSec,
    '-vf',
    `scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,fps=${FPS}`,
    '-af',
    'apad',
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    '-b:a',
    '192k',
    input.outPath,
  ];
  await runProcess(opts.ffmpegBin ?? 'ffmpeg', args, opts);
}

/** Execute a prebuilt ffmpeg command (e.g. from buildComposeCommand). */
export async function runFfmpeg(
  cmd: { bin: string; args: readonly string[] },
  opts: FfmpegExecOpts = {},
): Promise<void> {
  await runProcess(cmd.bin, cmd.args, opts);
}

export interface RenderKenBurnsInput {
  imagePath: string;
  audioPath: string;
  outPath: string;
  durationMs: number;
  width?: number;
  height?: number;
  fps?: number;
}

/**
 * 原方案 default visual — a still image with a slow Ken Burns zoom over its
 * narration audio → a fixed-length vertical clip (gives a static AI image a
 * "video feel" cheaply). zoompan z ramps with the output frame index `on`.
 */
export async function renderImageKenBurns(
  input: RenderKenBurnsInput,
  opts: FfmpegExecOpts = {},
): Promise<void> {
  const W = input.width ?? 1080;
  const H = input.height ?? 1920;
  const FPS = input.fps ?? 30;
  const durSec = (input.durationMs / 1000).toFixed(3);
  const args = [
    '-y',
    '-loop',
    '1',
    '-framerate',
    String(FPS),
    '-i',
    input.imagePath,
    '-i',
    input.audioPath,
    '-t',
    durSec,
    // Upscale 2× before zoompan so the per-frame zoom downsamples to sub-pixel
    // smoothness (fixes jitter, P1-1); GENTLE zoom 1.0→1.08 at a constant fps.
    '-vf',
    `scale=${W * 2}:${H * 2}:force_original_aspect_ratio=increase,crop=${W * 2}:${H * 2},` +
      `zoompan=z='min(1+0.00035*on,1.08)':d=1:fps=${FPS}:s=${W}x${H}:` +
      `x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)',setsar=1`,
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    '-b:a',
    '192k',
    '-shortest',
    input.outPath,
  ];
  await runProcess(opts.ffmpegBin ?? 'ffmpeg', args, opts);
}

export interface RenderVideoClipInput {
  /** A generated background video (Veo / Wanxiang t2v). */
  videoPath: string;
  audioPath: string;
  outPath: string;
  durationMs: number;
  width?: number;
  height?: number;
  fps?: number;
}

/**
 * 原方案 optional video visual — loop+trim a generated background video to the
 * requested clip length and mux the NARRATION audio (drop the source video's
 * audio, e.g. Veo's bundled track) → a fixed-length vertical clip. `-stream_loop`
 * covers the case where the bg video is shorter than the narration.
 */
export async function renderVideoClip(
  input: RenderVideoClipInput,
  opts: FfmpegExecOpts = {},
): Promise<void> {
  const W = input.width ?? 1080;
  const H = input.height ?? 1920;
  const FPS = input.fps ?? 30;
  const durSec = (input.durationMs / 1000).toFixed(3);
  const args = [
    '-y',
    '-stream_loop',
    '-1',
    '-i',
    input.videoPath,
    '-i',
    input.audioPath,
    '-t',
    durSec,
    '-vf',
    `scale=${W}:${H}:force_original_aspect_ratio=decrease,` +
      `pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,fps=${FPS}`,
    '-map',
    '0:v:0',
    '-map',
    '1:a:0',
    '-af',
    'apad',
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    '-b:a',
    '192k',
    input.outPath,
  ];
  await runProcess(opts.ffmpegBin ?? 'ffmpeg', args, opts);
}
