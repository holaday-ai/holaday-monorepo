import { describe, expect, it, vi } from 'vitest';
import type { SimpleVideoConfig } from './video-lane-simple.js';
import {
  runCloneVideoCreation,
  type CloneVideoFns,
  type CloneVideoServices,
} from './video-clone.js';

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
  const downloadToBuffer = vi.fn(async () => ({
    buffer: Buffer.from('clone-video'),
    contentType: 'video/mp4',
    sizeBytes: 11,
  }));
  const writeFile = vi.fn(async () => {});
  const readFile = vi.fn(async () => Buffer.from('poster'));
  const runFfmpeg = vi.fn(async () => {});
  const storeOutput = vi.fn(async (input: { filename: string }) => ({
    fileId: `f_${input.filename}`,
    storagePath: `s_${input.filename}`,
  }));
  const overrides: Partial<CloneVideoFns> = {
    generateWanAnimateMix: generateWanAnimateMix as unknown as CloneVideoFns['generateWanAnimateMix'],
    downloadToBuffer: downloadToBuffer as unknown as CloneVideoFns['downloadToBuffer'],
    writeFile,
    readFile,
    runFfmpeg,
  };
  const services: CloneVideoServices = {
    storeOutput,
    workdir: '/tmp/clone-video',
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    overrides,
  };
  return {
    services,
    mocks: { generateWanAnimateMix, downloadToBuffer, writeFile, readFile, runFfmpeg, storeOutput },
  };
}

describe('runCloneVideoCreation', () => {
  it('sends both user assets to Wan Animate and stores the provider video without stripping its audio', async () => {
    const { services, mocks } = makeServices();
    const result = await runCloneVideoCreation(
      {
        imageUrl: 'https://r2.example/subject.jpg',
        referenceVideoUrl: 'https://r2.example/reference.mp4',
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
    expect(mocks.downloadToBuffer).toHaveBeenCalledWith('https://dashscope-result-sgp/clone.mp4');
    expect(mocks.storeOutput).toHaveBeenCalledWith({
      filename: 'video.mp4',
      mimetype: 'video/mp4',
      buffer: Buffer.from('clone-video'),
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
});
