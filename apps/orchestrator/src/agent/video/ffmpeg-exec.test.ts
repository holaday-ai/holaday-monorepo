import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import {
  ffprobeDurationMs,
  ffprobeVideoMetadata,
  renderImageClip,
  renderImageKenBurns,
  renderVideoClip,
  runFfmpeg,
  type SpawnFn,
} from './ffmpeg-exec.js';

/** Fake spawn: records calls, emits stdout/stderr then closes with `code`. */
function fakeSpawn(behaviour: { code?: number; stdout?: string; stderr?: string; error?: string }) {
  const calls: Array<{ bin: string; args: readonly string[] }> = [];
  const fn: SpawnFn = (bin, args) => {
    calls.push({ bin, args });
    const proc = new EventEmitter() as EventEmitter & {
      stdout: EventEmitter;
      stderr: EventEmitter;
      kill: () => void;
    };
    proc.stdout = new EventEmitter();
    proc.stderr = new EventEmitter();
    proc.kill = () => {};
    queueMicrotask(() => {
      if (behaviour.error) {
        proc.emit('error', new Error(behaviour.error));
        return;
      }
      if (behaviour.stdout) proc.stdout.emit('data', Buffer.from(behaviour.stdout));
      if (behaviour.stderr) proc.stderr.emit('data', Buffer.from(behaviour.stderr));
      proc.emit('close', behaviour.code ?? 0);
    });
    return proc as unknown as ReturnType<SpawnFn>;
  };
  return { fn, calls };
}

describe('ffprobeDurationMs', () => {
  it('parses ffprobe duration seconds → ms', async () => {
    const { fn, calls } = fakeSpawn({ stdout: '4.523\n' });
    const ms = await ffprobeDurationMs('/r2/audio.wav', { spawnFn: fn });
    expect(ms).toBe(4523);
    expect(calls[0]?.args).toEqual(expect.arrayContaining(['format=duration', '/r2/audio.wav']));
  });

  it('throws on a non-numeric duration', async () => {
    const { fn } = fakeSpawn({ stdout: 'N/A' });
    await expect(ffprobeDurationMs('/r2/audio.wav', { spawnFn: fn })).rejects.toThrow(/bad duration/);
  });

  it('rejects on a non-zero exit', async () => {
    const { fn } = fakeSpawn({ code: 1, stderr: 'no such file' });
    await expect(ffprobeDurationMs('/missing', { spawnFn: fn })).rejects.toThrow(/exited 1/);
  });
});

describe('ffprobeVideoMetadata', () => {
  it('parses the first video stream dimensions and media duration', async () => {
    const { fn, calls } = fakeSpawn({
      stdout: JSON.stringify({
        streams: [{ width: 1080, height: 1920 }],
        format: { duration: '12.345' },
      }),
    });

    await expect(ffprobeVideoMetadata('/r2/reference.mp4', { spawnFn: fn })).resolves.toEqual({
      width: 1080,
      height: 1920,
      durationMs: 12_345,
    });
    expect(calls[0]?.args).toEqual(
      expect.arrayContaining([
        '-select_streams',
        'v:0',
        '-show_entries',
        'stream=width,height:format=duration',
        '/r2/reference.mp4',
      ]),
    );
  });

  it('rejects missing or malformed video dimensions', async () => {
    const { fn } = fakeSpawn({
      stdout: JSON.stringify({ streams: [], format: { duration: '8' } }),
    });

    await expect(ffprobeVideoMetadata('/r2/not-video.bin', { spawnFn: fn })).rejects.toThrow(
      /bad video metadata/,
    );
  });
});

describe('renderImageClip', () => {
  it('builds a loop-image + audio → fixed-length vertical clip command', async () => {
    const { fn, calls } = fakeSpawn({ code: 0 });
    await renderImageClip(
      { imagePath: '/r2/img.png', audioPath: '/r2/a.wav', outPath: '/r2/clip.mp4', durationMs: 3200 },
      { spawnFn: fn },
    );
    const args = calls[0]!.args;
    expect(args).toEqual(expect.arrayContaining(['-loop', '1', '-i', '/r2/img.png', '-i', '/r2/a.wav']));
    expect(args).toEqual(expect.arrayContaining(['-t', '3.200', '-af', 'apad', '-c:v', 'libx264', '-pix_fmt', 'yuv420p']));
    expect(args).not.toContain('-shortest');
    expect(args.join(' ')).toContain('scale=1080:1920');
    expect(args[args.length - 1]).toBe('/r2/clip.mp4');
  });

  it('rejects when ffmpeg fails', async () => {
    const { fn } = fakeSpawn({ code: 1, stderr: 'encode error' });
    await expect(
      renderImageClip(
        { imagePath: 'i', audioPath: 'a', outPath: 'o', durationMs: 1000 },
        { spawnFn: fn },
      ),
    ).rejects.toThrow(/exited 1/);
  });
});

describe('runFfmpeg', () => {
  it('runs a prebuilt command with its bin + args', async () => {
    const { fn, calls } = fakeSpawn({ code: 0 });
    await runFfmpeg({ bin: '/usr/bin/ffmpeg', args: ['-y', '-i', 'x', 'out.mp4'] }, { spawnFn: fn });
    expect(calls[0]?.bin).toBe('/usr/bin/ffmpeg');
    expect(calls[0]?.args).toEqual(['-y', '-i', 'x', 'out.mp4']);
  });

  it('surfaces a spawn error', async () => {
    const { fn } = fakeSpawn({ error: 'ENOENT' });
    await expect(runFfmpeg({ bin: 'ffmpeg', args: [] }, { spawnFn: fn })).rejects.toThrow(/ENOENT/);
  });
});

describe('renderImageKenBurns', () => {
  it('builds a loop-image + zoompan Ken Burns command of audio length', async () => {
    const { fn, calls } = fakeSpawn({ code: 0 });
    await renderImageKenBurns(
      { imagePath: '/r2/img.png', audioPath: '/r2/a.wav', outPath: '/r2/clip.mp4', durationMs: 4000 },
      { spawnFn: fn },
    );
    const args = calls[0]!.args;
    expect(args).toEqual(expect.arrayContaining(['-loop', '1', '-i', '/r2/img.png', '-i', '/r2/a.wav', '-t', '4.000']));
    expect(args.join(' ')).toContain('zoompan=');
    expect(args.join(' ')).toContain('scale=2160:3840'); // 2x upscale for smoothness
    expect(args.join(' ')).toContain(':s=1080x1920'); // zoompan downscales to target
    expect(args).toEqual(expect.arrayContaining(['-c:v', 'libx264', '-shortest']));
  });
});

describe('renderVideoClip', () => {
  it('loops+trims a bg video to the requested length and pads shorter narration with silence', async () => {
    const { fn, calls } = fakeSpawn({ code: 0 });
    await renderVideoClip(
      { videoPath: '/r2/veo.mp4', audioPath: '/r2/a.wav', outPath: '/r2/clip.mp4', durationMs: 3500 },
      { spawnFn: fn },
    );
    const args = calls[0]!.args;
    // -stream_loop before the bg video, -t to the audio length, map narration audio (1:a)
    expect(args).toEqual(expect.arrayContaining(['-stream_loop', '-1', '-i', '/r2/veo.mp4', '-t', '3.500']));
    expect(args).toEqual(expect.arrayContaining(['-map', '0:v:0', '-map', '1:a:0']));
    expect(args).toEqual(expect.arrayContaining(['-af', 'apad']));
    expect(args.join(' ')).toContain('scale=1080:1920');
  });
});
