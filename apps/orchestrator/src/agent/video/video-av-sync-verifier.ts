import path from 'node:path';
import type { FfmpegExecOpts } from './ffmpeg-exec.js';
import { runFfmpeg } from './ffmpeg-exec.js';
import { fetchWithTimeout } from './video-http.js';

const DEFAULT_BASE_URL = 'https://generativelanguage.googleapis.com';
const DEFAULT_MODEL = 'gemini-3.6-flash';
const DEFAULT_TIMEOUT_MS = 90_000;
const MAX_PROXY_BYTES = 20 * 1024 * 1024;

export interface VideoAvSyncEvidence {
  readonly startSeconds: number;
  readonly endSeconds: number;
  readonly observation: string;
}

export interface VideoAvSyncReview {
  readonly status: 'pass' | 'fail' | 'unknown';
  readonly reason: string;
  readonly evidence: VideoAvSyncEvidence[];
  readonly model: string;
}

export interface VideoAvSyncAudit {
  readonly model: string;
  readonly evidence: Array<{
    readonly startSeconds: number;
    readonly endSeconds: number;
  }>;
}

export interface VerifyAudioVisualSyncInput {
  readonly videoPath: string;
  readonly workdir: string;
  readonly durationMs: number;
  readonly apiKey: string;
  readonly baseUrl?: string;
  readonly model?: string;
  readonly ffmpegBin?: string;
}

export interface VideoAvSyncVerifierDeps {
  readonly runFfmpeg: (
    command: { bin: string; args: readonly string[] },
    opts?: FfmpegExecOpts,
  ) => Promise<void>;
  readonly readFile: (path: string) => Promise<Buffer>;
  readonly fetchImpl?: typeof fetch;
}

type ReviewPayload = {
  status?: unknown;
  reason?: unknown;
  evidence?: unknown;
};

function unknownReview(model: string, reason: string): VideoAvSyncReview {
  return { status: 'unknown', reason, evidence: [], model };
}

function parseEvidence(value: unknown, durationSeconds: number): VideoAvSyncEvidence[] {
  if (!Array.isArray(value)) return [];
  const evidence: VideoAvSyncEvidence[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const record = item as Record<string, unknown>;
    const startSeconds = Number(record.startSeconds);
    const endSeconds = Number(record.endSeconds);
    const observation = typeof record.observation === 'string' ? record.observation.trim() : '';
    if (
      !Number.isFinite(startSeconds) ||
      !Number.isFinite(endSeconds) ||
      startSeconds < 0 ||
      endSeconds <= startSeconds ||
      endSeconds > durationSeconds + 1 ||
      !observation
    ) {
      continue;
    }
    evidence.push({ startSeconds, endSeconds, observation });
  }
  return evidence.slice(0, 8);
}

function independentEvidence(evidence: VideoAvSyncEvidence[]): VideoAvSyncEvidence[] {
  const ordered = [...evidence].sort(
    (left, right) => left.startSeconds - right.startSeconds || left.endSeconds - right.endSeconds,
  );
  for (let index = 1; index < ordered.length; index += 1) {
    const previous = ordered[index - 1];
    const current = ordered[index];
    if (!previous || !current || current.startSeconds < previous.endSeconds) return [];
  }
  return ordered;
}

export function videoAvSyncAudit(review: VideoAvSyncReview): VideoAvSyncAudit | undefined {
  if (review.status !== 'pass' || review.evidence.length === 0) return undefined;
  return {
    model: review.model,
    evidence: review.evidence.map(({ startSeconds, endSeconds }) => ({
      startSeconds,
      endSeconds,
    })),
  };
}

export function videoAvSyncLogContext(review: VideoAvSyncReview): {
  status: VideoAvSyncReview['status'];
  model: string;
  evidenceWindows: VideoAvSyncAudit['evidence'];
} {
  return {
    status: review.status,
    model: review.model,
    evidenceWindows: review.evidence.map(({ startSeconds, endSeconds }) => ({
      startSeconds,
      endSeconds,
    })),
  };
}

function parseReview(text: string, model: string, durationMs: number): VideoAvSyncReview {
  let payload: ReviewPayload;
  try {
    payload = JSON.parse(text) as ReviewPayload;
  } catch {
    return unknownReview(model, '音画同步复核返回了无法解析的结果。');
  }
  const status =
    payload.status === 'pass' || payload.status === 'fail' || payload.status === 'unknown'
      ? payload.status
      : 'unknown';
  const reason = typeof payload.reason === 'string' ? payload.reason.trim() : '';
  const evidence = independentEvidence(parseEvidence(payload.evidence, durationMs / 1000));
  const minimumPassEvidence = durationMs >= 4_000 ? 2 : 1;
  if (status === 'pass' && (evidence.length < minimumPassEvidence || !reason)) {
    return unknownReview(model, '音画同步复核证据不足，不能确认通过。');
  }
  if (status === 'fail' && (evidence.length < 1 || !reason)) {
    return unknownReview(model, '音画同步复核没有提供足够的失败证据。');
  }
  if (status === 'unknown') {
    return { status, reason: reason || '画面或声音不足以判断音画同步。', evidence, model };
  }
  return { status, reason, evidence, model };
}

function reviewPrompt(): string {
  return [
    '你是独立于视频生成供应商的音画同步质检员。',
    '请同时检查视频中的声音与可见说话人物嘴部运动，只判断音画同步，不判断审美。',
    '通过标准：4 秒及以上视频要在至少两个不同且不重叠的口播时间窗内观察到同步；更短视频至少一个时间窗。',
    '失败标准：存在持续可观察的领先或滞后、说话时嘴部冻结、无声时持续说话，或声音与说话人物明显不对应。',
    '无法判断：人物嘴部不可见、没有连续口播、分辨率不足、遮挡严重或证据不足。',
    '不得因为供应商处理成功、存在音轨、存在字幕或单张画面正常就判定通过。',
    'evidence 必须给出直接观察到的时间窗；没有足够时间证据必须返回 unknown。',
  ].join('\n');
}

function responseSchema(): Record<string, unknown> {
  return {
    type: 'OBJECT',
    properties: {
      status: { type: 'STRING', enum: ['pass', 'fail', 'unknown'] },
      reason: { type: 'STRING' },
      evidence: {
        type: 'ARRAY',
        items: {
          type: 'OBJECT',
          properties: {
            startSeconds: { type: 'NUMBER' },
            endSeconds: { type: 'NUMBER' },
            observation: { type: 'STRING' },
          },
          required: ['startSeconds', 'endSeconds', 'observation'],
        },
      },
    },
    required: ['status', 'reason', 'evidence'],
  };
}

function responseText(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null;
  const candidates = (payload as { candidates?: unknown }).candidates;
  if (!Array.isArray(candidates)) return null;
  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== 'object') continue;
    const parts = (candidate as { content?: { parts?: unknown } }).content?.parts;
    if (!Array.isArray(parts)) continue;
    for (const part of parts) {
      if (
        part &&
        typeof part === 'object' &&
        typeof (part as { text?: unknown }).text === 'string'
      ) {
        return (part as { text: string }).text;
      }
    }
  }
  return null;
}

export async function verifyAudioVisualSync(
  input: VerifyAudioVisualSyncInput,
  deps: VideoAvSyncVerifierDeps = {
    runFfmpeg,
    readFile: async (filePath) => {
      const { promises: fs } = await import('node:fs');
      return fs.readFile(filePath);
    },
  },
): Promise<VideoAvSyncReview> {
  const model = input.model ?? DEFAULT_MODEL;
  if (!input.apiKey.trim()) {
    return unknownReview(model, '音画同步复核服务未配置。');
  }
  const proxyPath = path.join(input.workdir, 'av-sync-review.mp4');
  try {
    await deps.runFfmpeg(
      {
        bin: input.ffmpegBin ?? 'ffmpeg',
        args: [
          '-y',
          '-i',
          input.videoPath,
          '-map',
          '0:v:0',
          '-map',
          '0:a:0',
          '-vf',
          'scale=640:-2:force_original_aspect_ratio=decrease,fps=10',
          '-c:v',
          'libx264',
          '-preset',
          'fast',
          '-crf',
          '30',
          '-pix_fmt',
          'yuv420p',
          '-c:a',
          'aac',
          '-b:a',
          '64k',
          '-movflags',
          '+faststart',
          proxyPath,
        ],
      },
      input.ffmpegBin ? { ffmpegBin: input.ffmpegBin } : {},
    );
    const proxy = await deps.readFile(proxyPath);
    if (proxy.length === 0 || proxy.length > MAX_PROXY_BYTES) {
      return unknownReview(model, '音画同步复核代理文件大小不符合要求。');
    }
    const requestBody = {
      contents: [
        {
          role: 'user',
          parts: [
            {
              inlineData: { mimeType: 'video/mp4', data: proxy.toString('base64') },
              videoMetadata: { fps: 5 },
            },
            { text: reviewPrompt() },
          ],
        },
      ],
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: responseSchema(),
      },
    };
    const url = `${(input.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '')}/v1beta/models/${encodeURIComponent(model)}:generateContent`;
    const fetchImpl = deps.fetchImpl ?? fetch;
    const response = await fetchWithTimeout(
      url,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-goog-api-key': input.apiKey,
        },
        body: JSON.stringify(requestBody),
      },
      { timeoutMs: DEFAULT_TIMEOUT_MS, fetchImpl },
    );
    if (!response.ok) {
      return unknownReview(model, `音画同步复核服务暂不可用（${response.status}）。`);
    }
    const text = responseText(await response.json());
    return text
      ? parseReview(text, model, input.durationMs)
      : unknownReview(model, '音画同步复核没有返回结构化结论。');
  } catch {
    return unknownReview(model, '音画同步复核执行失败。');
  }
}
