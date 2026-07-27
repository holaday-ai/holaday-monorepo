import type { FfmpegExecOpts } from './ffmpeg-exec.js';
import {
  normalizeVideoQualityImage,
  parseVideoQualityResponse,
  type VideoQualityAnalysisInput,
  type VideoQualityAnalyzer,
  type VideoQualityFrameCommand,
  type VideoQualityReferenceImage,
  type VideoQualityResult,
} from './video-quality-verifier.js';

const SAMPLE_RATIOS = [0.1, 0.3, 0.5, 0.7, 0.9] as const;

export interface VerifyCloneVideoCompatibilityInput {
  readonly subjectImage: VideoQualityReferenceImage;
  readonly referenceVideoPath: string;
  readonly referenceVideoDurationMs: number;
  readonly workdir: string;
  readonly ffmpegBin?: string;
}

export interface CloneVideoCompatibilityDeps {
  readonly runFfmpeg: (
    command: { bin: string; args: readonly string[] },
    opts?: FfmpegExecOpts,
  ) => Promise<void>;
  readonly readFile: (path: string) => Promise<Buffer>;
  readonly analyzeFrames: VideoQualityAnalyzer;
  readonly normalizeImage?: (buffer: Buffer) => Promise<Buffer>;
}

function unknownResult(reason: string): VideoQualityResult {
  return {
    status: 'unknown',
    failedChecks: ['verifier_inconclusive'],
    reason,
  };
}

export function buildCloneCompatibilityFrameCommands(
  input: Omit<VerifyCloneVideoCompatibilityInput, 'subjectImage'>,
): VideoQualityFrameCommand[] {
  const durationSeconds = Math.max(0.2, input.referenceVideoDurationMs / 1000);
  return SAMPLE_RATIOS.map((ratio, index) => {
    const timestampSeconds = Number((durationSeconds * ratio).toFixed(3));
    const framePath = `${input.workdir}/clone-compatibility-${String(index + 1).padStart(2, '0')}.jpg`;
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
          input.referenceVideoPath,
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

const COMPATIBILITY_PROMPT = `你正在进行视频主角替换的付费前兼容性检查。当前模型仅支持单人换单人。

请把“上传的主角照片”与参考视频的五个抽样帧分开检查：
1. 主角照片必须只包含一位清晰可见的人类主体，可以是真人或写实虚构人物；宠物、动物、物体、纯插画角色、多人合照、严重遮挡均不通过。
2. 参考视频必须有且只有一位持续可识别的主要人类主体；多人共同出镜、没有人物或主体长期不可见均不通过。
3. 两者的取景和身体比例必须大致相容，例如近景对应近景、半身对应半身、全身对应全身。只要任一参考帧清楚出现手臂、双手、腹部或腿部，而这些区域在主角照片中没有完整可见，就必须返回 fail 并标记 framing_mismatch；不要假设模型可以可靠补全缺失身体。明显的头肩照替换半身或全身动作、身体比例或姿态范围严重不匹配均不通过。
4. 不要比较两者是否为同一身份、同一性别、同一服装或同一肤色；本功能的目的正是替换身份。

只提交结构化结论。失败项只使用：
- subject_not_single_human
- reference_not_single_human
- framing_mismatch
- subject_occluded

只有技术原因导致素材无法看清时才返回 unknown；不要因为身份不同而返回 fail。`;

export async function verifyCloneVideoCompatibility(
  input: VerifyCloneVideoCompatibilityInput,
  deps: CloneVideoCompatibilityDeps,
): Promise<VideoQualityResult> {
  const normalizeImage = deps.normalizeImage ?? normalizeVideoQualityImage;
  const commands = buildCloneCompatibilityFrameCommands(input);
  const frames: VideoQualityAnalysisInput['frames'] = [];

  try {
    for (const item of commands) {
      await deps.runFfmpeg(
        item.command,
        input.ffmpegBin ? { ffmpegBin: input.ffmpegBin } : undefined,
      );
      const normalized = await normalizeImage(await deps.readFile(item.framePath));
      frames.push({
        data: normalized.toString('base64'),
        mediaType: 'image/jpeg',
        timestampSeconds: item.timestampSeconds,
      });
    }
  } catch {
    return unknownResult('无法抽取参考视频兼容性检查帧');
  }

  const subject = await normalizeImage(Buffer.from(input.subjectImage.data, 'base64'))
    .then((buffer) => ({
      data: buffer.toString('base64'),
      mediaType: 'image/jpeg' as const,
      label: input.subjectImage.label,
    }))
    .catch(() => null);
  if (!subject) return unknownResult('无法读取主角照片');

  let lastResult = unknownResult('素材兼容性检查未得出结论');
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      lastResult = parseVideoQualityResponse(
        await deps.analyzeFrames({
          references: [subject],
          frames,
          prompt: COMPATIBILITY_PROMPT,
        }),
      );
      if (lastResult.status !== 'unknown') return lastResult;
    } catch {
      return unknownResult('素材兼容性检查服务暂时不可用');
    }
  }
  return lastResult;
}
