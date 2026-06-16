/**
 * Phase 1 #4 — video creation pipeline data model.
 *
 * The pipeline is: script → Qwen3-TTS-VC voice clone (narration audio per
 * segment) → Wanxiang B-roll → fal lip-sync (口播 segments) → subtitles →
 * FFmpeg vertical compose. These types are shared by the runner, the
 * timeline aligner, and the FFmpeg compositor. Pure data — no behaviour.
 */

/** 口播 (talking-head, lip-synced base video) vs B-roll (AI visual). */
export type SegmentType = 'voiceover' | 'broll';

export interface VideoSegment {
  /** Narration spoken in the user's cloned voice over this segment. */
  readonly text: string;
  readonly type: SegmentType;
  /** B-roll visual prompt (only for type='broll'). */
  readonly visual?: string;
  /**
   * Optional 信息点字卡 (a short key term, ≤8 chars) overlaid by the ASS
   * subtitle layer (KeyCard style) —字体叠加, never AI-drawn, so it can't
   * garble. CRITICAL: keyText goes ONLY to buildAss; it is NEVER fed into any
   * image/video prompt. The generateBroll dep signature ({index, visual})
   * keeps keyText out of the visual at compile time.
   */
  readonly keyText?: string;
  /** Optional planning hint (seconds); the REAL length comes from the synthesized audio. */
  readonly durationHintSec?: number;
}

export interface VideoScript {
  readonly title: string;
  readonly segments: readonly VideoSegment[];
  readonly bgmMood?: string;
  readonly hashtags?: readonly string[];
}

export interface TimelineSegment {
  readonly index: number;
  readonly type: SegmentType;
  readonly text: string;
  /** Optional 信息点字卡 short term, carried through for the ASS KeyCard layer. */
  readonly keyText?: string;
  /** Inclusive start offset from t=0, ms. */
  readonly startMs: number;
  /** Exclusive end offset, ms (= startMs + durationMs). */
  readonly endMs: number;
  /** Duration = the segment's synthesized narration audio length, ms. */
  readonly durationMs: number;
}

export interface Timeline {
  readonly segments: readonly TimelineSegment[];
  readonly totalDurationMs: number;
}
