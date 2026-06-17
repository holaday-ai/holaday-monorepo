import { describe, expect, it, vi } from 'vitest';
import {
  IP_MAX_AUDIO_MS,
  runIpVideoCreation,
  splitIpCues,
  type IpFns,
  type IpVideoConfig,
  type IpVideoContext,
  type IpVideoServices,
} from './video-ip-lipsync.js';

const CFG: IpVideoConfig = {
  dashscopeApiKey: 'dk',
  dashscopeBaseUrl: 'https://dashscope-intl.aliyuncs.com',
  qwenTtsVcModel: 'qwen3-tts-vc-2026-01-22',
  falApiKey: 'fk',
  falBaseUrl: 'https://queue.fal.run',
  falLipsyncModel: 'fal-ai/latentsync',
  watermarkFontFile: '/fonts/wqy.ttc',
};
const CTX: IpVideoContext = { voiceId: 'qwen-tts-vc-x', baseVideoUrl: 'https://r2/base.mp4?sig' };
const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

function makeServices(durationMs = 8000) {
  const synthesizeSpeech = vi.fn(async () => ({ audioUrl: 'https://oss/voice.wav', characters: 42 }));
  const runLipSync = vi.fn(async () => ({ videoUrl: 'https://v3.fal.media/out.mp4', requestId: 'r1', elapsedMs: 1000 }));
  const downloadToBuffer = vi.fn(async () => ({ buffer: Buffer.from('x'), contentType: 'application/octet-stream', sizeBytes: 1 }));
  const ffprobeDurationMs = vi.fn(async () => durationMs);
  const runFfmpeg = vi.fn(async () => {});
  const writeFile = vi.fn(async () => {});
  const readFile = vi.fn(async () => Buffer.from('final'));
  const storeOutput = vi.fn(async (i: { filename: string }) => ({ fileId: `f_${i.filename}` }));
  const presignByFileId = vi.fn(async (fid: string) => `https://r2/${fid}?sig`);
  const overrides: Partial<IpFns> = {
    synthesizeSpeech: synthesizeSpeech as unknown as IpFns['synthesizeSpeech'],
    runLipSync: runLipSync as unknown as IpFns['runLipSync'],
    downloadToBuffer: downloadToBuffer as unknown as IpFns['downloadToBuffer'],
    ffprobeDurationMs: ffprobeDurationMs as unknown as IpFns['ffprobeDurationMs'],
    runFfmpeg,
    writeFile,
    readFile,
  };
  const svc: IpVideoServices = { storeOutput, presignByFileId, workdir: '/tmp/ipwd', logger, overrides };
  return { svc, mocks: { synthesizeSpeech, runLipSync, downloadToBuffer, ffprobeDurationMs, runFfmpeg, storeOutput, presignByFileId } };
}

describe('runIpVideoCreation — B 架构单 clip 口播', () => {
  it('全文案 1 次合成(克隆音)→ 1 次 fal 换口型(loop_mode)→ compose → store', async () => {
    const { svc, mocks } = makeServices(8000);
    const res = await runIpVideoCreation({ copyText: '大家好,这是我本人口播。今天聊三件事。' }, CFG, CTX, {}, svc);
    // ① 合成用用户 voice_id + 全文案
    const synthArg = (mocks.synthesizeSpeech.mock.calls[0] as unknown[])[0] as { voiceId: string; text: string };
    expect(synthArg.voiceId).toBe('qwen-tts-vc-x');
    expect(synthArg.text).toContain('今天聊三件事');
    // ② fal: base video + presigned 克隆音 + loop_mode
    const lipArg = (mocks.runLipSync.mock.calls[0] as unknown[])[0] as { videoUrl: string; audioUrl: string; extra?: Record<string, unknown> };
    expect(lipArg.videoUrl).toBe('https://r2/base.mp4?sig');
    expect(lipArg.audioUrl).toContain('https://r2/'); // presigned 克隆音
    expect(lipArg.extra?.loop_mode).toBe('loop');
    // 只 1 次 fal(B 架构 = 1 clip)
    expect(mocks.runLipSync).toHaveBeenCalledTimes(1);
    // ③ compose + 最终 store
    expect(mocks.runFfmpeg).toHaveBeenCalledTimes(1);
    expect(mocks.storeOutput).toHaveBeenCalledWith(expect.objectContaining({ filename: 'video.mp4' }));
    expect(res.fileId).toBe('f_video.mp4');
    expect(res.totalDurationMs).toBe(8000);
  });

  it('音频 >40s → too_long(不调 fal,B 平价边界)', async () => {
    const { svc, mocks } = makeServices(IP_MAX_AUDIO_MS + 1000);
    await expect(runIpVideoCreation({ copyText: '很长的文案'.repeat(50) }, CFG, CTX, {}, svc)).rejects.toMatchObject({ kind: 'too_long' });
    expect(mocks.runLipSync).not.toHaveBeenCalled();
  });

  it('config error: 缺 voiceId / 缺底版 url / 缺 key', async () => {
    const { svc } = makeServices();
    await expect(runIpVideoCreation({ copyText: 'x' }, CFG, { voiceId: '', baseVideoUrl: 'u' }, {}, svc)).rejects.toMatchObject({ kind: 'config' });
    await expect(runIpVideoCreation({ copyText: 'x' }, { ...CFG, falApiKey: '' }, CTX, {}, svc)).rejects.toMatchObject({ kind: 'config' });
  });
});

describe('splitIpCues — 全文案按字数比例切逐句字幕', () => {
  it('切句 + 时长比例(和=总时长,各>=1)', () => {
    const { segments, durations } = splitIpCues('第一句。第二句较长一些!', 4000);
    expect(segments).toHaveLength(2);
    expect(segments.every((s) => s.type === 'voiceover')).toBe(true);
    expect(durations.reduce((a, b) => a + b, 0)).toBe(4000);
    expect(durations.every((d) => d >= 1)).toBe(true);
    // 较长的第二句时长更大
    expect(durations[1]!).toBeGreaterThan(durations[0]!);
  });

  it('无标点单句 → 1 个 cue 占满', () => {
    const { segments, durations } = splitIpCues('一句话没有标点', 3000);
    expect(segments).toHaveLength(1);
    expect(durations).toEqual([3000]);
  });

  it('多句 + 充足时长 → 和恰好 == totalMs(不超时)', () => {
    const text = '一。二。三。四。五。六。七。八。';
    const { durations } = splitIpCues(text, 9000);
    expect(durations.reduce((a, b) => a + b, 0)).toBe(9000);
    expect(durations.every((d) => d >= 1)).toBe(true);
  });

  it('退化:句数 > totalMs(ms) → 各 >=1、不崩、不出现 0/负(优雅降级)', () => {
    const text = '一。'.repeat(50); // 50 句
    const { segments, durations } = splitIpCues(text, 10); // 10ms << 50 句
    expect(segments).toHaveLength(50);
    expect(durations).toHaveLength(50);
    expect(durations.every((d) => d >= 1)).toBe(true); // buildTimeline 不会因非正时长抛错
  });
});
