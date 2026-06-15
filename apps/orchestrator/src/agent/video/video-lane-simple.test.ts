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
  wanxiangT2iModel: 'wan2.2-t2i-flash',
  wanxiangT2vModel: 'wan2.1-t2v-turbo',
  veoModel: 'veo-3.0-fast-generate-001',
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
    generateBrollImage: vi.fn(async () => ({ taskStatus: 'SUCCEEDED', imageUrls: ['https://oss/i.png'] })),
    generateBrollVideo: vi.fn(async () => ({ taskStatus: 'SUCCEEDED', imageUrls: [], videoUrl: 'https://oss/v.mp4' })),
    generateVeoVideo: vi.fn(async () => ({ videoUri: 'https://gl/veo.mp4', elapsedMs: 1 })),
    downloadToBuffer: vi.fn(async () => ({ buffer: Buffer.from('x'), sizeBytes: 1 })),
    ffprobeDurationMs: vi.fn(async () => 2500),
    renderImageKenBurns: vi.fn(async () => undefined),
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

describe('runSimpleVideoCreation — image (default)', () => {
  it('optimizes draft → preset-voice synth → wan-t2i n=1 → Ken Burns → compose', async () => {
    const { svc, mocks } = makeServices();
    const out = await runSimpleVideoCreation({ userText: '讲讲夏天防晒' }, CFG, {}, svc);

    expect(mocks.optimizeUserScript).toHaveBeenCalledTimes(1);
    // preset voice synth (Cherry on qwen3-tts-flash)
    const synthArg = (mocks.synthesizeSpeech.mock.calls[0] as unknown[])[0] as { voiceId: string; model: string };
    expect(synthArg.voiceId).toBe('Cherry');
    expect(synthArg.model).toBe('qwen3-tts-flash');
    // image visual: wan-t2i n=1, Ken Burns (NOT video clip)
    expect((mocks.generateBrollImage.mock.calls[0] as unknown[])[0]).toMatchObject({ n: 1 });
    expect(mocks.renderImageKenBurns).toHaveBeenCalledTimes(2);
    expect(mocks.renderVideoClip).not.toHaveBeenCalled();
    expect(mocks.generateVeoVideo).not.toHaveBeenCalled();
    expect(mocks.runFfmpeg).toHaveBeenCalledTimes(1);
    expect(out.visualMode).toBe('image');
    expect(out.fileId).toBe('f_video.mp4');
    expect(out.segments).toBe(2);
    expect(out.totalDurationMs).toBe(5000);
  });
});

describe('runSimpleVideoCreation — video', () => {
  it('wanxiang (default video source) → t2v + renderVideoClip', async () => {
    const { svc, mocks } = makeServices();
    const opts: SimpleVideoOptions = { visualMode: 'video' };
    await runSimpleVideoCreation({ userText: 'x' }, CFG, opts, svc);
    expect(mocks.generateBrollVideo).toHaveBeenCalledTimes(2);
    expect(mocks.generateVeoVideo).not.toHaveBeenCalled();
    expect(mocks.renderVideoClip).toHaveBeenCalledTimes(2);
    expect(mocks.renderImageKenBurns).not.toHaveBeenCalled();
  });

  it('veo (high-quality tier) → Veo + download with x-goog-api-key + renderVideoClip', async () => {
    const { svc, mocks } = makeServices();
    const opts: SimpleVideoOptions = { visualMode: 'video', videoSource: 'veo' };
    await runSimpleVideoCreation({ userText: 'x' }, CFG, opts, svc);
    expect(mocks.generateVeoVideo).toHaveBeenCalledTimes(2);
    // the Veo result uri is downloaded WITH the x-goog-api-key header
    const dlVeo = mocks.downloadToBuffer.mock.calls.find(
      (c) => ((c as unknown[])[0] as string) === 'https://gl/veo.mp4',
    ) as unknown[] | undefined;
    expect((((dlVeo?.[1] as { headers?: Record<string, string> })?.headers ?? {}) as Record<string, string>)['x-goog-api-key']).toBe('gk');
    expect(mocks.renderVideoClip).toHaveBeenCalledTimes(2);
  });
});

describe('runSimpleVideoCreation — config gates', () => {
  it('throws config when DASHSCOPE key missing', async () => {
    const { svc } = makeServices();
    await expect(
      runSimpleVideoCreation({ userText: 'x' }, { ...CFG, dashscopeApiKey: '' }, {}, svc),
    ).rejects.toMatchObject({ kind: 'config' });
  });

  it('throws config when Veo selected but GEMINI key missing', async () => {
    const { svc } = makeServices();
    await expect(
      runSimpleVideoCreation(
        { userText: 'x' },
        { ...CFG, geminiApiKey: '' },
        { visualMode: 'video', videoSource: 'veo' },
        svc,
      ),
    ).rejects.toMatchObject({ kind: 'config' });
  });
});
