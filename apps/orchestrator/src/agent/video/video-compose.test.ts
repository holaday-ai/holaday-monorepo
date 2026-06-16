import { describe, expect, it } from 'vitest';
import { buildComposeCommand, buildPetVideoCommand } from './video-compose.js';

const CLIPS = ['/r2/clip_0.mp4', '/r2/clip_1.mp4', '/r2/clip_2.mp4'];
const OUT = '/r2/final.mp4';

function fc(args: string[]): string {
  return args[args.indexOf('-filter_complex') + 1]!;
}

describe('buildComposeCommand', () => {
  it('builds a vertical 1080x1920 h264+aac concat with default watermark + faststart', () => {
    const cmd = buildComposeCommand({ segmentClipPaths: CLIPS, outputPath: OUT });
    expect(cmd.bin).toBe('ffmpeg');
    // every clip is an input
    for (const c of CLIPS) {
      const at = cmd.args.indexOf(c);
      expect(at).toBeGreaterThan(0);
      expect(cmd.args[at - 1]).toBe('-i');
    }
    const graph = fc(cmd.args);
    // normalize to 1080x1920 + pad + concat
    expect(graph).toContain('scale=1080:1920:force_original_aspect_ratio=decrease');
    expect(graph).toContain('pad=1080:1920');
    expect(graph).toContain('concat=n=3:v=1:a=1[cv][ca]');
    // compliance: a watermark is ALWAYS present even when none is supplied
    expect(graph).toContain('drawtext=text=');
    expect(graph).toContain('HOLA DAY');
    // encode settings
    expect(cmd.args).toEqual(expect.arrayContaining(['-c:v', 'libx264', '-c:a', 'aac', '-pix_fmt', 'yuv420p']));
    expect(cmd.args).toEqual(expect.arrayContaining(['-r', '30', '-movflags', '+faststart', '-y']));
    expect(cmd.args[cmd.args.length - 1]).toBe(OUT);
  });

  it('burns in subtitles when srtPath is given', () => {
    const graph = fc(
      buildComposeCommand({ segmentClipPaths: CLIPS, outputPath: OUT, srtPath: '/r2/subs.srt' }).args,
    );
    expect(graph).toContain('subtitles=/r2/subs.srt');
  });

  it('uses the styled ASS filter when assPath given (preferred over srt)', () => {
    const graph = fc(
      buildComposeCommand({
        segmentClipPaths: CLIPS,
        outputPath: OUT,
        assPath: '/r2/subs.ass',
        srtPath: '/r2/subs.srt',
      }).args,
    );
    expect(graph).toContain('ass=/r2/subs.ass'); // ASS preferred
    expect(graph).not.toContain('subtitles=/r2/subs.srt');
  });

  it('default watermark is English-only (no CJK boxes, P0-2)', () => {
    const graph = fc(buildComposeCommand({ segmentClipPaths: CLIPS, outputPath: OUT }).args);
    expect(graph).toContain('HOLA DAY · AI');
    expect(graph).not.toContain('合成');
  });

  it('passes a watermark fontfile to drawtext when provided', () => {
    const graph = fc(
      buildComposeCommand({
        segmentClipPaths: CLIPS,
        outputPath: OUT,
        watermark: { fontFile: '/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc' },
      }).args,
    );
    expect(graph).toContain("fontfile='/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc'");
  });

  it('uses an explicit text watermark', () => {
    const graph = fc(
      buildComposeCommand({
        segmentClipPaths: CLIPS,
        outputPath: OUT,
        watermark: { text: '@boss授权本人素材', position: 'top-left' },
      }).args,
    );
    expect(graph).toContain('@boss授权本人素材');
    expect(graph).toContain('x=40:y=40'); // top-left
  });

  it('overlays an image watermark with an extra input', () => {
    const cmd = buildComposeCommand({
      segmentClipPaths: CLIPS,
      outputPath: OUT,
      watermark: { imagePath: '/r2/wm.png', opacity: 0.5 },
    });
    // image is appended as an extra -i input
    const at = cmd.args.indexOf('/r2/wm.png');
    expect(cmd.args[at - 1]).toBe('-i');
    const graph = fc(cmd.args);
    expect(graph).toContain('colorchannelmixer=aa=0.5');
    expect(graph).toContain('overlay=');
  });

  it('adds BGM with sidechain ducking', () => {
    const cmd = buildComposeCommand({
      segmentClipPaths: CLIPS,
      outputPath: OUT,
      bgmPath: '/r2/bgm.mp3',
      bgmVolume: 0.3,
    });
    const at = cmd.args.indexOf('/r2/bgm.mp3');
    expect(cmd.args[at - 1]).toBe('-i');
    const graph = fc(cmd.args);
    expect(graph).toContain('volume=0.3');
    expect(graph).toContain('sidechaincompress');
    expect(graph).toContain('amix=inputs=2');
    expect(cmd.args).toEqual(expect.arrayContaining(['-map', '[mixa]']));
  });

  it('honours custom resolution + fps + ffmpeg bin', () => {
    const cmd = buildComposeCommand(
      { segmentClipPaths: CLIPS, outputPath: OUT, width: 720, height: 1280, fps: 24 },
      { ffmpegBin: '/usr/bin/ffmpeg' },
    );
    expect(cmd.bin).toBe('/usr/bin/ffmpeg');
    expect(fc(cmd.args)).toContain('scale=720:1280');
    expect(cmd.args).toEqual(expect.arrayContaining(['-r', '24']));
  });

  it('throws on no clips', () => {
    expect(() => buildComposeCommand({ segmentClipPaths: [], outputPath: OUT })).toThrow(/no segment clips/);
  });
});

describe('buildPetVideoCommand — 宠物 i2v 单 clip (静默, Phase 2 第二期)', () => {
  function petFc(args: string[]): string {
    return args[args.indexOf('-filter_complex') + 1]!;
  }

  it('pads single clip to 画幅 + 水印 + 静默音轨(anullsrc) + shortest, no concat/subtitles', () => {
    const cmd = buildPetVideoCommand({ clipPath: '/r2/pet-raw.mp4', outputPath: OUT, width: 1080, height: 1920 });
    // the i2v clip is input 0; silent audio is the lavfi anullsrc input
    expect(cmd.args[cmd.args.indexOf('/r2/pet-raw.mp4') - 1]).toBe('-i');
    expect(cmd.args).toEqual(expect.arrayContaining(['-f', 'lavfi']));
    expect(cmd.args.some((a) => a.startsWith('anullsrc'))).toBe(true);
    const graph = petFc(cmd.args);
    expect(graph).toContain('scale=1080:1920:force_original_aspect_ratio=decrease');
    expect(graph).toContain('pad=1080:1920');
    expect(graph).not.toContain('concat='); // single clip, no concat
    expect(graph).not.toContain('ass='); // no subtitles for pet i2v
    // compliance watermark ALWAYS present
    expect(graph).toContain('HOLA DAY');
    // map padded video + the silent audio (input 1), clamp to video length
    expect(cmd.args).toEqual(expect.arrayContaining(['-map', '1:a', '-shortest']));
    expect(cmd.args).toEqual(expect.arrayContaining(['-c:v', 'libx264', '-c:a', 'aac', '-pix_fmt', 'yuv420p']));
  });

  it('honours custom 画幅 (横屏) + ffmpeg bin', () => {
    const cmd = buildPetVideoCommand(
      { clipPath: '/r2/pet.mp4', outputPath: OUT, width: 1920, height: 1080 },
      { ffmpegBin: '/usr/bin/ffmpeg' },
    );
    expect(cmd.bin).toBe('/usr/bin/ffmpeg');
    expect(petFc(cmd.args)).toContain('scale=1920:1080');
  });
});
