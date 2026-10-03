import { describe, expect, it, vi } from 'vitest';
import type { VideoScript } from './types.js';
import type { SimpleVideoConfig, SimpleVideoServices } from './video-lane-simple.js';

const ENV = {
  DASHSCOPE_API_KEY: 'dk',
  DASHSCOPE_BASE_URL: 'https://dashscope-intl.aliyuncs.com',
  DASHSCOPE_WORKSPACE_ID: '',
  FAL_KEY: 'fk',
  FAL_BASE_URL: 'https://queue.fal.run',
  WANXIANG_T2V_MODEL: 'wan2.7-t2v-2026-06-12',
  WANXIANG_I2V_MODEL: 'wan2.7-i2v',
  FAL_VEO_FAST_MODEL: 'fal-ai/veo3.1/fast',
  FAL_VEO_LITE_MODEL: 'fal-ai/veo3.1/lite',
  FAL_VEO_STANDARD_MODEL: 'fal-ai/veo3.1',
  QWEN_IMAGE_MODEL: 'qwen-image-2.0-pro',
  WAN_IMAGE_MODEL: 'wan2.7-image',
  FAL_NANO_BANANA_2_MODEL: 'fal-ai/nano-banana-2',
  FAL_NANO_BANANA_2_EDIT_MODEL: 'fal-ai/nano-banana-2/edit',
  IMAGE_DEFAULT_MODEL: 'nano_banana_2' as const,
};

vi.mock('../../config/env.js', () => ({ env: ENV }));

const { runSimpleVideoCreation, verifyAudioVisualSync, withProductionVideoProviders } =
  await import('./qwen-only-video-runtime.js');

// What tasks.ts#buildVideoCfg passes today (Gemini key included).
const TASKS_CFG: SimpleVideoConfig = {
  dashscopeApiKey: 'dk',
  dashscopeBaseUrl: 'https://dashscope-intl.aliyuncs.com',
  falApiKey: 'fk',
  falBaseUrl: 'https://queue.fal.run',
  geminiApiKey: 'legacy-google-key',
  geminiBaseUrl: 'https://disabled.invalid',
  qwenTtsModel: 'qwen3-tts-flash',
  presetVoice: 'Cherry',
  geminiImageModel: 'gemini-3.1-flash-image',
  wanxiangT2vModel: 'wan2.7-t2v-2026-06-12',
  wanI2vModel: 'wan2.2-i2v-flash',
};

const SCRIPT: VideoScript = {
  title: 't',
  segments: [{ text: '一句旁白', type: 'broll', visual: '一杯咖啡' }],
};

function services() {
  const mocks = {
    synthesizeSpeech: vi.fn(async () => ({ audioUrl: 'https://oss/a.wav', characters: 4 })),
    synthesizeGeminiSpeech: vi.fn(),
    generateImages: vi.fn(async () => ({
      images: [{ buffer: Buffer.from('img'), mimeType: 'image/png' }],
      model: 'm',
    })),
    generateBrollVideo: vi.fn(async () => ({
      taskId: 't',
      taskStatus: 'SUCCEEDED',
      imageUrls: [],
      videoUrl: 'https://oss/wan.mp4',
    })),
    generateVeoVideo: vi.fn(async () => ({
      videoUri: 'https://v3.fal.media/veo.mp4',
      elapsedMs: 1,
    })),
    downloadToBuffer: vi.fn(async () => ({ buffer: Buffer.from('a'), sizeBytes: 1 })),
    downloadToFile: vi.fn(async () => ({ contentType: 'video/mp4', sizeBytes: 1000 })),
    ffprobeDurationMs: vi.fn(async () => 8000),
    renderImageClip: vi.fn(async () => undefined),
    renderVideoClip: vi.fn(async () => undefined),
    runFfmpeg: vi.fn(async () => undefined),
    optimizeUserScript: vi.fn(async () => SCRIPT),
    writeFile: vi.fn(async () => undefined),
    readFile: vi.fn(async () => Buffer.from('final')),
    removeFile: vi.fn(async () => undefined),
  };
  const svc: SimpleVideoServices = {
    storeOutput: vi.fn(async (i: { filename: string }) => ({
      fileId: i.filename,
      storagePath: i.filename,
    })),
    storeOutputFile: vi.fn(async (i: { filename: string }) => ({
      fileId: i.filename,
      storagePath: i.filename,
    })),
    workdir: '/tmp/wd',
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    llm: async () => '{}',
    verifyFinalVideo: async () => ({ status: 'pass', failedChecks: [], reason: 'ok' }),
    overrides: mocks as unknown as SimpleVideoServices['overrides'],
  };
  return { svc, mocks };
}

describe('withProductionVideoProviders', () => {
  it('drops the Gemini key and selects Wan 2.7 / fal Veo 3.1 / image providers from config', () => {
    const cfg = withProductionVideoProviders(TASKS_CFG, ENV);
    expect(cfg.geminiApiKey).toBeUndefined();
    expect(cfg.geminiBaseUrl).toBeUndefined();
    expect(cfg).toMatchObject({
      veoProvider: 'fal',
      veoFastModel: 'fal-ai/veo3.1/fast',
      veoLiteModel: 'fal-ai/veo3.1/lite',
      veoStandardModel: 'fal-ai/veo3.1',
      wanxiangT2vModel: 'wan2.7-t2v-2026-06-12',
      wanI2vModel: 'wan2.7-i2v',
      falApiKey: 'fk',
    });
    expect(cfg.imageProviders?.models.wan_image).toBe('wan2.7-image');
  });
});

describe('production video runtime', () => {
  it('normal video on veo_fast calls fal Veo 3.1 with the fal key and no Google header', async () => {
    const { svc, mocks } = services();
    await runSimpleVideoCreation(
      { userText: '介绍一杯咖啡', script: SCRIPT },
      TASKS_CFG,
      { videoSource: 'veo_fast' },
      svc,
    );
    expect(mocks.generateVeoVideo).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: 'fk',
        baseUrl: 'https://queue.fal.run',
        model: 'fal-ai/veo3.1/fast',
      }),
    );
    const downloadOpts = (mocks.downloadToFile.mock.calls[0] as unknown[])[2] as {
      headers?: Record<string, string>;
    };
    expect(downloadOpts.headers).toBeUndefined();
    expect(mocks.synthesizeGeminiSpeech).not.toHaveBeenCalled();
  });

  it('normal video on wanxiang uses the Wan 2.7 t2v protocol', async () => {
    const { svc, mocks } = services();
    await runSimpleVideoCreation(
      { userText: '介绍一杯咖啡', script: SCRIPT },
      TASKS_CFG,
      { videoSource: 'wanxiang', veoResolution: '720p', veoDurationSeconds: 5 },
      svc,
    );
    expect(mocks.generateBrollVideo).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: 'dk',
        model: 'wan2.7-t2v-2026-06-12',
        resolution: '720P',
        ratio: '9:16',
        durationSeconds: 5,
      }),
    );
    expect(mocks.generateVeoVideo).not.toHaveBeenCalled();
  });

  it('does not fall back to Gemini TTS when Qwen narration fails', async () => {
    const { svc, mocks } = services();
    mocks.synthesizeSpeech.mockRejectedValue(new Error('tts down'));
    await expect(
      runSimpleVideoCreation(
        { userText: '介绍一杯咖啡', script: SCRIPT, retries: 0 },
        TASKS_CFG,
        { videoSource: 'wanxiang' },
        svc,
      ),
    ).rejects.toThrow();
    expect(mocks.synthesizeGeminiSpeech).not.toHaveBeenCalled();
  });

  it('audio-visual sync review stays non-blocking (unknown) without the Gemini reviewer', async () => {
    await expect(
      verifyAudioVisualSync({ videoPath: '/v.mp4', workdir: '/w', durationMs: 1000, apiKey: 'g' }),
    ).resolves.toMatchObject({ status: 'unknown', evidence: [] });
  });
});
