/**
 * Video pipeline runner — orchestrates the per-segment steps:
 *   ② Qwen3-TTS-VC narration audio  → ③ Wanxiang B-roll / ④ fal lip-sync
 *   → ⑤ subtitles (via timeline).
 * Script generation (①) is upstream; FFmpeg compose (⑥) is downstream —
 * the runner returns the per-segment clips + timeline + SRT for the
 * compositor (see video-compose).
 *
 * PURE ORCHESTRATION — every external effect (synthesis, B-roll, lip-sync,
 * storage) is an INJECTED dep, so the sequencing / per-segment retry /
 * timeline construction are fully unit-testable without real APIs. The
 * lane (step 3e) wires the deps to the real adapters + R2 + ffprobe.
 *
 * Constraints baked in here:
 *   - 单句独立处理、失败只重试该句 (withRetry per segment step).
 *   - 以音频时长为基础；有明确成片时长时，每段不得短于该时长。
 *   - fire-and-poll lives inside `lipSyncSegment` (the dep wraps
 *     fal runLipSync); the runner itself is meant to run in a background
 *     coroutine — the lane never awaits it on the request thread.
 *   - broll n=1 / OSS→R2-immediately are the dep impl's responsibility
 *     (documented at the wiring site), not the orchestration's.
 */

import type { Timeline, SegmentType, VideoScript } from './types.js';
import { buildSrt, buildTimeline } from './timeline.js';

export interface PipelineLogger {
  info(obj: unknown, msg?: string): void;
  warn(obj: unknown, msg?: string): void;
  error(obj: unknown, msg?: string): void;
}

export interface VideoPipelineDeps {
  /** ② Synthesize a segment's narration in the cloned voice; persist; return ref + MEASURED duration (ms). */
  synthesizeSegmentAudio(seg: { index: number; text: string }): Promise<{
    audioRef: string;
    durationMs: number;
  }>;
  /** ③ Generate + persist a B-roll visual (caller passes n=1) for a broll segment. */
  generateBroll(seg: { index: number; visual: string }): Promise<{ visualRef: string }>;
  /** ③ Render a broll visual over its narration audio into a fixed-duration clip; persist; return clip ref. */
  renderBrollClip(seg: {
    index: number;
    visualRef: string;
    audioRef: string;
    durationMs: number;
  }): Promise<{ clipRef: string }>;
  /** ④ Lip-sync the base video with a segment's narration (fire-and-poll inside); persist; return clip ref. */
  lipSyncSegment(seg: {
    index: number;
    audioRef: string;
    durationMs: number;
  }): Promise<{ clipRef: string }>;
  logger: PipelineLogger;
  /** Optional progress hook for WS broadcast. */
  onProgress?: (p: { stage: string; segmentIndex?: number; done: number; total: number }) => void;
}

export interface VideoPipelineInput {
  readonly script: VideoScript;
  /** Per-segment-step retry count (single failed句 only retries that句). Default 1 → 2 attempts. */
  readonly retries?: number;
  /** Keep each rendered segment at least this long, padding shorter narration with silence. */
  readonly minimumSegmentDurationMs?: number;
}

export interface SegmentResult {
  readonly index: number;
  readonly type: SegmentType;
  readonly text: string;
  readonly audioRef: string;
  readonly durationMs: number;
  readonly visualRef?: string;
  /** The per-segment video clip (lip-sync output for 口播, broll-over-audio for B-roll). */
  readonly clipRef: string;
}

export interface VideoPipelineResult {
  readonly timeline: Timeline;
  readonly srt: string;
  readonly segments: SegmentResult[];
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function isExplicitlyNonRetryable(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'retryable' in err &&
    (err as { retryable?: unknown }).retryable === false
  );
}

/** Run `fn`, retrying up to `retries` extra times. Only this step is retried (单句重试). */
async function withRetry<T>(
  label: string,
  fn: () => Promise<T>,
  retries: number,
  logger: PipelineLogger,
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (isExplicitlyNonRetryable(err)) {
        logger.error({ label, attempt, err: errMsg(err) }, 'video: segment step is non-retryable');
        throw err;
      }
      if (attempt < retries) {
        logger.warn(
          { label, attempt, err: errMsg(err) },
          'video: segment step failed — retrying this句 only',
        );
      } else {
        logger.error({ label, attempt, err: errMsg(err) }, 'video: segment step exhausted retries');
      }
    }
  }
  throw lastErr;
}

/**
 * Orchestrate steps ②→⑤ for a script. Synthesizes all narration first
 * (its measured durations are the timeline's source of truth), builds the
 * timeline + SRT, then produces each segment's clip (lip-sync for 口播,
 * B-roll-over-audio for B-roll). Each step retries独立. The returned
 * clips + timeline + SRT feed the FFmpeg compositor (⑥).
 */
export async function runVideoPipeline(
  input: VideoPipelineInput,
  deps: VideoPipelineDeps,
): Promise<VideoPipelineResult> {
  const segs = input.script.segments;
  const retries = input.retries ?? 1;
  const total = segs.length;
  if (total === 0) throw new Error('video pipeline: script has no segments');

  // ② narration audio per segment — durations drive the timeline.
  const audio: Array<{ audioRef: string; durationMs: number }> = [];
  for (let i = 0; i < total; i += 1) {
    deps.onProgress?.({ stage: 'synthesize', segmentIndex: i, done: i, total });
    audio.push(
      await withRetry(
        `synth#${i}`,
        () => deps.synthesizeSegmentAudio({ index: i, text: segs[i]!.text }),
        retries,
        deps.logger,
      ),
    );
  }

  // ⑤ timeline + subtitles. Preserve the selected/quoted visual duration even
  // when narration is shorter; longer narration still remains intact.
  const segmentDurations = audio.map((item) =>
    Math.max(item.durationMs, input.minimumSegmentDurationMs ?? 0),
  );
  const timeline = buildTimeline(segs, segmentDurations);
  const srt = buildSrt(timeline);

  // ③/④ per-segment clip.
  const results: SegmentResult[] = [];
  for (let i = 0; i < total; i += 1) {
    const seg = segs[i]!;
    const a = audio[i]!;
    const durationMs = segmentDurations[i]!;
    if (seg.type === 'voiceover') {
      deps.onProgress?.({ stage: 'lipsync', segmentIndex: i, done: i, total });
      const r = await withRetry(
        `lipsync#${i}`,
        () => deps.lipSyncSegment({ index: i, audioRef: a.audioRef, durationMs }),
        retries,
        deps.logger,
      );
      results.push({
        index: i,
        type: seg.type,
        text: seg.text,
        audioRef: a.audioRef,
        durationMs,
        clipRef: r.clipRef,
      });
    } else {
      deps.onProgress?.({ stage: 'broll', segmentIndex: i, done: i, total });
      const visual = seg.visual ?? seg.text;
      const b = await withRetry(
        `broll#${i}`,
        () => deps.generateBroll({ index: i, visual }),
        retries,
        deps.logger,
      );
      const c = await withRetry(
        `brollclip#${i}`,
        () =>
          deps.renderBrollClip({
            index: i,
            visualRef: b.visualRef,
            audioRef: a.audioRef,
            durationMs,
          }),
        retries,
        deps.logger,
      );
      results.push({
        index: i,
        type: seg.type,
        text: seg.text,
        audioRef: a.audioRef,
        durationMs,
        visualRef: b.visualRef,
        clipRef: c.clipRef,
      });
    }
  }

  deps.onProgress?.({ stage: 'done', done: total, total });
  deps.logger.info(
    { segments: total, totalDurationMs: timeline.totalDurationMs },
    'video: pipeline segments complete (awaiting compose)',
  );
  return { timeline, srt, segments: results };
}
