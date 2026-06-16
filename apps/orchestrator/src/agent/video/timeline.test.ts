import { describe, expect, it } from 'vitest';
import {
  buildAss,
  buildSrt,
  buildTimeline,
  formatAssTime,
  formatSrtTime,
  sanitizeKeyText,
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

describe('sanitizeKeyText — 脏/超长兜底 (范围2 防御)', () => {
  it('trims, caps 8 chars, strips ASS control chars {} \\ and newlines; empty → null', () => {
    expect(sanitizeKeyText('SPF50')).toBe('SPF50');
    expect(sanitizeKeyText('  SPF50  ')).toBe('SPF50'); // trim
    expect(sanitizeKeyText('超过八个字符的超长信息点词')).toBe('超过八个字符的超'); // cap 8
    expect(sanitizeKeyText('a\nb\tc')).toBe('a b c'); // newline/tab → space
    expect(sanitizeKeyText('{SPF50}')).toBe('SPF50'); // strip { } braces
    expect(sanitizeKeyText('SP\\F50')).toBe('SPF50'); // strip backslash (\N injection)
    expect(sanitizeKeyText('')).toBeNull();
    expect(sanitizeKeyText(undefined)).toBeNull();
    expect(sanitizeKeyText('{}\\')).toBeNull(); // 全是控制字符 → 空 → null
  });
});

describe('buildAss — KeyCard 信息点字卡 (范围2)', () => {
  const SEGS_KEY: VideoSegment[] = [
    { text: '夏天紫外线很强', type: 'broll', visual: 'v1' }, // 无 keyText
    { text: '选防晒认准SPF50', type: 'broll', visual: 'v2', keyText: 'SPF50' }, // 有 keyText
  ];

  it('adds a KeyCard Style (magenta &H006B0BE5, size 72, Alignment 8, MarginV 360)', () => {
    const ass = buildAss(buildTimeline(SEGS_KEY, [3000, 4000]));
    expect(ass).toContain('Style: KeyCard,WenQuanYi Zen Hei,72,&H006B0BE5,'); // magenta BGR 转对
    expect(ass).toMatch(/Style: KeyCard,[^\n]*,1,4,1,8,80,80,360,1/); // Bold1 Outline4 Alignment8 MarginV360
  });

  it('叠 KeyCard Dialogue 只对有 keyText 的段, 含 \\fad 淡入淡出', () => {
    const ass = buildAss(buildTimeline(SEGS_KEY, [3000, 4000]));
    // 该段 [3000,7000) → KeyCard cue 与底部字幕同步
    expect(ass).toContain('KeyCard,,0,0,0,,{\\fad(300,300)}SPF50');
    expect((ass.match(/,KeyCard,/g) ?? []).length).toBe(1); // 只一段有 keyText → 只一条 KeyCard
    expect(ass).toContain('Default,,0,0,0,,选防晒认准SPF50'); // 底部字幕仍在
  });

  it('脏/超长 keyText → ASS 里 sanitize, 不注入不溢出 (兜底不崩)', () => {
    const dirty: VideoSegment[] = [
      { text: 'x', type: 'broll', visual: 'v', keyText: '注入{\\N}超长信息点文字串' },
    ];
    const ass = buildAss(buildTimeline(dirty, [3000]));
    const kt = ass.split('{\\fad(300,300)}')[1]?.split('\n')[0] ?? '';
    expect(kt.length).toBeLessThanOrEqual(8); // 截断 8
    expect(kt).not.toMatch(/[{}]/); // 无 {} 注入
    expect(kt).not.toContain('\\N'); // 无 \N 注入
  });
});
