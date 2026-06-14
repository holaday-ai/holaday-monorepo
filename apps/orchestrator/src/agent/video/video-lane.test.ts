import { describe, expect, it, vi } from 'vitest';
import {
  runVideoCreation,
  type VideoLaneConfig,
  type VideoLaneContext,
  type VideoLaneServices,
} from './video-lane.js';
import type { VideoScript } from './types.js';

const CFG: VideoLaneConfig = {
  dashscopeApiKey: 'dk',
  dashscopeBaseUrl: 'https://dashscope-intl.aliyuncs.com',
  falApiKey: 'fk',
  falBaseUrl: 'https://queue.fal.run',
  wanxiangT2iModel: 'wan2.2-t2i-flash',
  falLipsyncModel: 'fal-ai/latentsync',
  qwenTtsVcModel: 'qwen3-tts-vc-2026-01-22',
};

const CTX: VideoLaneContext = {
  voiceId: 'voice_x',
  baseVideoStoragePath: 'usr/input/base.mp4',
  authorizedSelfUse: true,
};

const SCRIPT: VideoScript = {
  title: 't',
  segments: [
    { text: '开场口播', type: 'voiceover' },
    { text: '产品空镜', type: 'broll', visual: '产品特写' },
    { text: '结尾口播', type: 'voiceover' },
  ],
};

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

function makeServices() {
  const mocks = {
    synthesizeSpeech: vi.fn(async () => ({ audioUrl: 'https://oss/a.wav', characters: 10 })),
    generateBrollImage: vi.fn(async () => ({ taskStatus: 'SUCCEEDED', imageUrls: ['https://oss/img.png'] })),
    runLipSync: vi.fn(async () => ({ videoUrl: 'https://fal/out.mp4', requestId: 'r', elapsedMs: 1 })),
    downloadToBuffer: vi.fn(async () => ({ buffer: Buffer.from('x'), sizeBytes: 1 })),
    ffprobeDurationMs: vi.fn(async () => 2000),
    renderImageClip: vi.fn(async () => undefined),
    runFfmpeg: vi.fn(async () => undefined),
    writeFile: vi.fn(async () => undefined),
    readFile: vi.fn(async () => Buffer.from('final-mp4-bytes')),
    generateVideoScript: vi.fn(async () => SCRIPT),
  };
  const storeOutput = vi.fn(async (i: { filename: string }) => ({
    fileId: `file_${i.filename}`,
    storagePath: `sp/${i.filename}`,
  }));
  const presignGet = vi.fn(async (sp: string) => `https://r2.example/${sp}`);
  const svc: VideoLaneServices = {
    storeOutput,
    presignGet,
    workdir: '/tmp/wd',
    logger,
    llm: async () => '{}',
    overrides: mocks as unknown as VideoLaneServices['overrides'],
  };
  return { svc, mocks: { ...mocks, storeOutput, presignGet } };
}

describe('runVideoCreation — gates', () => {
  it('refuses without the self-use authorization (compliance)', async () => {
    const { svc } = makeServices();
    await expect(
      runVideoCreation({ userPrompt: 'x' }, CFG, { ...CTX, authorizedSelfUse: false }, svc),
    ).rejects.toMatchObject({ kind: 'compliance' });
  });

  it('refuses without onboarding (no voice / base video)', async () => {
    const { svc } = makeServices();
    await expect(
      runVideoCreation({ userPrompt: 'x' }, CFG, { ...CTX, voiceId: '' }, svc),
    ).rejects.toMatchObject({ kind: 'onboarding' });
  });

  it('refuses when keys are not configured', async () => {
    const { svc } = makeServices();
    await expect(
      runVideoCreation({ userPrompt: 'x' }, { ...CFG, falApiKey: '' }, CTX, svc),
    ).rejects.toMatchObject({ kind: 'config' });
  });
});

describe('runVideoCreation — happy path wiring', () => {
  it('runs script → segments → compose → final, with n=1 broll + presigned fal inputs', async () => {
    const { svc, mocks } = makeServices();
    const out = await runVideoCreation({ userPrompt: '做个种草视频' }, CFG, CTX, svc);

    // ② synth per segment; ④ lip-sync for vo (0,2); ③ broll for broll seg (1).
    expect(mocks.synthesizeSpeech).toHaveBeenCalledTimes(3);
    expect(mocks.runLipSync).toHaveBeenCalledTimes(2);
    expect(mocks.generateBrollImage).toHaveBeenCalledTimes(1);
    expect(mocks.renderImageClip).toHaveBeenCalledTimes(1);

    // broll n=1 (cost control).
    expect((mocks.generateBrollImage.mock.calls[0] as unknown[])[0]).toMatchObject({
      n: 1,
      model: 'wan2.2-t2i-flash',
    });

    // fal lip-sync gets PRESIGNED public urls (base video + narration audio).
    const lipCall = (mocks.runLipSync.mock.calls[0] as unknown[])[0] as {
      videoUrl: string;
      audioUrl: string;
    };
    expect(lipCall.videoUrl).toBe('https://r2.example/usr/input/base.mp4');
    expect(lipCall.audioUrl).toContain('https://r2.example/sp/seg0-audio.wav');

    // ⑥ compose ran; final persisted.
    expect(mocks.runFfmpeg).toHaveBeenCalledTimes(1);
    const composeArgs = ((mocks.runFfmpeg.mock.calls[0] as unknown[])[0] as { args: string[] }).args;
    expect(composeArgs.join(' ')).toContain('seg0-clip.mp4');
    expect(composeArgs.join(' ')).toContain('subtitles.srt');

    expect(out.fileId).toBe('file_video.mp4');
    expect(out.downloadUrl).toBe('/api/files/file_video.mp4/download');
    expect(out.segments).toBe(3);
    expect(out.totalDurationMs).toBe(6000); // 3 × 2000ms
  });
});
