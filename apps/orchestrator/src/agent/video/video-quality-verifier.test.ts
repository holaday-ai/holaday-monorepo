import type Anthropic from '@anthropic-ai/sdk';
import sharp from 'sharp';
import { describe, expect, it, vi } from 'vitest';
import {
  VIDEO_QUALITY_MAX_IMAGE_BYTES,
  VIDEO_QUALITY_MAX_TOTAL_IMAGE_BYTES,
  buildVideoQualityFrameCommands,
  createAnthropicVideoQualityAnalyzer,
  parseVideoQualityResponse,
  prepareVideoQualityReferenceImage,
  verifyFinalVideoQuality,
} from './video-quality-verifier.js';

describe('prepareVideoQualityReferenceImage', () => {
  it('normalizes an oversized upload to a bounded JPEG when storage omits content type', async () => {
    const source = await sharp({
      create: {
        width: 3200,
        height: 2400,
        channels: 3,
        background: '#f2f4f8',
      },
    })
      .png()
      .toBuffer();
    const reference = await prepareVideoQualityReferenceImage({
      buffer: source,
      label: '上传照片',
    });

    expect(reference.mediaType).toBe('image/jpeg');
    expect(reference.label).toBe('上传照片');
    const normalized = Buffer.from(reference.data, 'base64');
    const metadata = await sharp(normalized).metadata();
    expect(Math.max(metadata.width ?? 0, metadata.height ?? 0)).toBeLessThanOrEqual(1568);
    expect(normalized.length).toBeLessThanOrEqual(VIDEO_QUALITY_MAX_IMAGE_BYTES);
  });
});

describe('buildVideoQualityFrameCommands', () => {
  it('samples five points across the final video instead of judging one poster frame', () => {
    const commands = buildVideoQualityFrameCommands({
      videoPath: '/tmp/final.mp4',
      workdir: '/tmp/quality',
      durationMs: 10_000,
      ffmpegBin: '/opt/ffmpeg',
    });

    expect(commands).toHaveLength(5);
    expect(commands.map((item) => item.timestampSeconds)).toEqual([1, 3, 5, 7, 9]);
    expect(commands[0]?.command).toEqual({
      bin: '/opt/ffmpeg',
      args: [
        '-y',
        '-ss',
        '1.000',
        '-i',
        '/tmp/final.mp4',
        '-frames:v',
        '1',
        '-q:v',
        '3',
        '/tmp/quality/quality-frame-01.jpg',
      ],
    });
  });
});

describe('parseVideoQualityResponse', () => {
  it('parses a hard anatomy failure', () => {
    expect(
      parseVideoQualityResponse(
        '{"status":"fail","failedChecks":["fused_hands","extra_fingers"],"reason":"手部融合且多指"}',
      ),
    ).toEqual({
      status: 'fail',
      failedChecks: ['fused_hands', 'extra_fingers'],
      reason: '手部融合且多指',
    });
  });

  it('returns unknown for malformed or out-of-contract responses', () => {
    expect(parseVideoQualityResponse('looks fine')).toMatchObject({ status: 'unknown' });
    expect(
      parseVideoQualityResponse('{"status":"maybe","failedChecks":[],"reason":"?"}'),
    ).toMatchObject({ status: 'unknown' });
  });
});

describe('verifyFinalVideoQuality', () => {
  it('sends all sampled frames and strict anatomy/text requirements to one bounded analysis', async () => {
    const runFfmpeg = vi.fn(async () => undefined);
    const readFile = vi.fn(async (framePath: string) => Buffer.from(`jpeg:${framePath}`));
    const analyzeFrames = vi.fn(async () =>
      JSON.stringify({
        status: 'fail',
        failedChecks: ['unrequested_human'],
        reason: '静物任务出现人手',
      }),
    );

    const result = await verifyFinalVideoQuality(
      {
        videoPath: '/tmp/final.mp4',
        workdir: '/tmp/quality',
        durationMs: 8_000,
        userText: '一只蓝色陶瓷杯放在白色桌面',
        qualityContext: '静物视频不得凭空出现人物或手部。',
        expectedSubtitleText: ['一只蓝色陶瓷杯静静放在白色桌面。'],
        requiredBrandTexts: ['HOLA DAY · AI'],
        brandPolicy: '不得新增其它文字或品牌。',
      },
      {
        runFfmpeg,
        readFile,
        analyzeFrames,
        normalizeImage: async (buffer) => buffer,
      },
    );

    expect(runFfmpeg).toHaveBeenCalledTimes(5);
    expect(readFile).toHaveBeenCalledTimes(5);
    expect(analyzeFrames).toHaveBeenCalledTimes(1);
    const analysisInput = (analyzeFrames.mock.calls[0] as unknown[])[0] as {
      frames: Array<{ data: string }>;
      prompt: string;
    };
    expect(analysisInput.frames).toHaveLength(5);
    expect(analysisInput.prompt).toMatch(/多指|融合手|额外肢体|异常关节/);
    expect(analysisInput.prompt).toContain('静物任务出现人物或手');
    expect(analysisInput.prompt).toContain('HOLA DAY · AI');
    expect(analysisInput.prompt).toContain('静物视频不得凭空出现人物或手部');
    expect(analysisInput.prompt).toMatch(/逐字准确|错误品牌标识/);
    expect(analysisInput.prompt).toMatch(/未要求时擅自添加文字或品牌/);
    expect(analysisInput.prompt).toMatch(/静态抽样帧.*连续运动|不能验证.*口型同步/);
    expect(result.status).toBe('fail');
  });

  it('retries one inconclusive analysis and never silently passes an unknown result', async () => {
    const analyzeFrames = vi
      .fn()
      .mockResolvedValueOnce('not-json')
      .mockResolvedValueOnce(
        JSON.stringify({ status: 'pass', failedChecks: [], reason: '五帧均通过' }),
      );

    const result = await verifyFinalVideoQuality(
      {
        videoPath: '/tmp/final.mp4',
        workdir: '/tmp/quality',
        durationMs: 8_000,
        userText: '蓝色陶瓷杯',
        expectedSubtitleText: [],
        requiredBrandTexts: ['HOLA DAY · AI'],
        brandPolicy: '不得新增其它文字或品牌。',
      },
      {
        runFfmpeg: vi.fn(async () => undefined),
        readFile: vi.fn(async () => Buffer.from('jpeg')),
        analyzeFrames,
        normalizeImage: async (buffer) => buffer,
      },
    );

    expect(analyzeFrames).toHaveBeenCalledTimes(2);
    expect(result.status).toBe('pass');
  });

  it('compares the final frames with source images and sampled source-video frames', async () => {
    const runFfmpeg = vi.fn(async () => undefined);
    const readFile = vi.fn(async (framePath: string) => Buffer.from(`jpeg:${framePath}`));
    const analyzeFrames = vi.fn(async () =>
      JSON.stringify({ status: 'pass', failedChecks: [], reason: '主角与源素材一致' }),
    );

    await verifyFinalVideoQuality(
      {
        videoPath: '/tmp/final.mp4',
        workdir: '/tmp/quality',
        durationMs: 8_000,
        userText: '复刻参考动作',
        qualityContext: '主角身份和可见外观要与源素材一致。',
        expectedSubtitleText: [],
        requiredBrandTexts: [],
        brandPolicy: '参考素材原有品牌可保留，但不得新增乱码或错误品牌。',
        referenceImages: [
          {
            data: Buffer.from('subject-jpeg').toString('base64'),
            mediaType: 'image/jpeg',
            label: '上传的主角照片',
          },
        ],
        referenceVideos: [
          {
            videoPath: '/tmp/reference.mp4',
            durationMs: 10_000,
            label: '用户上传的参考动作视频',
          },
        ],
      },
      {
        runFfmpeg,
        readFile,
        analyzeFrames,
        normalizeImage: async (buffer) => buffer,
      },
    );

    expect(runFfmpeg).toHaveBeenCalledTimes(10);
    const analysisInput = (analyzeFrames.mock.calls[0] as unknown[])[0] as {
      references: Array<{ label: string; data: string }>;
      frames: Array<{ data: string }>;
      prompt: string;
    };
    expect(analysisInput.references).toHaveLength(6);
    expect(analysisInput.references.map((item) => item.label)).toEqual([
      '上传的主角照片',
      '用户上传的参考动作视频 · 10%',
      '用户上传的参考动作视频 · 30%',
      '用户上传的参考动作视频 · 50%',
      '用户上传的参考动作视频 · 70%',
      '用户上传的参考动作视频 · 90%',
    ]);
    expect(analysisInput.frames).toHaveLength(5);
    expect(analysisInput.prompt).toMatch(/先比较参考素材与待验收成片/);
  });

  it('returns unknown before analysis when an image exceeds the request budget', async () => {
    const analyzeFrames = vi.fn(async () =>
      JSON.stringify({ status: 'pass', failedChecks: [], reason: '不应执行' }),
    );
    const result = await verifyFinalVideoQuality(
      {
        videoPath: '/tmp/final.mp4',
        workdir: '/tmp/quality',
        durationMs: 8_000,
        userText: '蓝色陶瓷杯',
        referenceImages: [
          {
            data: Buffer.alloc(VIDEO_QUALITY_MAX_IMAGE_BYTES + 1).toString('base64'),
            mediaType: 'image/jpeg',
            label: '超大参考图',
          },
        ],
        expectedSubtitleText: [],
        requiredBrandTexts: [],
        brandPolicy: '无品牌要求。',
      },
      {
        runFfmpeg: vi.fn(async () => undefined),
        readFile: vi.fn(async () => Buffer.from('jpeg')),
        analyzeFrames,
        normalizeImage: async (buffer) => buffer,
      },
    );

    expect(result).toMatchObject({
      status: 'unknown',
      failedChecks: ['verifier_inconclusive'],
    });
    expect(result.reason).toMatch(/图片.*预算/);
    expect(analyzeFrames).not.toHaveBeenCalled();
  });

  it('returns unknown before analysis when individually valid images exceed the total budget', async () => {
    const analyzeFrames = vi.fn(async () =>
      JSON.stringify({ status: 'pass', failedChecks: [], reason: '不应执行' }),
    );
    const normalizedSize = Math.floor(VIDEO_QUALITY_MAX_IMAGE_BYTES * 0.95);
    const referenceCount = Math.floor(VIDEO_QUALITY_MAX_TOTAL_IMAGE_BYTES / normalizedSize) + 1;
    const result = await verifyFinalVideoQuality(
      {
        videoPath: '/tmp/final.mp4',
        workdir: '/tmp/quality',
        durationMs: 8_000,
        userText: '复刻多个参考素材',
        referenceImages: Array.from({ length: referenceCount }, (_, index) => ({
          data: Buffer.from(`reference-${index}`).toString('base64'),
          mediaType: 'image/jpeg' as const,
          label: `参考图 ${index + 1}`,
        })),
        expectedSubtitleText: [],
        requiredBrandTexts: [],
        brandPolicy: '无品牌要求。',
      },
      {
        runFfmpeg: vi.fn(async () => undefined),
        readFile: vi.fn(async () => Buffer.from('jpeg')),
        analyzeFrames,
        normalizeImage: async () => Buffer.alloc(normalizedSize),
      },
    );

    expect(result).toMatchObject({
      status: 'unknown',
      failedChecks: ['verifier_inconclusive'],
    });
    expect(result.reason).toMatch(/图片.*预算/);
    expect(analyzeFrames).not.toHaveBeenCalled();
  });
});

describe('createAnthropicVideoQualityAnalyzer', () => {
  it('bounds each quality-analysis request because the verifier owns retry policy', async () => {
    const create = vi.fn(async () => ({
      content: [{ type: 'text' as const, text: '{"status":"pass","failedChecks":[]}' }],
    }));
    const analyzer = createAnthropicVideoQualityAnalyzer({
      messages: { create },
    } as unknown as Anthropic);

    await analyzer({
      references: [],
      frames: [],
      prompt: 'check the final video',
    });

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'claude-sonnet-4-6',
        max_tokens: 512,
      }),
      {
        timeout: 45_000,
        maxRetries: 0,
      },
    );
  });
});
