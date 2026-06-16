import { describe, expect, it } from 'vitest';
import {
  buildAss,
  buildSrt,
  buildTimeline,
  formatAssTime,
  formatSrtTime,
  wrapCjk,
} from './timeline.js';
import type { VideoSegment } from './types.js';

const SEGS: VideoSegment[] = [
  { text: '姐妹们夏天到了千万别让紫外线毁了你的皮肤', type: 'voiceover' },
  { text: '防晒霜特写', type: 'broll', visual: '防晒霜产品特写' },
  { text: '记得每两小时补涂一次哦', type: 'voiceover' },
];

describe('buildTimeline — audio duration is the source of truth', () => {
  it('lays segments end-to-end; each duration = its audio length; total = sum', () => {
    const audio = [4000, 2500, 3200];
    const tl = buildTimeline(SEGS, audio);
    expect(tl.segments.map((s) => s.durationMs)).toEqual(audio);
    expect(tl.segments.map((s) => s.startMs)).toEqual([0, 4000, 6500]);
    expect(tl.segments.map((s) => s.endMs)).toEqual([4000, 6500, 9700]);
    // No gaps: each start equals the previous end.
    for (let i = 1; i < tl.segments.length; i++) {
      expect(tl.segments[i]!.startMs).toBe(tl.segments[i - 1]!.endMs);
    }
    // Total equals the sum of audio durations (the alignment invariant).
    expect(tl.totalDurationMs).toBe(audio.reduce((a, b) => a + b, 0));
    // Segment metadata carried through.
    expect(tl.segments[1]).toMatchObject({ index: 1, type: 'broll', text: '防晒霜特写' });
  });

  it('throws when segment count != audio-duration count', () => {
    expect(() => buildTimeline(SEGS, [1000, 2000])).toThrow(/2 segments but|3 segments but/);
  });

  it('throws on a non-positive / non-finite audio duration', () => {
    expect(() => buildTimeline(SEGS, [4000, 0, 3200])).toThrow(/non-positive/);
    expect(() => buildTimeline(SEGS, [4000, Number.NaN, 3200])).toThrow(/non-positive/);
  });
});

describe('formatSrtTime', () => {
  it('formats HH:MM:SS,mmm', () => {
    expect(formatSrtTime(0)).toBe('00:00:00,000');
    expect(formatSrtTime(4000)).toBe('00:00:04,000');
    expect(formatSrtTime(3_661_500)).toBe('01:01:01,500');
    expect(formatSrtTime(-50)).toBe('00:00:00,000'); // clamps negatives
  });
});

describe('buildSrt', () => {
  it('emits 1-based cues timecoded to each segment', () => {
    const tl = buildTimeline(SEGS, [4000, 2500, 3200]);
    const srt = buildSrt(tl);
    expect(srt).toContain('1\n00:00:00,000 --> 00:00:04,000\n姐妹们夏天到了千万别让紫外线毁了你的皮肤');
    expect(srt).toContain('2\n00:00:04,000 --> 00:00:06,500\n防晒霜特写');
    expect(srt).toContain('3\n00:00:06,500 --> 00:00:09,700\n记得每两小时补涂一次哦');
    // SRT timecodes must match the timeline exactly (audio→subtitle sync).
    expect(srt).toContain(`--> ${formatSrtTime(tl.totalDurationMs)}`);
  });
});

describe('wrapCjk', () => {
  it('wraps long lines at maxPerLine with the ASS hard break', () => {
    expect(wrapCjk('短句')).toBe('短句');
    expect(wrapCjk('一二三四五六七八九十一二三四五六', 8)).toBe('一二三四五六七八\\N九十一二三四五六');
  });
});

describe('formatAssTime', () => {
  it('formats H:MM:SS.cc (centiseconds)', () => {
    expect(formatAssTime(0)).toBe('0:00:00.00');
    expect(formatAssTime(4250)).toBe('0:00:04.25');
    expect(formatAssTime(3_661_500)).toBe('1:01:01.50');
  });
});

describe('buildAss — styled, fixes subtitle overflow (P0-1)', () => {
  it('sets PlayRes to the video, a CJK font, safe margins, wrapped cues', () => {
    const tl = buildTimeline(SEGS, [4000, 2500, 3200]);
    const ass = buildAss(tl, { maxCharsPerLine: 8 });
    expect(ass).toContain('PlayResX: 1080');
    expect(ass).toContain('PlayResY: 1920');
    // CJK font + bottom-center alignment (2) + L/R safe margins (80) present in the Style.
    expect(ass).toMatch(/Style: Default,WenQuanYi Zen Hei,54,.*,1,3,1,2,80,80,140,1/);
    // a long cue (18 chars) is wrapped at 8 chars/line with the ASS hard break \N
    expect(ass).toContain('姐妹们夏天到了千\\N');
    expect(ass).toContain('姐妹们'); // text preserved
    // cue timecodes in ASS format
    expect(ass).toContain('Dialogue: 0,0:00:00.00,0:00:04.00,Default');
  });
});

describe('buildAss — keyText 已撤回, 不再叠 KeyCard', () => {
  it('无 KeyCard Style / 无 KeyCard Dialogue, 只剩底部字幕', () => {
    const ass = buildAss(buildTimeline(SEGS, [4000, 2500, 3200]));
    expect(ass).not.toContain('Style: KeyCard');
    expect(ass).not.toContain(',KeyCard,');
    expect((ass.match(/,Default,/g) ?? []).length).toBe(3); // 仍每段一条底部字幕
  });
});
