import type Anthropic from '@anthropic-ai/sdk';
import sharp from 'sharp';
import type { FfmpegExecOpts } from './ffmpeg-exec.js';

const QUALITY_MODEL = 'claude-sonnet-4-6';
const QUALITY_VERDICT_TOOL_NAME = 'submit_video_quality_verdict';
const QUALITY_VERDICT_TOOL: Anthropic.Tool = {
  name: QUALITY_VERDICT_TOOL_NAME,
  description: 'Submit the final structured quality verdict for the sampled video frames.',
  input_schema: {
    type: 'object',
    properties: {
      status: {
        type: 'string',
        enum: ['pass', 'fail', 'unknown'],
      },
      failedChecks: {
        type: 'array',
        items: { type: 'string' },
      },
      reason: {
        type: 'string',
      },
    },
    required: ['status', 'failedChecks', 'reason'],
    additionalProperties: false,
  },
};
const REQUIRED_ACTION_EVIDENCE_TOOL_NAME = 'submit_required_action_evidence';
const REQUIRED_ACTION_IDS = ['enter_frame', 'lift', 'pause', 'return', 'exit_frame'] as const;
type RequiredActionId = (typeof REQUIRED_ACTION_IDS)[number];
const REQUIRED_ACTION_EVIDENCE_TOOL: Anthropic.Tool = {
  name: REQUIRED_ACTION_EVIDENCE_TOOL_NAME,
  description:
    'Submit direct sampled-frame evidence for each explicitly requested action without a top-level verdict.',
  input_schema: {
    type: 'object',
    properties: {
      checks: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: {
              type: 'string',
              enum: [...REQUIRED_ACTION_IDS],
            },
            observed: {
              type: 'boolean',
            },
            evidenceFrameSeconds: {
              type: 'array',
              items: { type: 'number' },
            },
            reason: {
              type: 'string',
            },
          },
          required: ['id', 'observed', 'evidenceFrameSeconds', 'reason'],
          additionalProperties: false,
        },
      },
      reason: {
        type: 'string',
      },
    },
    required: ['checks', 'reason'],
    additionalProperties: false,
  },
};
const SAMPLE_RATIOS = [0.05, 0.15, 0.25, 0.375, 0.5, 0.625, 0.75, 0.85, 0.95] as const;
const REFERENCE_SAMPLE_RATIOS = [0.1, 0.3, 0.5, 0.7, 0.9] as const;
const VIDEO_QUALITY_MAX_SOURCE_IMAGE_BYTES = 12 * 1024 * 1024;
export const VIDEO_QUALITY_MAX_IMAGE_BYTES = 1_500_000;
export const VIDEO_QUALITY_MAX_TOTAL_IMAGE_BYTES = 12 * 1024 * 1024;
export const VIDEO_QUALITY_MAX_EDGE = 1568;

export type VideoQualityImageMediaType = 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';

export interface VideoQualityReferenceImage {
  readonly data: string;
  readonly mediaType: VideoQualityImageMediaType;
  readonly label: string;
}

export interface VideoQualityReferenceVideo {
  readonly videoPath: string;
  readonly durationMs: number;
  readonly label: string;
}

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
  readonly references: VideoQualityReferenceImage[];
  readonly frames: Array<{
    readonly data: string;
    readonly mediaType: 'image/jpeg';
    readonly timestampSeconds: number;
  }>;
  readonly prompt: string;
  readonly outputMode?: 'quality_verdict' | 'required_action_evidence';
}

export type VideoQualityAnalyzer = (input: VideoQualityAnalysisInput) => Promise<string>;

export interface VerifyFinalVideoQualityInput {
  readonly videoPath: string;
  readonly workdir: string;
  readonly durationMs: number;
  /** Minimum deliverable duration selected or quoted for this artifact. */
  readonly minimumDurationMs?: number;
  /** Run an independent fail-closed audit for visibly required action states. */
  readonly strictRequiredActions?: boolean;
  readonly userText: string;
  /** Lane-specific invariants visible in sampled frames, such as identity and scene. */
  readonly qualityContext?: string;
  readonly referenceImages?: VideoQualityReferenceImage[];
  readonly referenceVideos?: VideoQualityReferenceVideo[];
  readonly expectedSubtitleText: string[];
  readonly requiredBrandTexts: readonly string[];
  readonly brandPolicy: string;
  readonly ffmpegBin?: string;
}

export interface VideoQualityVerifierDeps {
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

function detectImageMediaType(buffer: Buffer): VideoQualityImageMediaType | null {
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg';
  }
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
    return 'image/png';
  }
  if (buffer.subarray(0, 3).toString('ascii') === 'GIF') {
    return 'image/gif';
  }
  if (
    buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return 'image/webp';
  }
  return null;
}

function normalizeDeclaredImageMediaType(contentType?: string): VideoQualityImageMediaType | null {
  const value = contentType?.toLowerCase().split(';', 1)[0]?.trim();
  if (value === 'image/jpeg' || value === 'image/jpg') return 'image/jpeg';
  if (value === 'image/png') return 'image/png';
  if (value === 'image/gif') return 'image/gif';
  if (value === 'image/webp') return 'image/webp';
  return null;
}

export async function normalizeVideoQualityImage(buffer: Buffer): Promise<Buffer> {
  if (buffer.length === 0 || buffer.length > VIDEO_QUALITY_MAX_SOURCE_IMAGE_BYTES) {
    throw new Error('quality-reference image exceeds source byte limit');
  }
  const source = sharp(buffer, { failOn: 'warning' })
    .rotate()
    .resize({
      width: VIDEO_QUALITY_MAX_EDGE,
      height: VIDEO_QUALITY_MAX_EDGE,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .flatten({ background: '#ffffff' });
  for (const quality of [82, 72, 62, 52]) {
    const output = await source.clone().jpeg({ quality, mozjpeg: true }).toBuffer();
    if (output.length <= VIDEO_QUALITY_MAX_IMAGE_BYTES) return output;
  }
  throw new Error('quality-reference image exceeds normalized byte limit');
}

export async function prepareVideoQualityReferenceImage(input: {
  buffer: Buffer;
  contentType?: string;
  label: string;
}): Promise<VideoQualityReferenceImage> {
  const declaredType = normalizeDeclaredImageMediaType(input.contentType);
  const mediaType = declaredType ?? detectImageMediaType(input.buffer);
  if (!mediaType) throw new Error('unsupported quality-reference image type');
  const normalized = await normalizeVideoQualityImage(input.buffer);
  return {
    data: normalized.toString('base64'),
    mediaType: 'image/jpeg',
    label: input.label,
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
    if (value.status !== 'pass' && value.status !== 'fail' && value.status !== 'unknown') {
      return unknownResult('质检返回状态无效');
    }
    let failedChecks = Array.isArray(value.failedChecks)
      ? value.failedChecks.filter((item): item is string => typeof item === 'string')
      : [];
    const reason =
      typeof value.reason === 'string' && value.reason.trim()
        ? value.reason.trim()
        : value.status === 'pass'
          ? '成片质检通过'
          : value.status === 'fail'
            ? '成片质检未通过'
            : '成片质检未得出结论';
    if (value.status === 'pass' && failedChecks.length > 0) {
      return unknownResult('质检结论与检查项冲突');
    }
    if (value.status === 'unknown' && failedChecks.length === 0) {
      failedChecks = ['verifier_inconclusive'];
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
  const requiredBrands =
    input.requiredBrandTexts.length > 0 ? input.requiredBrandTexts.join('；') : '无';
  return [
    '你是生成视频的成片质量审核器。待验收内容是从最终视频按时间顺序抽取的九张静态抽样帧。',
    `用户原始需求：${input.userText}`,
    `任务链路约束：${input.qualityContext?.trim() || '无额外约束'}`,
    input.referenceImages?.length || input.referenceVideos?.length
      ? '已提供源素材。必须先比较参考素材与待验收成片在相同进度附近的抽样帧，再判断可见的主体身份、外观、粗粒度姿态和场景是否一致。'
      : '未提供源素材时，只能判断成片内部的跨帧稳定性，不得声称已经验证源素材一致性。',
    '证据边界：静态抽样帧不能验证连续运动是否顺滑、动作节奏是否精确，也不能验证音频与口型同步；不得把这些未验证项作为通过依据。只能对抽样帧里实际可见的问题作结论。',
    '',
    '任何一项命中都必须 status=fail：',
    '1. 人体或手部异常：多指、少指、融合手、手指粘连、额外的手/手臂、断肢、悬浮肢体、异常关节、肢体来源不可能。',
    '   自然抓握、侧面角度、手指交叠或被杯柄/物体合理遮挡时，不要求五根手指在同一帧全部展开可见，也不得仅据此无法逐根计数就 fail。',
    '   应综合可见轮廓、掌指连接、关节方向、遮挡关系和跨帧连续性判断。只有看到明确生成异常，例如额外或缺失手指的可见证据、指根或边界无合理分离、手指与物体融合、数量矛盾、异常关节或不可能的遮挡关系，才必须 fail。',
    '   若可见区域呈现疑似生成瑕疵但抽样帧不足以确认，使用 hand_anatomy_uncertain；自然遮挡本身不是生成瑕疵。',
    '2. 用户原始需求没有人物或手部动作，但静物任务出现人物或手、有人拿起/触碰/操作主体。',
    '3. 主体、动作、数量、颜色、构图或场景明显偏离用户需求；主体跨帧身份或形态明显漂移。',
    '   若用户要求进入、拿起、移动、放回等分阶段动作，必须按九张帧的时间顺序核对每个关键结果状态。任何要求的阶段在全部抽样帧中都没有可见证据，必须 fail，并使用 required_action_missing；不得假设它发生在帧与帧之间。',
    '4. 用户指定或输入参数明确列为允许的文字、品牌或 Logo 没有逐字准确呈现，或画面中出现乱码、错字、不可读/错误品牌标识；允许范围之外又不符合其它文字与品牌规则的文字或品牌；字幕或品牌文字被裁切、严重遮挡、明显拼错。预期字幕和必须出现的品牌属于已允许内容，不能仅因它没有写在用户原始需求中而判失败。',
    '5. 抽样帧中实际可见的物体融化、穿模、突然消失、跨帧形态跳变或其它足以让用户拒收的画面瑕疵；不得仅凭静态帧判定运动流畅度、节奏或音画同步。',
    '',
    `必须逐字准确出现的品牌标识：${requiredBrands}`,
    `其它文字与品牌规则：${input.brandPolicy}`,
    '预期字幕文本（不同时间帧只需出现对应句，不要求每帧同时出现）：',
    subtitles,
    '只核对抽样帧中实际出现的对应字幕；某句未出现在这九张抽样帧时，不得仅据此判定缺失。',
    '',
    '不要因为整体风格好看而放过局部异常。status=unknown 只用于帧损坏、帧缺失或分析服务无法读取等技术原因；存在可见异常迹象但无法定性时不得返回 unknown，这类质量不确定性必须 fail closed。单纯的自然遮挡不属于异常迹象。',
    '只输出 JSON：',
    '{"status":"pass|fail|unknown","failedChecks":["snake_case_code"],"reason":"一句中文结论"}',
  ].join('\n');
}

const ENTER_FRAME_ACTION_RE =
  /(?:进入画面|伸入画面|从画面.+进入|enter(?:s|ing)? (?:the )?frame|come(?:s|ing)? into (?:the )?frame)/iu;
const LIFT_ACTION_RE =
  /(?:拿起|提起|端起|举起|抬起|离开桌面|离开支撑面|pick(?:s|ing)? up|lift(?:s|ing)?|raise(?:s|d|ing)?)/iu;
const PAUSE_ACTION_RE =
  /(?:停顿|停留|悬停|保持.+(?:秒|片刻)|pause(?:s|d|ing)?|hold(?:s|ing)? (?:it )?(?:still|up|for))/iu;
const RETURN_ACTION_RE =
  /(?:放回|放下|归位|回到原位|put(?:s|ting)? (?:it )?back|set(?:s|ting)? (?:it )?down|return(?:s|ed|ing)? .+ (?:table|support|place))/iu;
const EXIT_FRAME_ACTION_RE =
  /(?:离开画面|退出画面|移出画面|手离开|手臂离开|(?:并|再|随后)离开(?:画面)?|leave(?:s|ing)? (?:the )?frame|exit(?:s|ing)? (?:the )?frame|withdraw(?:s|n|ing)?)/iu;

interface RequiredActionCheck {
  readonly id: RequiredActionId;
  readonly label: string;
  readonly requirement: string;
}

interface RequiredActionEvidence {
  readonly checks: Array<{
    readonly id: RequiredActionId;
    readonly observed: boolean;
    readonly evidenceFrameSeconds: number[];
    readonly reason: string;
  }>;
  readonly reason: string;
}

function getRequiredActionChecks(input: VerifyFinalVideoQualityInput): RequiredActionCheck[] {
  const checks: RequiredActionCheck[] = [];
  if (ENTER_FRAME_ACTION_RE.test(input.userText)) {
    checks.push({
      id: 'enter_frame',
      label: '进入画面',
      requirement:
        '前段应先看不到用户指定的动作主体，随后抽样帧必须清楚看到同一主体从指定方向进入。',
    });
  }
  if (LIFT_ACTION_RE.test(input.userText)) {
    checks.push({
      id: 'lift',
      label: '拿起/提起',
      requirement:
        '至少一个接触后的抽样帧必须清楚看到主体底部离开桌面或原支撑面，出现明确悬空、可见间隙或明显垂直位移。',
    });
  }
  if (PAUSE_ACTION_RE.test(input.userText)) {
    checks.push({
      id: 'pause',
      label: '停顿/停留',
      requirement:
        '必须先有明确拿起证据，再由一个或多个后续抽样帧显示主体保持在离开支撑面的状态；只在桌面上停着不算。',
    });
  }
  if (RETURN_ACTION_RE.test(input.userText)) {
    checks.push({
      id: 'return',
      label: '放回/放下',
      requirement:
        '必须在明确拿起之后，后段抽样帧重新看到同一主体接触原支撑面；没有拿起证据时不得声称已经放回。',
    });
  }
  if (EXIT_FRAME_ACTION_RE.test(input.userText)) {
    checks.push({
      id: 'exit_frame',
      label: '离开画面',
      requirement:
        '时间点约为视频时长 95% 的末段抽样帧中，用户指定的动作主体必须已经离场；仍抓握、接触或停留时不得判定完成。',
    });
  }
  return checks;
}

function buildStrictRequiredActionPrompt(
  input: VerifyFinalVideoQualityInput,
  checks: readonly RequiredActionCheck[],
): string {
  return [
    '这是第二次独立动作证据复核。只审核用户明确要求的动作阶段是否在九张按时间排序的抽样帧中有清楚、直接、可复核的视觉证据。',
    `用户原始需求：${input.userText}`,
    '本任务需要逐项复核：',
    ...checks.map(
      (check, index) => `${index + 1}. ${check.id}（${check.label}）：${check.requirement}`,
    ),
    '',
    '判定红线：',
    '- 手接触主体、握住把手或遮挡主体，但主体仍留在原支撑面上，不能算“拿起”。',
    '- 不得根据动作意图、相邻帧姿势或“可能发生在抽样帧之间”来脑补缺失阶段。',
    '- 必须严格按上方清单逐项返回，每个 id 恰好一次，不得漏项、重复或增加其它 id。',
    '- observed=true 时必须从图片标签逐字抄录至少一个对应的时间秒数到 evidenceFrameSeconds；没有直接证据必须 observed=false。',
    '- 不要提交 pass、fail、unknown 或 failedChecks。最终结论由程序根据逐项证据确定。',
    '',
    '只输出 JSON：',
    '{"checks":[{"id":"lift","observed":true,"evidenceFrameSeconds":[2.250],"reason":"杯底与桌面之间有清楚间隙"}],"reason":"一句中文整体说明"}',
  ].join('\n');
}

function shouldRunStrictRequiredActionAudit(input: VerifyFinalVideoQualityInput): boolean {
  return Boolean(input.strictRequiredActions && getRequiredActionChecks(input).length > 0);
}

function parseRequiredActionEvidenceResponse(text: string): RequiredActionEvidence | null {
  try {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start < 0 || end <= start) return null;
    const value = JSON.parse(text.slice(start, end + 1)) as {
      checks?: unknown;
      reason?: unknown;
    };
    if (!Array.isArray(value.checks) || typeof value.reason !== 'string') return null;
    const seen = new Set<RequiredActionId>();
    const checks: RequiredActionEvidence['checks'] = [];
    for (const item of value.checks) {
      if (!item || typeof item !== 'object') return null;
      const check = item as {
        id?: unknown;
        observed?: unknown;
        evidenceFrameSeconds?: unknown;
        reason?: unknown;
      };
      if (
        typeof check.id !== 'string' ||
        !REQUIRED_ACTION_IDS.includes(check.id as RequiredActionId) ||
        seen.has(check.id as RequiredActionId) ||
        typeof check.observed !== 'boolean' ||
        !Array.isArray(check.evidenceFrameSeconds) ||
        !check.evidenceFrameSeconds.every(
          (timestamp) =>
            typeof timestamp === 'number' && Number.isFinite(timestamp) && timestamp >= 0,
        ) ||
        typeof check.reason !== 'string' ||
        !check.reason.trim()
      ) {
        return null;
      }
      const id = check.id as RequiredActionId;
      seen.add(id);
      checks.push({
        id,
        observed: check.observed,
        evidenceFrameSeconds: check.evidenceFrameSeconds as number[],
        reason: check.reason.trim(),
      });
    }
    return {
      checks,
      reason: value.reason.trim(),
    };
  } catch {
    return null;
  }
}

function aggregateRequiredActionEvidence(input: {
  expectedChecks: readonly RequiredActionCheck[];
  evidence: RequiredActionEvidence;
  sampledFrameSeconds: readonly number[];
}): VideoQualityResult {
  const evidenceById = new Map(input.evidence.checks.map((check) => [check.id, check]));
  const failures: Array<{ check: RequiredActionCheck; reason: string }> = [];
  for (const expected of input.expectedChecks) {
    const evidence = evidenceById.get(expected.id);
    if (!evidence) {
      failures.push({
        check: expected,
        reason: '质检未提交该动作的直接证据',
      });
      continue;
    }
    const hasSampledFrameEvidence = evidence.evidenceFrameSeconds.some((timestamp) =>
      input.sampledFrameSeconds.some((sampled) => Math.abs(sampled - timestamp) <= 0.01),
    );
    if (!evidence.observed) {
      failures.push({ check: expected, reason: evidence.reason });
    } else if (!hasSampledFrameEvidence) {
      failures.push({
        check: expected,
        reason: '未引用任何实际抽样帧作为直接证据',
      });
    }
  }
  if (failures.length > 0) {
    return {
      status: 'fail',
      failedChecks: failures.map(({ check }) => `required_action_missing_${check.id}`),
      reason: failures.map(({ check, reason }) => `${check.label}：${reason}`).join('；'),
    };
  }
  return {
    status: 'pass',
    failedChecks: [],
    reason: `动作证据复核通过：${input.expectedChecks.map((check) => check.label).join('、')}`,
  };
}

export function createAnthropicVideoQualityAnalyzer(client: Anthropic): VideoQualityAnalyzer {
  return async (input) => {
    const outputMode = input.outputMode ?? 'quality_verdict';
    const selectedTool =
      outputMode === 'required_action_evidence'
        ? REQUIRED_ACTION_EVIDENCE_TOOL
        : QUALITY_VERDICT_TOOL;
    const referenceContent = input.references.flatMap((reference) => [
      { type: 'text' as const, text: `参考素材：${reference.label}` },
      {
        type: 'image' as const,
        source: {
          type: 'base64' as const,
          media_type: reference.mediaType,
          data: reference.data,
        },
      },
    ]);
    const frameContent = input.frames.flatMap((frame) => [
      {
        type: 'text' as const,
        text: `待验收成片抽样帧 · ${frame.timestampSeconds.toFixed(3)} 秒`,
      },
      {
        type: 'image' as const,
        source: {
          type: 'base64' as const,
          media_type: frame.mediaType,
          data: frame.data,
        },
      },
    ]);
    const content = [
      ...referenceContent,
      ...(input.references.length > 0
        ? [{ type: 'text' as const, text: '以下为待验收成片的九个时间点：' }]
        : []),
      ...frameContent,
      { type: 'text' as const, text: input.prompt },
    ];
    const response = await client.messages.create(
      {
        model: QUALITY_MODEL,
        max_tokens: outputMode === 'required_action_evidence' ? 768 : 512,
        tools: [selectedTool],
        tool_choice: { type: 'tool', name: selectedTool.name },
        messages: [{ role: 'user', content }],
      },
      {
        timeout: 45_000,
        maxRetries: 0,
      },
    );
    const block = response.content.find(
      (item): item is Anthropic.ToolUseBlock =>
        item.type === 'tool_use' && item.name === selectedTool.name,
    );
    return block ? JSON.stringify(block.input) : '';
  };
}

class VideoQualityImageBudgetError extends Error {}

export async function verifyFinalVideoQuality(
  input: VerifyFinalVideoQualityInput,
  deps: VideoQualityVerifierDeps,
): Promise<VideoQualityResult> {
  if (input.minimumDurationMs !== undefined) {
    const toleranceMs = Math.max(250, input.minimumDurationMs * 0.05);
    if (input.durationMs < input.minimumDurationMs - toleranceMs) {
      return {
        status: 'fail',
        failedChecks: ['duration_too_short'],
        reason:
          `成片时长 ${(input.durationMs / 1000).toFixed(2)} 秒，` +
          `短于要求的 ${(input.minimumDurationMs / 1000).toFixed(2)} 秒`,
      };
    }
  }
  const normalizeImage = deps.normalizeImage ?? normalizeVideoQualityImage;
  let totalImageBytes = 0;
  const prepareForAnalysis = async (buffer: Buffer): Promise<Buffer> => {
    if (buffer.length === 0 || buffer.length > VIDEO_QUALITY_MAX_SOURCE_IMAGE_BYTES) {
      throw new VideoQualityImageBudgetError('quality image exceeds source byte budget');
    }
    const normalized = await normalizeImage(buffer);
    if (normalized.length === 0 || normalized.length > VIDEO_QUALITY_MAX_IMAGE_BYTES) {
      throw new VideoQualityImageBudgetError('quality image exceeds per-image request budget');
    }
    totalImageBytes += normalized.length;
    if (totalImageBytes > VIDEO_QUALITY_MAX_TOTAL_IMAGE_BYTES) {
      throw new VideoQualityImageBudgetError('quality images exceed total request budget');
    }
    return normalized;
  };

  const references: VideoQualityReferenceImage[] = [];
  try {
    for (const reference of input.referenceImages ?? []) {
      const normalized = await prepareForAnalysis(Buffer.from(reference.data, 'base64'));
      references.push({
        data: normalized.toString('base64'),
        mediaType: 'image/jpeg',
        label: reference.label,
      });
    }
    for (const [videoIndex, reference] of (input.referenceVideos ?? []).entries()) {
      const durationSeconds = Math.max(0.2, reference.durationMs / 1000);
      for (const [sampleIndex, ratio] of REFERENCE_SAMPLE_RATIOS.entries()) {
        const timestampSeconds = Number((durationSeconds * ratio).toFixed(3));
        const framePath = `${input.workdir}/quality-reference-${videoIndex + 1}-${sampleIndex + 1}.jpg`;
        await deps.runFfmpeg(
          {
            bin: input.ffmpegBin ?? 'ffmpeg',
            args: [
              '-y',
              '-ss',
              timestampSeconds.toFixed(3),
              '-i',
              reference.videoPath,
              '-frames:v',
              '1',
              '-q:v',
              '3',
              framePath,
            ],
          },
          input.ffmpegBin ? { ffmpegBin: input.ffmpegBin } : undefined,
        );
        const normalized = await prepareForAnalysis(await deps.readFile(framePath));
        references.push({
          data: normalized.toString('base64'),
          mediaType: 'image/jpeg',
          label: `${reference.label} · ${Math.round(ratio * 100)}%`,
        });
      }
    }
  } catch (err) {
    if (err instanceof VideoQualityImageBudgetError) {
      return unknownResult('质检图片超过安全请求预算');
    }
    return unknownResult('无法抽取源素材质检帧');
  }

  const commands = buildVideoQualityFrameCommands(input);
  const frames: VideoQualityAnalysisInput['frames'] = [];
  try {
    for (const item of commands) {
      await deps.runFfmpeg(
        item.command,
        input.ffmpegBin ? { ffmpegBin: input.ffmpegBin } : undefined,
      );
      const frame = await prepareForAnalysis(await deps.readFile(item.framePath));
      frames.push({
        data: frame.toString('base64'),
        mediaType: 'image/jpeg',
        timestampSeconds: item.timestampSeconds,
      });
    }
  } catch (err) {
    if (err instanceof VideoQualityImageBudgetError) {
      return unknownResult('质检图片超过安全请求预算');
    }
    return unknownResult('无法抽取成片质检帧');
  }

  const analyzeWithRetry = async (prompt: string): Promise<VideoQualityResult> => {
    let lastResult = unknownResult('成片质检未得出结论');
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        lastResult = parseVideoQualityResponse(
          await deps.analyzeFrames({ references, frames, prompt }),
        );
        if (lastResult.status !== 'unknown') return lastResult;
      } catch {
        lastResult = unknownResult('成片质检服务暂时不可用');
      }
    }
    return lastResult;
  };

  const primaryResult = await analyzeWithRetry(buildQualityPrompt(input));
  if (primaryResult.status !== 'pass' || !shouldRunStrictRequiredActionAudit(input)) {
    return primaryResult;
  }
  const requiredActionChecks = getRequiredActionChecks(input);
  let lastActionResult = unknownResult('动作证据质检返回无法解析');
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const evidence = parseRequiredActionEvidenceResponse(
        await deps.analyzeFrames({
          references,
          frames,
          prompt: buildStrictRequiredActionPrompt(input, requiredActionChecks),
          outputMode: 'required_action_evidence',
        }),
      );
      if (!evidence) {
        lastActionResult = unknownResult('动作证据质检返回无法解析');
        continue;
      }
      return aggregateRequiredActionEvidence({
        expectedChecks: requiredActionChecks,
        evidence,
        sampledFrameSeconds: frames.map((frame) => frame.timestampSeconds),
      });
    } catch {
      lastActionResult = unknownResult('动作证据质检服务暂时不可用');
    }
  }
  return lastActionResult;
}
