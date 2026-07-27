import sharp from 'sharp';
import type { FfmpegExecOpts } from './ffmpeg-exec.js';
import {
  normalizeVideoQualityImage,
  type VideoQualityAnalysisInput,
  type VideoQualityAnalyzer,
  type VideoQualityFrameCommand,
  type VideoQualityReferenceImage,
  type VideoQualityResult,
} from './video-quality-verifier.js';

const SAMPLE_RATIOS = [0.1, 0.3, 0.5, 0.7, 0.9] as const;
const COMPATIBILITY_CHECK_IDS = [
  'subject_single_human',
  'reference_single_human',
  'subject_not_occluded',
  'framing_compatible',
] as const;
type CompatibilityCheckId = (typeof COMPATIBILITY_CHECK_IDS)[number];
const COMPATIBILITY_FAILURES: Record<
  CompatibilityCheckId,
  { readonly code: string; readonly label: string }
> = {
  subject_single_human: {
    code: 'subject_not_single_human',
    label: '主角照片不是清晰单人主体',
  },
  reference_single_human: {
    code: 'reference_not_single_human',
    label: '参考视频不是持续单人主体',
  },
  subject_not_occluded: {
    code: 'subject_occluded',
    label: '主角照片存在关键遮挡',
  },
  framing_compatible: {
    code: 'framing_mismatch',
    label: '取景范围不兼容',
  },
};

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
  readonly createSubjectBodyDetail?: (buffer: Buffer) => Promise<Buffer>;
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
3. “主角照片下半区域放大”与第一张是同一张主角照片的细节裁切，只用于核对手臂和双手，不能当成第二个人。取景兼容性是单向约束：只在参考帧需要的身体区域在主角照片中缺失时，才返回 fail 并标记 framing_mismatch。只比较参考帧需要的可见身体范围，不要要求两者保持同一姿态或同一构图。只要任一参考帧清楚出现手臂、双手、腹部或腿部，而这些区域在主角照片中没有完整可见，就必须返回 fail；不要假设模型可以可靠补全缺失身体。主角照片的身体范围比参考帧更完整，或额外显示腹部、腿部，不能单独标记 framing_mismatch。姿态、手势不同不能单独作为 framing_mismatch。手臂和双手已经完整可见时，即使接近画面边缘也不视为缺失。明显的头肩照替换需要双手、腹部或腿部的动作仍不通过。
4. 不要比较两者是否为同一身份、同一性别、同一服装或同一肤色；本功能的目的正是替换身份。

请逐项提交可见证据，不要提交顶层 pass、fail、unknown、status 或 failedChecks：
- subject_single_human：主角照片是否只有一位清晰人类主体。
- reference_single_human：五个参考帧是否只有一位持续可识别的主要人类主体。
- subject_not_occluded：主角照片的必要身体区域是否清楚且未被严重遮挡。
- framing_compatible：参考帧需要的可见身体区域是否都在主角照片或其下半区域放大中完整可见。

每个 id 必须恰好提交一次。passed 只表示该项是否通过，reason 只写直接可见事实，不要在 reason 中另写总结果。`;

interface CompatibilityEvidence {
  readonly checks: Array<{
    readonly id: CompatibilityCheckId;
    readonly passed: boolean;
    readonly reason: string;
  }>;
}

function parseCompatibilityEvidence(text: string): VideoQualityResult {
  try {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start < 0 || end <= start) return unknownResult('素材兼容性证据无法解析');
    const value = JSON.parse(text.slice(start, end + 1)) as { checks?: unknown };
    if (!Array.isArray(value.checks) || value.checks.length !== COMPATIBILITY_CHECK_IDS.length) {
      return unknownResult('素材兼容性证据不完整');
    }

    const checks: CompatibilityEvidence['checks'] = [];
    const seen = new Set<CompatibilityCheckId>();
    for (const item of value.checks) {
      if (!item || typeof item !== 'object') {
        return unknownResult('素材兼容性证据无效');
      }
      const check = item as { id?: unknown; passed?: unknown; reason?: unknown };
      if (
        typeof check.id !== 'string' ||
        !COMPATIBILITY_CHECK_IDS.includes(check.id as CompatibilityCheckId) ||
        seen.has(check.id as CompatibilityCheckId) ||
        typeof check.passed !== 'boolean' ||
        typeof check.reason !== 'string' ||
        !check.reason.trim()
      ) {
        return unknownResult('素材兼容性证据无效');
      }
      const id = check.id as CompatibilityCheckId;
      seen.add(id);
      checks.push({
        id,
        passed: check.passed,
        reason: check.reason.trim(),
      });
    }

    const failures = checks.filter((check) => !check.passed);
    if (failures.length === 0) {
      return {
        status: 'pass',
        failedChecks: [],
        reason: '素材兼容性检查通过',
      };
    }
    return {
      status: 'fail',
      failedChecks: failures.map((check) => COMPATIBILITY_FAILURES[check.id].code),
      reason: failures
        .map(
          (check) => `${COMPATIBILITY_FAILURES[check.id].label}：${check.reason}`,
        )
        .join('；'),
    };
  } catch {
    return unknownResult('素材兼容性证据无法解析');
  }
}

async function createCloneSubjectBodyDetail(buffer: Buffer): Promise<Buffer> {
  const source = sharp(buffer, { failOn: 'warning' });
  const metadata = await source.metadata();
  if (!metadata.width || !metadata.height) {
    throw new Error('subject image dimensions unavailable');
  }
  const top = Math.floor(metadata.height * 0.28);
  return source
    .extract({
      left: 0,
      top,
      width: metadata.width,
      height: metadata.height - top,
    })
    .jpeg({ quality: 88, mozjpeg: true })
    .toBuffer();
}

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

  const subjectBuffer = Buffer.from(input.subjectImage.data, 'base64');
  const [subject, subjectBodyDetail] = await Promise.all([
    normalizeImage(subjectBuffer)
      .then((buffer) => ({
        data: buffer.toString('base64'),
        mediaType: 'image/jpeg' as const,
        label: input.subjectImage.label,
      }))
      .catch(() => null),
    (deps.createSubjectBodyDetail ?? createCloneSubjectBodyDetail)(subjectBuffer)
      .then(normalizeImage)
      .then((buffer) => ({
        data: buffer.toString('base64'),
        mediaType: 'image/jpeg' as const,
        label: '主角照片下半区域放大',
      }))
      .catch(() => null),
  ]);
  if (!subject || !subjectBodyDetail) return unknownResult('无法读取主角照片');

  let lastResult = unknownResult('素材兼容性检查未得出结论');
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      lastResult = parseCompatibilityEvidence(
        await deps.analyzeFrames({
          references: [subject, subjectBodyDetail],
          frames,
          prompt: COMPATIBILITY_PROMPT,
          outputMode: 'clone_compatibility_evidence',
        }),
      );
      if (lastResult.status !== 'unknown') return lastResult;
    } catch {
      return unknownResult('素材兼容性检查服务暂时不可用');
    }
  }
  return lastResult;
}
