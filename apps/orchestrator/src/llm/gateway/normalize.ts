import {
  type MessagesAdapter,
  MessagesAdapterError,
  type NeutralMessagesResponse,
  type NeutralOutputContentBlock,
} from '../messages-adapter.js';
import {
  modelProviderFailureMessage,
  safeProviderDiagnostics,
} from '../provider-error-diagnostics.js';
import type { ModelRole } from './model-roles.js';
import { withRoleThinking } from './thinking.js';

/**
 * REBUILD-2 — the thin layer between our internal (Anthropic Messages) format and DashScope's
 * Anthropic-compatible endpoint. REBUILD-1 D measured five places where that endpoint differs
 * from Anthropic's semantics; this wrapper evens them out so callers never see them:
 *
 *   1. forced tool + `end_turn`: a response that carries a tool_use block is a `tool_use` stop.
 *   2. thinking: the endpoint thinks by default (and thinking eats max_tokens), so every Qwen
 *      request states it per role (thinking.ts): small-budget roles `disabled`, thinking roles
 *      `enabled` + `budget_tokens` with max_tokens = answer room + budget; forced tools off.
 *   3. empty thinking blocks (`{type:"thinking",thinking:""}`) never reach callers.
 *   4. usage stays in Anthropic shape (input excludes cache reads, which the ledger prices
 *      separately); `totalInputTokens` is the one place that adds them up.
 *   5. a DashScope `{code,message,request_id}` failure always surfaces as MessagesAdapterError
 *      with its code and request id in `diagnostics`; `modelErrorKind` names it.
 *
 * Only active behind LLM_GATEWAY_V2. With the flag off no adapter is wrapped.
 */
export function normalizeMessagesAdapter(
  adapter: MessagesAdapter,
  role: ModelRole,
): MessagesAdapter {
  const wrapped: MessagesAdapter = {
    metadata: adapter.metadata,
    async create(request, options) {
      let response: NeutralMessagesResponse;
      try {
        response = await adapter.create(withRoleThinking(request, adapter.metadata, role), options);
      } catch (error) {
        throw toMessagesAdapterError(error);
      }
      return normalizeMessagesResponse(response);
    },
  };
  if (!adapter.browserBrain) return wrapped;
  return {
    ...wrapped,
    browserBrain: {
      planning: normalizeMessagesAdapter(adapter.browserBrain.planning, role),
      verification: normalizeMessagesAdapter(adapter.browserBrain.verification, role),
    },
  };
}

/** (1) + (3) on a finished response. Usage (4) is passed through unchanged. */
export function normalizeMessagesResponse(
  response: NeutralMessagesResponse,
): NeutralMessagesResponse {
  const content = response.content.filter((block) => !isEmptyThinkingBlock(block));
  const hasToolUse = content.some((block) => block.type === 'tool_use');
  const stopReason =
    hasToolUse && (response.stopReason === 'end_turn' || response.stopReason === 'unknown')
      ? 'tool_use'
      : response.stopReason;
  if (content.length === response.content.length && stopReason === response.stopReason)
    return response;
  return { ...response, content, stopReason };
}

function isEmptyThinkingBlock(block: NeutralOutputContentBlock): boolean {
  const raw = block as unknown as { type?: unknown; thinking?: unknown; text?: unknown };
  if (raw.type !== 'thinking' && raw.type !== 'redacted_thinking') return false;
  const value = typeof raw.thinking === 'string' ? raw.thinking : raw.text;
  return typeof value !== 'string' || value.trim() === '';
}

/**
 * (4) Total prompt size: Anthropic-channel `input_tokens` excludes cache reads and writes.
 * Use this wherever a figure must match the Responses/OpenAI channel (whose prompt count
 * includes the cache). Never feed it to the ledger, which prices the cache separately.
 */
export function totalInputTokens(usage: NeutralMessagesResponse['usage']): number | null {
  if (usage.inputTokens === null) return null;
  return (
    usage.inputTokens + (usage.cacheReadInputTokens ?? 0) + (usage.cacheCreationInputTokens ?? 0)
  );
}

/** (5) A caller-visible failure is always a MessagesAdapterError (aborts pass through). */
export function toMessagesAdapterError(error: unknown): unknown {
  if (error instanceof MessagesAdapterError) return error;
  if (!isRecord(error)) return error;
  const name = typeof error.name === 'string' ? error.name : undefined;
  if (name === 'AbortError' || name === 'APIUserAbortError') return error;
  // A raw DashScope error body (or an error object carrying it): {code, message, request_id}.
  const body = isRecord(error.error) ? error.error : error;
  const code = typeof body.code === 'string' ? body.code : undefined;
  const requestId = typeof body.request_id === 'string' ? body.request_id : undefined;
  // DashScope always names the request; a bare `code` (ECONNRESET…) is not this shape.
  if (!code || !requestId) return error;
  const status = typeof error.status === 'number' ? error.status : null;
  return new MessagesAdapterError(
    'PROVIDER_ERROR',
    modelProviderFailureMessage(status),
    status,
    safeProviderDiagnostics({ httpStatus: status, providerCode: code, requestId }),
  );
}

export type ModelErrorKind =
  | 'arrears'
  | 'access_denied'
  | 'invalid_parameter'
  | 'content_inspection'
  | 'rate_limited'
  | 'timeout'
  | 'aborted'
  | 'invalid_response'
  | 'provider_unavailable'
  | 'other';

/** (5) One internal name for a failed model call (DashScope codes per REBUILD-1 D §3.5). */
export function modelErrorKind(error: unknown): ModelErrorKind {
  if (!(error instanceof MessagesAdapterError)) return 'other';
  const code = error.diagnostics.providerCode ?? '';
  if (/arrearage|insufficient[_-]?quota|billing/i.test(code)) return 'arrears';
  if (/data[_-]?inspection/i.test(code)) return 'content_inspection';
  if (/access[_-]?denied|unauthori[sz]ed|invalid[_-]?api[_-]?key/i.test(code))
    return 'access_denied';
  if (/invalid[_-]?parameter/i.test(code)) return 'invalid_parameter';
  if (error.code === 'REQUEST_ABORTED') return 'aborted';
  if (error.code === 'REQUEST_TIMEOUT') return 'timeout';
  if (error.code === 'INVALID_RESPONSE') return 'invalid_response';
  if (error.status === 401 || error.status === 403) return 'access_denied';
  if (error.status === 429 || /throttl|rate[_-]?limit/i.test(code)) return 'rate_limited';
  if (error.code === 'PROVIDER_ERROR' && (error.status === null || error.status >= 500))
    return 'provider_unavailable';
  return 'other';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
