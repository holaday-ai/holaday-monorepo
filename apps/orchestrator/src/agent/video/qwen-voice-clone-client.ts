/**
 * Qwen3-TTS-VC voice-clone client — DashScope International (Singapore).
 *
 * Pure adapter. NO orchestrator / DB / storage / fs coupling — the
 * caller supplies the voice sample as base64 (the onboarding flow reads
 * the file → base64) and persists the synthesized audio. Verified
 * 2026-06-13 from Vultr against the live intl endpoint with a real BOSS
 * voice sample:
 *   ENROLL  m4a (audio/mp4 base64) → 200, output.voice = a cloned voice_id
 *   SYNTH   text + voice → 200, output.audio.url = a temporary OSS WAV
 *           (usage.characters billed; ~226KB for a 50-char sentence)
 *
 * Why Qwen3-TTS-VC (not CosyVoice): CosyVoice voice cloning is NOT
 * supported on the international/Singapore region; Qwen3-TTS-VC IS, and
 * it accepts base64 inline (no public hosting of the user's voice).
 *
 * API surface (HTTP, NOT WebSocket — unlike CosyVoice synthesis):
 *   ENROLL  POST {base}/api/v1/services/audio/tts/customization
 *           body { model:'qwen-voice-enrollment',
 *                  input:{ action:'create', target_model, preferred_name,
 *                          audio:{ data:'data:{mime};base64,{b64}' } } }
 *           resp { output:{ voice, target_model } }
 *   SYNTH   POST {base}/api/v1/services/aigc/multimodal-generation/generation
 *           body { model: target_model, input:{ text, voice } }
 *           resp { output:{ audio:{ url, expires_at, id } },
 *                  usage:{ characters } }
 *
 * The synthesized URL is TEMPORARY (expires_at) — the runner downloads it
 * immediately (video-http.downloadToBuffer) and persists to R2.
 * The enrollment `target_model` MUST match the synthesis `model`.
 */

import { fetchWithTimeout, safeText, sleep, VideoHttpError } from './video-http.js';

const DEFAULT_BASE_URL = 'https://dashscope-intl.aliyuncs.com';
const ENROLL_MODEL = 'qwen-voice-enrollment';
const DEFAULT_TARGET_MODEL = 'qwen3-tts-vc-2026-01-22';
const DEFAULT_AUDIO_MIME = 'audio/mp4'; // m4a; mp3 = audio/mpeg, wav = audio/wav
// Enrollment uploads a base64 audio sample (≤10MB) so allow a bigger body window.
const DEFAULT_ENROLL_TIMEOUT_MS = 60_000;
const DEFAULT_SYNTH_TIMEOUT_MS = 60_000;

export type QwenVoiceCloneErrorKind =
  | 'no_api_key'
  | 'http'
  | 'no_voice'
  | 'no_audio'
  | 'timeout'
  | 'network'
  | 'bad_response';

export class QwenVoiceCloneError extends Error {
  constructor(
    message: string,
    readonly kind: QwenVoiceCloneErrorKind,
    readonly status?: number,
    readonly detail?: string,
  ) {
    super(message);
    this.name = 'QwenVoiceCloneError';
  }
}

export interface QwenBaseParams {
  /** DashScope INTERNATIONAL (Singapore-region) API key. Empty → no_api_key. */
  readonly apiKey: string;
  readonly baseUrl?: string;
  /** Optional DashScope business-space id → `X-DashScope-WorkSpace` header. */
  readonly workspaceId?: string;
  readonly timeoutMs?: number;
  readonly fetchImpl?: typeof fetch;
  readonly signal?: AbortSignal;
  readonly maxRetries?: number;
  readonly retryBaseMs?: number;
}

function assertKey(apiKey: string): void {
  if (!apiKey || apiKey.trim() === '') {
    throw new QwenVoiceCloneError('DASHSCOPE_API_KEY not configured', 'no_api_key');
  }
}
function base(p: QwenBaseParams): string {
  return (p.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
}

/** POST JSON with Bearer auth, retrying transient 429/503. Returns parsed JSON. */
async function postJson(
  url: string,
  body: unknown,
  p: QwenBaseParams,
  defaultTimeoutMs: number,
): Promise<Record<string, unknown>> {
  const fetchImpl = p.fetchImpl ?? fetch;
  const maxRetries = p.maxRetries ?? 2;
  const retryBaseMs = p.retryBaseMs ?? 1000;
  let res!: Response;
  for (let attempt = 0; ; attempt += 1) {
    try {
      res = await fetchWithTimeout(
        url,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${p.apiKey}`,
            ...(p.workspaceId ? { 'x-dashscope-workspace': p.workspaceId } : {}),
          },
          body: JSON.stringify(body),
        },
        { timeoutMs: p.timeoutMs ?? defaultTimeoutMs, ...(p.signal ? { signal: p.signal } : {}), fetchImpl },
      );
    } catch (err) {
      if (err instanceof VideoHttpError) throw new QwenVoiceCloneError(err.message, err.kind);
      throw err;
    }
    if (res.ok) break;
    if ((res.status === 429 || res.status === 503) && attempt < maxRetries) {
      await safeText(res);
      await sleep(retryBaseMs * 2 ** attempt);
      continue;
    }
    const errBody = await safeText(res);
    throw new QwenVoiceCloneError(`DashScope returned ${res.status}`, 'http', res.status, errBody.slice(0, 800));
  }
  try {
    return (await res.json()) as Record<string, unknown>;
  } catch (err) {
    throw new QwenVoiceCloneError(`DashScope response not JSON: ${(err as Error).message}`, 'bad_response');
  }
}

export interface EnrollVoiceParams extends QwenBaseParams {
  /** Raw base64 (NO `data:` prefix) of the user's voice sample. */
  readonly audioBase64: string;
  /** MIME of the sample: 'audio/mp4'(m4a) | 'audio/mpeg'(mp3) | 'audio/wav'. Default audio/mp4. */
  readonly audioMime?: string;
  /** Human label prefix for the voice. Default 'holaday'. */
  readonly preferredName?: string;
  /** TTS model the voice is bound to (must match synthesis model). Default qwen3-tts-vc-2026-01-22. */
  readonly targetModel?: string;
}

export interface EnrollVoiceResult {
  readonly voiceId: string;
  readonly targetModel: string;
}

/**
 * Register a cloned voice from a base64 audio sample. Enrollment is FREE
 * (no per-voice charge; synthesis is billed per character). Returns the
 * voice_id to persist on the user (users.qwen_voice_id) and reuse on
 * every synthesis call.
 */
export async function enrollVoice(p: EnrollVoiceParams): Promise<EnrollVoiceResult> {
  assertKey(p.apiKey);
  const targetModel = p.targetModel ?? DEFAULT_TARGET_MODEL;
  const mime = p.audioMime ?? DEFAULT_AUDIO_MIME;
  const json = await postJson(
    `${base(p)}/api/v1/services/audio/tts/customization`,
    {
      model: ENROLL_MODEL,
      input: {
        action: 'create',
        target_model: targetModel,
        preferred_name: p.preferredName ?? 'holaday',
        audio: { data: `data:${mime};base64,${p.audioBase64}` },
      },
    },
    p,
    DEFAULT_ENROLL_TIMEOUT_MS,
  );
  const output = (json.output ?? {}) as { voice?: string; target_model?: string };
  if (!output.voice) {
    throw new QwenVoiceCloneError(
      'Qwen enrollment returned no voice id',
      'no_voice',
      undefined,
      JSON.stringify(json).slice(0, 400),
    );
  }
  return { voiceId: output.voice, targetModel: output.target_model ?? targetModel };
}

export interface SynthesizeParams extends QwenBaseParams {
  readonly voiceId: string;
  readonly text: string;
  /** Must match the enrollment target_model. Default qwen3-tts-vc-2026-01-22. */
  readonly model?: string;
}

export interface SynthesizeResult {
  /** TEMPORARY OSS URL to the synthesized audio (download immediately). */
  readonly audioUrl: string;
  /** Unix seconds the URL expires at, when present. */
  readonly expiresAt?: number;
  readonly audioId?: string;
  /** usage.characters — the billable unit. */
  readonly characters?: number;
  readonly finishReason?: string;
}

/** Synthesize speech in the cloned voice. Result audio is a temporary URL. */
export async function synthesizeSpeech(p: SynthesizeParams): Promise<SynthesizeResult> {
  assertKey(p.apiKey);
  const json = await postJson(
    `${base(p)}/api/v1/services/aigc/multimodal-generation/generation`,
    { model: p.model ?? DEFAULT_TARGET_MODEL, input: { text: p.text, voice: p.voiceId } },
    p,
    DEFAULT_SYNTH_TIMEOUT_MS,
  );
  const output = (json.output ?? {}) as {
    audio?: { url?: string; expires_at?: number; id?: string };
    finish_reason?: string;
  };
  const usage = (json.usage ?? {}) as { characters?: number };
  const url = output.audio?.url;
  if (!url) {
    throw new QwenVoiceCloneError(
      'Qwen synthesis returned no audio url',
      'no_audio',
      undefined,
      JSON.stringify(json).slice(0, 400),
    );
  }
  return {
    audioUrl: url,
    ...(output.audio?.expires_at !== undefined ? { expiresAt: output.audio.expires_at } : {}),
    ...(output.audio?.id ? { audioId: output.audio.id } : {}),
    ...(usage.characters !== undefined ? { characters: usage.characters } : {}),
    ...(output.finish_reason ? { finishReason: output.finish_reason } : {}),
  };
}
