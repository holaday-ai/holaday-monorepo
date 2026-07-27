import { describe, expect, it, vi } from 'vitest';
import type { MediaIntegrityReport } from './ffmpeg-exec.js';
import {
  type CloneVideoFns,
  type CloneVideoServices,
  runCloneVideoCreation,
} from './video-clone.js';
import type { SimpleVideoConfig } from './video-lane-simple.js';
import type { VideoQualityResult } from './video-quality-verifier.js';

const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);

const CFG: SimpleVideoConfig = {
  dashscopeApiKey: 'dk',
  dashscopeBaseUrl: 'https://dashscope-intl.aliyuncs.com',
  dashscopeWorkspaceId: 'ws-test',
  falApiKey: 'fk',
  falBaseUrl: 'https://queue.fal.run',
  falLipsyncModel: 'fal-ai/latentsync',
  qwenTtsModel: 'qwen3-tts-flash',
  presetVoice: 'Cherry',
  wanxiangT2vModel: 'wan2.1-t2v-turbo',
  watermarkFontFile: '/fonts/wqy.ttc',
};

function makeServices() {
  const generateWanAnimateMix = vi.fn(async () => ({
    taskId: 'mix-1',
    videoUrl: 'https://dashscope-result-sgp/clone.mp4',
    durationSeconds: 8.2,
    mode: 'wan-pro' as const,
  }));
  const downloadToBuffer = vi.fn(async (url: string) => ({
    buffer: url.includes('subject.jpg') ? TINY_PNG : Buffer.from('clone-video'),
    contentType: url.includes('subject.jpg') ? 'image/png' : 'video/mp4',
    sizeBytes: 11,
  }));
  const downloadToFile = vi.fn(async () => ({
    contentType: 'video/mp4',
    sizeBytes: 42_000_000,
  }));
  const runLipSync = vi.fn(async () => ({
    videoUrl: 'https://v3.fal.media/clone-lipsynced.mp4',
    requestId: 'lip-1',
    elapsedMs: 120_000,
  }));
  const readFile = vi.fn(async () => Buffer.from('poster'));
  const runFfmpeg = vi.fn(async () => {});
  const ffprobeDurationMs = vi.fn(async () => 8200);
  const ffprobeVideoMetadata = vi.fn(async () => ({
    width: 1080,
    height: 1920,
    durationMs: 8200,
  }));
  const readImageMetadata = vi.fn(async () => ({ width: 1024, height: 1024 }));
  const storeOutput = vi.fn(async (input: { filename: string }) => ({
    fileId: `f_${input.filename}`,
    storagePath: `s_${input.filename}`,
  }));
  const storeOutputFile = vi.fn(async (input: { filename: string }) => ({
    fileId: `f_${input.filename}`,
    storagePath: `s_${input.filename}`,
  }));
  const storeTemporaryAudio = vi.fn(async () => ({ fileId: 'f_clone-audio.wav' }));
  const presignByFileId = vi.fn(async () => 'https://r2.example/f_clone-audio.wav?sig');
  const deleteOutput = vi.fn(async () => true);
  const verifyFinalVideo = vi.fn(
    async (): Promise<VideoQualityResult> => ({
      status: 'pass' as const,
      failedChecks: [],
      reason: '主体、动作和肢体均通过',
    }),
  );
  const verifyCloneInputs = vi.fn(
    async (): Promise<VideoQualityResult> => ({
      status: 'pass' as const,
      failedChecks: [],
      reason: '单人主体和参考视频取景相容',
    }),
  );
  const inspectMediaIntegrity = vi.fn(async (): Promise<MediaIntegrityReport> => ({
    durationMs: 8200,
    hasVideo: true,
    hasAudio: true,
    frozenRatio: 0.1,
    audioMeanVolumeDb: -24,
    audioMaxVolumeDb: -8,
  }));
  const overrides: Partial<CloneVideoFns> = {
    generateWanAnimateMix:
      generateWanAnimateMix as unknown as CloneVideoFns['generateWanAnimateMix'],
    runLipSync: runLipSync as unknown as CloneVideoFns['runLipSync'],
    downloadToBuffer: downloadToBuffer as unknown as CloneVideoFns['downloadToBuffer'],
    downloadToFile: downloadToFile as unknown as CloneVideoFns['downloadToFile'],
    readFile,
    runFfmpeg,
    ffprobeDurationMs,
    ffprobeVideoMetadata,
    readImageMetadata,
    inspectMediaIntegrity,
  };
  const services: CloneVideoServices = {
    storeOutput,
    storeOutputFile,
    storeTemporaryAudio,
    presignByFileId,
    deleteOutput,
    workdir: '/tmp/clone-video',
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    verifyCloneInputs,
    verifyFinalVideo,
    overrides,
  } as CloneVideoServices & {
    verifyCloneInputs(input: unknown): Promise<VideoQualityResult>;
  };
  return {
    services,
    mocks: {
      generateWanAnimateMix,
      runLipSync,
      downloadToBuffer,
      downloadToFile,
      readFile,
      runFfmpeg,
      ffprobeDurationMs,
      ffprobeVideoMetadata,
      readImageMetadata,
      storeOutput,
      storeOutputFile,
      storeTemporaryAudio,
      presignByFileId,
      deleteOutput,
      verifyCloneInputs,
      verifyFinalVideo,
      inspectMediaIntegrity,
    },
  };
}

describe('runCloneVideoCreation', () => {
  it('lip-syncs an audible clone with the original audio before quality verification and storage', async () => {
    const { services, mocks } = makeServices();
    const result = await runCloneVideoCreation(
      {
        imageUrl: 'https://r2.example/subject.jpg',
        referenceVideoUrl: 'https://r2.example/reference.mp4',
        description: '保持参考动作，把主角替换为上传角色',
      },
      CFG,
      { mode: 'wan-pro' },
      services,
    );

    expect(mocks.generateWanAnimateMix).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: 'dk',
        workspaceId: 'ws-test',
        imageUrl: 'https://r2.example/subject.jpg',
        referenceVideoUrl: 'https://r2.example/reference.mp4',
        mode: 'wan-pro',
      }),
    );
    expect(mocks.downloadToFile).toHaveBeenCalledWith(
      'https://v3.fal.media/clone-lipsynced.mp4',
      '/tmp/clone-video/clone-final.mp4',
      { maxBytes: 500 * 1024 * 1024 },
    );
    expect(mocks.downloadToFile).toHaveBeenCalledWith(
      'https://r2.example/reference.mp4',
      '/tmp/clone-video/clone-reference.mp4',
      { maxBytes: 200 * 1024 * 1024 },
    );
    expect(mocks.downloadToBuffer).not.toHaveBeenCalledWith('https://r2.example/reference.mp4');
    expect(mocks.downloadToBuffer).not.toHaveBeenCalledWith(
      'https://dashscope-result-sgp/clone.mp4',
    );
    expect(mocks.runLipSync).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: 'fk',
        baseUrl: 'https://queue.fal.run',
        model: 'fal-ai/latentsync',
        videoUrl: 'https://dashscope-result-sgp/clone.mp4',
        audioUrl: 'https://r2.example/f_clone-audio.wav?sig',
        extra: { loop_mode: 'loop' },
      }),
    );
    expect(mocks.storeTemporaryAudio).toHaveBeenCalledWith({
      filename: 'clone-reference-audio.wav',
      mimetype: 'audio/wav',
      buffer: Buffer.from('poster'),
    });
    expect(mocks.deleteOutput).toHaveBeenCalledWith('f_clone-audio.wav');
    expect(mocks.verifyCloneInputs).toHaveBeenCalledWith(
      expect.objectContaining({
        subjectImage: expect.objectContaining({
          label: '上传的主角照片',
        }),
        referenceVideoPath: '/tmp/clone-video/clone-reference.mp4',
        referenceVideoDurationMs: 8200,
        workdir: '/tmp/clone-video',
      }),
    );
    expect(mocks.verifyFinalVideo).toHaveBeenCalledWith(
      expect.objectContaining({
        videoPath: '/tmp/clone-video/clone-final.mp4',
        durationMs: 8200,
        minimumDurationMs: 8200,
        userText: '保持参考动作，把主角替换为上传角色',
        qualityContext: expect.stringMatching(/主角.*身份.*粗粒度姿态.*静态抽样/),
        referenceImages: [
          expect.objectContaining({
            mediaType: 'image/jpeg',
            label: '上传的主角照片',
          }),
        ],
        referenceVideos: [
          expect.objectContaining({
            videoPath: '/tmp/clone-video/clone-reference.mp4',
            label: '用户上传的参考动作视频',
          }),
        ],
        requiredBrandTexts: ['Generated by Qwen AI'],
      }),
    );
    expect(mocks.storeOutputFile).toHaveBeenCalledWith({
      filename: 'video.mp4',
      mimetype: 'video/mp4',
      sourcePath: '/tmp/clone-video/clone-final.mp4',
    });
    expect(mocks.runFfmpeg).toHaveBeenCalledWith(
      {
        bin: 'ffmpeg',
        args: [
          '-y',
          '-i',
          '/tmp/clone-video/clone-reference.mp4',
          '-map',
          '0:a:0',
          '-vn',
          '-ac',
          '1',
          '-ar',
          '16000',
          '-c:a',
          'pcm_s16le',
          '/tmp/clone-video/clone-reference-audio.wav',
        ],
      },
      {},
    );
    expect(mocks.runFfmpeg).toHaveBeenCalledTimes(2);
    expect(mocks.storeOutput).toHaveBeenCalledWith(
      expect.objectContaining({ filename: 'poster.jpg', mimetype: 'image/jpeg' }),
    );
    expect(result).toEqual({
      fileId: 'f_video.mp4',
      downloadUrl: '/api/files/f_video.mp4/download',
      durationSeconds: 8.2,
    });
  });

  it('keeps the direct clone path when the reference video has no audible audio', async () => {
    const { services, mocks } = makeServices();
    mocks.inspectMediaIntegrity
      .mockResolvedValueOnce({
        durationMs: 8200,
        hasVideo: true,
        hasAudio: false,
        frozenRatio: 0.1,
        audioMeanVolumeDb: null,
        audioMaxVolumeDb: null,
      })
      .mockResolvedValueOnce({
        durationMs: 8200,
        hasVideo: true,
        hasAudio: false,
        frozenRatio: 0.1,
        audioMeanVolumeDb: null,
        audioMaxVolumeDb: null,
      });

    await runCloneVideoCreation(
      {
        imageUrl: 'https://r2.example/subject.jpg',
        referenceVideoUrl: 'https://r2.example/reference.mp4',
      },
      CFG,
      { mode: 'wan-pro' },
      services,
    );

    expect(mocks.runLipSync).not.toHaveBeenCalled();
    expect(mocks.storeTemporaryAudio).not.toHaveBeenCalled();
    expect(mocks.downloadToFile).toHaveBeenCalledWith(
      'https://dashscope-result-sgp/clone.mp4',
      '/tmp/clone-video/clone-final.mp4',
      { maxBytes: 500 * 1024 * 1024 },
    );
  });

  it('rejects an audible clone before the paid Wan job when lip-sync is not configured', async () => {
    const { services, mocks } = makeServices();

    await expect(
      runCloneVideoCreation(
        {
          imageUrl: 'https://r2.example/subject.jpg',
          referenceVideoUrl: 'https://r2.example/reference.mp4',
        },
        { ...CFG, falApiKey: undefined },
        { mode: 'wan-pro' },
        services,
      ),
    ).rejects.toMatchObject({
      name: 'SimpleVideoError',
      kind: 'config',
    });

    expect(mocks.generateWanAnimateMix).not.toHaveBeenCalled();
    expect(mocks.storeTemporaryAudio).not.toHaveBeenCalled();
  });

  it('rejects a missing reference video before calling the provider', async () => {
    const { services, mocks } = makeServices();
    await expect(
      runCloneVideoCreation(
        { imageUrl: 'https://r2.example/subject.jpg', referenceVideoUrl: '' },
        CFG,
        { mode: 'wan-std' },
        services,
      ),
    ).rejects.toMatchObject({ kind: 'config' });
    expect(mocks.generateWanAnimateMix).not.toHaveBeenCalled();
  });

  it('rejects unsupported source dimensions before starting the paid provider job', async () => {
    const { services, mocks } = makeServices();
    mocks.readImageMetadata.mockResolvedValueOnce({ width: 120, height: 120 });

    await expect(
      runCloneVideoCreation(
        {
          imageUrl: 'https://r2.example/subject.jpg',
          referenceVideoUrl: 'https://r2.example/reference.mp4',
        },
        CFG,
        { mode: 'wan-pro' },
        services,
      ),
    ).rejects.toMatchObject({ name: 'SimpleVideoError', kind: 'invalid_options' });

    expect(mocks.generateWanAnimateMix).not.toHaveBeenCalled();
  });

  it('rejects an out-of-range reference before starting the paid provider job', async () => {
    const { services, mocks } = makeServices();
    mocks.ffprobeVideoMetadata.mockResolvedValueOnce({
      width: 1080,
      height: 1920,
      durationMs: 31_000,
    });

    await expect(
      runCloneVideoCreation(
        {
          imageUrl: 'https://r2.example/subject.jpg',
          referenceVideoUrl: 'https://r2.example/reference.mp4',
        },
        CFG,
        { mode: 'wan-pro' },
        services,
      ),
    ).rejects.toMatchObject({ name: 'SimpleVideoError', kind: 'invalid_options' });

    expect(mocks.generateWanAnimateMix).not.toHaveBeenCalled();
  });

  it('rejects a still-image reference before starting the paid provider job', async () => {
    const { services, mocks } = makeServices();
    mocks.inspectMediaIntegrity.mockResolvedValueOnce({
      durationMs: 8200,
      hasVideo: true,
      hasAudio: false,
      frozenRatio: 1,
      audioMeanVolumeDb: null,
      audioMaxVolumeDb: null,
    });

    await expect(
      runCloneVideoCreation(
        {
          imageUrl: 'https://r2.example/subject.jpg',
          referenceVideoUrl: 'https://r2.example/reference.mp4',
        },
        CFG,
        { mode: 'wan-pro' },
        services,
      ),
    ).rejects.toMatchObject({
      name: 'SimpleVideoError',
      kind: 'clone_incompatible',
      failedChecks: ['source_motion_missing'],
    });

    expect(mocks.generateWanAnimateMix).not.toHaveBeenCalled();
  });

  it.each([
    [
      'fail',
      'clone_incompatible',
      ['subject_not_single_human', 'framing_mismatch'],
      '主角不是单人，且取景与参考视频不一致',
    ],
    [
      'unknown',
      'clone_compatibility_unavailable',
      ['verifier_inconclusive'],
      '素材兼容性检查未得出结论',
    ],
  ] as const)(
    'blocks a %s compatibility verdict before starting the paid provider job',
    async (status, expectedKind, failedChecks, reason) => {
      const { services, mocks } = makeServices();
      mocks.verifyCloneInputs.mockResolvedValueOnce({
        status,
        failedChecks: [...failedChecks],
        reason,
      });

      await expect(
        runCloneVideoCreation(
          {
            imageUrl: 'https://r2.example/subject.jpg',
            referenceVideoUrl: 'https://r2.example/reference.mp4',
          },
          CFG,
          { mode: 'wan-pro' },
          services,
        ),
      ).rejects.toMatchObject({
        name: 'SimpleVideoError',
        kind: expectedKind,
      });

      expect(mocks.generateWanAnimateMix).not.toHaveBeenCalled();
      expect(mocks.verifyFinalVideo).not.toHaveBeenCalled();
      expect(mocks.storeOutputFile).not.toHaveBeenCalled();
    },
  );

  it('blocks an output that drops audible reference audio', async () => {
    const { services, mocks } = makeServices();
    mocks.inspectMediaIntegrity
      .mockResolvedValueOnce({
        durationMs: 8200,
        hasVideo: true,
        hasAudio: true,
        frozenRatio: 0.1,
        audioMeanVolumeDb: -22,
        audioMaxVolumeDb: -7,
      })
      .mockResolvedValueOnce({
        durationMs: 8200,
        hasVideo: true,
        hasAudio: false,
        frozenRatio: 0.1,
        audioMeanVolumeDb: null,
        audioMaxVolumeDb: null,
      });

    await expect(
      runCloneVideoCreation(
        {
          imageUrl: 'https://r2.example/subject.jpg',
          referenceVideoUrl: 'https://r2.example/reference.mp4',
          description: '复刻动作并保留原片声音',
        },
        CFG,
        { mode: 'wan-pro' },
        services,
      ),
    ).rejects.toMatchObject({
      name: 'SimpleVideoError',
      kind: 'quality',
      failedChecks: ['output_audio_missing'],
    });

    expect(mocks.verifyFinalVideo).not.toHaveBeenCalled();
    expect(mocks.storeOutputFile).not.toHaveBeenCalled();
  });

  it.each([
    ['fail', 'quality'],
    ['unknown', 'quality_unavailable'],
  ] as const)(
    'blocks a %s clone verdict before storing the final video or poster',
    async (status, expectedKind) => {
      const { services, mocks } = makeServices();
      mocks.verifyFinalVideo.mockResolvedValueOnce({
        status,
        failedChecks:
          status === 'fail' ? ['fused_hands', 'identity_drift'] : ['verifier_inconclusive'],
        reason: status === 'fail' ? '手部融合且主角身份漂移' : '质检服务未得出结论',
      });

      await expect(
        runCloneVideoCreation(
          {
            imageUrl: 'https://r2.example/subject.jpg',
            referenceVideoUrl: 'https://r2.example/reference.mp4',
            description: '复刻动作并保持主角一致',
          },
          CFG,
          { mode: 'wan-pro' },
          services,
        ),
      ).rejects.toMatchObject({
        name: 'SimpleVideoError',
        kind: expectedKind,
        failedChecks:
          status === 'fail' ? ['fused_hands', 'identity_drift'] : ['verifier_inconclusive'],
        qualityReason: status === 'fail' ? '手部融合且主角身份漂移' : '质检服务未得出结论',
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
    },
  );
});
