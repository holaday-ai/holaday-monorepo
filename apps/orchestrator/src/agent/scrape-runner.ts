/**
 * Phase 24 RC follow-up — scrape-mode task runner.
 *
 * Parallel to generate-runner.ts, but for tasks classified as
 * 'scrape': the user wants information that lives on the web, but
 * does NOT need a live browser. Two-step flow:
 *
 *   1. Pull markdown via Firecrawl. URL in intent → /scrape;
 *      otherwise → /search with the search-keyword tail.
 *   2. Hand the markdown + original intent to Claude. The model
 *      writes a clean, well-structured answer from those bytes.
 *
 * Cost: $0.001-0.003 per Firecrawl call + ~$0.01 of Sonnet output.
 * Latency: 3-10s end-to-end (vs 60-180s on the browser path).
 */

import type Anthropic from '@anthropic-ai/sdk';
import type { Logger } from 'pino';
import { buildPromptSchemaSuffix } from '../execution/execution-contract.js';
import { classifyRole, buildLayeredSystemPrompt } from './supercar/prompt-layers.js';
import type { FirecrawlLane } from '../firecrawl/firecrawl-lane.js';

export interface ScrapeOutcome {
  status: 'completed' | 'failed';
  summary: string;
  reason?: string;
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
  source: 'scrape' | 'search';
  /** URLs the synthesis drew from. UI cites these in the result panel. */
  sources: string[];
}

export interface RunScrapeOpts {
  taskId: string;
  userId: string;
  intent: string;
  skillId?: string;
  client: Anthropic;
  firecrawl: FirecrawlLane;
  logger: Logger;
  /** Override default Sonnet 4.6. */
  model?: string;
  /** Wall-clock cap. Default 120s — Firecrawl is fast; the LLM call sets the ceiling. */
  timeoutMs?: number;
  /** Cap on response tokens. Default 8192. */
  maxTokens?: number;
  /** Search-result fetch limit. Default 5. */
  searchLimit?: number;
  /**
   * Phase 24 RC follow-up — streaming delta callback for the LLM
   * synthesis phase. Same shape as generate-runner's `onStreamDelta`.
   * tasks.ts wires this to broadcastToUser({type:'server.task.stream',
   * taskId, delta}).
   */
  onStreamDelta?: (delta: string) => void;
  /**
   * Phase 24 RC follow-up — coarse progress message hook. Fired
   * twice per task today: once before Firecrawl ("正在抓取网页数据
   * ...") and once between Firecrawl and the LLM stream
   * ("正在分析整理..."). tasks.ts wires this to broadcastToUser
   * ({type:'server.task.progress', taskId, message}).
   */
  onProgress?: (message: string) => void;
}

const DEFAULT_MODEL = 'claude-sonnet-4-6';
const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_MAX_TOKENS = 8192;
const DEFAULT_SEARCH_LIMIT = 5;

// Per-source markdown truncation, mirroring the apify scrape_website
// formatter. Caps total context the model sees at ~30K bytes.
const MAX_CONTENT_PER_SOURCE = 12_000;
const MAX_TOTAL_CONTENT = 30_000;

const URL_REGEX = /\b(?:https?:\/\/|www\.)[^\s　-〿＀-￯]+/i;
const TRAILING_TRIM = /[\s.,;:!?，。；：！？、（）()\[\]【】"'""'']+$/;

const ZH_LEADING_SEARCH_VERBS = /^(?:搜索|搜一下|搜|查询|查找|查看|研究|对比|调研)\s*/;
const EN_LEADING_SEARCH_VERBS = /^(?:search\s+(?:for\s+)?|find\s+|research\s+|compare\s+|look\s+up\s+)/i;

export function extractTargetUrl(intent: string): string | null {
  const m = URL_REGEX.exec(intent);
  if (!m) return null;
  let url = m[0].replace(TRAILING_TRIM, '');
  if (url.startsWith('www.')) url = `https://${url}`;
  return url;
}

export function extractSearchQuery(intent: string): string {
  let q = intent.trim();
  if (!q) return '';
  q = q.replace(ZH_LEADING_SEARCH_VERBS, '');
  q = q.replace(EN_LEADING_SEARCH_VERBS, '');
  return q.trim().slice(0, 200);
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max - 12)}\n\n…(truncated)`;
}

function formatScrapedContext(
  sources: ReadonlyArray<{ url: string; markdown: string; title?: string }>,
): { context: string; usedSources: string[] } {
  let total = 0;
  const used: string[] = [];
  const blocks: string[] = [];
  for (const s of sources) {
    if (total >= MAX_TOTAL_CONTENT) break;
    const head = `## 来源: ${s.url}${s.title ? ` — ${s.title}` : ''}\n`;
    const body = truncate(s.markdown, MAX_CONTENT_PER_SOURCE);
    blocks.push(`${head}\n${body}`);
    used.push(s.url);
    total += head.length + body.length;
  }
  return { context: blocks.join('\n\n---\n\n'), usedSources: used };
}

function safeProgress(opts: RunScrapeOpts, message: string): void {
  if (!opts.onProgress) return;
  try {
    opts.onProgress(message);
  } catch (err) {
    opts.logger.warn(
      { err: err instanceof Error ? err.message : String(err) },
      'scrape: onProgress callback threw (swallowed)',
    );
  }
}

export async function runScrapeTask(opts: RunScrapeOpts): Promise<ScrapeOutcome> {
  const start = Date.now();
  const log = opts.logger.child({ taskId: opts.taskId, runner: 'scrape' });
  const url = extractTargetUrl(opts.intent);
  let scrapeSource: 'scrape' | 'search';
  let sources: Array<{ url: string; markdown: string; title?: string }> = [];

  if (url) {
    log.info({ url }, 'scrape-runner: scraping target URL');
    safeProgress(opts, '正在抓取网页数据…');
    const r = await opts.firecrawl.scrape(url);
    if (!r.ok) {
      log.warn({ err: r.error, url }, 'scrape-runner: firecrawl.scrape failed');
      return {
        status: 'failed',
        summary: '',
        reason: r.error,
        inputTokens: 0,
        outputTokens: 0,
        durationMs: Date.now() - start,
        source: 'scrape',
        sources: [],
      };
    }
    scrapeSource = 'scrape';
    sources = [{ url: r.url, markdown: r.markdown, ...(r.title ? { title: r.title } : {}) }];
  } else {
    const query = extractSearchQuery(opts.intent);
    if (!query) {
      return {
        status: 'failed',
        summary: '',
        reason: 'scrape-runner: empty search query',
        inputTokens: 0,
        outputTokens: 0,
        durationMs: Date.now() - start,
        source: 'search',
        sources: [],
      };
    }
    log.info({ query }, 'scrape-runner: searching via firecrawl');
    safeProgress(opts, '正在搜索网络数据…');
    const r = await opts.firecrawl.search(query, {
      limit: opts.searchLimit ?? DEFAULT_SEARCH_LIMIT,
    });
    if (!r.ok) {
      log.warn({ err: r.error, query }, 'scrape-runner: firecrawl.search failed');
      return {
        status: 'failed',
        summary: '',
        reason: r.error,
        inputTokens: 0,
        outputTokens: 0,
        durationMs: Date.now() - start,
        source: 'search',
        sources: [],
      };
    }
    if (r.results.length === 0) {
      return {
        status: 'failed',
        summary: '',
        reason: '搜索没有结果（no results），换个关键词试试。',
        inputTokens: 0,
        outputTokens: 0,
        durationMs: Date.now() - start,
        source: 'search',
        sources: [],
      };
    }
    scrapeSource = 'search';
    sources = r.results.map((x) => ({
      url: x.url,
      markdown: x.markdown,
      ...(x.title ? { title: x.title } : {}),
    }));
  }

  const explicitRole = opts.skillId && opts.skillId !== 'none' ? opts.skillId : null;
  const roleId = explicitRole ?? classifyRole(opts.intent);
  // Codex Pack C3 — append JSON schema suffix when the intent kind
  // demands structured output. See execution-contract.ts for the
  // schemas + supported kinds.
  const system = buildLayeredSystemPrompt(roleId) + buildPromptSchemaSuffix(opts.intent);
  const { context, usedSources } = formatScrapedContext(sources);
  const userPrompt =
    `用户的请求：${opts.intent}\n\n` +
    `下面是从网络上抓取的相关内容。请基于这些真实数据回答用户的请求；` +
    `如果信息不足，明确说明缺什么，不要编造。\n\n` +
    `--- 抓取内容 ---\n\n${context}`;

  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const abortController = new AbortController();
  const timer = setTimeout(() => abortController.abort(), timeoutMs);

  // Phase 24 RC follow-up — Firecrawl is done, the LLM-synthesis
  // phase begins. Push a coarse progress note before the first
  // delta lands so the SPA can render "正在分析整理…" instead of
  // a blank panel for the few seconds before the model warms up.
  safeProgress(opts, '正在分析整理…');

  try {
    // Phase 24 RC follow-up — switched messages.create →
    // messages.stream so the SPA renders the synthesis as it
    // generates. Subscribe to 'text' events for the WS broadcast,
    // then await finalMessage() for the canonical content + usage.
    const stream = opts.client.messages.stream(
      {
        model: opts.model ?? DEFAULT_MODEL,
        max_tokens: opts.maxTokens ?? DEFAULT_MAX_TOKENS,
        system: [
          {
            type: 'text' as const,
            text: system,
            cache_control: { type: 'ephemeral' as const },
          },
        ],
        messages: [{ role: 'user' as const, content: userPrompt }],
      },
      { signal: abortController.signal },
    );
    if (opts.onStreamDelta) {
      const cb = opts.onStreamDelta;
      stream.on('text', (delta: string): void => {
        if (delta) {
          try {
            cb(delta);
          } catch (err) {
            log.warn(
              { err: err instanceof Error ? err.message : String(err) },
              'scrape: onStreamDelta callback threw (swallowed)',
            );
          }
        }
      });
    }
    const finalMessage = await stream.finalMessage();
    const summary = finalMessage.content
      .map((b) => (b.type === 'text' ? b.text : ''))
      .join('')
      .trim();
    const inputTokens = finalMessage.usage?.input_tokens ?? 0;
    const outputTokens = finalMessage.usage?.output_tokens ?? 0;
    const durationMs = Date.now() - start;
    if (!summary) {
      return {
        status: 'failed',
        summary: '',
        reason: 'AI 没有生成内容（empty response），请重试。',
        inputTokens,
        outputTokens,
        durationMs,
        source: scrapeSource,
        sources: usedSources,
      };
    }
    log.info(
      {
        source: scrapeSource,
        sourcesCount: usedSources.length,
        inputTokens,
        outputTokens,
        durationMs,
        summaryLen: summary.length,
        streaming: true,
      },
      'scrape-runner: completed',
    );
    return {
      status: 'completed',
      summary,
      inputTokens,
      outputTokens,
      durationMs,
      source: scrapeSource,
      sources: usedSources,
    };
  } catch (err) {
    const isAbort =
      abortController.signal.aborted ||
      (err instanceof Error &&
        (err.name === 'AbortError' || /aborted/i.test(err.message)));
    return {
      status: 'failed',
      summary: '',
      reason: isAbort
        ? `生成超时（>${Math.round(timeoutMs / 1000)} 秒）`
        : err instanceof Error
          ? err.message
          : String(err),
      inputTokens: 0,
      outputTokens: 0,
      durationMs: Date.now() - start,
      source: scrapeSource,
      sources: [],
    };
  } finally {
    clearTimeout(timer);
  }
}
