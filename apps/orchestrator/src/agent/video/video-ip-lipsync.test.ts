import { describe, expect, it, vi } from 'vitest';
import type { MediaIntegrityReport } from './ffmpeg-exec.js';
import {
  IP_MAX_AUDIO_MS,
  type IpFns,
  type IpVideoConfig,
  type IpVideoContext,
  type IpVideoServices,
  runIpVideoCreation,
  splitIpCues,
} from './video-ip-lipsync.js';
import type { VideoQualityResult } from './video-quality-verifier.js';

const CFG: IpVideoConfig = {
  dashscopeApiKey: 'dk',
  dashscopeBaseUrl: 'https://dashscope-intl.aliyuncs.com',
  qwenTtsVcModel: 'qwen3-tts-vc-2026-01-22',
  falApiKey: 'fk',
  falBaseUrl: 'https://queue.fal.run',
  falLipsyncModel: 'fal-ai/sync-lipsync/v2',
  watermarkFontFile: '/fonts/wqy.ttc',
};
const CTX: IpVideoContext = { voiceId: 'qwen-tts-vc-x', baseVideoUrl: 'https://r2/base.mp4?sig' };
const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

function makeServices(durationMs = 8000) {
  const synthesizeSpeech = vi.fn(async () => ({
    audioUrl: 'https://oss/voice.wav',
    characters: 42,
  }));
  const runLipSync = vi.fn(async () => ({
    videoUrl: 'https://v3.fal.media/out.mp4',
    requestId: 'r1',
    elapsedMs: 1000,
  }));
  const downloadToBuffer = vi.fn(async () => ({
    buffer: Buffer.from('x'),
    contentType: 'application/octet-stream',
    sizeBytes: 1,
  }));
  const downloadToFile = vi.fn(async () => ({
    contentType: 'video/mp4',
    sizeBytes: 42_000_000,
  }));
  const ffprobeDurationMs = vi.fn(async () => durationMs);
  const runFfmpeg = vi.fn(async () => {});
  const writeFile = vi.fn(async () => {});
  const readFile = vi.fn(async () => Buffer.from('final'));
  const storeOutput = vi.fn(async (i: { filename: string }) => ({ fileId: `f_${i.filename}` }));
  const storeOutputFile = vi.fn(async (i: { filename: string }) => ({
    fileId: `f_${i.filename}`,
  }));
  const storeTemporaryAudio = vi.fn(async () => ({ fileId: 'f_ip-voice.wav' }));
  const presignByFileId = vi.fn(
    async (fid: string): Promise<string | null> => `https://r2/${fid}?sig`,
  );
  const deleteOutput = vi.fn(async () => true);
  const verifyFinalVideo = vi.fn(
    async (): Promise<VideoQualityResult> => ({
      status: 'pass' as const,
      failedChecks: [],
      reason: '人物、口型和字幕均通过',
    }),
  );
  const inspectMediaIntegrity = vi.fn(async (): Promise<MediaIntegrityReport> => ({
    durationMs,
    hasVideo: true,
    hasAudio: true,
    frozenRatio: 0.1,
    audioMeanVolumeDb: -24,
    audioMaxVolumeDb: -8,
  }));
  const overrides: Partial<IpFns> = {
    synthesizeSpeech: synthesizeSpeech as unknown as IpFns['synthesizeSpeech'],
    runLipSync: runLipSync as unknown as IpFns['runLipSync'],
    downloadToBuffer: downloadToBuffer as unknown as IpFns['downloadToBuffer'],
    downloadToFile: downloadToFile as unknown as IpFns['downloadToFile'],
    ffprobeDurationMs: ffprobeDurationMs as unknown as IpFns['ffprobeDurationMs'],
    runFfmpeg,
    writeFile,
    readFile,
    inspectMediaIntegrity,
  };
  const svc: IpVideoServices = {
    storeOutput,
    storeOutputFile,
    storeTemporaryAudio,
    presignByFileId,
    deleteOutput,
    workdir: '/tmp/ipwd',
    logger,
    verifyFinalVideo,
    overrides,
  };
  return {
    svc,
    mocks: {
      synthesizeSpeech,
      runLipSync,
      downloadToBuffer,
      downloadToFile,
      ffprobeDurationMs,
      runFfmpeg,
      storeOutput,
      storeOutputFile,
      storeTemporaryAudio,
      presignByFileId,
      deleteOutput,
      verifyFinalVideo,
      inspectMediaIntegrity,
    },
  };
}

describe('runIpVideoCreation — B 架构单 clip 口播', () => {
  it('rejects an out-of-range base video before voice synthesis or paid lip sync', async () => {
    const { svc, mocks } = makeServices(61_000);

    await expect(
      runIpVideoCreation(
        { copyText: '这是一段验收文案。' },
        CFG,
        CTX,
        { aspectRatio: '9:16' },
        svc,
      ),
    ).rejects.toMatchObject({ name: 'IpVideoError', kind: 'config' });

    expect(mocks.synthesizeSpeech).not.toHaveBeenCalled();
    expect(mocks.runLipSync).not.toHaveBeenCalled();
  });

  it('rejects a still-image base video before voice synthesis or paid lip sync', async () => {
    const { svc, mocks } = makeServices(15_000);
    mocks.inspectMediaIntegrity.mockResolvedValueOnce({
      durationMs: 15_000,
      hasVideo: true,
      hasAudio: false,
      frozenRatio: 1,
      audioMeanVolumeDb: null,
      audioMaxVolumeDb: null,
    });

    await expect(
      runIpVideoCreation(
        { copyText: '这是一段验收文案。' },
        CFG,
        CTX,
        { aspectRatio: '9:16' },
        svc,
      ),
    ).rejects.toMatchObject({
      name: 'IpVideoError',
      kind: 'quality',
      failedChecks: ['source_motion_missing'],
    });

    expect(mocks.synthesizeSpeech).not.toHaveBeenCalled();
    expect(mocks.runLipSync).not.toHaveBeenCalled();
  });

  it('全文案 1 次合成(克隆音)→ 1 次 Sync Lipsync 换口型→ compose → store', async () => {
    const { svc, mocks } = makeServices(8000);
    const res = await runIpVideoCreation(
      { copyText: '大家好,这是我本人口播。今天聊三件事。' },
      CFG,
      CTX,
      {},
      svc,
    );
    expect(mocks.downloadToFile).toHaveBeenCalledWith(
      CTX.baseVideoUrl,
      '/tmp/ipwd/ip-base-reference.mp4',
      { maxBytes: 200 * 1024 * 1024 },
    );
    expect(mocks.downloadToBuffer).not.toHaveBeenCalledWith(CTX.baseVideoUrl);
    expect(mocks.downloadToFile).toHaveBeenCalledWith(
      'https://v3.fal.media/out.mp4',
      '/tmp/ipwd/ip-lipsync.mp4',
      { maxBytes: 500 * 1024 * 1024 },
    );
    expect(mocks.downloadToBuffer).not.toHaveBeenCalledWith('https://v3.fal.media/out.mp4');
    // ① 合成用用户 voice_id + 全文案
    const synthArg = (mocks.synthesizeSpeech.mock.calls[0] as unknown[])[0] as {
      voiceId: string;
      text: string;
    };
    expect(synthArg.voiceId).toBe('qwen-tts-vc-x');
    expect(synthArg.text).toContain('今天聊三件事');
    // ② fal: base video + presigned 克隆音 + provider-native loop mode
    const lipArg = (mocks.runLipSync.mock.calls[0] as unknown[])[0] as {
      model: string;
      videoUrl: string;
      audioUrl: string;
      extra?: Record<string, unknown>;
    };
    expect(lipArg.model).toBe('fal-ai/sync-lipsync/v2');
    expect(lipArg.videoUrl).toBe('https://r2/base.mp4?sig');
    expect(lipArg.audioUrl).toContain('https://r2/'); // presigned 克隆音
    expect(lipArg.extra).toEqual({ sync_mode: 'loop' });
    // 只 1 次 fal(B 架构 = 1 clip)
    expect(mocks.runLipSync).toHaveBeenCalledTimes(1);
    expect(mocks.storeTemporaryAudio).toHaveBeenCalledWith({
      filename: 'ip-voice.wav',
      mimetype: 'audio/wav',
      buffer: Buffer.from('x'),
    });
    expect(mocks.storeOutput).not.toHaveBeenCalledWith(
      expect.objectContaining({ filename: 'ip-voice.wav' }),
    );
    expect(mocks.deleteOutput).toHaveBeenCalledWith('f_ip-voice.wav');
    expect(mocks.verifyFinalVideo).toHaveBeenCalledWith(
      expect.objectContaining({
        videoPath: '/tmp/ipwd/ip-final.mp4',
        durationMs: 8000,
        minimumDurationMs: 8000,
        userText: '大家好,这是我本人口播。今天聊三件事。',
        qualityContext: expect.stringMatching(/底版人物.*身份.*口型/),
        expectedSubtitleText: ['大家好,这是我本人口播。', '今天聊三件事。'],
        referenceVideos: [
          expect.objectContaining({
            videoPath: '/tmp/ipwd/ip-base-reference.mp4',
            label: '用户本人出镜底版',
          }),
        ],
      }),
    );
    // ③ compose + 最终 store + 首帧 poster
    expect(mocks.runFfmpeg).toHaveBeenCalledTimes(2); // compose + poster
    expect(mocks.storeOutputFile).toHaveBeenCalledWith(
      expect.objectContaining({
        filename: 'video.mp4',
        sourcePath: '/tmp/ipwd/ip-final.mp4',
      }),
    );
    expect(mocks.storeOutput).toHaveBeenCalledWith(
      expect.objectContaining({ filename: 'poster.jpg', mimetype: 'image/jpeg' }),
    );
    expect(res.fileId).toBe('f_video.mp4');
    expect(res.totalDurationMs).toBe(8000);
  });

  it('音频 >40s → too_long(不调 fal,B 平价边界)', async () => {
    const { svc, mocks } = makeServices(IP_MAX_AUDIO_MS + 1000);
    await expect(
      runIpVideoCreation({ copyText: '很长的文案'.repeat(50) }, CFG, CTX, {}, svc),
    ).rejects.toMatchObject({ kind: 'too_long' });
    expect(mocks.runLipSync).not.toHaveBeenCalled();
  });

  it('blocks a frozen lip-sync output even when static-frame verification passes', async () => {
    const { svc, mocks } = makeServices(8000);
    mocks.inspectMediaIntegrity
      .mockResolvedValueOnce({
        durationMs: 8000,
        hasVideo: true,
        hasAudio: false,
        frozenRatio: 0.1,
        audioMeanVolumeDb: null,
        audioMaxVolumeDb: null,
      })
      .mockResolvedValueOnce({
        durationMs: 8000,
        hasVideo: true,
        hasAudio: true,
        frozenRatio: 1,
        audioMeanVolumeDb: -23,
        audioMaxVolumeDb: -8,
      });

    await expect(
      runIpVideoCreation({ copyText: '欢迎关注我们的新品。' }, CFG, CTX, {}, svc),
    ).rejects.toMatchObject({
      name: 'IpVideoError',
      kind: 'quality',
      failedChecks: ['output_motion_missing'],
    });

    expect(mocks.verifyFinalVideo).not.toHaveBeenCalled();
    expect(mocks.storeOutputFile).not.toHaveBeenCalled();
  });

  it('blocks an IP output without a clearly audible audio track', async () => {
    const { svc, mocks } = makeServices(8000);
    mocks.inspectMediaIntegrity
      .mockResolvedValueOnce({
        durationMs: 8000,
        hasVideo: true,
        hasAudio: false,
        frozenRatio: 0.1,
        audioMeanVolumeDb: null,
        audioMaxVolumeDb: null,
      })
      .mockResolvedValueOnce({
        durationMs: 8000,
        hasVideo: true,
        hasAudio: true,
        frozenRatio: 0.1,
        audioMeanVolumeDb: -80,
        audioMaxVolumeDb: -70,
      });

    await expect(
      runIpVideoCreation({ copyText: '欢迎关注我们的新品。' }, CFG, CTX, {}, svc),
    ).rejects.toMatchObject({
      name: 'IpVideoError',
      kind: 'quality',
      failedChecks: ['output_audio_inaudible'],
    });

    expect(mocks.verifyFinalVideo).not.toHaveBeenCalled();
    expect(mocks.storeOutputFile).not.toHaveBeenCalled();
  });

  it('config error: 缺 voiceId / 缺底版 url / 缺 key', async () => {
    const { svc } = makeServices();
    await expect(
      runIpVideoCreation({ copyText: 'x' }, CFG, { voiceId: '', baseVideoUrl: 'u' }, {}, svc),
    ).rejects.toMatchObject({ kind: 'config' });
    await expect(
      runIpVideoCreation({ copyText: 'x' }, { ...CFG, falApiKey: '' }, CTX, {}, svc),
    ).rejects.toMatchObject({ kind: 'config' });
  });

  it('removes the temporary cloned audio when presigning fails', async () => {
    const { svc, mocks } = makeServices();
    mocks.presignByFileId.mockResolvedValueOnce(null);

    await expect(
      runIpVideoCreation({ copyText: '欢迎回来。' }, CFG, CTX, {}, svc),
    ).rejects.toMatchObject({ name: 'IpVideoError', kind: 'config' });

    expect(mocks.runLipSync).not.toHaveBeenCalled();
    expect(mocks.deleteOutput).toHaveBeenCalledWith('f_ip-voice.wav');
  });

  it.each([
    ['fail', 'quality'],
    ['unknown', 'quality_unavailable'],
  ] as const)(
    'blocks a %s IP verdict before storing the final video or poster',
    async (status, expectedKind) => {
      const { svc, mocks } = makeServices(8000);
      mocks.verifyFinalVideo.mockResolvedValueOnce({
        status,
        failedChecks: status === 'fail' ? ['fused_hands', 'face_drift'] : ['verifier_inconclusive'],
        reason: status === 'fail' ? '人物手部异常且面部漂移' : '质检服务未得出结论',
      });

      await expect(
        runIpVideoCreation({ copyText: '欢迎关注我们的新品。' }, CFG, CTX, {}, svc),
      ).rejects.toMatchObject({
        name: 'IpVideoError',
        kind: expectedKind,
        failedChecks:
          status === 'fail' ? ['fused_hands', 'face_drift'] : ['verifier_inconclusive'],
        qualityReason: status === 'fail' ? '人物手部异常且面部漂移' : '质检服务未得出结论',
      });

      expect(
        mocks.storeOutputFile.mock.calls.some(
          (call) => ((call as unknown[])[0] as { filename?: string }).filename === 'video.mp4',
        ),
      ).toBe(false);
      expect(
        mocks.storeOutput.mock.calls.some(
          (call) => ((call as unknown[])[0] as { filename?: string }).filename === 'poster.jpg',
        ),
      ).toBe(false);
      expect(mocks.deleteOutput).toHaveBeenCalledWith('f_ip-voice.wav');
    },
  );
});

describe('splitIpCues — 全文案按字数比例切逐句字幕', () => {
  it('切句 + 时长比例(和=总时长,各>=1)', () => {
    const { segments, durations } = splitIpCues('第一句。第二句较长一些!', 4000);
    expect(segments).toHaveLength(2);
    expect(segments.every((s) => s.type === 'voiceover')).toBe(true);
    expect(durations.reduce((a, b) => a + b, 0)).toBe(4000);
    expect(durations.every((d) => d >= 1)).toBe(true);
    // 较长的第二句时长更大
    expect(durations).toHaveLength(2);
    const [firstDuration = 0, secondDuration = 0] = durations;
    expect(secondDuration).toBeGreaterThan(firstDuration);
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
