/**
 * Provider-neutral Veo contract (params, result, typed error). Shared by the
 * dormant Gemini client (`veo-client.ts`, which re-exports these) and the fal
 * adapter (`fal-veo-client.ts`), so the production path never has to import
 * the Gemini client to speak this contract.
 */

export type VeoErrorKind =
  | 'no_api_key'
  | 'invalid_argument'
  | 'permission_denied'
  | 'quota_exhausted'
  | 'http'
  | 'op_failed'
  | 'timeout'
  | 'network'
  | 'bad_response'
  | 'no_result';

export class VeoError extends Error {
  constructor(
    message: string,
    readonly kind: VeoErrorKind,
    readonly status?: number,
    readonly detail?: string,
    readonly retryable = true,
  ) {
    super(message);
    this.name = 'VeoError';
  }
}

export interface GenerateVeoParams {
  /** Provider API key (Gemini key for veo-client, FAL_KEY for fal-veo-client). Empty → no_api_key. */
  readonly apiKey: string;
  readonly baseUrl?: string;
  /** Provider model id (Gemini model or fal endpoint id). */
  readonly model?: string;
  readonly prompt: string;
  /** Optional first-frame composition constraint (Veo 3.1 image-to-video). */
  readonly startImage?: {
    readonly data: string;
    readonly mimeType: 'image/png' | 'image/jpeg';
  };
  /** Optional final-frame composition constraint (Veo 3.1 interpolation). */
  readonly lastFrameImage?: {
    readonly data: string;
    readonly mimeType: 'image/png' | 'image/jpeg';
  };
  /** Elements that should not appear in the generated video. */
  readonly negativePrompt?: string;
  /** Default '9:16' (vertical). */
  readonly aspectRatio?: '9:16' | '16:9';
  /** Default 4. MUST be a number (string → 400). */
  readonly durationSeconds?: number;
  /** Optional — omit for the model default (720p). */
  readonly resolution?: '720p' | '1080p';
  readonly pollIntervalMs?: number;
  readonly maxWaitMs?: number;
  /** Transient 408/429/5xx retries per submit or poll request. Default 4. */
  readonly maxRetries?: number;
  /** Exponential retry base delay. Default 2000ms. */
  readonly retryBaseMs?: number;
  /** Injectable retry wait for deterministic tests. */
  readonly sleepImpl?: (ms: number) => Promise<void>;
  readonly fetchImpl?: typeof fetch;
  readonly signal?: AbortSignal;
  /** Called on each poll with the elapsed seconds (for WS progress). */
  readonly onPoll?: (elapsedMs: number) => void;
}

export interface VeoResult {
  /** Result video URI (Gemini: download with x-goog-api-key; fal: public CDN URL). */
  readonly videoUri: string;
  readonly elapsedMs: number;
}
