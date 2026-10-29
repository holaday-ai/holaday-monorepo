/**
 * FIX-47 #4 (BOSS 2026-10-29: evidence first, no backup model): what a provider sent back when
 * the messages adapter calls its response invalid. Since 2026-10-28 qwen3.8-max (execution)
 * returns such responses in about one second with no HTTP error; the accounting row only said
 * `INVALID_RESPONSE`. This record says which check failed, the response as sent (cut to 4 KB,
 * credentials and personal identifiers masked) and the size of the request — never the request
 * itself, the prompt or the page text.
 */

export type InvalidResponseKind =
  | 'not_json'
  | 'not_object'
  | 'no_id'
  | 'no_content_array'
  | 'bad_text_block'
  | 'bad_tool_use_block'
  | 'empty_content';

export interface InvalidResponseForensics {
  kind: InvalidResponseKind;
  httpStatus: number | null;
  requestId: string | null;
  elapsedMs: number | null;
  model: string;
  /** The wire body's size; its content is never kept. */
  requestBytes: number;
  toolCount: number;
  messageCount: number;
  stopReason: string | null;
  /** Block types in `content`, in order (「thinking」 only is an empty answer). */
  contentTypes: string[];
  usage: { inputTokens: number | null; outputTokens: number | null } | null;
  responseBytes: number;
  /** The response body, masked, at most 4 KB. */
  body: string;
}

/** What the transport saw of a 2xx response; carried on the parsed body under a symbol. */
export interface TransportResponseMeta {
  httpStatus: number;
  requestId: string | null;
  elapsedMs: number;
  /** The body text as received, before any masking. */
  text: string;
}

export const TRANSPORT_RESPONSE_META: unique symbol = Symbol('holaday.transportResponseMeta');

export const FORENSIC_BODY_LIMIT = 4096;

const REQUEST_ID_HEADERS = [
  'x-request-id',
  'x-dashscope-request-id',
  'request-id',
  'x-acs-request-id',
];

/** The provider's request id from response headers, if it looks like one. */
export function responseRequestId(headers: Headers | undefined): string | null {
  for (const name of REQUEST_ID_HEADERS) {
    const value = headers?.get(name);
    if (value && value.length <= 128 && /^[A-Za-z0-9][A-Za-z0-9_.:-]*$/.test(value)) return value;
  }
  return null;
}

/**
 * Credentials first (the route's own key and workspace, bearer tokens, `sk-` keys, long hex),
 * then what could identify a person (e-mail, mainland mobile and ID numbers, long digit runs);
 * then the 4 KB cut, so nothing masked can straddle it.
 */
export function maskForensicBody(raw: string, secrets: readonly string[] = []): string {
  let text = raw;
  for (const secret of secrets)
    if (secret && secret.length >= 6) text = text.split(secret).join('[密钥]');
  text = text
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, 'Bearer [密钥]')
    .replace(/\b(?:sk|ak|key|token)-[A-Za-z0-9_-]{8,}/gi, '[密钥]')
    .replace(/\b[a-f0-9]{32,}\b/gi, '[密钥]')
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[邮箱]')
    .replace(/(?<!\d)\d{17}[\dXx](?!\d)/g, '[证件号]')
    .replace(/(?<!\d)1[3-9]\d{9}(?!\d)/g, '[手机号]')
    .replace(/(?<!\d)\d{12,}(?!\d)/g, '[长数字]');
  const bytes = Buffer.from(text, 'utf8');
  if (bytes.byteLength <= FORENSIC_BODY_LIMIT) return text;
  // Cut on a character boundary, then say it was cut.
  return `${bytes.subarray(0, FORENSIC_BODY_LIMIT).toString('utf8').replace(/�+$/, '')}…[截断]`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function count(container: unknown, key: string): number | null {
  if (!isRecord(container)) return null;
  const value = container[key];
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

/** The record for one invalid response; `raw` is the parsed body (or nothing, for `not_json`). */
export function invalidResponseForensics(input: {
  kind: InvalidResponseKind;
  raw: unknown;
  meta?: TransportResponseMeta;
  model: string;
  request: { messages?: unknown; tools?: unknown };
  requestBytes: number;
  secrets?: readonly string[];
}): InvalidResponseForensics {
  const raw = input.raw;
  let text = input.meta?.text;
  if (text === undefined) {
    try {
      text = JSON.stringify(raw) ?? '';
    } catch {
      text = '';
    }
  }
  const content = isRecord(raw) && Array.isArray(raw.content) ? raw.content : [];
  return {
    kind: input.kind,
    httpStatus: input.meta?.httpStatus ?? null,
    requestId: input.meta?.requestId ?? null,
    elapsedMs: input.meta?.elapsedMs ?? null,
    model: input.model,
    requestBytes: input.requestBytes,
    toolCount: Array.isArray(input.request.tools) ? input.request.tools.length : 0,
    messageCount: Array.isArray(input.request.messages) ? input.request.messages.length : 0,
    stopReason:
      isRecord(raw) && typeof raw.stop_reason === 'string' ? raw.stop_reason.slice(0, 40) : null,
    contentTypes: content
      .slice(0, 20)
      .map((block) =>
        isRecord(block) && typeof block.type === 'string' ? block.type.slice(0, 40) : typeof block,
      ),
    usage: isRecord(raw)
      ? {
          inputTokens: count(raw.usage, 'input_tokens'),
          outputTokens: count(raw.usage, 'output_tokens'),
        }
      : null,
    responseBytes: Buffer.byteLength(text, 'utf8'),
    body: maskForensicBody(text, input.secrets),
  };
}
