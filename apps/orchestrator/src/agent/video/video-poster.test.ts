import { describe, expect, it, vi } from 'vitest';
import { buildPosterCommand, generatePosterFile, type PosterDeps } from './video-poster.js';

describe('buildPosterCommand', () => {
  it('grabs frame 0 as a quality-3 jpeg, default ffmpeg bin', () => {
    const cmd = buildPosterCommand({ videoPath: '/w/final.mp4', posterPath: '/w/poster.jpg' });
    expect(cmd.bin).toBe('ffmpeg');
    expect(cmd.args).toEqual(['-y', '-i', '/w/final.mp4', '-frames:v', '1', '-q:v', '3', '/w/poster.jpg']);
  });
  it('honours an explicit ffmpegBin', () => {
    expect(buildPosterCommand({ videoPath: 'a', posterPath: 'b', ffmpegBin: '/usr/bin/ffmpeg' }).bin).toBe('/usr/bin/ffmpeg');
  });
});

function deps(over: Partial<PosterDeps> = {}): PosterDeps {
  return {
    runFfmpeg: vi.fn(async () => {}),
    readFile: vi.fn(async () => Buffer.from('jpeg-bytes')),
    storeOutput: vi.fn(async () => ({ fileId: 'file_poster' })),
    logger: { warn: vi.fn() },
    ...over,
  };
}

describe('generatePosterFile — non-fatal poster generation', () => {
  it('happy path: runs ffmpeg, stores poster.jpg as image/jpeg, returns fileId', async () => {
    const d = deps();
    const id = await generatePosterFile({ videoPath: '/w/final.mp4', posterPath: '/w/poster.jpg', deps: d });
    expect(id).toBe('file_poster');
    expect(d.storeOutput).toHaveBeenCalledWith(
      expect.objectContaining({ filename: 'poster.jpg', mimetype: 'image/jpeg' }),
    );
  });

  it('passes ffmpegBin from ffOpts into the command', async () => {
    const d = deps();
    await generatePosterFile({ videoPath: 'a', posterPath: 'b', deps: d, ffOpts: { ffmpegBin: '/opt/ffmpeg' } });
    expect(d.runFfmpeg).toHaveBeenCalledWith(expect.objectContaining({ bin: '/opt/ffmpeg' }), { ffmpegBin: '/opt/ffmpeg' });
  });

  it('★ ffmpeg failure → returns null, logs, does NOT throw (成片 still completes)', async () => {
    const warn = vi.fn();
    const d = deps({ runFfmpeg: vi.fn(async () => { throw new Error('ffmpeg boom'); }), logger: { warn } });
    await expect(
      generatePosterFile({ videoPath: 'a', posterPath: 'b', deps: d }),
    ).resolves.toBeNull();
    expect(warn).toHaveBeenCalled();
    expect(d.storeOutput).not.toHaveBeenCalled();
  });

  it('★ readFile failure → null, non-fatal', async () => {
    const d = deps({ readFile: vi.fn(async () => { throw new Error('no frame'); }) });
    await expect(generatePosterFile({ videoPath: 'a', posterPath: 'b', deps: d })).resolves.toBeNull();
  });

  it('★ storeOutput failure → null, non-fatal', async () => {
    const d = deps({ storeOutput: vi.fn(async () => { throw new Error('r2 down'); }) });
    await expect(generatePosterFile({ videoPath: 'a', posterPath: 'b', deps: d })).resolves.toBeNull();
  });
});
