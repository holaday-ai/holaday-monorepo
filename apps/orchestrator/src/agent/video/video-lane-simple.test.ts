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
    synthesizeGeminiSpeech: vi.fn(async () => ({
      audioBuffer: Buffer.from('gemini-wav'),
      mimeType: 'audio/wav' as const,
      model: 'gemini-2.5-flash-preview-tts',
      voiceName: 'Kore',
    })),
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
    expect(veoArg.prompt).toMatch(/未明确要求人物或手部时.*优先.*不要主动加入手或手臂/);
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
    expect(out.audioEngine).toBe('qwen');
  });

  it('falls back to Gemini TTS when the primary DashScope voice account is unavailable', async () => {
    const { svc, mocks } = makeServices();
    mocks.synthesizeSpeech.mockRejectedValue(
      Object.assign(new Error('DashScope returned 400'), {
        name: 'QwenVoiceCloneError',
        status: 400,
        detail: '{"code":"Arrearage","message":"account is not in good standing"}',
        retryable: false,
      }),
    );
    const oneSegmentScript: VideoScript = {
      title: '蓝色陶瓷杯',
      segments: [
        {
          text: '一只右手拿起蓝色陶瓷杯，停一秒，再放回原位。',
          type: 'broll',
          visual: '一只右手拿起蓝色陶瓷杯，停一秒，再放回原位。',
        },
      ],
    };

    const out = await runSimpleVideoCreation(
      {
        userText: '一只右手拿起蓝色陶瓷杯，停一秒，再放回原位。',
        script: oneSegmentScript,
      },
      CFG,
      { videoSource: 'veo_fast', veoDurationSeconds: 8, veoResolution: '720p' },
      svc,
    );

    expect(mocks.synthesizeSpeech).toHaveBeenCalledTimes(1);
    expect(mocks.synthesizeGeminiSpeech).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: 'gk',
        text: oneSegmentScript.segments[0]?.text,
      }),
    );
    expect(mocks.storeOutput).toHaveBeenCalledWith(
      expect.objectContaining({
        filename: 'seg0-audio.wav',
        mimetype: 'audio/wav',
        buffer: Buffer.from('gemini-wav'),
      }),
    );
    expect(out.audioEngine).toBe('gemini');
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

  it('honors an explicit no-person or no-hand request even when the prompt contains human words', async () => {
    const { svc, mocks } = makeServices();
    const objectScript: VideoScript = {
      title: '无人产品镜头',
      segments: [
        {
          text: '杯子自动转向镜头。',
          type: 'broll',
          visual: '蓝色杯子自动转向镜头，桌面保持整洁',
        },
      ],
    };

    await runSimpleVideoCreation(
      {
        userText: '不要人物或手，蓝色杯子自动转向镜头。',
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
    expect(veoArg.negativePrompt).toMatch(/person|hand|body parts/);
    expect(veoArg.prompt).not.toContain('只保留用户要求的手和手臂');
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
      negativePrompt?: string;
    };
    expect(veoArg.prompt).toMatch(/若人物出镜/);
    expect(veoArg.prompt).toMatch(/双臂可追溯到肩膀|解剖正确/);
    expect(veoArg.prompt).toMatch(/自然遮挡关系|自然抓握/);
    expect(veoArg.prompt).toMatch(/可见手指.*边界.*必须自然/);
    expect(veoArg.prompt).not.toMatch(/每只可见的手.*恰好五根.*独立清晰/);
    expect(veoArg.prompt).toMatch(/按顺序完整执行所有动作/);
    expect(veoArg.prompt).toMatch(/结尾应清楚呈现完成状态/);
    expect(veoArg.prompt).not.toMatch(/未明确要求人物或手部时.*不要主动加入手或手臂/);
    expect(veoArg.negativePrompt).toMatch(/少指|手指粘连|missing fingers|fused fingers/);
    expect(veoArg.prompt).not.toContain('不得出现人物、手、手臂或身体部位');
  });

  it('locks object identity across frames when a requested hand manipulates it', async () => {
    const { svc, mocks } = makeServices();
    const handActionScript: VideoScript = {
      title: '拿起杯子',
      segments: [
        {
          text: '拿起杯子，再放回桌面。',
          type: 'broll',
          visual: '右手拿起蓝色陶瓷杯，停顿后放回原位',
        },
      ],
    };

    await runSimpleVideoCreation(
      {
        userText: '一只右手拿起蓝色陶瓷杯，停顿一秒，再放回原位。',
        script: handActionScript,
      },
      CFG,
      { videoSource: 'happyhorse', veoDurationSeconds: 6 },
      svc,
    );

    const happyHorseArg = (mocks.generateBrollVideo.mock.calls[0] as unknown[])[0] as {
      prompt: string;
      negativePrompt?: string;
    };
    expect(happyHorseArg.prompt).toMatch(/同一个物体|主体身份/);
    expect(happyHorseArg.prompt).toMatch(/类别、轮廓、颜色.*把手/);
    expect(happyHorseArg.prompt).toMatch(/杯身侧面.*稳定抓握/);
    expect(happyHorseArg.prompt).toMatch(/单一连续镜头.*时间段/);
    expect(happyHorseArg.negativePrompt).toMatch(
      /object morphing|subject identity drift|handle appearing or disappearing/,
    );
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
  it('videoSource=wanxiang → Wan 2.7 with selected duration, resolution and aspect ratio', async () => {
    const { svc, mocks } = makeServices();
    await runSimpleVideoCreation(
      { userText: 'x' },
      { ...CFG, wanxiangT2vModel: 'wan2.7-t2v-2026-06-12' },
      {
        visualMode: 'video',
        videoSource: 'wanxiang',
        aspectRatio: '16:9',
        veoResolution: '720p',
        veoDurationSeconds: 8,
      },
      svc,
    );
    expect(mocks.generateBrollVideo).toHaveBeenCalledTimes(2);
    expect(mocks.generateVeoVideo).not.toHaveBeenCalled();
    expect(mocks.renderVideoClip).toHaveBeenCalledTimes(2);
    const t2vArg = (mocks.generateBrollVideo.mock.calls[0] as unknown[])[0] as {
      model: string;
      prompt: string;
      negativePrompt?: string;
      size?: string;
      resolution?: string;
      ratio?: string;
      durationSeconds?: number;
    };
    expect(t2vArg.model).toBe('wan2.7-t2v-2026-06-12');
    expect(t2vArg.prompt).toContain('画面整洁');
    expect(t2vArg.negativePrompt ?? '').toMatch(/乱码|多余手臂|extra arm/);
    expect(t2vArg.size).toBe('1280*720');
    expect(t2vArg.resolution).toBe('720P');
    expect(t2vArg.ratio).toBe('16:9');
    expect(t2vArg.durationSeconds).toBe(8);
  });
});

describe('runSimpleVideoCreation — happyhorse (Phase 2)', () => {
  it('videoSource=happyhorse → generateBrollVideo with HappyHorse 1.1 + selected duration', async () => {
    const { svc, mocks } = makeServices();
    await runSimpleVideoCreation(
      { userText: 'x' },
      CFG,
      { visualMode: 'video', videoSource: 'happyhorse', veoDurationSeconds: 6 },
      svc,
    );
    expect(mocks.generateBrollVideo).toHaveBeenCalledTimes(2);
    expect(mocks.generateVeoVideo).not.toHaveBeenCalled();
    const arg = (mocks.generateBrollVideo.mock.calls[0] as unknown[])[0] as {
      model: string;
      size?: string;
      durationSeconds?: number;
    };
    expect(arg.model).toBe('happyhorse-1.1-t2v');
    expect(arg.size).toBe('1080*1920'); // 默认 9:16 1080P
    expect(arg.durationSeconds).toBe(6);
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
  it('uses Gemini narration directly when the primary DashScope key is missing', async () => {
    const { svc, mocks } = makeServices();
    const out = await runSimpleVideoCreation(
      { userText: 'x', script: SCRIPT },
      { ...CFG, dashscopeApiKey: '' },
      {},
      svc,
    );

    expect(mocks.synthesizeSpeech).not.toHaveBeenCalled();
    expect(mocks.synthesizeGeminiSpeech).toHaveBeenCalledTimes(2);
    expect(out.audioEngine).toBe('gemini');
  });

  it('throws config when no narration engine is configured', async () => {
    const { svc } = makeServices();
    await expect(
      runSimpleVideoCreation(
        { userText: 'x' },
        { ...CFG, dashscopeApiKey: '', geminiApiKey: '' },
        { videoSource: 'wanxiang' },
        svc,
      ),
    ).rejects.toMatchObject({
      kind: 'config',
      message: expect.stringContaining('narration'),
    });
  });

  it('throws config when video (default Veo) but GEMINI key missing', async () => {
    const { svc } = makeServices();
    await expect(
      runSimpleVideoCreation({ userText: 'x' }, { ...CFG, geminiApiKey: '' }, {}, svc),
    ).rejects.toMatchObject({ kind: 'config' });
  });

  it('throws config when Wanxiang is selected without a DashScope key', async () => {
    const { svc } = makeServices();
    await expect(
      runSimpleVideoCreation(
        { userText: 'x' },
        { ...CFG, dashscopeApiKey: '' },
        { videoSource: 'wanxiang' },
        svc,
      ),
    ).rejects.toMatchObject({
      kind: 'config',
      message: expect.stringContaining('Wanxiang'),
    });
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
        minimumDurationMs: 16000,
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

  it('preserves the selected per-segment duration through render and final verification', async () => {
    const { svc, mocks } = makeServices();
    const oneShot: VideoScript = {
      title: '单镜头持杯',
      segments: [
        {
          text: '右手拿起蓝色陶瓷杯再放回桌面。',
          type: 'broll',
          visual: '固定镜头，右手进入，拿起蓝色陶瓷杯，再放回桌面',
        },
      ],
    };
    const verifyFinalVideo = vi.fn(async () => ({
      status: 'pass' as const,
      failedChecks: [],
      reason: '画面通过',
    }));

    await runSimpleVideoCreation(
      { userText: '右手进入，拿起蓝色陶瓷杯，再放回桌面。', script: oneShot },
      CFG,
      {
        videoSource: 'veo_fast',
        veoResolution: '720p',
        veoDurationSeconds: 6,
      },
      { ...svc, verifyFinalVideo },
    );

    expect(mocks.renderVideoClip).toHaveBeenCalledWith(
      expect.objectContaining({ durationMs: 6_000 }),
      expect.anything(),
    );
    expect(verifyFinalVideo).toHaveBeenCalledWith(
      expect.objectContaining({
        videoPath: '/tmp/wd/seg0-vid.mp4',
        minimumDurationMs: 6_000,
      }),
    );
    expect(verifyFinalVideo).toHaveBeenCalledWith(
      expect.objectContaining({
        videoPath: '/tmp/wd/final.mp4',
        minimumDurationMs: 6_000,
        strictRequiredActions: true,
      }),
    );
  });

  it('repairs one final-gate rejection with the original one-shot sequence and bounded timing', async () => {
    const { svc, mocks } = makeServices();
    const userText =
      '固定镜头，一只手从右侧拿起桌上的蓝色杯子，停一下，再放回去并离开。真实产品摄影。';
    const oneShot: VideoScript = {
      title: '单镜头持杯',
      segments: [
        {
          text: '拿起杯子，再放回。',
          type: 'broll',
          visual: '固定镜头，右手拿起蓝色杯子',
        },
      ],
    };
    let finalChecks = 0;
    const verifyFinalVideo = vi.fn(async (input: { videoPath: string }) => {
      if (input.videoPath.endsWith('/seg0-vid.mp4')) {
        return {
          status: 'pass' as const,
          failedChecks: [],
          reason: '原始片段通过',
        };
      }
      finalChecks += 1;
      if (finalChecks === 1) {
        return {
          status: 'fail' as const,
          failedChecks: ['hand_anatomy_uncertain', 'required_action_missing'],
          reason: '手指与杯柄疑似融合，且没有看到放回后手离开',
        };
      }
      return {
        status: 'pass' as const,
        failedChecks: [],
        reason: '替换成片通过',
      };
    });

    const out = await runSimpleVideoCreation(
      { userText, script: oneShot },
      CFG,
      {
        videoSource: 'veo_fast',
        aspectRatio: '16:9',
        veoDurationSeconds: 6,
        veoResolution: '720p',
      },
      { ...svc, verifyFinalVideo },
    );

    expect(out.fileId).toBe('f_video.mp4');
    expect(mocks.generateVeoVideo).toHaveBeenCalledTimes(2);
    expect(finalChecks).toBe(2);
    const initialRequest = (mocks.generateVeoVideo.mock.calls[0] as unknown[])[0] as {
      prompt: string;
    };
    expect(initialRequest.prompt).toContain(userText);
    expect(initialRequest.prompt).toMatch(/最后.*1 秒.*稳定终态/);
    expect(initialRequest.prompt).toMatch(/手腕.*连续|三分之四侧面/);
    const replacementRequest = (mocks.generateVeoVideo.mock.calls[1] as unknown[])[0] as {
      prompt: string;
    };
    expect(replacementRequest.prompt).toContain('质量修复重试');
    expect(replacementRequest.prompt).toContain('手指与杯柄疑似融合');
    expect(replacementRequest.prompt).toContain('放回后手离开');
    expect(replacementRequest.prompt).toContain(userText);
    expect(
      mocks.storeOutputFile.mock.calls.filter(
        (call) => ((call as unknown[])[0] as { filename?: string }).filename === 'video.mp4',
      ),
    ).toHaveLength(1);
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
            failedChecks: ['hand_structure_abnormal', 'subject_out_of_frame'],
            reason: '手指边缘融合，且杯口越过画面上边界',
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
    expect(mocks.generateImages).toHaveBeenCalledTimes(1);
    expect(mocks.generateImages).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'gemini-3.1-flash-image',
        aspectRatio: '16:9',
        prompt: expect.stringMatching(/动作开始前.*蓝色陶瓷杯.*画面下半部/),
      }),
    );
    expect(mocks.removeFile).toHaveBeenCalledTimes(2);
    expect(mocks.downloadToFile).toHaveBeenCalledTimes(2);
    const initialRequest = (mocks.generateVeoVideo.mock.calls[0] as unknown[])[0] as {
      prompt: string;
      startImage?: { data: string; mimeType: string };
      lastFrameImage?: { data: string; mimeType: string };
    };
    expect(initialRequest.startImage).toEqual({
      data: Buffer.from('img').toString('base64'),
      mimeType: 'image/png',
    });
    expect(initialRequest.lastFrameImage).toEqual(initialRequest.startImage);
    expect(initialRequest.prompt).toMatch(/操作主体.*全程完整保留在画面内/);
    expect(initialRequest.prompt).toMatch(/四周保留.*安全留白/);
    expect(initialRequest.prompt).toMatch(/固定机位.*不得推近、变焦或跟随抬升/);
    expect(initialRequest.prompt).toMatch(/只做完成动作所需的最小幅度抬升/);
    const retryRequest = (mocks.generateVeoVideo.mock.calls[1] as unknown[])[0] as {
      prompt: string;
      startImage?: { data: string; mimeType: string };
      lastFrameImage?: { data: string; mimeType: string };
    };
    expect(retryRequest.startImage).toEqual(initialRequest.startImage);
    expect(retryRequest.lastFrameImage).toEqual(initialRequest.lastFrameImage);
    expect(retryRequest.prompt).toContain('质量修复重试');
    expect(retryRequest.prompt).toContain('手指边缘融合');
    expect(retryRequest.prompt).toContain('杯口越过画面上边界');
    expect(retryRequest.prompt).toContain('只保留用户要求的手和手臂');
    expect(retryRequest.prompt).toMatch(/自然抓握.*遮挡/);
    expect(retryRequest.prompt).not.toContain('抓握处无遮挡');
    expect(retryRequest.prompt).not.toMatch(/恰好五根彼此独立、清晰可辨/);
    expect(retryRequest.prompt).toContain('允许调整上一版有缺陷的构图');
    expect(retryRequest.prompt).toMatch(
      /构图修复要求.*全桌面宽景.*画面高度不超过 15%.*至少 30% 安全留白.*使用固定机位/,
    );
    expect(retryRequest.prompt).toMatch(/杯底.*离开桌面.*3-5 厘米/);
    expect(retryRequest.prompt).toContain('不得进入画面上半部');
    expect(retryRequest.prompt).not.toContain('构图和镜头要求不变');
    expect(retryRequest.prompt).toContain('按用户原始顺序完整执行全部动作');
    expect(retryRequest.prompt).toContain('最后至少 1 秒展示动作完成后的稳定终态');
    expect(
      mocks.storeOutputFile.mock.calls.filter(
        (call) => ((call as unknown[])[0] as { filename?: string }).filename === 'video.mp4',
      ),
    ).toHaveLength(1);
  });

  it('stages a modest hand-object action inside a central motion corridor', async () => {
    const { svc, mocks } = makeServices();
    const userText =
      '一个成年人的右手从画面右侧进入，拿起白色桌面上的蓝色陶瓷杯，在空中停一秒，再把杯子放回原位，然后手离开画面。真实产品摄影。';
    const oneShot: VideoScript = {
      title: '安全持杯',
      segments: [
        {
          text: userText,
          type: 'broll',
          visual: userText,
        },
      ],
    };

    await runSimpleVideoCreation(
      { userText, script: oneShot },
      CFG,
      { videoSource: 'wanxiang', aspectRatio: '16:9' },
      svc,
    );

    const request = (mocks.generateBrollVideo.mock.calls[0] as unknown[])[0] as {
      prompt: string;
    };
    expect(request.prompt).toMatch(/主体中心.*画面下半部中央区域/);
    expect(request.prompt).toMatch(/全桌面宽景.*杯体.*画面高度.*20%/);
    expect(request.prompt).toMatch(/上下左右.*25%.*安全留白/);
    expect(request.prompt).toMatch(/仅垂直抬升.*足以离开桌面/);
    expect(request.prompt).toMatch(/杯底.*离开桌面.*3-5 厘米/);
    expect(request.prompt).toMatch(/抬升距离.*不超过半个杯身高度/);
    expect(request.prompt).toContain('不得进入画面上半部');
    expect(request.prompt).toMatch(/清楚停留至少 1 秒.*放回原来的桌面落点/);
    expect(request.prompt).toMatch(/原来的桌面落点.*把手方向.*画面大小/);
    expect(request.prompt).toContain('桌面始终在杯子下方留有可见空间');
  });

  it('uses subject-generic framing language for a non-cup hand action', async () => {
    const { svc, mocks } = makeServices();
    const userText = '右手拿起桌面上的黑色相机，停留一秒，再放回原位。';
    const oneShot: VideoScript = {
      title: '拿起相机',
      segments: [{ text: userText, type: 'broll', visual: userText }],
    };

    await runSimpleVideoCreation(
      { userText, script: oneShot },
      CFG,
      { videoSource: 'wanxiang', aspectRatio: '16:9' },
      svc,
    );

    const request = (mocks.generateBrollVideo.mock.calls[0] as unknown[])[0] as {
      prompt: string;
    };
    expect(request.prompt).toMatch(/操作主体初始占画面高度不超过 20%/);
    expect(request.prompt).not.toContain('杯体初始占画面高度');
  });

  it('preserves explicitly requested camera motion and large hand movement while keeping the subject in frame', async () => {
    const { svc, mocks } = makeServices();
    const userText = '环绕镜头，右手高高举起蓝色杯子，再把杯子放回桌面。';
    const oneShot: VideoScript = {
      title: '跟拍举杯',
      segments: [
        {
          text: userText,
          type: 'broll',
          visual: userText,
        },
      ],
    };
    const verifyFinalVideo = vi
      .fn()
      .mockResolvedValueOnce({
        status: 'fail' as const,
        failedChecks: ['subject_out_of_frame'],
        reason: '杯口在抬升时越过画面上边界',
      })
      .mockResolvedValue({
        status: 'pass' as const,
        failedChecks: [],
        reason: '替换成片通过',
      });

    await runSimpleVideoCreation(
      { userText, script: oneShot },
      CFG,
      { videoSource: 'veo_fast', aspectRatio: '16:9' },
      { ...svc, verifyFinalVideo },
    );

    expect(mocks.generateVeoVideo).toHaveBeenCalledTimes(2);
    const initialRequest = (mocks.generateVeoVideo.mock.calls[0] as unknown[])[0] as {
      prompt: string;
      startImage?: { data: string; mimeType: string };
    };
    expect(initialRequest.prompt).toContain('保留用户明确要求的跟拍、变焦或其它运镜');
    expect(initialRequest.prompt).toContain('保留用户明确要求的大幅度动作');
    expect(initialRequest.prompt).not.toContain('使用固定机位，不得推近、变焦或跟随抬升');
    expect(initialRequest.prompt).not.toContain('只做完成动作所需的最小幅度抬升');
    expect(initialRequest.prompt).not.toContain('主体中心始终保持在画面中央 50%');
    expect(initialRequest.prompt).not.toContain('仅垂直抬升到足以离开桌面');
    expect(initialRequest.startImage).toBeUndefined();
    expect(mocks.generateImages).not.toHaveBeenCalled();

    const retryRequest = (mocks.generateVeoVideo.mock.calls[1] as unknown[])[0] as {
      prompt: string;
    };
    expect(retryRequest.prompt).toContain('保持用户明确要求的跟拍、变焦或其它运镜');
    expect(retryRequest.prompt).toContain('保留用户明确要求的大幅度动作');
    expect(retryRequest.prompt).not.toMatch(/构图修复要求.*固定略宽中景/);
    expect(retryRequest.prompt).not.toContain('只做完成动作所需的最小运动幅度');
    expect(retryRequest.prompt).not.toContain('主体中心始终保持在画面中央 50%');
    expect(retryRequest.prompt).not.toContain('仅垂直抬升到足以离开桌面');
  });

  it('removes an unrequested hand from a repair candidate instead of constraining the composition around it', async () => {
    const { svc, mocks } = makeServices();
    const oneShot: VideoScript = {
      title: '咖啡产品镜头',
      segments: [
        {
          text: '蓝色咖啡杯在晨光中旋转。',
          type: 'broll',
          visual: '蓝色咖啡杯在晨光中缓慢旋转，镜头平稳环绕',
        },
      ],
    };
    const verifyFinalVideo = vi
      .fn()
      .mockResolvedValueOnce({
        status: 'fail' as const,
        failedChecks: ['hand_anatomy_uncertain'],
        reason: '画面边缘出现了不完整的手',
      })
      .mockResolvedValue({
        status: 'pass' as const,
        failedChecks: [],
        reason: '画面通过',
      });

    await runSimpleVideoCreation(
      { userText: '做一个蓝色咖啡杯的晨光产品镜头。', script: oneShot },
      CFG,
      { videoSource: 'veo_fast', aspectRatio: '16:9' },
      { ...svc, verifyFinalVideo },
    );

    const retryRequest = (mocks.generateVeoVideo.mock.calls[1] as unknown[])[0] as {
      prompt: string;
    };
    expect(retryRequest.prompt).toContain('上一版出现了非必要手部');
    expect(retryRequest.prompt).toContain('移除所有手和手臂');
    expect(retryRequest.prompt).not.toContain('只保留用户要求的手和手臂');
  });

  it('records the exact reason when the repair candidate is also rejected', async () => {
    const { svc, mocks } = makeServices();
    logger.warn.mockClear();
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
    const verifyFinalVideo = vi
      .fn()
      .mockResolvedValueOnce({
        status: 'fail' as const,
        failedChecks: ['hand_anatomy_uncertain', 'required_action_missing'],
        reason: '手部不清晰且放回动作缺失',
      })
      .mockResolvedValueOnce({
        status: 'fail' as const,
        failedChecks: ['required_action_missing'],
        reason: '第二版仍未展示放回后的稳定终态',
      });

    await expect(
      runSimpleVideoCreation(
        { userText: '一只手拿起杯子，停一下，再放回并离开。', script: oneShot },
        CFG,
        {
          videoSource: 'veo_fast',
          aspectRatio: '16:9',
          veoDurationSeconds: 6,
          veoResolution: '720p',
        },
        { ...svc, verifyFinalVideo },
      ),
    ).rejects.toMatchObject({
      name: 'SimpleVideoError',
      kind: 'quality',
      retryable: false,
    });

    expect(mocks.generateVeoVideo).toHaveBeenCalledTimes(2);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        segmentIndex: 0,
        failedChecks: ['required_action_missing'],
        reason: '第二版仍未展示放回后的稳定终态',
      }),
      'video: replacement segment quality rejected',
    );
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
    logger.warn.mockClear();
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
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        failedChecks: ['verifier_inconclusive'],
        reason: '质检服务未得出结论',
      }),
      'video: segment quality verification inconclusive',
    );
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
      expect(mocks.generateVeoVideo).toHaveBeenCalledTimes(
        status === 'fail' ? SCRIPT.segments.length * 2 : SCRIPT.segments.length,
      );
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
