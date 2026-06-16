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
      ...(seg.keyText !== undefined ? { keyText: seg.keyText } : {}),
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

/** Format milliseconds → ASS timecode `H:MM:SS.cc` (centiseconds). */
export function formatAssTime(ms: number): string {
  const total = Math.max(0, Math.round(ms));
  const h = Math.floor(total / 3_600_000);
  const m = Math.floor((total % 3_600_000) / 60_000);
  const s = Math.floor((total % 60_000) / 1_000);
  const cs = Math.floor((total % 1_000) / 10);
  const p2 = (n: number) => String(n).padStart(2, '0');
  return `${h}:${p2(m)}:${p2(s)}.${p2(cs)}`;
}

/**
 * Wrap a (CJK-heavy) line to at most `maxPerLine` characters per visual line,
 * joining with the ASS hard line-break `\N`. Char-count ≈ visual width for
 * CJK, which is what we care about for staying inside the safe margins.
 */
export function wrapCjk(text: string, maxPerLine = 14): string {
  const t = text.trim().replace(/\s+/g, ' ');
  if (t.length <= maxPerLine) return t;
  const lines: string[] = [];
  for (let i = 0; i < t.length; i += maxPerLine) lines.push(t.slice(i, i + maxPerLine));
  return lines.join('\\N');
}

export interface AssStyleOptions {
  /** Subtitle font family (fontconfig). Default 'WenQuanYi Zen Hei' (present on Vultr). */
  fontName?: string;
  /** Font size in PlayRes px (PlayRes matches the video, so this is real px). Default 54. */
  fontSize?: number;
  width?: number; // PlayResX, default 1080
  height?: number; // PlayResY, default 1920
  /** Left/right safe margin px. Default 80 (BOSS asked ≥60). */
  marginH?: number;
  /** Bottom margin px. Default 140. */
  marginV?: number;
  /** Auto-wrap threshold (chars/line). Default 14 (CJK). */
  maxCharsPerLine?: number;
  /** KeyCard (信息点字卡) font size. Default 72 (bigger than subtitle). */
  keyFontSize?: number;
  /** KeyCard vertical margin from TOP (Alignment 8). Default 360 (中上, clears bottom subtitle). */
  keyMarginV?: number;
}

/** KeyCard 字卡颜色: 品牌 magenta #E50B6B → ASS &HAABBGGRR (BGR 倒序: BB=6B GG=0B RR=E5). */
const KEYCARD_COLOUR = '&H006B0BE5';

/**
 * Defend a keyText before it enters the ASS layer (范围2 防御): strip ASS
 * control chars (`{` `}` `\` — would inject override tags / break the file)
 * and newlines/tabs, trim, then hard-cap 8 chars. A dirty / over-long / empty
 * keyText degrades to `null` (that segment simply gets no KeyCard) — it can
 * never crash the ASS render or overflow. (schema is the first cap; this is
 * belt-and-braces for whatever the model emits.)
 */
export function sanitizeKeyText(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const cleaned = raw.replace(/[{}\\]/g, '').replace(/[\r\n\t]+/g, ' ').trim();
  if (!cleaned) return null;
  return cleaned.length > 8 ? cleaned.slice(0, 8) : cleaned;
}

/**
 * Render the timeline to a STYLED ASS subtitle string for FFmpeg's `ass`
 * filter. Fixes the SRT-default overflow (P0-1): PlayRes matches the video so
 * sizes/margins are real px; bottom-center alignment with L/R safe margins;
 * a CJK font; and each cue's text is auto-wrapped to maxCharsPerLine. Outline
 * for legibility over any background.
 */
export function buildAss(timeline: Timeline, opts: AssStyleOptions = {}): string {
  const W = opts.width ?? 1080;
  const H = opts.height ?? 1920;
  const font = opts.fontName ?? 'WenQuanYi Zen Hei';
  const size = opts.fontSize ?? 54;
  const mH = opts.marginH ?? 80;
  const mV = opts.marginV ?? 140;
  const maxChars = opts.maxCharsPerLine ?? 14;
  const keySize = opts.keyFontSize ?? 72;
  const keyMV = opts.keyMarginV ?? 360;
  const header = [
    '[Script Info]',
    'ScriptType: v4.00+',
    `PlayResX: ${W}`,
    `PlayResY: ${H}`,
    'WrapStyle: 2',
    'ScaledBorderAndShadow: yes',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    // 底部字幕: white text, black outline; Alignment 2 = bottom-center.
    `Style: Default,${font},${size},&H00FFFFFF,&H000000FF,&H00000000,&H80000000,0,0,0,0,100,100,0,0,1,3,1,2,${mH},${mH},${mV},1`,
    // 信息点字卡: magenta bold, thicker outline; Alignment 8 = top-center, MarginV from top.
    `Style: KeyCard,${font},${keySize},${KEYCARD_COLOUR},&H000000FF,&H00000000,&H80000000,1,0,0,0,100,100,0,0,1,4,1,8,${mH},${mH},${keyMV},1`,
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ].join('\n');
  // 底部字幕(每段一条 Default cue)。
  const subEvents = timeline.segments.map(
    (seg) =>
      `Dialogue: 0,${formatAssTime(seg.startMs)},${formatAssTime(seg.endMs)},Default,,0,0,0,,${wrapCjk(seg.text, maxChars)}`,
  );
  // 信息点字卡(只对 sanitize 后非空的 keyText 段叠 KeyCard cue, \fad 300ms 淡入淡出)。
  const keyEvents = timeline.segments
    .map((seg) => ({ seg, kt: sanitizeKeyText(seg.keyText) }))
    .filter((x): x is { seg: TimelineSegment; kt: string } => x.kt !== null)
    .map(
      ({ seg, kt }) =>
        `Dialogue: 0,${formatAssTime(seg.startMs)},${formatAssTime(seg.endMs)},KeyCard,,0,0,0,,{\\fad(300,300)}${kt}`,
    );
  const events = [...subEvents, ...keyEvents].join('\n');
  return `${header}\n${events}\n`;
}
