/**
 * Gemini image-generation client ("nano banana").
 *
 * Pure adapter over Google's Generative Language REST API
 * (`generateContent`). Given a prompt (+ optional input images for
 * editing / 图生图) it returns the generated image bytes. NO
 * orchestrator / DB / storage coupling — the runner layer
 * (image-runner.ts) is responsible for persisting the bytes to R2 and
 * emitting download cards.
 *
 * API surface (verified 2026-06 against
 * https://ai.google.dev/gemini-api/docs/image-generation):
 *   POST {baseUrl}/{apiVersion}/models/{model}:generateContent
 *   header  x-goog-api-key: <key>
 *   body    { contents: [{ parts: [ {text}, {inlineData:{mimeType,data}} ] }],
 *            generationConfig: { imageConfig?: { aspectRatio, imageSize } } }
 *   resp    candidates[].content.parts[].inlineData.{mimeType,data(base64 PNG)}
 *
 * Model IDs come from the caller (env-overridable) — the BOSS sprint
 * plan fixes them as gemini-3.1-flash-image (NB2) / gemini-3-pro-image
 * (NB Pro), but a wrong id is a one-env-var fix, never a redeploy,
 * because nothing here hard-codes them.
 *
 * Network note: the orchestrator runs on Vultr (Singapore egress), so
 * it can reach generativelanguage.googleapis.com directly — the "AI
 * proxy" the plan references is the deploy location, not a code-level
 * baseURL. `baseUrl` is still overridable so a future gateway can be
 * slotted in without touching this file.
 */

/** A base64-encoded image handed IN for editing (图生图 / inpaint). */
export interface GeminiImageInput {
  /** Raw base64 (no data: prefix). */
  readonly data: string;
  /** e.g. 'image/png', 'image/jpeg', 'image/webp'. */
  readonly mimeType: string;
}

export type GeminiApiVersion = 'v1' | 'v1beta';

export interface GenerateImagesParams {
  /** Google AI Studio API key. Empty → throws `no_api_key`. */
  readonly apiKey: string;
  /** The text prompt. For pure text-to-image this is the whole ask. */
  readonly prompt: string;
  /** Full model id, e.g. 'gemini-3.1-flash-image'. */
  readonly model: string;
  /** API surface selected by the model tier. Defaults to stable `v1`. */
  readonly apiVersion?: GeminiApiVersion;
  /** Defaults to https://generativelanguage.googleapis.com. No trailing slash needed. */
  readonly baseUrl?: string;
  /** Optional input images → image-editing mode. */
  readonly inputImages?: readonly GeminiImageInput[];
  /**
   * Optional output resolution for models that honour it (Pro → up to
   * '4096x4096'). Only sent when present so flash calls stay default.
   */
  readonly resolution?: string;
  /** Official Gemini image output aspect ratio. */
  readonly aspectRatio?: '1:1' | '3:4' | '4:3' | '9:16' | '16:9';
  /**
   * Some general multimodal models require an explicit
   * `responseModalities` to emit images. The dedicated `*-image`
   * models output images natively, so this is OFF by default; flip it
   * on (e.g. ['IMAGE'] or ['TEXT','IMAGE']) if a live smoke shows the
   * model returning only text.
   */
  readonly responseModalities?: readonly ('TEXT' | 'IMAGE')[];
  /** Wall-clock per call. Default 60s (Pro/4K is slower than NB2's <2s). */
  readonly timeoutMs?: number;
  /**
   * Retries on transient 503 (overload) / 429 (rate-limit). Default 2
   * → 3 attempts total. The newly-GA Pro model returns 503 "high
   * demand" under load; a couple of backed-off retries absorb the
   * common transient spike before the runner degrades to NB2.
   */
  readonly maxRetries?: number;
  /** Base backoff in ms (exponential: base, base*2, …). Default 1000. */
  readonly retryBaseMs?: number;
  /** Injectable for tests; defaults to global fetch. */
  readonly fetchImpl?: typeof fetch;
  /** Caller cancellation, composed with the internal timeout. */
  readonly signal?: AbortSignal;
}

export interface GeneratedImage {
  readonly buffer: Buffer;
  readonly mimeType: string;
}

export interface GenerateImagesResult {
  readonly images: GeneratedImage[];
  /** Any text part the model emitted alongside the image(s). */
  readonly text?: string;
  /** The model id actually called. */
  readonly model: string;
  /** finishReason of the first candidate, when present. */
  readonly finishReason?: string;
}

export type GeminiImageErrorKind =
  | 'no_api_key'
  | 'blocked'
  | 'no_image'
  | 'http'
  | 'network'
  | 'timeout'
  | 'bad_response';

/** Typed failure so the runner can map each kind to a clean Chinese message. */
export class GeminiImageError extends Error {
  constructor(
    message: string,
    readonly kind: GeminiImageErrorKind,
    readonly status?: number,
    readonly detail?: string,
  ) {
    super(message);
    this.name = 'GeminiImageError';
  }
}

const DEFAULT_BASE_URL = 'https://generativelanguage.googleapis.com';
// 120s — flash is normally <2s, but under heavy load (e.g. the 2026-06
// Pro-GA demand spike) image gen can queue past 60s. Headroom prevents
// spurious timeouts; the runner/eval still cap overall wall-clock.
const DEFAULT_TIMEOUT_MS = 120_000;

// Response part shapes — Google's proto3-JSON emits camelCase, but we
// also tolerate snake_case defensively.
interface InlineDataCamel {
  mimeType?: string;
  data?: string;
}
interface InlineDataSnake {
  mime_type?: string;
  data?: string;
}
interface ResponsePart {
  text?: string;
  inlineData?: InlineDataCamel;
  inline_data?: InlineDataSnake;
}
interface ResponseCandidate {
  content?: { parts?: ResponsePart[] };
  finishReason?: string;
}
interface GenerateContentResponse {
  candidates?: ResponseCandidate[];
  promptFeedback?: { blockReason?: string; blockReasonMessage?: string };
}

function extractInline(part: ResponsePart): { data: string; mimeType: string } | null {
  const camel = part.inlineData;
  if (camel?.data) return { data: camel.data, mimeType: camel.mimeType ?? 'image/png' };
  const snake = part.inline_data;
  if (snake?.data) return { data: snake.data, mimeType: snake.mime_type ?? 'image/png' };
  return null;
}

/**
 * Generate (or edit) one or more images. Resolves with the decoded
 * image buffers; rejects with a `GeminiImageError` carrying a typed
 * `kind` for every failure mode.
 */
export async function generateImages(
  params: GenerateImagesParams,
): Promise<GenerateImagesResult> {
  if (!params.apiKey || params.apiKey.trim() === '') {
    throw new GeminiImageError('GEMINI_API_KEY not configured', 'no_api_key');
  }

  const baseUrl = (params.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
  const apiVersion = params.apiVersion ?? 'v1';
  const url = `${baseUrl}/${apiVersion}/models/${encodeURIComponent(params.model)}:generateContent`;
  const fetchImpl = params.fetchImpl ?? fetch;

  const parts: Array<Record<string, unknown>> = [{ text: params.prompt }];
  for (const img of params.inputImages ?? []) {
    parts.push({ inlineData: { mimeType: img.mimeType, data: img.data } });
  }

  const generationConfig: Record<string, unknown> = {};
  const imageConfig: Record<string, string> = {};
  if (params.aspectRatio) imageConfig.aspectRatio = params.aspectRatio;
  const imageSize = normalizeImageSize(params.resolution);
  if (imageSize) imageConfig.imageSize = imageSize;
  if (Object.keys(imageConfig).length > 0) {
    // The REST responseFormat schema currently parses aspectRatio as a proto
    // enum and rejects documented strings such as "1:1". imageConfig is the
    // documented string-based compatibility surface for these same controls.
    generationConfig.imageConfig = imageConfig;
  }
  if (params.responseModalities) generationConfig.responseModalities = params.responseModalities;

  const body: Record<string, unknown> = {
    contents: [{ role: 'user', parts }],
  };
  if (Object.keys(generationConfig).length > 0) body.generationConfig = generationConfig;

  // One HTTP attempt: own timeout + caller-signal composition.
  const timeoutMs = params.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const attemptFetch = async (): Promise<Response> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const onCallerAbort = () => controller.abort();
    if (params.signal) {
      if (params.signal.aborted) controller.abort();
      else params.signal.addEventListener('abort', onCallerAbort, { once: true });
    }
    try {
      return await fetchImpl(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-goog-api-key': params.apiKey,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err) {
      if (controller.signal.aborted && !(params.signal?.aborted ?? false)) {
        throw new GeminiImageError(
          `Gemini image request timed out after ${timeoutMs}ms`,
          'timeout',
        );
      }
      throw new GeminiImageError(
        `Gemini image request failed: ${(err as Error).message}`,
        'network',
      );
    } finally {
      clearTimeout(timer);
      if (params.signal) params.signal.removeEventListener('abort', onCallerAbort);
    }
  };

  // Retry transient overload (503) / rate-limit (429) with exponential
  // backoff. Persistent overload still surfaces as `http` so the runner
  // can degrade Pro→NB2.
  const maxRetries = params.maxRetries ?? 2;
  const retryBaseMs = params.retryBaseMs ?? 1000;
  let res!: Response;
  for (let attempt = 0; ; attempt += 1) {
    res = await attemptFetch();
    if (res.ok) break;
    if ((res.status === 503 || res.status === 429) && attempt < maxRetries) {
      await safeText(res); // drain body so the socket frees up
      await sleep(retryBaseMs * 2 ** attempt);
      continue;
    }
    const errBody = await safeText(res);
    throw new GeminiImageError(
      `Gemini image API returned ${res.status}`,
      'http',
      res.status,
      errBody.slice(0, 800),
    );
  }

  let json: GenerateContentResponse;
  try {
    json = (await res.json()) as GenerateContentResponse;
  } catch (err) {
    throw new GeminiImageError(
      `Gemini image response was not valid JSON: ${(err as Error).message}`,
      'bad_response',
    );
  }

  const candidates = json.candidates ?? [];
  const images: GeneratedImage[] = [];
  const textChunks: string[] = [];
  for (const cand of candidates) {
    for (const part of cand.content?.parts ?? []) {
      const inline = extractInline(part);
      if (inline) {
        images.push({
          buffer: Buffer.from(inline.data, 'base64'),
          mimeType: inline.mimeType,
        });
      } else if (typeof part.text === 'string' && part.text.length > 0) {
        textChunks.push(part.text);
      }
    }
  }

  const finishReason = candidates[0]?.finishReason;
  const text = textChunks.length > 0 ? textChunks.join('\n') : undefined;

  if (images.length === 0) {
    const blockReason =
      json.promptFeedback?.blockReason ?? json.promptFeedback?.blockReasonMessage;
    if (blockReason || isSafetyFinish(finishReason)) {
      throw new GeminiImageError(
        `Gemini blocked the image request (${blockReason ?? finishReason})`,
        'blocked',
        undefined,
        blockReason ?? finishReason,
      );
    }
    throw new GeminiImageError(
      'Gemini returned no image',
      'no_image',
      undefined,
      [finishReason ? `finishReason=${finishReason}` : '', text ?? '']
        .filter(Boolean)
        .join(' | ') || undefined,
    );
  }

  return {
    images,
    ...(text ? { text } : {}),
    model: params.model,
    ...(finishReason ? { finishReason } : {}),
  };
}

function normalizeImageSize(value: string | undefined): '512' | '1K' | '2K' | '4K' | undefined {
  if (!value) return undefined;
  const normalized = value.trim().toUpperCase();
  if (normalized === '512') return '512';
  if (normalized === '1K' || normalized.includes('1024')) return '1K';
  if (normalized === '2K' || normalized.includes('2048')) return '2K';
  if (normalized === '4K' || normalized.includes('4096')) return '4K';
  return undefined;
}

function isSafetyFinish(finishReason: string | undefined): boolean {
  if (!finishReason) return false;
  return /SAFETY|PROHIBITED|BLOCK|RECITATION|IMAGE_SAFETY/i.test(finishReason);
}

async function safeText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return '';
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
