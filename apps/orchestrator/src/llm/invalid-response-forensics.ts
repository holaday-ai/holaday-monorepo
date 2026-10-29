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
  /** PR #311 review: the body's size as received (UTF-8 bytes), before any summary. */
  bodyBytes?: number;
  /**
   * A body that was not JSON, described without its words (PR #311 review: a truncated JSON body
   * still carries generated text). A parsed body is summarised from its structure instead.
   */
  unparsed?: { bytes: number; sketch: string };
}

/**
 * PR #311 review: what an unparseable body looked like — its size and form, never its text
 * (「{"content":[{"type":"text","text":"杭州市…」 cut short keeps nothing of the address).
 */
export function unparsedSketch(text: string): { bytes: number; sketch: string } {
  const head = text.trimStart()[0] ?? '';
  const shape = !text.trim()
    ? 'empty'
    : head === '{' || head === '['
      ? 'json_unparseable'
      : head === '<'
        ? 'html_or_xml'
        : 'text';
  return {
    bytes: Buffer.byteLength(text, 'utf8'),
    sketch: JSON.stringify({ shape, chars: text.length, lines: text.split('\n').length }),
  };
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

/**
 * The places in a response whose text is a diagnostic value, never generated or user text —
 * paths, not key names (PR #311 review: a tool input's own `code` / `id` keys are user data).
 * `*` is any array index.
 */
const DIAGNOSTIC_TEXT_PATHS = new Set([
  'id',
  'type',
  'object',
  'role',
  'model',
  'stop_reason',
  'stop_sequence',
  'status',
  'request_id',
  'code',
  'content.*.type',
  'content.*.id',
  'content.*.name',
  'error.type',
  'error.code',
  'choices.*.finish_reason',
  'choices.*.message.role',
]);

/**
 * DEPLOY-48 复审 #3 + PR #311 review: a parsed body as kept is its shape only. Numbers, booleans
 * and nulls stay; text stays only at a known diagnostic path (`stop_reason`, `content.*.type`…),
 * cut to 80 characters; any other text — block text, tool inputs, `choices[].message.content`, an
 * error's message — becomes its length (「<11 chars>」), wherever it sits.
 */
function shapeOf(value: unknown, path: string, depth: number): unknown {
  if (value === null || typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'string')
    return DIAGNOSTIC_TEXT_PATHS.has(path) && value.length <= 80
      ? value
      : `<${value.length} chars>`;
  if (depth >= 6) return Array.isArray(value) ? `<array of ${value.length}>` : `<${typeof value}>`;
  const at = (key: string) => (path ? `${path}.${key}` : key);
  if (Array.isArray(value)) {
    const items = value.slice(0, 50).map((item) => shapeOf(item, at('*'), depth + 1));
    return value.length > 50 ? [...items, `<${value.length - 50} more>`] : items;
  }
  if (isRecord(value))
    return Object.fromEntries(
      Object.entries(value)
        .slice(0, 40)
        .map(([k, v]) => [k.slice(0, 40), shapeOf(v, at(k), depth + 1)]),
    );
  return `<${typeof value}>`;
}

function structuralBody(raw: unknown): string {
  return JSON.stringify(shapeOf(raw, '', 0)) ?? '';
}

/** A parsed body's size when no transport measured it (another client): its JSON form. */
function receivedBytes(raw: unknown): number {
  try {
    return Buffer.byteLength(JSON.stringify(raw) ?? '', 'utf8');
  } catch {
    return 0;
  }
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
  const unparsed = input.kind === 'not_json' ? input.meta?.unparsed : undefined;
  const text = input.kind === 'not_json' ? (unparsed?.sketch ?? '') : structuralBody(raw);
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
    responseBytes: unparsed?.bytes ?? input.meta?.bodyBytes ?? receivedBytes(raw),
    body: maskForensicBody(text, input.secrets),
  };
}
