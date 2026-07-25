import { describe, expect, it, vi } from 'vitest';
import type { VideoScript } from './types.js';
import {
  type SimpleVideoConfig,
  type SimpleVideoOptions,
  type SimpleVideoServices,
  runSimpleVideoCreation,
} from './video-lane-simple.js';

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
    generateImages: vi.fn(async () => ({
      images: [{ buffer: Buffer.from('img'), mimeType: 'image/png' }],
      model: 'nb',
    })),
    generateBrollVideo: vi.fn(async () => ({
      taskStatus: 'SUCCEEDED',
      imageUrls: [],
      videoUrl: 'https://oss/v.mp4',
    })),
    generateVeoVideo: vi.fn(async () => ({ videoUri: 'https://gl/veo.mp4', elapsedMs: 1 })),
    downloadToBuffer: vi.fn(async () => ({ buffer: Buffer.from('x'), sizeBytes: 1 })),
    downloadToFile: vi.fn(async () => ({ contentType: 'video/mp4', sizeBytes: 42_000_000 })),
    ffprobeDurationMs: vi.fn(async (filePath: string) =>
      filePath.endsWith('/final.mp4') ? 5000 : 2500,
    ),
    renderImageClip: vi.fn(async () => undefined),
    renderVideoClip: vi.fn(async () => undefined),
    runFfmpeg: vi.fn(async () => undefined),
    writeFile: vi.fn(async () => undefined),
    readFile: vi.fn(async () => Buffer.from('final')),
    removeFile: vi.fn(async () => undefined),
  };
  const storeOutput = vi.fn(async (i: { filename: string }) => ({
    fileId: `f_${i.filename}`,
    storagePath: `sp/${i.filename}`,
  }));
  const storeOutputFile = vi.fn(async (i: { filename: string }) => ({
    fileId: `f_${i.filename}`,
    storagePath: `sp/${i.filename}`,
  }));
  const svc: SimpleVideoServices = {
    storeOutput,
    storeOutputFile,
    workdir: '/tmp/wd',
    logger,
    llm: async () => '{}',
    verifyFinalVideo: async () => ({
      status: 'pass',
      failedChecks: [],
      reason: 'test verifier passed',
    }),
    overrides: mocks as unknown as SimpleVideoServices['overrides'],
  };
  return { svc, mocks: { ...mocks, storeOutput, storeOutputFile } };
}

describe('runSimpleVideoCreation — video (default = veo_fast)', () => {
  it('empty opts → Cherry synth → Veo 3.1 Fast (8s/1080p/9:16) → renderVideoClip → compose', async () => {
    const { svc, mocks } = makeServices();
    // BOSS 2026-06-15: 万相手部畸形 + Lite 解剖不稳 → 默认 Veo 3.1 Fast.
    const out = await runSimpleVideoCreation({ userText: '讲讲夏天防晒' }, CFG, {}, svc);

    expect(mocks.optimizeUserScript).toHaveBeenCalledTimes(1);
    const synthArg = (mocks.synthesizeSpeech.mock.calls[0] as unknown[])[0] as {
      voiceId: string;
      model: string;
    };
    expect(synthArg.voiceId).toBe('Cherry');
    expect(synthArg.model).toBe('qwen3-tts-flash');
    // default video visual: Veo Fast + renderVideoClip (NOT nano banana / wanxiang)
    expect(mocks.generateVeoVideo).toHaveBeenCalledTimes(2);
    expect(mocks.renderVideoClip).toHaveBeenCalledTimes(2);
    expect(mocks.generateBrollVideo).not.toHaveBeenCalled();
    expect(mocks.generateImages).not.toHaveBeenCalled();
    expect(mocks.renderImageClip).not.toHaveBeenCalled();
    const veoArg = (mocks.generateVeoVideo.mock.calls[0] as unknown[])[0] as {
      model: string;
      prompt: string;
      negativePrompt: string;
      aspectRatio: string;
      durationSeconds: number;
      resolution: string;
    };
    expect(veoArg.model).toBe('veo-3.1-fast-generate-preview');
    expect(veoArg.aspectRatio).toBe('9:16');
    expect(veoArg.durationSeconds).toBe(8); // BOSS: 8s
    expect(veoArg.resolution).toBe('1080p'); // BOSS: 1080p
    // Generic topics keep conditional anatomy guidance without forcing a person into frame.
    expect(veoArg.prompt).toContain('画面整洁');
    expect(veoArg.prompt).toMatch(/五指完整|多余肢体|双臂可追溯/);
    expect(veoArg.prompt).not.toContain('单人出镜');
    // Text and brands are allowed when requested, but must be exact.
    expect(veoArg.prompt).toMatch(/未要求时不要凭空添加|逐字准确/);
    expect(veoArg.prompt).not.toMatch(/不要把.*含文字物体.*主体/);
    expect(veoArg.prompt).not.toContain('不能有任何文字');
    expect(veoArg.negativePrompt).not.toMatch(/包装文字|标签文字|signage text/);
    expect(mocks.runFfmpeg).toHaveBeenCalledTimes(2); // compose + 首帧 poster
    expect(mocks.storeOutput).toHaveBeenCalledWith(
      expect.objectContaining({ filename: 'poster.jpg', mimetype: 'image/jpeg' }),
    );
    expect(out.visualMode).toBe('video');
    expect(out.fileId).toBe('f_video.mp4');
    expect(out.segments).toBe(2);
    expect(out.totalDurationMs).toBe(5000);
  });

  it('a pure object request forbids unrequested people, hands and body parts', async () => {
    const { svc, mocks } = makeServices();
    const objectScript: VideoScript = {
      title: '蓝色陶瓷杯',
      segments: [
        {
          text: '一只蓝色陶瓷杯静静放在白色桌面。',
          type: 'broll',
          visual: '蓝色陶瓷杯放在白色桌面，固定镜头，蒸汽缓慢上升',
        },
      ],
    };

    await runSimpleVideoCreation(
      {
        userText: '一只蓝色陶瓷杯放在白色桌面，固定镜头，轻微蒸汽上升。',
        script: objectScript,
      },
      CFG,
      {},
      svc,
    );

    const veoArg = (mocks.generateVeoVideo.mock.calls[0] as unknown[])[0] as {
      prompt: string;
      negativePrompt?: string;
    };
    expect(veoArg.prompt).toMatch(/不得出现人物、手、手臂或身体部位/);
    expect(veoArg.prompt).toMatch(/不要新增拿起、触碰或操作主体的动作/);
    expect(veoArg.prompt).not.toContain('单人出镜');
    expect(veoArg.negativePrompt).toMatch(/person|hand|body parts/);
  });

  it('allows a requested brand or packaging label while requiring exact rendering', async () => {
    const { svc, mocks } = makeServices();
    const brandedScript: VideoScript = {
      title: '品牌杯展示',
      segments: [
        {
          text: 'HOLA DAY 限定杯放在白色桌面。 ',
          type: 'broll',
          visual: '正面展示印有 HOLA DAY 的蓝色陶瓷杯',
        },
      ],
    };

    await runSimpleVideoCreation(
      {
        userText: '展示印有 HOLA DAY 的蓝色陶瓷杯，品牌字样必须清晰准确。',
        script: brandedScript,
      },
      CFG,
      {},
      svc,
    );

    const veoArg = (mocks.generateVeoVideo.mock.calls[0] as unknown[])[0] as {
      prompt: string;
      negativePrompt?: string;
    };
    expect(veoArg.prompt).toMatch(/文字、品牌|逐字准确/);
    expect(veoArg.prompt).not.toMatch(/不要把.*包装|不能有任何文字|禁止品牌/);
    expect(veoArg.negativePrompt).not.toMatch(/包装文字|标签文字|packaging label text/);
  });

  it('an explicit human request keeps strict anatomy constraints', async () => {
    const { svc, mocks } = makeServices();
    const humanScript: VideoScript = {
      title: '人物持杯',
      segments: [
        {
          text: '一位女性端起蓝色陶瓷杯。',
          type: 'broll',
          visual: '一位女性侧身端起蓝色陶瓷杯，手部自然清晰',
        },
      ],
    };

    await runSimpleVideoCreation(
      { userText: '一位女性用右手端起蓝色陶瓷杯。', script: humanScript },
      CFG,
      {},
      svc,
    );

    const veoArg = (mocks.generateVeoVideo.mock.calls[0] as unknown[])[0] as {
      prompt: string;
    };
    expect(veoArg.prompt).toMatch(/若人物出镜/);
    expect(veoArg.prompt).toMatch(/双臂可追溯到肩膀|五指完整|解剖正确/);
    expect(veoArg.prompt).not.toContain('不得出现人物、手、手臂或身体部位');
  });

  it('rejects unsupported Veo parameters before TTS or video generation starts', async () => {
    const { svc, mocks } = makeServices();

    await expect(
      runSimpleVideoCreation(
        { userText: '讲讲夏天防晒' },
        CFG,
        {
          videoSource: 'veo_fast',
          veoResolution: '1080p',
          veoDurationSeconds: 6,
        },
        svc,
      ),
    ).rejects.toMatchObject({
      kind: 'invalid_options',
    });
    expect(mocks.synthesizeSpeech).not.toHaveBeenCalled();
    expect(mocks.generateVeoVideo).not.toHaveBeenCalled();
  });
});

describe('runSimpleVideoCreation — image (nano banana, static)', () => {
  it('visualMode=image → nano banana (anatomy+vertical prompt) → renderImageClip (NO Ken Burns)', async () => {
    const { svc, mocks } = makeServices();
    const opts: SimpleVideoOptions = { visualMode: 'image' };
    const out = await runSimpleVideoCreation({ userText: '讲讲夏天防晒' }, CFG, opts, svc);
    expect(mocks.generateImages).toHaveBeenCalledTimes(2);
    const imgArg = (mocks.generateImages.mock.calls[0] as unknown[])[0] as {
      model: string;
      prompt: string;
    };
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
    await runSimpleVideoCreation(
      { userText: 'x' },
      CFG,
      { visualMode: 'video', videoSource: 'veo_lite' },
      svc,
    );
    const veoArg = (mocks.generateVeoVideo.mock.calls[0] as unknown[])[0] as { model: string };
    expect(veoArg.model).toBe('veo-3.1-lite-generate-preview');
  });

  it('veo_standard (高质量) → standard model + x-goog-api-key download', async () => {
    const { svc, mocks } = makeServices();
    await runSimpleVideoCreation(
      { userText: 'x' },
      CFG,
      { visualMode: 'video', videoSource: 'veo_standard' },
      svc,
    );
    const veoArg = (mocks.generateVeoVideo.mock.calls[0] as unknown[])[0] as { model: string };
    expect(veoArg.model).toBe('veo-3.1-generate-preview');
    const dlVeo = mocks.downloadToFile.mock.calls.find(
      (c) => ((c as unknown[])[0] as string) === 'https://gl/veo.mp4',
    ) as unknown[] | undefined;
    expect(
      (
        ((dlVeo?.[2] as { headers?: Record<string, string> })?.headers ?? {}) as Record<
          string,
          string
        >
      )['x-goog-api-key'],
    ).toBe('gk');
  });
});

describe('runSimpleVideoCreation — wanxiang (fallback, explicit)', () => {
  it('videoSource=wanxiang → t2v (no-text+anatomy negative) + renderVideoClip', async () => {
    const { svc, mocks } = makeServices();
    await runSimpleVideoCreation(
      { userText: 'x' },
      CFG,
      { visualMode: 'video', videoSource: 'wanxiang' },
      svc,
    );
    expect(mocks.generateBrollVideo).toHaveBeenCalledTimes(2);
    expect(mocks.generateVeoVideo).not.toHaveBeenCalled();
    expect(mocks.renderVideoClip).toHaveBeenCalledTimes(2);
    const t2vArg = (mocks.generateBrollVideo.mock.calls[0] as unknown[])[0] as {
      prompt: string;
      negativePrompt?: string;
      size?: string;
    };
    expect(t2vArg.prompt).toContain('画面整洁');
    expect(t2vArg.negativePrompt ?? '').toMatch(/乱码|多余手臂|extra arm/);
    expect(t2vArg.size).toBe('720*1280');
  });
});

describe('runSimpleVideoCreation — happyhorse (Phase 2)', () => {
  it('videoSource=happyhorse → generateBrollVideo with happyhorse-1.0-t2v + 1080P size', async () => {
    const { svc, mocks } = makeServices();
    await runSimpleVideoCreation(
      { userText: 'x' },
      CFG,
      { visualMode: 'video', videoSource: 'happyhorse' },
      svc,
    );
    expect(mocks.generateBrollVideo).toHaveBeenCalledTimes(2);
    expect(mocks.generateVeoVideo).not.toHaveBeenCalled();
    const arg = (mocks.generateBrollVideo.mock.calls[0] as unknown[])[0] as {
      model: string;
      size?: string;
    };
    expect(arg.model).toBe('happyhorse-1.0-t2v'); // 同端点改 model
    expect(arg.size).toBe('1080*1920'); // 默认 9:16 1080P
  });
});

describe('runSimpleVideoCreation — aspectRatio (Phase 2 多画幅)', () => {
  it('16:9 → veo aspectRatio 16:9 + render/compose 1920×1080', async () => {
    const { svc, mocks } = makeServices();
    await runSimpleVideoCreation(
      { userText: 'x' },
      CFG,
      { visualMode: 'video', videoSource: 'veo_fast', aspectRatio: '16:9' },
      svc,
    );
    const veoArg = (mocks.generateVeoVideo.mock.calls[0] as unknown[])[0] as {
      aspectRatio: string;
    };
    expect(veoArg.aspectRatio).toBe('16:9');
    const clipArg = (mocks.renderVideoClip.mock.calls[0] as unknown[])[0] as {
      width: number;
      height: number;
    };
    expect(clipArg.width).toBe(1920);
    expect(clipArg.height).toBe(1080);
  });

  it('1:1 → veo aspectRatio falls back to 9:16, render/compose 1080×1080', async () => {
    const { svc, mocks } = makeServices();
    await runSimpleVideoCreation(
      { userText: 'x' },
      CFG,
      { visualMode: 'video', videoSource: 'veo_fast', aspectRatio: '1:1' },
      svc,
    );
    const veoArg = (mocks.generateVeoVideo.mock.calls[0] as unknown[])[0] as {
      aspectRatio: string;
    };
    expect(veoArg.aspectRatio).toBe('9:16'); // Veo 无 1:1 → 9:16 出, compose pad 到方形
    const clipArg = (mocks.renderVideoClip.mock.calls[0] as unknown[])[0] as {
      width: number;
      height: number;
    };
    expect(clipArg.width).toBe(1080);
    expect(clipArg.height).toBe(1080);
  });

  it('4:3 → veo aspectRatio uses 16:9 source, render/compose 1440×1080', async () => {
    const { svc, mocks } = makeServices();
    await runSimpleVideoCreation(
      { userText: 'x' },
      CFG,
      { visualMode: 'video', videoSource: 'veo_fast', aspectRatio: '4:3' },
      svc,
    );
    const veoArg = (mocks.generateVeoVideo.mock.calls[0] as unknown[])[0] as {
      aspectRatio: string;
    };
    expect(veoArg.aspectRatio).toBe('16:9');
    const clipArg = (mocks.renderVideoClip.mock.calls[0] as unknown[])[0] as {
      width: number;
      height: number;
    };
    expect(clipArg.width).toBe(1440);
    expect(clipArg.height).toBe(1080);
  });

  it('3:4 → veo aspectRatio uses 9:16 source, render/compose 1080×1440', async () => {
    const { svc, mocks } = makeServices();
    await runSimpleVideoCreation(
      { userText: 'x' },
      CFG,
      { visualMode: 'video', videoSource: 'veo_fast', aspectRatio: '3:4' },
      svc,
    );
    const veoArg = (mocks.generateVeoVideo.mock.calls[0] as unknown[])[0] as {
      aspectRatio: string;
    };
    expect(veoArg.aspectRatio).toBe('9:16');
    const clipArg = (mocks.renderVideoClip.mock.calls[0] as unknown[])[0] as {
      width: number;
      height: number;
    };
    expect(clipArg.width).toBe(1080);
    expect(clipArg.height).toBe(1440);
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
      runSimpleVideoCreation(
        { userText: 'x' },
        { ...CFG, geminiApiKey: '' },
        { visualMode: 'image' },
        svc,
      ),
    ).rejects.toMatchObject({ kind: 'config' });
  });
});

describe('runSimpleVideoCreation — final quality gate', () => {
  it('rejects a missing verifier before any paid generation call', async () => {
    const { svc, mocks } = makeServices();
    const miswired = { ...svc, verifyFinalVideo: undefined } as unknown as SimpleVideoServices;

    await expect(
      runSimpleVideoCreation(
        { userText: '一只蓝色陶瓷杯放在白色桌面', script: SCRIPT },
        CFG,
        {},
        miswired,
      ),
    ).rejects.toMatchObject({ name: 'SimpleVideoError', kind: 'config' });

    expect(mocks.generateVeoVideo).not.toHaveBeenCalled();
    expect(mocks.generateBrollVideo).not.toHaveBeenCalled();
  });

  it('stores the final artifact only after frame verification passes', async () => {
    const { svc, mocks } = makeServices();
    const verifyFinalVideo = vi.fn(async () => ({
      status: 'pass' as const,
      failedChecks: [],
      reason: '画面、主体和文字均通过',
    }));

    const out = await runSimpleVideoCreation(
      { userText: '一只蓝色陶瓷杯放在白色桌面', script: SCRIPT },
      CFG,
      {},
      { ...svc, verifyFinalVideo },
    );

    expect(verifyFinalVideo).toHaveBeenCalledWith(
      expect.objectContaining({
        videoPath: '/tmp/wd/final.mp4',
        durationMs: 5000,
        userText: '一只蓝色陶瓷杯放在白色桌面',
        requiredBrandTexts: ['HOLA DAY · AI'],
        brandPolicy: expect.stringMatching(/错误品牌/),
      }),
    );
    expect(mocks.ffprobeDurationMs).toHaveBeenCalledWith('/tmp/wd/final.mp4', {});
    expect(out.fileId).toBe('f_video.mp4');
    expect(mocks.storeOutputFile).toHaveBeenCalledWith(
      expect.objectContaining({
        filename: 'video.mp4',
        sourcePath: '/tmp/wd/final.mp4',
      }),
    );
  });

  it('replaces a rejected segment once, then delivers only the passing candidate', async () => {
    const { svc, mocks } = makeServices();
    const oneShot: VideoScript = {
      title: '单镜头持杯',
      segments: [
        {
          text: '右手拿起蓝色陶瓷杯再放回桌面。',
          type: 'broll',
          visual: '固定镜头，右手从画面右侧进入，拿起蓝色陶瓷杯再放回白色桌面',
        },
      ],
    };
    let segmentChecks = 0;
    let candidateExists = false;
    mocks.removeFile.mockImplementation(async () => {
      candidateExists = false;
    });
    mocks.downloadToFile.mockImplementation(async () => {
      if (candidateExists) {
        throw Object.assign(new Error('file already exists'), { code: 'EEXIST' });
      }
      candidateExists = true;
      return { contentType: 'video/mp4', sizeBytes: 42_000_000 };
    });
    const verifyFinalVideo = vi.fn(async (input: { videoPath: string }) => {
      if (input.videoPath.endsWith('/seg0-vid.mp4')) {
        segmentChecks += 1;
        if (segmentChecks === 1) {
          return {
            status: 'fail' as const,
            failedChecks: ['hand_structure_abnormal'],
            reason: '手指边缘融合，无法确认五指清晰分离',
          };
        }
      }
      return {
        status: 'pass' as const,
        failedChecks: [],
        reason: '画面通过',
      };
    });

    const out = await runSimpleVideoCreation(
      {
        userText:
          '固定镜头，一只自然成年人的右手拿起蓝色陶瓷杯再放回桌面，杯身文字 HOLA DAY 必须准确。',
        script: oneShot,
      },
      CFG,
      { videoSource: 'veo_fast', aspectRatio: '16:9' },
      { ...svc, verifyFinalVideo },
    );

    expect(out.fileId).toBe('f_video.mp4');
    expect(mocks.generateVeoVideo).toHaveBeenCalledTimes(2);
    expect(mocks.removeFile).toHaveBeenCalledTimes(2);
    expect(mocks.downloadToFile).toHaveBeenCalledTimes(2);
    const retryRequest = (mocks.generateVeoVideo.mock.calls[1] as unknown[])[0] as {
      prompt: string;
    };
    expect(retryRequest.prompt).toContain('质量修复重试');
    expect(retryRequest.prompt).toContain('手指边缘融合');
    expect(
      mocks.storeOutputFile.mock.calls.filter(
        (call) => ((call as unknown[])[0] as { filename?: string }).filename === 'video.mp4',
      ),
    ).toHaveLength(1);
  });

  it('retries a generated URL download without buying another candidate', async () => {
    const { svc, mocks } = makeServices();
    const oneShot: VideoScript = {
      title: '单镜头持杯',
      segments: [
        {
          text: '右手拿起蓝色陶瓷杯再放回桌面。',
          type: 'broll',
          visual: '固定镜头，右手从画面右侧进入，拿起蓝色陶瓷杯再放回白色桌面',
        },
      ],
    };
    mocks.downloadToFile.mockRejectedValue(new Error('temporary download failure'));

    await expect(
      runSimpleVideoCreation(
        { userText: '固定镜头，右手拿起蓝色陶瓷杯再放回桌面。', script: oneShot },
        CFG,
        { videoSource: 'veo_fast', aspectRatio: '16:9' },
        svc,
      ),
    ).rejects.toMatchObject({
      name: 'SimpleVideoError',
      kind: 'compose',
      retryable: false,
    });

    expect(mocks.generateVeoVideo).toHaveBeenCalledTimes(1);
    expect(mocks.downloadToFile).toHaveBeenCalledTimes(2);
    expect(mocks.removeFile).toHaveBeenCalledTimes(2);
  });

  it('fails closed when a generated candidate path cannot be prepared', async () => {
    const { svc, mocks } = makeServices();
    const oneShot: VideoScript = {
      title: '单镜头持杯',
      segments: [
        {
          text: '右手拿起蓝色陶瓷杯再放回桌面。',
          type: 'broll',
          visual: '固定镜头，右手从画面右侧进入，拿起蓝色陶瓷杯再放回白色桌面',
        },
      ],
    };
    mocks.removeFile.mockRejectedValue(new Error('candidate path is not writable'));

    await expect(
      runSimpleVideoCreation(
        { userText: '固定镜头，右手拿起蓝色陶瓷杯再放回桌面。', script: oneShot },
        CFG,
        { videoSource: 'veo_fast', aspectRatio: '16:9' },
        svc,
      ),
    ).rejects.toMatchObject({
      name: 'SimpleVideoError',
      kind: 'compose',
      retryable: false,
    });

    expect(mocks.generateVeoVideo).toHaveBeenCalledTimes(1);
    expect(mocks.removeFile).toHaveBeenCalledTimes(2);
    expect(mocks.downloadToFile).not.toHaveBeenCalled();
  });

  it('does not spend on a replacement when segment verification is unavailable', async () => {
    const { svc, mocks } = makeServices();
    const oneShot: VideoScript = {
      title: '单镜头持杯',
      segments: [
        {
          text: '右手拿起蓝色陶瓷杯再放回桌面。',
          type: 'broll',
          visual: '固定镜头，右手从画面右侧进入，拿起蓝色陶瓷杯再放回白色桌面',
        },
      ],
    };
    const verifyFinalVideo = vi.fn(async () => ({
      status: 'unknown' as const,
      failedChecks: ['verifier_inconclusive'],
      reason: '质检服务未得出结论',
    }));

    await expect(
      runSimpleVideoCreation(
        { userText: '固定镜头，右手拿起蓝色陶瓷杯再放回桌面。', script: oneShot },
        CFG,
        { videoSource: 'veo_fast', aspectRatio: '16:9' },
        { ...svc, verifyFinalVideo },
      ),
    ).rejects.toMatchObject({
      name: 'SimpleVideoError',
      kind: 'quality_unavailable',
    });

    expect(mocks.generateVeoVideo).toHaveBeenCalledTimes(1);
    expect(mocks.renderVideoClip).not.toHaveBeenCalled();
    expect(mocks.storeOutputFile).not.toHaveBeenCalled();
  });

  it('does not spend on a replacement when segment verification throws', async () => {
    const { svc, mocks } = makeServices();
    const oneShot: VideoScript = {
      title: '单镜头持杯',
      segments: [
        {
          text: '右手拿起蓝色陶瓷杯再放回桌面。',
          type: 'broll',
          visual: '固定镜头，右手从画面右侧进入，拿起蓝色陶瓷杯再放回白色桌面',
        },
      ],
    };
    const verifyFinalVideo = vi.fn(async () => {
      throw new Error('quality verifier unavailable');
    });

    await expect(
      runSimpleVideoCreation(
        { userText: '固定镜头，右手拿起蓝色陶瓷杯再放回桌面。', script: oneShot },
        CFG,
        { videoSource: 'veo_fast', aspectRatio: '16:9' },
        { ...svc, verifyFinalVideo },
      ),
    ).rejects.toMatchObject({
      name: 'SimpleVideoError',
      kind: 'quality_unavailable',
      retryable: false,
    });

    expect(mocks.generateVeoVideo).toHaveBeenCalledTimes(1);
    expect(mocks.renderVideoClip).not.toHaveBeenCalled();
    expect(mocks.storeOutputFile).not.toHaveBeenCalled();
  });

  it.each([
    ['fail', 'quality'],
    ['unknown', 'quality_unavailable'],
  ] as const)(
    'blocks a final %s verdict before the video is stored or marked deliverable',
    async (status, expectedKind) => {
      const { svc, mocks } = makeServices();
      const verifyFinalVideo = vi.fn(async (input: { videoPath: string }) => {
        if (!input.videoPath.endsWith('/final.mp4')) {
          return {
            status: 'pass' as const,
            failedChecks: [],
            reason: '原始片段通过',
          };
        }
        return {
          status,
          failedChecks:
            status === 'fail' ? ['fused_hands', 'unrequested_human'] : ['verifier_inconclusive'],
          reason: status === 'fail' ? '画面出现融合手和未请求的人物肢体' : '质检服务未得出结论',
        };
      });

      await expect(
        runSimpleVideoCreation(
          { userText: '一只蓝色陶瓷杯放在白色桌面', script: SCRIPT },
          CFG,
          {},
          { ...svc, verifyFinalVideo },
        ),
      ).rejects.toMatchObject({
        name: 'SimpleVideoError',
        kind: expectedKind,
      });

      expect(verifyFinalVideo).toHaveBeenCalledWith(
        expect.objectContaining({
          videoPath: '/tmp/wd/final.mp4',
          qualityContext: expect.stringMatching(/2 个脚本分段.*允许正常切镜/),
        }),
      );
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
