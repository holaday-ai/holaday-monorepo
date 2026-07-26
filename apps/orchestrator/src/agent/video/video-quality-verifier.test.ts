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
  it('samples nine ordered points across the final video instead of judging sparse poster frames', () => {
    const commands = buildVideoQualityFrameCommands({
      videoPath: '/tmp/final.mp4',
      workdir: '/tmp/quality',
      durationMs: 10_000,
      ffmpegBin: '/opt/ffmpeg',
    });

    expect(commands).toHaveLength(9);
    expect(commands.map((item) => item.timestampSeconds)).toEqual([
      0.5, 1.5, 2.5, 3.75, 5, 6.25, 7.5, 8.5, 9.5,
    ]);
    expect(commands[0]?.command).toEqual({
      bin: '/opt/ffmpeg',
      args: [
        '-y',
        '-ss',
        '0.500',
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

  it('preserves a verifier-declared technical unknown for diagnosis', () => {
    expect(
      parseVideoQualityResponse(
        '{"status":"unknown","failedChecks":["frame_unreadable"],"reason":"第 5 帧无法读取"}',
      ),
    ).toEqual({
      status: 'unknown',
      failedChecks: ['frame_unreadable'],
      reason: '第 5 帧无法读取',
    });
  });
});

describe('verifyFinalVideoQuality', () => {
  it('fails closed before frame analysis when the artifact is materially shorter than requested', async () => {
    const runFfmpeg = vi.fn(async () => undefined);
    const analyzeFrames = vi.fn(async () =>
      JSON.stringify({ status: 'pass', failedChecks: [], reason: '不应执行' }),
    );

    const result = await verifyFinalVideoQuality(
      {
        videoPath: '/tmp/final.mp4',
        workdir: '/tmp/quality',
        durationMs: 4_567,
        minimumDurationMs: 6_000,
        userText: '一只手拿起杯子再放回桌面',
        expectedSubtitleText: [],
        requiredBrandTexts: [],
        brandPolicy: '无品牌要求。',
      },
      {
        runFfmpeg,
        readFile: vi.fn(async () => Buffer.from('jpeg')),
        analyzeFrames,
        normalizeImage: async (buffer) => buffer,
      },
    );

    expect(result).toEqual({
      status: 'fail',
      failedChecks: ['duration_too_short'],
      reason: '成片时长 4.57 秒，短于要求的 6.00 秒',
    });
    expect(runFfmpeg).not.toHaveBeenCalled();
    expect(analyzeFrames).not.toHaveBeenCalled();
  });

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

    expect(runFfmpeg).toHaveBeenCalledTimes(9);
    expect(readFile).toHaveBeenCalledTimes(9);
    expect(analyzeFrames).toHaveBeenCalledTimes(1);
    const analysisInput = (analyzeFrames.mock.calls[0] as unknown[])[0] as {
      frames: Array<{ data: string }>;
      prompt: string;
    };
    expect(analysisInput.frames).toHaveLength(9);
    expect(analysisInput.prompt).toMatch(/多指|融合手|额外肢体|异常关节/);
    expect(analysisInput.prompt).toMatch(/自然抓握.*遮挡.*不得仅据此.*fail/);
    expect(analysisInput.prompt).toMatch(/hand_anatomy_uncertain/);
    expect(analysisInput.prompt).toMatch(/明确.*融合|数量矛盾|异常关节/);
    expect(analysisInput.prompt).not.toMatch(/每只可见的手应能确认五根彼此独立的手指/);
    expect(analysisInput.prompt).toMatch(/unknown.*技术原因|不得.*画质存疑.*unknown/);
    expect(analysisInput.prompt).toContain('静物任务出现人物或手');
    expect(analysisInput.prompt).toContain('HOLA DAY · AI');
    expect(analysisInput.prompt).toContain('静物视频不得凭空出现人物或手部');
    expect(analysisInput.prompt).toMatch(/逐字准确|错误品牌标识/);
    expect(analysisInput.prompt).toMatch(/输入参数明确列为允许.*不能仅因.*用户原始需求.*判失败/);
    expect(analysisInput.prompt).toMatch(/允许范围之外.*文字或品牌/);
    expect(analysisInput.prompt).not.toMatch(/未要求时擅自添加文字或品牌/);
    expect(analysisInput.prompt).toMatch(/静态抽样帧.*连续运动|不能验证.*口型同步/);
    expect(analysisInput.prompt).toMatch(/进入.*拿起.*放回|分阶段动作/);
    expect(analysisInput.prompt).toMatch(/required_action_missing/);
    expect(result.status).toBe('fail');
  });

  it('requires a second fail-closed action audit before passing a hand-object sequence', async () => {
    const analyzeFrames = vi
      .fn()
      .mockResolvedValueOnce(
        JSON.stringify({ status: 'pass', failedChecks: [], reason: '整体画面无明显异常' }),
      )
      .mockResolvedValueOnce(
        JSON.stringify({
          checks: [
            {
              id: 'enter_frame',
              observed: true,
              evidenceFrameSeconds: [0.3, 0.9],
              reason: '前段无手，随后右手进入画面',
            },
            {
              id: 'lift',
              observed: false,
              evidenceFrameSeconds: [],
              reason: '只看到手接触杯子，杯底始终贴着桌面',
            },
            {
              id: 'pause',
              observed: false,
              evidenceFrameSeconds: [],
              reason: '没有杯子离开桌面后的停留证据',
            },
            {
              id: 'return',
              observed: false,
              evidenceFrameSeconds: [],
              reason: '没有先拿起，因此不能确认放回',
            },
            {
              id: 'exit_frame',
              observed: false,
              evidenceFrameSeconds: [5.7],
              reason: '末段手仍在画面中',
            },
          ],
          reason: '动作链未完整完成',
        }),
      );

    const result = await verifyFinalVideoQuality(
      {
        videoPath: '/tmp/final.mp4',
        workdir: '/tmp/quality',
        durationMs: 6_000,
        minimumDurationMs: 6_000,
        userText: '一只右手进入画面，拿起杯子，停留一下，再放回桌面并离开。',
        strictRequiredActions: true,
        expectedSubtitleText: ['拿起杯子，再放回桌面。'],
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
    const auditInput = (analyzeFrames.mock.calls[1] as unknown[])[0] as {
      prompt: string;
      outputMode: string;
    };
    expect(auditInput.outputMode).toBe('required_action_evidence');
    expect(auditInput.prompt).toMatch(/独立动作证据复核/);
    expect(auditInput.prompt).toMatch(/杯底.*离开.*桌面|明确.*悬空/);
    expect(auditInput.prompt).toMatch(/手接触.*不能算.*拿起/);
    expect(auditInput.prompt).toMatch(/95%.*动作主体.*已经离场/);
    expect(result).toEqual({
      status: 'fail',
      failedChecks: [
        'required_action_missing_lift',
        'required_action_missing_pause',
        'required_action_missing_return',
        'required_action_missing_exit_frame',
      ],
      reason:
        '拿起/提起：只看到手接触杯子，杯底始终贴着桌面；' +
        '停顿/停留：没有杯子离开桌面后的停留证据；' +
        '放回/放下：没有先拿起，因此不能确认放回；' +
        '离开画面：末段手仍在画面中',
    });
  });

  it('passes required actions only when every requested action has direct frame evidence', async () => {
    const analyzeFrames = vi
      .fn()
      .mockResolvedValueOnce(
        JSON.stringify({ status: 'pass', failedChecks: [], reason: '整体画面无明显异常' }),
      )
      .mockResolvedValueOnce(
        JSON.stringify({
          checks: [
            {
              id: 'lift',
              observed: true,
              evidenceFrameSeconds: [1.5, 2.25],
              reason: '杯底与桌面之间有清楚间隙',
            },
            {
              id: 'return',
              observed: true,
              evidenceFrameSeconds: [4.5],
              reason: '杯子在后段重新接触桌面',
            },
          ],
          reason: '两个动作均有直接证据',
        }),
      );

    const result = await verifyFinalVideoQuality(
      {
        videoPath: '/tmp/final.mp4',
        workdir: '/tmp/quality',
        durationMs: 6_000,
        userText: '拿起杯子，再放回桌面。',
        strictRequiredActions: true,
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

    expect(result).toEqual({
      status: 'pass',
      failedChecks: [],
      reason: '动作证据复核通过：拿起/提起、放回/放下',
    });
  });

  it('fails closed when the action evidence response omits a requested action', async () => {
    const analyzeFrames = vi
      .fn()
      .mockResolvedValueOnce(
        JSON.stringify({ status: 'pass', failedChecks: [], reason: '整体画面无明显异常' }),
      )
      .mockResolvedValueOnce(
        JSON.stringify({
          checks: [
            {
              id: 'lift',
              observed: true,
              evidenceFrameSeconds: [1.5],
              reason: '杯子离开桌面',
            },
          ],
          reason: '只提交了拿起证据',
        }),
      );

    const result = await verifyFinalVideoQuality(
      {
        videoPath: '/tmp/final.mp4',
        workdir: '/tmp/quality',
        durationMs: 6_000,
        userText: '拿起杯子，再放回桌面。',
        strictRequiredActions: true,
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

    expect(result).toEqual({
      status: 'fail',
      failedChecks: ['required_action_missing_return'],
      reason: '放回/放下：质检未提交该动作的直接证据',
    });
  });

  it('returns unknown after two malformed required-action evidence responses', async () => {
    const analyzeFrames = vi
      .fn()
      .mockResolvedValueOnce(
        JSON.stringify({ status: 'pass', failedChecks: [], reason: '整体画面无明显异常' }),
      )
      .mockResolvedValueOnce('not-json')
      .mockResolvedValueOnce('still-not-json');

    const result = await verifyFinalVideoQuality(
      {
        videoPath: '/tmp/final.mp4',
        workdir: '/tmp/quality',
        durationMs: 6_000,
        userText: '拿起杯子。',
        strictRequiredActions: true,
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

    expect(analyzeFrames).toHaveBeenCalledTimes(3);
    expect(result).toEqual({
      status: 'unknown',
      failedChecks: ['verifier_inconclusive'],
      reason: '动作证据质检返回无法解析',
    });
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

    expect(runFfmpeg).toHaveBeenCalledTimes(14);
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
    expect(analysisInput.frames).toHaveLength(9);
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
  it('forces every bounded quality-analysis request through the structured verdict tool', async () => {
    const create = vi.fn(async () => ({
      content: [
        {
          type: 'tool_use' as const,
          id: 'toolu_video_quality',
          name: 'submit_video_quality_verdict',
          input: {
            status: 'pass',
            failedChecks: [],
            reason: '九帧均通过',
          },
        },
      ],
    }));
    const analyzer = createAnthropicVideoQualityAnalyzer({
      messages: { create },
    } as unknown as Anthropic);

    const response = await analyzer({
      references: [],
      frames: [],
      prompt: 'check the final video',
    });

    expect(JSON.parse(response)).toEqual({
      status: 'pass',
      failedChecks: [],
      reason: '九帧均通过',
    });
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'claude-sonnet-4-6',
        max_tokens: 512,
        tools: [
          expect.objectContaining({
            name: 'submit_video_quality_verdict',
          }),
        ],
        tool_choice: {
          type: 'tool',
          name: 'submit_video_quality_verdict',
        },
      }),
      {
        timeout: 45_000,
        maxRetries: 0,
      },
    );
  });

  it('uses a separate evidence-only tool for required-action analysis', async () => {
    const create = vi.fn(async () => ({
      content: [
        {
          type: 'tool_use' as const,
          id: 'toolu_required_actions',
          name: 'submit_required_action_evidence',
          input: {
            checks: [
              {
                id: 'lift',
                observed: true,
                evidenceFrameSeconds: [2.25],
                reason: '杯底清楚离开桌面',
              },
            ],
            reason: '动作有直接证据',
          },
        },
      ],
    }));
    const analyzer = createAnthropicVideoQualityAnalyzer({
      messages: { create },
    } as unknown as Anthropic);

    const response = await analyzer({
      references: [],
      frames: [],
      prompt: 'check required actions',
      outputMode: 'required_action_evidence',
    });

    expect(JSON.parse(response)).toMatchObject({
      checks: [expect.objectContaining({ id: 'lift', observed: true })],
    });
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        tools: [
          expect.objectContaining({
            name: 'submit_required_action_evidence',
            input_schema: expect.objectContaining({
              required: ['checks', 'reason'],
              properties: expect.objectContaining({
                checks: expect.any(Object),
              }),
            }),
          }),
        ],
        tool_choice: {
          type: 'tool',
          name: 'submit_required_action_evidence',
        },
      }),
      {
        timeout: 45_000,
        maxRetries: 0,
      },
    );
  });
});
