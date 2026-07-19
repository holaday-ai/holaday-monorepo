const DEFAULT_BASE_URL = 'https://dashscope-intl.aliyuncs.com';
const DEFAULT_MODEL = 'wan2.2-animate-mix';
const DEFAULT_POLL_INTERVAL_MS = 15_000;
const DEFAULT_MAX_WAIT_MS = 15 * 60_000;

export type WanAnimateMixMode = 'wan-std' | 'wan-pro';
export type WanAnimateMixErrorKind =
  | 'no_api_key'
  | 'invalid_input'
  | 'network'
  | 'http'
  | 'bad_response'
  | 'task_failed'
  | 'timeout';

export class WanAnimateMixError extends Error {
  readonly kind: WanAnimateMixErrorKind;
  readonly status?: number;
  readonly code?: string;

  constructor(message: string, kind: WanAnimateMixErrorKind, details: { status?: number; code?: string } = {}) {
    super(message);
    this.name = 'WanAnimateMixError';
    this.kind = kind;
    if (details.status !== undefined) this.status = details.status;
    if (details.code !== undefined) this.code = details.code;
  }
}

export interface GenerateWanAnimateMixParams {
  readonly apiKey: string;
  readonly baseUrl?: string;
  readonly workspaceId?: string;
  readonly model?: string;
  readonly imageUrl: string;
  readonly referenceVideoUrl: string;
  readonly mode: WanAnimateMixMode;
  readonly fetchImpl?: typeof fetch;
  readonly signal?: AbortSignal;
  readonly pollIntervalMs?: number;
  readonly maxWaitMs?: number;
}

export interface WanAnimateMixResult {
  readonly taskId: string;
  readonly videoUrl: string;
  readonly durationSeconds?: number;
  readonly mode: WanAnimateMixMode;
}

interface ProviderBody {
  output?: {
    task_id?: string;
    task_status?: string;
    results?: { video_url?: string };
    code?: string;
    message?: string;
  };
  usage?: {
    video_duration?: number;
    video_ratio?: string;
  };
  code?: string;
  message?: string;
}

function trimBaseUrl(value: string | undefined): string {
  return (value || DEFAULT_BASE_URL).replace(/\/+$/, '');
}

function headersFor(params: GenerateWanAnimateMixParams, asyncRequest = false): Record<string, string> {
  return {
    authorization: `Bearer ${params.apiKey}`,
    ...(asyncRequest ? { 'x-dashscope-async': 'enable', 'content-type': 'application/json' } : {}),
    ...(params.workspaceId ? { 'x-dashscope-workspace': params.workspaceId } : {}),
  };
}

async function readBody(response: Response): Promise<ProviderBody> {
  try {
    return (await response.json()) as ProviderBody;
  } catch {
    throw new WanAnimateMixError(`Wan Animate returned invalid JSON (HTTP ${response.status})`, 'bad_response', {
      status: response.status,
    });
  }
}

async function providerFetch(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit,
): Promise<{ response: Response; body: ProviderBody }> {
  let response: Response;
  try {
    response = await fetchImpl(url, init);
  } catch (error) {
    throw new WanAnimateMixError(
      `Wan Animate request failed: ${error instanceof Error ? error.message : String(error)}`,
      'network',
    );
  }
  const body = await readBody(response);
  if (!response.ok) {
    throw new WanAnimateMixError(
      body.message ?? body.output?.message ?? `Wan Animate request failed (HTTP ${response.status})`,
      'http',
      { status: response.status, code: body.code ?? body.output?.code },
    );
  }
  return { response, body };
}

function validate(params: GenerateWanAnimateMixParams): void {
  if (!params.apiKey) throw new WanAnimateMixError('DASHSCOPE_API_KEY not configured', 'no_api_key');
  if (!params.imageUrl || !params.referenceVideoUrl) {
    throw new WanAnimateMixError('Character image and reference video are required', 'invalid_input');
  }
}

/**
 * Run Wan 2.2 character swap as one paid async job. The provider preserves
 * the reference video's action, expression, environment, and audio while
 * replacing its main subject with the uploaded character image.
 */
export async function generateWanAnimateMix(params: GenerateWanAnimateMixParams): Promise<WanAnimateMixResult> {
  validate(params);
  const fetchImpl = params.fetchImpl ?? fetch;
  const baseUrl = trimBaseUrl(params.baseUrl);
  const createUrl = `${baseUrl}/api/v1/services/aigc/image2video/video-synthesis`;
  const { body: created } = await providerFetch(fetchImpl, createUrl, {
    method: 'POST',
    headers: headersFor(params, true),
    body: JSON.stringify({
      model: params.model ?? DEFAULT_MODEL,
      input: {
        image_url: params.imageUrl,
        video_url: params.referenceVideoUrl,
        watermark: true,
      },
      parameters: { mode: params.mode },
    }),
    ...(params.signal ? { signal: params.signal } : {}),
  });
  const taskId = created.output?.task_id;
  if (!taskId) throw new WanAnimateMixError('Wan Animate did not return a task id', 'bad_response');

  const startedAt = Date.now();
  const pollIntervalMs = params.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const maxWaitMs = params.maxWaitMs ?? DEFAULT_MAX_WAIT_MS;
  for (;;) {
    const { body } = await providerFetch(
      fetchImpl,
      `${baseUrl}/api/v1/tasks/${encodeURIComponent(taskId)}`,
      {
        method: 'GET',
        headers: headersFor(params),
        ...(params.signal ? { signal: params.signal } : {}),
      },
    );
    const status = body.output?.task_status;
    if (status === 'SUCCEEDED') {
      const videoUrl = body.output?.results?.video_url;
      if (!videoUrl) throw new WanAnimateMixError('Wan Animate completed without a video URL', 'bad_response');
      return {
        taskId,
        videoUrl,
        ...(typeof body.usage?.video_duration === 'number'
          ? { durationSeconds: body.usage.video_duration }
          : {}),
        mode: params.mode,
      };
    }
    if (status === 'FAILED' || status === 'CANCELED' || status === 'UNKNOWN') {
      throw new WanAnimateMixError(
        body.output?.message ?? `Wan Animate task ended with ${status ?? 'unknown status'}`,
        'task_failed',
        { code: body.output?.code },
      );
    }
    if (Date.now() - startedAt >= maxWaitMs) {
      throw new WanAnimateMixError(`Wan Animate task timed out after ${maxWaitMs}ms`, 'timeout');
    }
    await new Promise<void>((resolve) => setTimeout(resolve, pollIntervalMs));
  }
}
