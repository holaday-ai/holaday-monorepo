import { fetchWithTimeout, safeText, sleep, VideoHttpError } from './video-http.js';

const DEFAULT_BASE_URL = 'https://generativelanguage.googleapis.com';
const DEFAULT_MODEL = 'gemini-2.5-flash-preview-tts';
const DEFAULT_VOICE = 'Kore';
const DEFAULT_SAMPLE_RATE = 24_000;
const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_RETRY_BASE_MS = 1_000;

export type GeminiTtsErrorKind =
  | 'no_api_key'
  | 'invalid_argument'
  | 'permission_denied'
  | 'quota_exhausted'
  | 'http'
  | 'network'
  | 'timeout'
  | 'bad_response'
  | 'no_audio';

export class GeminiTtsError extends Error {
  constructor(
    message: string,
    readonly kind: GeminiTtsErrorKind,
    readonly status?: number,
    readonly detail?: string,
    readonly retryable = true,
  ) {
    super(message);
    this.name = 'GeminiTtsError';
  }
}

export interface SynthesizeGeminiSpeechParams {
  readonly apiKey: string;
  readonly text: string;
  readonly baseUrl?: string;
  readonly model?: string;
  readonly voiceName?: string;
  readonly timeoutMs?: number;
  readonly maxRetries?: number;
  readonly retryBaseMs?: number;
  readonly fetchImpl?: typeof fetch;
  readonly signal?: AbortSignal;
}

export interface SynthesizeGeminiSpeechResult {
  readonly audioBuffer: Buffer;
  readonly mimeType: 'audio/wav';
  readonly model: string;
  readonly voiceName: string;
}

interface GeminiTtsResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        inlineData?: {
          data?: string;
          mimeType?: string;
        };
      }>;
    };
  }>;
}

function wavFromPcm(
  pcm: Buffer,
  sampleRate = DEFAULT_SAMPLE_RATE,
  channels = 1,
  bitsPerSample = 16,
): Buffer {
  const header = Buffer.alloc(44);
  const blockAlign = (channels * bitsPerSample) / 8;
  const byteRate = sampleRate * blockAlign;
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

function sampleRateFromMimeType(mimeType: string | undefined): number {
  const parsed = Number(mimeType?.match(/(?:^|;)rate=(\d+)/i)?.[1] ?? DEFAULT_SAMPLE_RATE);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_SAMPLE_RATE;
}

function errorKindForStatus(status: number): GeminiTtsErrorKind {
  if (status === 400) return 'invalid_argument';
  if (status === 401 || status === 403) return 'permission_denied';
  if (status === 429) return 'quota_exhausted';
  return 'http';
}

function isTransientStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

export async function synthesizeGeminiSpeech(
  p: SynthesizeGeminiSpeechParams,
): Promise<SynthesizeGeminiSpeechResult> {
  if (!p.apiKey.trim()) {
    throw new GeminiTtsError('GEMINI_API_KEY not configured', 'no_api_key', undefined, undefined, false);
  }
  const text = p.text.trim();
  if (!text) {
    throw new GeminiTtsError('Gemini TTS text is empty', 'invalid_argument', 400, undefined, false);
  }

  const model = p.model ?? DEFAULT_MODEL;
  const voiceName = p.voiceName ?? DEFAULT_VOICE;
  const fetchImpl = p.fetchImpl ?? fetch;
  const maxRetries = Math.max(0, p.maxRetries ?? DEFAULT_MAX_RETRIES);
  const retryBaseMs = Math.max(0, p.retryBaseMs ?? DEFAULT_RETRY_BASE_MS);
  const url = `${(p.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '')}/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const requestBody = {
    contents: [
      {
        parts: [
          {
            text: `请用自然、清晰的普通话，逐字朗读以下内容，不要改写、增删或翻译：\n\n${text}`,
          },
        ],
      },
    ],
    generationConfig: {
      responseModalities: ['AUDIO'],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: { voiceName },
        },
      },
    },
  };

  let response!: Response;
  for (let attempt = 0; ; attempt += 1) {
    try {
      response = await fetchWithTimeout(
        url,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-goog-api-key': p.apiKey,
          },
          body: JSON.stringify(requestBody),
        },
        {
          timeoutMs: p.timeoutMs ?? DEFAULT_TIMEOUT_MS,
          ...(p.signal ? { signal: p.signal } : {}),
          fetchImpl,
        },
      );
    } catch (err) {
      if (err instanceof VideoHttpError) {
        if (!(p.signal?.aborted ?? false) && attempt < maxRetries) {
          await sleep(retryBaseMs * 2 ** attempt);
          continue;
        }
        throw new GeminiTtsError(err.message, err.kind);
      }
      throw err;
    }
    if (response.ok) break;

    const detail = (await safeText(response)).slice(0, 800);
    if (isTransientStatus(response.status) && attempt < maxRetries) {
      await sleep(retryBaseMs * 2 ** attempt);
      continue;
    }
    throw new GeminiTtsError(
      `Gemini TTS returned ${response.status}`,
      errorKindForStatus(response.status),
      response.status,
      detail,
      false,
    );
  }

  let json: GeminiTtsResponse;
  try {
    json = (await response.json()) as GeminiTtsResponse;
  } catch (err) {
    throw new GeminiTtsError(
      `Gemini TTS response was not JSON: ${(err as Error).message}`,
      'bad_response',
    );
  }
  const audio = json.candidates?.[0]?.content?.parts?.find((part) => part.inlineData?.data)
    ?.inlineData;
  if (!audio?.data) {
    throw new GeminiTtsError(
      'Gemini TTS returned no audio',
      'no_audio',
      undefined,
      JSON.stringify(json).slice(0, 400),
    );
  }

  let pcm: Buffer;
  try {
    pcm = Buffer.from(audio.data, 'base64');
  } catch (err) {
    throw new GeminiTtsError(
      `Gemini TTS audio was not valid base64: ${(err as Error).message}`,
      'bad_response',
    );
  }
  if (pcm.length === 0) {
    throw new GeminiTtsError('Gemini TTS returned empty audio', 'no_audio');
  }

  return {
    audioBuffer: wavFromPcm(pcm, sampleRateFromMimeType(audio.mimeType)),
    mimeType: 'audio/wav',
    model,
    voiceName,
  };
}
