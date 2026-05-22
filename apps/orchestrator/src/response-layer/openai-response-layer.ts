/**
 * Optimization #2 — OpenAI-driven response formatter / style layer.
 *
 * One short OpenAI call rewrites the agent's `original` summary into
 * a polished `formatted` summary. The model gets:
 *   - factual constraints (the original text + any evidence URLs;
 *     red-line "do not invent facts / URLs / numbers")
 *   - HOLA DAY style guide (markdown structure, ⚠️ for warnings,
 *     🟢🔵🟡🔴 source-tag preservation, follow-up actions marker
 *     preservation, no Claude self-references)
 *
 * Then a DETERMINISTIC post-check verifies:
 *   - no new URLs introduced
 *   - no new numbers introduced
 *   - all original markers preserved (⚠️, 🟢🔵🟡🔴, follow-up marker)
 *
 * If any check fails the formatted text is dropped and we return
 * `{ formatted: original, fallbackReason }`. Caller persists both
 * `original_summary` and `formatted_summary` (= original when fallback)
 * along with `response_layer_metadata` for forensics.
 *
 * Feature-gated: OPENAI_RESPONSE_LAYER_ENABLED=false → caller
 * shouldn't even call this module. The default is OFF; an explicit
 * env flip + valid OPENAI_API_KEY are both required.
 *
 * Timeout: 10s. Fallback to original on timeout / API error / any
 * unexpected throw — the user always sees something usable.
 */

import OpenAI from 'openai';
import type { Logger } from 'pino';
import { isTaskTerminalStatus, type TaskTerminalStatus } from '../task-status.js';

export const DEFAULT_RESPONSE_MODEL = 'gpt-4o-mini';
export const DEFAULT_TIMEOUT_MS = 25_000;

/**
 * Dedicated undici dispatcher for OpenAI calls. The orchestrator
 * shares a process-wide undici state with the Anthropic SDK + many
 * long-running browser-tool fetches; we hit a reproducible issue
 * where standalone Node calls to api.openai.com complete in ~1s
 * but in-process calls from the long-running orchestrator time out
 * at 30s (= SDK's 10s timeout × 3 retries). A fresh per-module
 * dispatcher bypasses any pool corruption / connection-keepalive
 * staleness inherited from neighbouring SDKs.
 *
 * `connect.timeout` fails fast on TCP-level hangs so the visible
 * latency on a network blip is bounded. `pipelining: 0` keeps
 * request boundaries clean (HTTP/1.1 default pool would otherwise
 * pipeline, which historically tickles surprising bugs).
 *
 * Lazy module-scope singleton — first format() call materialises
 * it; subsequent calls reuse the pool. We don't instantiate at
 * import time so the flag-off path stays zero-cost.
 */
let openaiDispatcher: unknown | null = null;
async function getOpenAiDispatcher(): Promise<unknown> {
  if (!openaiDispatcher) {
    const { Agent } = await import('undici');
    openaiDispatcher = new Agent({
      connect: { timeout: 5_000 },
      keepAliveTimeout: 30_000,
      keepAliveMaxTimeout: 60_000,
      pipelining: 0,
    });
  }
  return openaiDispatcher;
}
/** Trigger threshold — only format replies above this length. */
export const TRIGGER_MIN_LENGTH = 200;

export interface FormatRequest {
  /** The agent's raw summary. Source of truth for facts. */
  original: string;
  /**
   * Workflow id when the agent ran a typed expert workflow. Drives
   * "always trigger formatter regardless of length" (expert reports
   * are short-but-structured; we want consistent voice).
   */
  expertWorkflowId?: string | undefined;
  /** Task status — formatter runs on terminal task statuses. */
  terminalStatus: TaskTerminalStatus;
}

export interface FormatMetadata {
  model: string;
  latencyMs: number;
  /** Pre-vs-post diff summary. Empty when fallback was used. */
  changes: Array<'paragraphs_added' | 'paragraphs_removed' | 'length_delta'>;
  /** Set when post-check or runtime forced a fallback. */
  fallbackReason?:
    | 'flag_off'
    | 'short_response'
    | 'missing_api_key'
    | 'timeout'
    | 'api_error'
    | 'new_url_introduced'
    | 'new_number_introduced'
    | 'warning_marker_removed'
    | 'source_badge_removed'
    | 'followup_marker_removed'
    | 'empty_output';
}

export interface FormatResult {
  formatted: string;
  metadata: FormatMetadata;
}

export interface ResponseLayerDeps {
  logger: Logger;
  /** Override-able for tests; defaults to a real OpenAI client. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  openaiClient?: any;
}

/**
 * Standalone flag check — callers gate the entire integration block
 * (including the post-persist UPDATE) on this. Codex P2 follow-up:
 * when the flag is off we must do ZERO DB writes for original_summary
 * / formatted_summary / response_layer_metadata; the previous
 * always-call-format-and-write-metadata flow left audit-only rows on
 * every terminal task and bloated the columns for users who never
 * opted into the feature.
 */
export function isResponseLayerEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const flag = (env.OPENAI_RESPONSE_LAYER_ENABLED ?? 'false').toLowerCase();
  if (flag !== 'true' && flag !== '1') return false;
  if (!env.OPENAI_API_KEY) return false;
  return true;
}

/**
 * Should we even attempt to format this response? Returns false when:
 *   - flag is off
 *   - status is something other than a task terminal status
 *   - response is short AND not an expert workflow report
 */
export function shouldFormat(req: FormatRequest, env: NodeJS.ProcessEnv = process.env): boolean {
  if (!isResponseLayerEnabled(env)) return false;
  if (!isTaskTerminalStatus(req.terminalStatus)) return false;
  // Expert workflow reports always format, regardless of length.
  if (req.expertWorkflowId) return true;
  // Short replies (translations, single-fact answers) skip the
  // formatter — the round-trip latency + risk-of-fallback isn't
  // worth it for ≤200 chars.
  return req.original.length > TRIGGER_MIN_LENGTH;
}

/**
 * Run the formatter. Always returns a usable string. The metadata's
 * `fallbackReason` tells the caller whether the formatted output was
 * actually OpenAI's work or just the original passed through.
 *
 * Single OpenAI call: combines factual-constraints prompt + style
 * guide. The two-prompt original design had a verifier + style stage
 * but that's 2× latency for limited gain at this layer.
 */
export async function format(
  req: FormatRequest,
  deps: ResponseLayerDeps,
  env: NodeJS.ProcessEnv = process.env,
): Promise<FormatResult> {
  const startedAt = Date.now();
  if (!shouldFormat(req, env)) {
    return {
      formatted: req.original,
      metadata: {
        model: env.OPENAI_RESPONSE_MODEL ?? DEFAULT_RESPONSE_MODEL,
        latencyMs: 0,
        changes: [],
        fallbackReason: !env.OPENAI_API_KEY
          ? 'missing_api_key'
          : (env.OPENAI_RESPONSE_LAYER_ENABLED ?? '').toLowerCase() !== 'true' &&
              (env.OPENAI_RESPONSE_LAYER_ENABLED ?? '').toLowerCase() !== '1'
            ? 'flag_off'
            : 'short_response',
      },
    };
  }
  const model = env.OPENAI_RESPONSE_MODEL ?? DEFAULT_RESPONSE_MODEL;
  // Custom fetch that pins each request to our dedicated undici
  // dispatcher. OpenAI SDK 4.104 accepts a `fetch?: (url, init)`
  // override; we route through `undiciFetch` with `dispatcher`
  // injected into `init` so the request bypasses any
  // process-shared pool state.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const dispatcherFetch: any = async (url: string | URL, init?: any) => {
    const { fetch: undiciFetch } = await import('undici');
    return undiciFetch(url as never, {
      ...(init ?? {}),
      dispatcher: await getOpenAiDispatcher(),
    });
  };
  const client =
    deps.openaiClient ??
    new OpenAI({
      apiKey: env.OPENAI_API_KEY,
      // openai SDK's per-request timeout option is supported on each
      // call; we set the client default to the same value so future
      // call sites inherit. The per-call override below overrides this.
      timeout: DEFAULT_TIMEOUT_MS,
      // No SDK-level retries — a single 25s window is plenty for
      // a small gpt-4o-mini polish call. Default `maxRetries: 2`
      // turns a 10s timeout into a 30s pile-up that's user-visible
      // when the call eventually falls back; we'd rather surface
      // the error fast.
      maxRetries: 0,
      fetch: dispatcherFetch,
    });

  let raw: string;
  try {
    raw = await callOpenAI(client, model, req);
  } catch (err) {
    const isTimeout =
      err instanceof Error && /timeout|aborted|ETIMEDOUT/i.test(err.message);
    deps.logger.warn(
      {
        err: err instanceof Error ? err.message : String(err),
        isTimeout,
        model,
      },
      'openai-response-layer: API call failed → fallback original',
    );
    return {
      formatted: req.original,
      metadata: {
        model,
        latencyMs: Date.now() - startedAt,
        changes: [],
        fallbackReason: isTimeout ? 'timeout' : 'api_error',
      },
    };
  }
  const latencyMs = Date.now() - startedAt;
  const trimmed = raw.trim();
  if (!trimmed) {
    return {
      formatted: req.original,
      metadata: {
        model,
        latencyMs,
        changes: [],
        fallbackReason: 'empty_output',
      },
    };
  }
  // Deterministic post-check — see postCheck() for the contracts.
  const check = postCheck(req.original, trimmed);
  if (!check.ok) {
    deps.logger.warn(
      {
        reason: check.reason,
        model,
        latencyMs,
        originalLen: req.original.length,
        formattedLen: trimmed.length,
      },
      'openai-response-layer: post-check rejected formatted output → fallback original',
    );
    return {
      formatted: req.original,
      metadata: {
        model,
        latencyMs,
        changes: [],
        fallbackReason: check.reason,
      },
    };
  }
  return {
    formatted: trimmed,
    metadata: {
      model,
      latencyMs,
      changes: diffChanges(req.original, trimmed),
    },
  };
}

/**
 * Build the prompt + call the OpenAI Chat Completions API. Isolated
 * so tests can stub the client at the SDK boundary.
 */
async function callOpenAI(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: any,
  model: string,
  req: FormatRequest,
): Promise<string> {
  const system = [
    'You are a polishing layer for an autonomous agent product called HOLA DAY (橙子智能).',
    '',
    'FACTUAL CONSTRAINTS — HARD RED LINES:',
    '1. NEVER introduce a fact, URL, number, name, or claim that is not in the ORIGINAL text below.',
    '2. NEVER remove a ⚠️ warning paragraph, a 🟢/🔵/🟡/🔴 source-tag prefix, or the <!-- HOLA_FOLLOW_UP_ACTIONS_START --> / _END marker block.',
    '3. NEVER refer to yourself or to OpenAI, Anthropic, GPT, Claude, or any underlying model.',
    '4. If you cannot polish without breaking these rules, return the ORIGINAL text unchanged.',
    '',
    'STYLE GUIDE:',
    '- Tighten prose, fix awkward Chinese, normalize markdown structure.',
    '- Headings use ## / ###; lists use - / 1.; tables stay in markdown.',
    '- Preserve all URLs verbatim. Preserve all numbers verbatim.',
    '- Keep the voice friendly + concise + factual.',
    '- Output ONLY the polished text. No commentary, no "Here is the polished version:" preamble.',
  ].join('\n');
  const user = [
    'ORIGINAL TEXT (source of truth for facts):',
    '---',
    req.original,
    '---',
    '',
    'Return the polished version of the text above, following the style guide and red lines.',
  ].join('\n');
  const completion = await client.chat.completions.create(
    {
      model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      temperature: 0.3,
      max_tokens: 4_096,
    },
    {
      timeout: DEFAULT_TIMEOUT_MS,
    },
  );
  const content = completion?.choices?.[0]?.message?.content;
  if (typeof content !== 'string') {
    throw new Error('openai response: missing string content');
  }
  return content;
}

/**
 * Deterministic post-check. Runs against the original + formatted
 * strings WITHOUT touching the LLM. Catches the three main classes
 * of formatter mistakes:
 *   1. New URL — the formatter invented a link
 *   2. New number — the formatter invented a stat / metric
 *   3. Removed marker — the formatter dropped a structural cue the
 *      SPA depends on (⚠️ box, source badge, follow-up chips)
 *
 * Returns { ok: true } when all three checks pass; otherwise
 * { ok: false, reason }.
 */
export function postCheck(
  original: string,
  formatted: string,
): { ok: true } | { ok: false; reason: FormatMetadata['fallbackReason'] } {
  // 1. New URL detection.
  const originalUrls = extractUrls(original);
  const formattedUrls = extractUrls(formatted);
  for (const url of formattedUrls) {
    if (!originalUrls.has(url)) {
      return { ok: false, reason: 'new_url_introduced' };
    }
  }
  // 2. New number detection. We tokenize numbers (including
  // decimals, percentages, currency-prefixed) and check each in the
  // formatted text appears in the original. Tolerates re-formatting
  // ("100,000" → "100000") via normalisation.
  const originalNumbers = new Set(
    extractNumbers(original).map(normaliseNumber),
  );
  const formattedNumbers = extractNumbers(formatted).map(normaliseNumber);
  for (const n of formattedNumbers) {
    if (!originalNumbers.has(n)) {
      return { ok: false, reason: 'new_number_introduced' };
    }
  }
  // 3. Marker preservation. If the original had a marker, the
  // formatted must too. We don't require the count to match exactly
  // (the formatter is allowed to merge two adjacent ⚠️ paragraphs
  // into one); we just require each KIND of marker to survive.
  if (countWarningMarkers(original) > 0 && countWarningMarkers(formatted) === 0) {
    return { ok: false, reason: 'warning_marker_removed' };
  }
  if (countSourceBadges(original) > 0 && countSourceBadges(formatted) === 0) {
    return { ok: false, reason: 'source_badge_removed' };
  }
  if (hasFollowUpMarker(original) && !hasFollowUpMarker(formatted)) {
    return { ok: false, reason: 'followup_marker_removed' };
  }
  return { ok: true };
}

// URL extraction — matches http:// and https:// scheme links. The
// raw match runs to the first character in the URL-stop class
// (whitespace + ASCII / CJK punctuation that's almost never part of
// a URL). We then strip a wider set of trailing punctuation so a
// URL written inside a sentence ("详情见 https://x.com 。") matches
// the same URL written without trailing punctuation ("https://x.com").
const URL_BODY_RE = /https?:\/\/[^\s<>"')，。；：！？,;:!?]+/gi;
const URL_TRAILING_PUNCT_RE = /[\.,;:!?，。；：！？\)\]'"]+$/u;
function extractUrls(text: string): Set<string> {
  const out = new Set<string>();
  const matches = text.match(URL_BODY_RE);
  if (!matches) return out;
  for (const m of matches) {
    out.add(m.replace(URL_TRAILING_PUNCT_RE, ''));
  }
  return out;
}

// Number extraction. Matches integers, decimals, percentages,
// "1,234,567"-style formatted numbers, and currency-prefixed numbers
// (¥, $, €). We INTENTIONALLY skip pure-text numbers like "三千" /
// "ten" — formatters that rewrite "5%" as "five percent" would
// false-trip otherwise; the agent's text is overwhelmingly digit-form.
//
// Single unified alternative: optional currency prefix, then one or
// more digits with optional comma-grouped trailing thousands, then
// optional decimal, then optional percent. Earlier two-alternative
// version preferred the comma-grouped branch which split bare
// "100000" into "100" + "000" (regex alternation is left-first).
const NUMBER_RE = /(?:[¥$€])?\d+(?:,\d{3})*(?:\.\d+)?%?/g;
// Markdown ordered-list ordinal at line start: "1. ", "2. ", optionally
// preceded by whitespace (nested indentation). Strip these BEFORE
// number extraction so the formatter re-numbering a list (or adding
// a new ordered list while preserving facts) doesn't trip the "new
// number introduced" guard. Sentence-internal "1." (no space-after
// or no line-start) still counts as a real number.
const MARKDOWN_ORDINAL_RE = /^[ \t]*\d+\.[ \t]+/gm;
function extractNumbers(text: string): string[] {
  const stripped = text.replace(MARKDOWN_ORDINAL_RE, '');
  const matches = stripped.match(NUMBER_RE);
  return matches ?? [];
}
function normaliseNumber(raw: string): string {
  // Strip commas + currency symbols + trailing %. Keeps the bare
  // numeric value for set comparison.
  return raw.replace(/[,¥$€]/g, '').replace(/%$/, '');
}

function countWarningMarkers(text: string): number {
  // ⚠️ with optional variation selector U+FE0F. Match at paragraph
  // start (after newline or at string start) — same prefix-match the
  // SPA's WarningBlock renderer uses.
  const re = /(^|\n)[ \t]*⚠(?:️)?/gu;
  return (text.match(re) ?? []).length;
}
function countSourceBadges(text: string): number {
  // 🟢🔵🟡🔴 at paragraph start.
  const re = /(^|\n)[ \t]*[🟢🔵🟡🔴]/gu;
  return (text.match(re) ?? []).length;
}
function hasFollowUpMarker(text: string): boolean {
  return /<!--\s*HOLA_FOLLOW_UP_ACTIONS_START\s*-->/i.test(text);
}

function diffChanges(
  original: string,
  formatted: string,
): FormatMetadata['changes'] {
  const out: FormatMetadata['changes'] = [];
  const origParas = original.split(/\n{2,}/).length;
  const fmtParas = formatted.split(/\n{2,}/).length;
  if (fmtParas > origParas) out.push('paragraphs_added');
  if (fmtParas < origParas) out.push('paragraphs_removed');
  if (Math.abs(formatted.length - original.length) > 50) {
    out.push('length_delta');
  }
  return out;
}
