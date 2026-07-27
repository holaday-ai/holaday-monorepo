import { describe, expect, it, vi } from 'vitest';
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
  const overrides: Partial<CloneVideoFns> = {
    generateWanAnimateMix:
      generateWanAnimateMix as unknown as CloneVideoFns['generateWanAnimateMix'],
    downloadToBuffer: downloadToBuffer as unknown as CloneVideoFns['downloadToBuffer'],
    downloadToFile: downloadToFile as unknown as CloneVideoFns['downloadToFile'],
    readFile,
    runFfmpeg,
    ffprobeDurationMs,
    ffprobeVideoMetadata,
    readImageMetadata,
  };
  const services: CloneVideoServices = {
    storeOutput,
    storeOutputFile,
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
      downloadToBuffer,
      downloadToFile,
      readFile,
      runFfmpeg,
      ffprobeDurationMs,
      ffprobeVideoMetadata,
      readImageMetadata,
      storeOutput,
      storeOutputFile,
      verifyCloneInputs,
      verifyFinalVideo,
    },
  };
}

describe('runCloneVideoCreation', () => {
  it('sends both user assets to Wan Animate and stores the provider video without stripping its audio', async () => {
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
      'https://dashscope-result-sgp/clone.mp4',
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
    expect(mocks.runFfmpeg).toHaveBeenCalledTimes(1);
    expect(mocks.storeOutput).toHaveBeenCalledWith(
      expect.objectContaining({ filename: 'poster.jpg', mimetype: 'image/jpeg' }),
    );
    expect(result).toEqual({
      fileId: 'f_video.mp4',
      downloadUrl: '/api/files/f_video.mp4/download',
      durationSeconds: 8.2,
    });
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
      ).rejects.toMatchObject({ name: 'SimpleVideoError', kind: expectedKind });

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
