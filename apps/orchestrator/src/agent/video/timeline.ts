/**
 * Timeline alignment + subtitle (SRT) generation.
 *
 * CONSTRAINT (BOSS, 钉死): 以音频时长为基准反推视频/字幕 —— the synthesized
 * narration audio length is the SINGLE SOURCE OF TRUTH. Each segment's
 * video clip (lip-sync output for 口播; B-roll shown for the audio length)
 * and its subtitle cue inherit the EXACT duration of that segment's audio,
 * and segments are laid end-to-end with no gaps. This keeps audio, video,
 * and subtitles frame-synced no matter how the TTS paces a sentence.
 *
 * Pure functions — no IO. The runner measures each audio's real duration
 * (ffprobe) and feeds the array here.
 */

import type { Timeline, TimelineSegment, VideoSegment } from './types.js';

/**
 * Build the timeline from per-segment narration audio durations (ms).
 * `audioDurationsMs[i]` is the measured length of segment i's synthesized
 * audio. Throws on a length mismatch or a non-positive duration (a silent /
 * failed synth must not silently collapse a segment to zero length).
 */
export function buildTimeline(
  segments: readonly VideoSegment[],
  audioDurationsMs: readonly number[],
): Timeline {
  if (segments.length !== audioDurationsMs.length) {
    throw new Error(
      `timeline: ${segments.length} segments but ${audioDurationsMs.length} audio durations`,
    );
  }
  const out: TimelineSegment[] = [];
  let cursor = 0;
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i]!;
    const dur = audioDurationsMs[i]!;
    if (!Number.isFinite(dur) || dur <= 0) {
      throw new Error(`timeline: segment ${i} has non-positive audio duration ${dur}`);
    }
    out.push({
      index: i,
      type: seg.type,
      text: seg.text,
      startMs: cursor,
      endMs: cursor + dur,
      durationMs: dur,
    });
    cursor += dur;
  }
  return { segments: out, totalDurationMs: cursor };
}

/** Format milliseconds → SRT timecode `HH:MM:SS,mmm`. */
export function formatSrtTime(ms: number): string {
  const total = Math.max(0, Math.round(ms));
  const h = Math.floor(total / 3_600_000);
  const m = Math.floor((total % 3_600_000) / 60_000);
  const s = Math.floor((total % 60_000) / 1_000);
  const millis = total % 1_000;
  const p2 = (n: number) => String(n).padStart(2, '0');
  return `${p2(h)}:${p2(m)}:${p2(s)},${String(millis).padStart(3, '0')}`;
}

/**
 * Render the timeline to an SRT subtitle string — one cue per segment,
 * timecoded to that segment's [startMs, endMs). Cue indices are 1-based
 * (SRT convention). Blank-line separated.
 */
export function buildSrt(timeline: Timeline): string {
  return timeline.segments
    .map((seg, i) => {
      const text = seg.text.trim();
      return `${i + 1}\n${formatSrtTime(seg.startMs)} --> ${formatSrtTime(seg.endMs)}\n${text}\n`;
    })
    .join('\n');
}
