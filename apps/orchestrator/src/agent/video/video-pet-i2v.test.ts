import { describe, expect, it, vi } from 'vitest';
import type { SimpleVideoConfig } from './video-lane-simple.js';
import { type PetI2vFns, type PetVideoServices, runPetVideoCreation } from './video-pet-i2v.js';
import type { VideoQualityResult } from './video-quality-verifier.js';

const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);

const CFG: SimpleVideoConfig = {
  dashscopeApiKey: 'dk',
  dashscopeBaseUrl: 'https://dashscope-intl.aliyuncs.com',
  qwenTtsModel: 'qwen3-tts-flash',
  presetVoice: 'Cherry',
  wanxiangT2vModel: 'wan2.1-t2v-turbo',
  wanI2vModel: 'wan2.2-i2v-flash',
  happyhorseI2vModel: 'happyhorse-1.0-i2v',
  watermarkFontFile: '/fonts/wqy.ttc',
};

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

function makeServices() {
  const generateBrollVideo = vi.fn(async () => ({
    taskId: 't1',
    taskStatus: 'SUCCEEDED' as const,
    imageUrls: [] as string[],
    videoUrl: 'https://dashscope-result-sgp/pet.mp4',
  }));
  const downloadToBuffer = vi.fn(async (url: string) => ({
    buffer:
      url.includes('/pet.') || url.includes('/dog.') || url.includes('/cat.') || url.includes('/x.')
        ? TINY_PNG
        : Buffer.from('rawvid'),
    contentType:
      url.includes('/pet.') || url.includes('/dog.') || url.includes('/cat.') || url.includes('/x.')
        ? 'image/png'
        : 'video/mp4',
    sizeBytes: 6,
  }));
  const downloadToFile = vi.fn(async () => ({
    contentType: 'video/mp4',
    sizeBytes: 42_000_000,
  }));
  const runFfmpeg = vi.fn(async () => {});
  const ffprobeDurationMs = vi.fn(async () => 8000);
  const readFile = vi.fn(async () => Buffer.from('finalvid'));
  const storeOutput = vi.fn(async (i: { filename: string }) => ({
    fileId: `f_${i.filename}`,
    storagePath: `s_${i.filename}`,
  }));
  const storeOutputFile = vi.fn(async (i: { filename: string }) => ({
    fileId: `f_${i.filename}`,
    storagePath: `s_${i.filename}`,
  }));
  const verifyFinalVideo = vi.fn(
    async (): Promise<VideoQualityResult> => ({
      status: 'pass' as const,
      failedChecks: [],
      reason: '宠物身份和肢体均通过',
    }),
  );
  const overrides: Partial<PetI2vFns> = {
    generateBrollVideo: generateBrollVideo as unknown as PetI2vFns['generateBrollVideo'],
    downloadToBuffer: downloadToBuffer as unknown as PetI2vFns['downloadToBuffer'],
    downloadToFile: downloadToFile as unknown as PetI2vFns['downloadToFile'],
    runFfmpeg,
    ffprobeDurationMs,
    readFile,
  };
  const svc: PetVideoServices = {
    storeOutput,
    storeOutputFile,
    workdir: '/tmp/petwd',
    logger,
    verifyFinalVideo,
    overrides,
  };
  return {
    svc,
    mocks: {
      generateBrollVideo,
      downloadToBuffer,
      downloadToFile,
      runFfmpeg,
      ffprobeDurationMs,
      readFile,
      storeOutput,
      storeOutputFile,
      verifyFinalVideo,
    },
  };
}

describe('runPetVideoCreation — 宠物 i2v 单图', () => {
  it('default model = wan2.2-i2v-flash; passes img_url + size(画幅) to generateBrollVideo', async () => {
    const { svc, mocks } = makeServices();
    const res = await runPetVideoCreation(
      { imageUrl: 'https://r2/pet.jpg', motionPrompt: '小猫眨眨眼' },
      CFG,
      {},
      svc,
    );
    expect(mocks.downloadToFile).toHaveBeenCalledWith(
      'https://dashscope-result-sgp/pet.mp4',
      '/tmp/petwd/pet-i2v-raw.mp4',
      { maxBytes: 500 * 1024 * 1024 },
    );
    const arg = (mocks.generateBrollVideo.mock.calls[0] as unknown[])[0] as {
      model: string;
      imageUrl: string;
      size: string;
      prompt: string;
    };
    expect(arg.model).toBe('wan2.2-i2v-flash'); // 默认更省 + 已证可达
    expect(arg.imageUrl).toBe('https://r2/pet.jpg');
    expect(arg.size).toBe('1080*1920'); // 默认竖屏 9:16
    expect(arg.prompt).toContain('小猫眨眨眼');
    expect(arg.prompt).toMatch(/肢体数量|关节|主体外观/);
    expect(mocks.verifyFinalVideo).toHaveBeenCalledWith(
      expect.objectContaining({
        videoPath: '/tmp/petwd/pet-final.mp4',
        durationMs: 8000,
        userText: '小猫眨眨眼',
        qualityContext: expect.stringMatching(/宠物.*身份.*四肢/),
        referenceImages: [
          expect.objectContaining({
            mediaType: 'image/jpeg',
            label: '用户上传的宠物照片',
          }),
        ],
      }),
    );
    // composed via ffmpeg + final stored + 首帧 poster
    expect(mocks.runFfmpeg).toHaveBeenCalledTimes(2); // compose + poster
    expect(mocks.storeOutputFile).toHaveBeenCalledWith(
      expect.objectContaining({
        filename: 'video.mp4',
        sourcePath: '/tmp/petwd/pet-final.mp4',
      }),
    );
    expect(mocks.storeOutput).toHaveBeenCalledWith(
      expect.objectContaining({ filename: 'poster.jpg', mimetype: 'image/jpeg' }),
    );
    expect(res.fileId).toBe('f_video.mp4');
    expect(res.downloadUrl).toContain('/download');
  });

  it('model=happyhorse_i2v → happyhorse-1.0-i2v; durationSeconds → adapter', async () => {
    const { svc, mocks } = makeServices();
    await runPetVideoCreation(
      { imageUrl: 'https://r2/dog.png', motionPrompt: '狗狗摇尾巴' },
      CFG,
      { model: 'happyhorse_i2v', aspectRatio: '16:9', durationSeconds: 5 },
      svc,
    );
    const arg = (mocks.generateBrollVideo.mock.calls[0] as unknown[])[0] as {
      model: string;
      size: string;
      durationSeconds?: number;
    };
    expect(arg.model).toBe('happyhorse-1.0-i2v');
    expect(arg.size).toBe('1920*1080'); // 横屏
    expect(arg.durationSeconds).toBe(5);
  });

  it('aspectRatio=3:4 → passes portrait 1080*1440 to i2v adapter', async () => {
    const { svc, mocks } = makeServices();
    await runPetVideoCreation(
      { imageUrl: 'https://r2/cat.png', motionPrompt: '小猫眨眼' },
      CFG,
      { aspectRatio: '3:4' },
      svc,
    );
    const arg = (mocks.generateBrollVideo.mock.calls[0] as unknown[])[0] as { size: string };
    expect(arg.size).toBe('1080*1440');
  });

  it('throws config error when no dashscope key / no image url', async () => {
    const { svc } = makeServices();
    await expect(
      runPetVideoCreation(
        { imageUrl: 'https://r2/x.jpg', motionPrompt: 'x' },
        { ...CFG, dashscopeApiKey: '' },
        {},
        svc,
      ),
    ).rejects.toMatchObject({ kind: 'config' });
    await expect(
      runPetVideoCreation({ imageUrl: '', motionPrompt: 'x' }, CFG, {}, svc),
    ).rejects.toMatchObject({ kind: 'config' });
  });

  it('throws compose error when i2v returns no video url', async () => {
    const { svc, mocks } = makeServices();
    mocks.generateBrollVideo.mockResolvedValueOnce({
      taskId: 't',
      taskStatus: 'SUCCEEDED',
      imageUrls: [],
    } as unknown as Awaited<ReturnType<typeof mocks.generateBrollVideo>>);
    await expect(
      runPetVideoCreation({ imageUrl: 'https://r2/x.jpg', motionPrompt: 'x' }, CFG, {}, svc),
    ).rejects.toMatchObject({ kind: 'compose' });
  });

  it.each(['fail', 'unknown'] as const)(
    'blocks a %s pet verdict before storing the final video or poster',
    async (status) => {
      const { svc, mocks } = makeServices();
      mocks.verifyFinalVideo.mockResolvedValueOnce({
        status,
        failedChecks: status === 'fail' ? ['extra_limbs'] : ['verifier_inconclusive'],
        reason: status === 'fail' ? '宠物出现额外肢体' : '质检服务未得出结论',
      });

      await expect(
        runPetVideoCreation(
          { imageUrl: 'https://r2/dog.png', motionPrompt: '狗狗自然走向镜头' },
          CFG,
          { durationSeconds: 6 },
          svc,
        ),
      ).rejects.toMatchObject({ name: 'SimpleVideoError', kind: 'quality' });

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
