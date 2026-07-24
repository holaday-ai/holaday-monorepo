import type Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it, vi } from 'vitest';
import {
  buildVideoQualityFrameCommands,
  createAnthropicVideoQualityAnalyzer,
  parseVideoQualityResponse,
  verifyFinalVideoQuality,
} from './video-quality-verifier.js';

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
      JSON.stringify({ status: 'fail', failedChecks: ['unrequested_human'], reason: '静物任务出现人手' }),
    );

    const result = await verifyFinalVideoQuality(
      {
        videoPath: '/tmp/final.mp4',
        workdir: '/tmp/quality',
        durationMs: 8_000,
        userText: '一只蓝色陶瓷杯放在白色桌面',
        expectedSubtitleText: ['一只蓝色陶瓷杯静静放在白色桌面。'],
        expectedBrandText: 'HOLA DAY · AI',
      },
      { runFfmpeg, readFile, analyzeFrames },
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
    expect(analysisInput.prompt).toMatch(/逐字准确|错误品牌标识/);
    expect(analysisInput.prompt).toMatch(/未要求时擅自添加文字或品牌/);
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
        expectedBrandText: 'HOLA DAY · AI',
      },
      {
        runFfmpeg: vi.fn(async () => undefined),
        readFile: vi.fn(async () => Buffer.from('jpeg')),
        analyzeFrames,
      },
    );

    expect(analyzeFrames).toHaveBeenCalledTimes(2);
    expect(result.status).toBe('pass');
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
