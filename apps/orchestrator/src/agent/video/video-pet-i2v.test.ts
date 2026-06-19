import { describe, expect, it, vi } from 'vitest';
import type { SimpleVideoConfig } from './video-lane-simple.js';
import {
  runPetVideoCreation,
  type PetI2vFns,
  type PetVideoServices,
} from './video-pet-i2v.js';

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
  const downloadToBuffer = vi.fn(async () => ({
    buffer: Buffer.from('rawvid'),
    contentType: 'video/mp4',
    sizeBytes: 6,
  }));
  const runFfmpeg = vi.fn(async () => {});
  const writeFile = vi.fn(async () => {});
  const readFile = vi.fn(async () => Buffer.from('finalvid'));
  const storeOutput = vi.fn(async (i: { filename: string }) => ({ fileId: `f_${i.filename}`, storagePath: `s_${i.filename}` }));
  const overrides: Partial<PetI2vFns> = {
    generateBrollVideo: generateBrollVideo as unknown as PetI2vFns['generateBrollVideo'],
    downloadToBuffer: downloadToBuffer as unknown as PetI2vFns['downloadToBuffer'],
    runFfmpeg,
    writeFile,
    readFile,
  };
  const svc: PetVideoServices = { storeOutput, workdir: '/tmp/petwd', logger, overrides };
  return { svc, mocks: { generateBrollVideo, downloadToBuffer, runFfmpeg, writeFile, readFile, storeOutput } };
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
    // composed via ffmpeg + final stored + 首帧 poster
    expect(mocks.runFfmpeg).toHaveBeenCalledTimes(2); // compose + poster
    expect(mocks.storeOutput).toHaveBeenCalledWith(expect.objectContaining({ filename: 'video.mp4' }));
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

  it('throws config error when no dashscope key / no image url', async () => {
    const { svc } = makeServices();
    await expect(
      runPetVideoCreation({ imageUrl: 'https://r2/x.jpg', motionPrompt: 'x' }, { ...CFG, dashscopeApiKey: '' }, {}, svc),
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
});
