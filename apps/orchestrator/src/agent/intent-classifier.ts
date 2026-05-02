/**
 * Phase 21a — task execution-mode classifier.
 *
 * Decides whether a user's task should be routed to the browser
 * pool ('browser') or run as a pure-generation Anthropic call
 * ('generate'). Called from tasks.create BEFORE pool.allocate so a
 * 'generate' classification skips the per-user browser slot
 * entirely — that slot is a heavy quartet (Xvfb + Brave + x11vnc +
 * websockify) and spinning one up for "翻译这段" or "写一份方案"
 * is wasted resources.
 *
 * Uses Haiku for the classification: cheap (~$0.0001 per call,
 * <500ms), and the decision is binary so we don't need Sonnet's
 * nuance. Result is cached in an in-memory LRU keyed on the trimmed
 * lower-cased intent — same intent within process lifetime returns
 * instantly.
 *
 * Phase 21a scope note: the 'generate' return value currently only
 * skips the per-user pool slot. The agent loop still gets a
 * singleton-headless executor as fallback (same as today's
 * pool-overflow behaviour), so pure-generation tasks still nominally
 * have a browser available. Full no-browser path (single Anthropic
 * call with web_search only, no executor at all) is phase 21b.
 */

import Anthropic from '@anthropic-ai/sdk';
import type { Logger } from 'pino';

export type ExecutionMode = 'browser' | 'generate';

const PROMPT = `Classify this user task into ONE of two modes. Respond with ONLY the literal string "browser" or "generate", nothing else.

- "browser": the task asks the agent to open a website, search a real-world site, fill a form, click, scroll, screenshot, or otherwise interact with a live page. Examples: "去京东查 iPhone 16 价格", "在小红书搜爆款笔记", "打开 google 搜...", "去 LinkedIn 找深圳的 PM".

- "generate": the task is pure text generation, analysis, translation, planning, summarization, code review, or fictional writing — no live web interaction needed. Examples: "翻译这段话", "写一份产品方案", "把这份 PDF 整理成表格", "起一个产品名".

Default to "browser" if the task plausibly needs current/real-time data the model can't have memorized.

Task: """`;

const PROMPT_SUFFIX = '"""';

interface CacheEntry {
  mode: ExecutionMode;
  at: number;
}

/** Process-lifetime cache. Cap is small (200) — the cost of a
 *  classifier miss is ~$0.0001 + 500ms, so we don't need a giant
 *  cache. LRU semantics via Map insertion order. */
const CACHE = new Map<string, CacheEntry>();
const CACHE_MAX = 200;
const CACHE_TTL_MS = 60 * 60 * 1_000; // 1 hour

function cacheKey(intent: string): string {
  return intent.trim().toLowerCase().slice(0, 280);
}

function cacheGet(key: string): ExecutionMode | null {
  const entry = CACHE.get(key);
  if (!entry) return null;
  if (Date.now() - entry.at > CACHE_TTL_MS) {
    CACHE.delete(key);
    return null;
  }
  // Refresh LRU position
  CACHE.delete(key);
  CACHE.set(key, entry);
  return entry.mode;
}

function cacheSet(key: string, mode: ExecutionMode): void {
  CACHE.set(key, { mode, at: Date.now() });
  while (CACHE.size > CACHE_MAX) {
    const oldest = CACHE.keys().next().value;
    if (oldest) CACHE.delete(oldest);
    else break;
  }
}

export interface ClassifyOpts {
  intent: string;
  /** Per-task logger (already child-tagged). */
  logger: Logger;
  /** Override Anthropic client. Tests + null-key environments. */
  client?: Anthropic | null;
  /** Override model — defaults to Haiku 4.5 family. */
  model?: string;
  /** Hard ceiling so a stalled API call can't block task creation. */
  timeoutMs?: number;
}

const DEFAULT_MODEL = 'claude-haiku-4-5';
const DEFAULT_TIMEOUT_MS = 4_000;

/**
 * Classify a task intent. Defaults to 'browser' on any failure
 * (network error, parse error, timeout) — the existing browser
 * lane is the safe fallback because every browser task can also be
 * answered by the model alone, but the reverse isn't true.
 */
export async function classifyExecutionMode(opts: ClassifyOpts): Promise<ExecutionMode> {
  const intent = opts.intent.trim();
  if (!intent) return 'browser';

  const key = cacheKey(intent);
  const cached = cacheGet(key);
  if (cached) {
    opts.logger.debug({ mode: cached, cache: 'hit' }, 'intent-classifier: cache hit');
    return cached;
  }

  const client = opts.client ?? new Anthropic();
  const model = opts.model ?? DEFAULT_MODEL;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const ac = new AbortController();
  const tt = setTimeout(() => ac.abort(), timeoutMs);

  try {
    const res = await client.messages.create(
      {
        model,
        max_tokens: 8,
        messages: [{ role: 'user', content: `${PROMPT}${intent}${PROMPT_SUFFIX}` }],
      },
      { signal: ac.signal },
    );
    clearTimeout(tt);
    // Extract text from content blocks. The SDK's TextBlock type
    // carries citations + other fields we don't care about; safer to
    // narrow with a runtime check than to fight the type predicate.
    const text = res.content
      .map((b) => (b.type === 'text' ? b.text : ''))
      .join('')
      .toLowerCase()
      .trim();
    const mode: ExecutionMode = text.startsWith('generate') ? 'generate' : 'browser';
    cacheSet(key, mode);
    opts.logger.info(
      { mode, raw: text.slice(0, 32), inputTokens: res.usage?.input_tokens, outputTokens: res.usage?.output_tokens },
      'intent-classifier: decided',
    );
    return mode;
  } catch (err) {
    clearTimeout(tt);
    opts.logger.warn(
      { err: err instanceof Error ? err.message : String(err) },
      'intent-classifier: failed — defaulting to browser',
    );
    return 'browser';
  }
}
