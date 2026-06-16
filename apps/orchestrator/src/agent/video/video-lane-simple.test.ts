import { describe, expect, it, vi } from 'vitest';
import {
  runSimpleVideoCreation,
  type SimpleVideoConfig,
  type SimpleVideoOptions,
  type SimpleVideoServices,
} from './video-lane-simple.js';
import type { VideoScript } from './types.js';

const CFG: SimpleVideoConfig = {
  dashscopeApiKey: 'dk',
  dashscopeBaseUrl: 'https://dashscope-intl.aliyuncs.com',
  geminiApiKey: 'gk',
  geminiBaseUrl: 'https://generativelanguage.googleapis.com',
  qwenTtsModel: 'qwen3-tts-flash',
  presetVoice: 'Cherry',
  geminiImageModel: 'gemini-3.1-flash-image',
  wanxiangT2vModel: 'wan2.1-t2v-turbo',
  veoFastModel: 'veo-3.1-fast-generate-preview',
  veoLiteModel: 'veo-3.1-lite-generate-preview',
  veoStandardModel: 'veo-3.1-generate-preview',
};

const SCRIPT: VideoScript = {
  title: 't',
  segments: [
    { text: '第一句旁白', type: 'broll', visual: '画面一' },
    { text: '第二句旁白', type: 'broll', visual: '画面二' },
  ],
};

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

function makeServices() {
  const mocks = {
    optimizeUserScript: vi.fn(async () => SCRIPT),
    synthesizeSpeech: vi.fn(async () => ({ audioUrl: 'https://oss/a.wav', characters: 5 })),
    generateImages: vi.fn(async () => ({ images: [{ buffer: Buffer.from('img'), mimeType: 'image/png' }], model: 'nb' })),
    generateBrollVideo: vi.fn(async () => ({ taskStatus: 'SUCCEEDED', imageUrls: [], videoUrl: 'https://oss/v.mp4' })),
    generateVeoVideo: vi.fn(async () => ({ videoUri: 'https://gl/veo.mp4', elapsedMs: 1 })),
    downloadToBuffer: vi.fn(async () => ({ buffer: Buffer.from('x'), sizeBytes: 1 })),
    ffprobeDurationMs: vi.fn(async () => 2500),
    renderImageClip: vi.fn(async () => undefined),
    renderVideoClip: vi.fn(async () => undefined),
    runFfmpeg: vi.fn(async () => undefined),
    writeFile: vi.fn(async () => undefined),
    readFile: vi.fn(async () => Buffer.from('final')),
  };
  const storeOutput = vi.fn(async (i: { filename: string }) => ({ fileId: `f_${i.filename}`, storagePath: `sp/${i.filename}` }));
  const svc: SimpleVideoServices = {
    storeOutput,
    workdir: '/tmp/wd',
    logger,
    llm: async () => '{}',
    overrides: mocks as unknown as SimpleVideoServices['overrides'],
  };
  return { svc, mocks: { ...mocks, storeOutput } };
}

describe('runSimpleVideoCreation — video (default = veo_fast)', () => {
  it('empty opts → Cherry synth → Veo 3.1 Fast (8s/1080p/9:16, anatomy prompt) → renderVideoClip → compose', async () => {
    const { svc, mocks } = makeServices();
    // BOSS 2026-06-15: 万相手部畸形 + Lite 解剖不稳 → 默认 Veo 3.1 Fast.
    const out = await runSimpleVideoCreation({ userText: '讲讲夏天防晒' }, CFG, {}, svc);

    expect(mocks.optimizeUserScript).toHaveBeenCalledTimes(1);
    const synthArg = (mocks.synthesizeSpeech.mock.calls[0] as unknown[])[0] as { voiceId: string; model: string };
    expect(synthArg.voiceId).toBe('Cherry');
    expect(synthArg.model).toBe('qwen3-tts-flash');
    // default video visual: Veo Fast + renderVideoClip (NOT nano banana / wanxiang)
    expect(mocks.generateVeoVideo).toHaveBeenCalledTimes(2);
    expect(mocks.renderVideoClip).toHaveBeenCalledTimes(2);
    expect(mocks.generateBrollVideo).not.toHaveBeenCalled();
    expect(mocks.generateImages).not.toHaveBeenCalled();
    expect(mocks.renderImageClip).not.toHaveBeenCalled();
    const veoArg = (mocks.generateVeoVideo.mock.calls[0] as unknown[])[0] as {
      model: string; prompt: string; aspectRatio: string; durationSeconds: number; resolution: string;
    };
    expect(veoArg.model).toBe('veo-3.1-fast-generate-preview');
    expect(veoArg.aspectRatio).toBe('9:16');
    expect(veoArg.durationSeconds).toBe(8); // BOSS: 8s
    expect(veoArg.resolution).toBe('1080p'); // BOSS: 1080p
    // anatomy constraints ride in the prompt
    expect(veoArg.prompt).toContain('画面整洁');
    expect(veoArg.prompt).toMatch(/五指完整|多余肢体|双臂可追溯/);
    // 范围2 收窄: 仍压"含文字物体/编造乱码假字", 但删掉"任何文字"一刀切
    expect(veoArg.prompt).toMatch(/含文字物体|编造乱码假字/);
    expect(veoArg.prompt).not.toContain('不能有任何文字');
    expect(mocks.runFfmpeg).toHaveBeenCalledTimes(1);
    expect(out.visualMode).toBe('video');
    expect(out.fileId).toBe('f_video.mp4');
    expect(out.segments).toBe(2);
    expect(out.totalDurationMs).toBe(5000);
  });
});

describe('runSimpleVideoCreation — image (nano banana, static)', () => {
  it('visualMode=image → nano banana (anatomy+vertical prompt) → renderImageClip (NO Ken Burns)', async () => {
    const { svc, mocks } = makeServices();
    const opts: SimpleVideoOptions = { visualMode: 'image' };
    const out = await runSimpleVideoCreation({ userText: '讲讲夏天防晒' }, CFG, opts, svc);
    expect(mocks.generateImages).toHaveBeenCalledTimes(2);
    const imgArg = (mocks.generateImages.mock.calls[0] as unknown[])[0] as { model: string; prompt: string };
    expect(imgArg.model).toBe('gemini-3.1-flash-image'); // nano banana
    expect(imgArg.prompt).toContain('竖屏'); // 9:16 ridden in prompt (no aspectRatio param)
    expect(imgArg.prompt).toMatch(/五指完整|多余肢体/); // anatomy
    // STATIC render, no Ken Burns, no video
    expect(mocks.renderImageClip).toHaveBeenCalledTimes(2);
    expect(mocks.renderVideoClip).not.toHaveBeenCalled();
    expect(mocks.generateVeoVideo).not.toHaveBeenCalled();
    expect(mocks.generateBrollVideo).not.toHaveBeenCalled();
    expect(out.visualMode).toBe('image');
  });
});

describe('runSimpleVideoCreation — Veo tiers (explicit)', () => {
  it('veo_lite (省钱) → lite model', async () => {
    const { svc, mocks } = makeServices();
    await runSimpleVideoCreation({ userText: 'x' }, CFG, { visualMode: 'video', videoSource: 'veo_lite' }, svc);
    const veoArg = (mocks.generateVeoVideo.mock.calls[0] as unknown[])[0] as { model: string };
    expect(veoArg.model).toBe('veo-3.1-lite-generate-preview');
  });

  it('veo_standard (高质量) → standard model + x-goog-api-key download', async () => {
    const { svc, mocks } = makeServices();
    await runSimpleVideoCreation({ userText: 'x' }, CFG, { visualMode: 'video', videoSource: 'veo_standard' }, svc);
    const veoArg = (mocks.generateVeoVideo.mock.calls[0] as unknown[])[0] as { model: string };
    expect(veoArg.model).toBe('veo-3.1-generate-preview');
    const dlVeo = mocks.downloadToBuffer.mock.calls.find(
      (c) => ((c as unknown[])[0] as string) === 'https://gl/veo.mp4',
    ) as unknown[] | undefined;
    expect((((dlVeo?.[1] as { headers?: Record<string, string> })?.headers ?? {}) as Record<string, string>)['x-goog-api-key']).toBe('gk');
  });
});

describe('runSimpleVideoCreation — wanxiang (fallback, explicit)', () => {
  it('videoSource=wanxiang → t2v (no-text+anatomy negative) + renderVideoClip', async () => {
    const { svc, mocks } = makeServices();
    await runSimpleVideoCreation({ userText: 'x' }, CFG, { visualMode: 'video', videoSource: 'wanxiang' }, svc);
    expect(mocks.generateBrollVideo).toHaveBeenCalledTimes(2);
    expect(mocks.generateVeoVideo).not.toHaveBeenCalled();
    expect(mocks.renderVideoClip).toHaveBeenCalledTimes(2);
    const t2vArg = (mocks.generateBrollVideo.mock.calls[0] as unknown[])[0] as { prompt: string; negativePrompt?: string; size?: string };
    expect(t2vArg.prompt).toContain('画面整洁');
    expect(t2vArg.negativePrompt ?? '').toMatch(/乱码|多余手臂|extra arm/);
    expect(t2vArg.size).toBe('720*1280');
  });
});

describe('runSimpleVideoCreation — config gates', () => {
  it('throws config when DASHSCOPE key missing', async () => {
    const { svc } = makeServices();
    await expect(
      runSimpleVideoCreation({ userText: 'x' }, { ...CFG, dashscopeApiKey: '' }, {}, svc),
    ).rejects.toMatchObject({ kind: 'config' });
  });

  it('throws config when video (default Veo) but GEMINI key missing', async () => {
    const { svc } = makeServices();
    await expect(
      runSimpleVideoCreation({ userText: 'x' }, { ...CFG, geminiApiKey: '' }, {}, svc),
    ).rejects.toMatchObject({ kind: 'config' });
  });

  it('throws config when image (nano banana) but GEMINI key missing', async () => {
    const { svc } = makeServices();
    await expect(
      runSimpleVideoCreation({ userText: 'x' }, { ...CFG, geminiApiKey: '' }, { visualMode: 'image' }, svc),
    ).rejects.toMatchObject({ kind: 'config' });
  });
});

describe('runSimpleVideoCreation — pre-optimized script (Phase-1 quote reuse)', () => {
  it('uses input.script verbatim and SKIPS optimize (quote segs == gen segs)', async () => {
    const { svc, mocks } = makeServices();
    const SCRIPT3: VideoScript = {
      title: 'q',
      segments: [
        { text: 'a', type: 'broll', visual: 'va' },
        { text: 'b', type: 'broll', visual: 'vb' },
        { text: 'c', type: 'broll', visual: 'vc' },
      ],
    };
    const out = await runSimpleVideoCreation({ userText: 'x', script: SCRIPT3 }, CFG, {}, svc);
    expect(mocks.optimizeUserScript).not.toHaveBeenCalled(); // optimize skipped
    expect(mocks.generateVeoVideo).toHaveBeenCalledTimes(3); // 3 段 = 报价段数(默认 veo_fast)
    expect(out.segments).toBe(3);
  });
});
