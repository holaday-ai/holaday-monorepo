import type Anthropic from '@anthropic-ai/sdk';
import type { FfmpegExecOpts } from './ffmpeg-exec.js';

const QUALITY_MODEL = 'claude-sonnet-4-6';
const SAMPLE_RATIOS = [0.1, 0.3, 0.5, 0.7, 0.9] as const;

export type VideoQualityStatus = 'pass' | 'fail' | 'unknown';

export interface VideoQualityResult {
  readonly status: VideoQualityStatus;
  readonly failedChecks: string[];
  readonly reason: string;
}

export interface VideoQualityFrameCommand {
  readonly timestampSeconds: number;
  readonly framePath: string;
  readonly command: { bin: string; args: string[] };
}

export interface VideoQualityAnalysisInput {
  readonly frames: Array<{
    readonly data: string;
    readonly mediaType: 'image/jpeg';
    readonly timestampSeconds: number;
  }>;
  readonly prompt: string;
}

export type VideoQualityAnalyzer = (
  input: VideoQualityAnalysisInput,
) => Promise<string>;

export interface VerifyFinalVideoQualityInput {
  readonly videoPath: string;
  readonly workdir: string;
  readonly durationMs: number;
  readonly userText: string;
  readonly expectedSubtitleText: string[];
  readonly expectedBrandText: string;
  readonly ffmpegBin?: string;
}

export interface VideoQualityVerifierDeps {
  readonly runFfmpeg: (
    command: { bin: string; args: readonly string[] },
    opts?: FfmpegExecOpts,
  ) => Promise<void>;
  readonly readFile: (path: string) => Promise<Buffer>;
  readonly analyzeFrames: VideoQualityAnalyzer;
}

function unknownResult(reason: string): VideoQualityResult {
  return {
    status: 'unknown',
    failedChecks: ['verifier_inconclusive'],
    reason,
  };
}

export function buildVideoQualityFrameCommands(input: {
  videoPath: string;
  workdir: string;
  durationMs: number;
  ffmpegBin?: string;
}): VideoQualityFrameCommand[] {
  const durationSeconds = Math.max(0.2, input.durationMs / 1000);
  return SAMPLE_RATIOS.map((ratio, index) => {
    const timestampSeconds = Number((durationSeconds * ratio).toFixed(3));
    const framePath = `${input.workdir}/quality-frame-${String(index + 1).padStart(2, '0')}.jpg`;
    return {
      timestampSeconds,
      framePath,
      command: {
        bin: input.ffmpegBin ?? 'ffmpeg',
        args: [
          '-y',
          '-ss',
          timestampSeconds.toFixed(3),
          '-i',
          input.videoPath,
          '-frames:v',
          '1',
          '-q:v',
          '3',
          framePath,
        ],
      },
    };
  });
}

export function parseVideoQualityResponse(text: string): VideoQualityResult {
  try {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start < 0 || end <= start) return unknownResult('质检返回无法解析');
    const value = JSON.parse(text.slice(start, end + 1)) as {
      status?: unknown;
      failedChecks?: unknown;
      reason?: unknown;
    };
    if (value.status !== 'pass' && value.status !== 'fail') {
      return unknownResult('质检返回状态无效');
    }
    const failedChecks = Array.isArray(value.failedChecks)
      ? value.failedChecks.filter((item): item is string => typeof item === 'string')
      : [];
    const reason =
      typeof value.reason === 'string' && value.reason.trim()
        ? value.reason.trim()
        : value.status === 'pass'
          ? '成片质检通过'
          : '成片质检未通过';
    if (value.status === 'pass' && failedChecks.length > 0) {
      return unknownResult('质检结论与检查项冲突');
    }
    return { status: value.status, failedChecks, reason };
  } catch {
    return unknownResult('质检返回无法解析');
  }
}

function buildQualityPrompt(input: VerifyFinalVideoQualityInput): string {
  const subtitles =
    input.expectedSubtitleText.length > 0
      ? input.expectedSubtitleText.map((text, index) => `${index + 1}. ${text}`).join('\n')
      : '无';
  return [
    '你是生成视频的成片质量审核器。以下五张图按时间顺序来自同一条最终视频。',
    `用户原始需求：${input.userText}`,
    '',
    '任何一项命中都必须 status=fail：',
    '1. 人体或手部异常：多指、少指、融合手、手指粘连、额外的手/手臂、断肢、悬浮肢体、异常关节、肢体来源不可能。',
    '2. 用户原始需求没有人物或手部动作，但静物任务出现人物或手、有人拿起/触碰/操作主体。',
    '3. 主体、动作、数量、颜色、构图或场景明显偏离用户需求；主体跨帧身份或形态明显漂移。',
    '4. 用户指定的文字、品牌或 Logo 没有逐字准确呈现，或画面中出现乱码、错字、不可读/错误品牌标识；未要求时擅自添加文字或品牌；字幕或品牌文字被裁切、严重遮挡、明显拼错。',
    '5. 明显闪烁、物体融化、穿模、突然消失、非物理运动或其它足以让用户拒收的生成瑕疵。',
    '',
    `允许且必须准确的品牌标识：${input.expectedBrandText}`,
    '预期字幕文本（不同时间帧只需出现对应句，不要求每帧同时出现）：',
    subtitles,
    '',
    '不要因为整体风格好看而放过局部异常。无法确认时 status=unknown，不得猜测通过。',
    '只输出 JSON：',
    '{"status":"pass|fail","failedChecks":["snake_case_code"],"reason":"一句中文结论"}',
  ].join('\n');
}

export function createAnthropicVideoQualityAnalyzer(
  client: Anthropic,
): VideoQualityAnalyzer {
  return async (input) => {
    const content = [
      ...input.frames.map((frame) => ({
        type: 'image' as const,
        source: {
          type: 'base64' as const,
          media_type: frame.mediaType,
          data: frame.data,
        },
      })),
      { type: 'text' as const, text: input.prompt },
    ];
    const response = await client.messages.create({
      model: QUALITY_MODEL,
      max_tokens: 512,
      messages: [{ role: 'user', content }],
    }, {
      timeout: 45_000,
      maxRetries: 0,
    });
    const block = response.content.find((item) => item.type === 'text');
    return block && block.type === 'text' ? block.text : '';
  };
}

export async function verifyFinalVideoQuality(
  input: VerifyFinalVideoQualityInput,
  deps: VideoQualityVerifierDeps,
): Promise<VideoQualityResult> {
  const commands = buildVideoQualityFrameCommands(input);
  const frames: VideoQualityAnalysisInput['frames'] = [];
  try {
    for (const item of commands) {
      await deps.runFfmpeg(
        item.command,
        input.ffmpegBin ? { ffmpegBin: input.ffmpegBin } : undefined,
      );
      const frame = await deps.readFile(item.framePath);
      frames.push({
        data: frame.toString('base64'),
        mediaType: 'image/jpeg',
        timestampSeconds: item.timestampSeconds,
      });
    }
  } catch {
    return unknownResult('无法抽取成片质检帧');
  }

  const prompt = buildQualityPrompt(input);
  let lastResult = unknownResult('成片质检未得出结论');
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      lastResult = parseVideoQualityResponse(
        await deps.analyzeFrames({ frames, prompt }),
      );
      if (lastResult.status !== 'unknown') return lastResult;
    } catch {
      lastResult = unknownResult('成片质检服务暂时不可用');
    }
  }
  return lastResult;
}
