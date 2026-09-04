/**
 * Scrape-mode task runner. Firecrawl is the sole source channel; the regional
 * Qwen Responses adapter only synthesizes the bounded observed content.
 */

import type { Logger } from 'pino';
import { buildPromptSchemaSuffix } from '../execution/execution-contract.js';
import type { FirecrawlLane } from '../firecrawl/firecrawl-lane.js';
import { type ResponsesAdapter, ResponsesAdapterError } from '../llm/responses-adapter.js';
import {
  type ExpertMode,
  buildLayeredSystemPrompt,
  classifyRole,
} from './supercar/prompt-layers.js';

export interface ScrapeOutcome {
  status: 'completed' | 'failed';
  summary: string;
  reason?: string;
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
  source: 'scrape' | 'search';
  /** Exact URLs observed through Firecrawl and included in synthesis context. */
  sources: string[];
}

export interface RunScrapeOpts {
  taskId: string;
  userId: string;
  intent: string;
  skillId?: string;
  expertMode?: ExpertMode;
  responsesAdapter: ResponsesAdapter;
  firecrawl: FirecrawlLane;
  logger: Logger;
  timeoutMs?: number;
  maxTokens?: number;
  searchLimit?: number;
  onStreamDelta?: (delta: string) => void;
  onProgress?: (message: string) => void;
}

const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_MAX_TOKENS = 8192;
const DEFAULT_SEARCH_LIMIT = 5;
const MAX_CONTENT_PER_SOURCE = 12_000;
const MAX_TOTAL_CONTENT = 30_000;
const URL_REGEX = /\b(?:https?:\/\/|www\.)[^\s　-〿＀-￯]+/i;
const TRAILING_TRIM = /[\s.,;:!?，。；：！？、（）()\[\]【】"'“”‘’]+$/;
const ZH_LEADING_SEARCH_VERBS = /^(?:搜索|搜一下|搜|查询|查找|查看|研究|对比|调研)\s*/;
const EN_LEADING_SEARCH_VERBS =
  /^(?:search\s+(?:for\s+)?|find\s+|research\s+|compare\s+|look\s+up\s+)/i;

export function extractTargetUrl(intent: string): string | null {
  const match = URL_REGEX.exec(intent);
  if (!match) return null;
  let url = match[0].replace(TRAILING_TRIM, '');
  if (url.startsWith('www.')) url = `https://${url}`;
  return url;
}

export function extractSearchQuery(intent: string): string {
  let query = intent.trim();
  if (!query) return '';
  query = query.replace(ZH_LEADING_SEARCH_VERBS, '');
  query = query.replace(EN_LEADING_SEARCH_VERBS, '');
  return query.trim().slice(0, 200);
}

function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max - 12)}\n\n…(truncated)`;
}

function formatScrapedContext(
  sources: ReadonlyArray<{ url: string; markdown: string; title?: string }>,
): { context: string; usedSources: string[] } {
  let total = 0;
  const usedSources: string[] = [];
  const blocks: string[] = [];
  for (const source of sources) {
    if (total >= MAX_TOTAL_CONTENT) break;
    const heading = `## 来源: ${source.url}${source.title ? ` — ${source.title}` : ''}\n`;
    const body = truncate(source.markdown, MAX_CONTENT_PER_SOURCE);
    blocks.push(`${heading}\n${body}`);
    usedSources.push(source.url);
    total += heading.length + body.length;
  }
  return { context: blocks.join('\n\n---\n\n'), usedSources };
}

function safeProgress(opts: RunScrapeOpts, message: string): void {
  try {
    opts.onProgress?.(message);
  } catch {
    opts.logger.warn({ code: 'PROGRESS_CALLBACK_ERROR' }, 'scrape: progress callback failed');
  }
}

function failed(input: {
  start: number;
  reason: string;
  source: 'scrape' | 'search';
  sources?: string[];
  inputTokens?: number;
  outputTokens?: number;
}): ScrapeOutcome {
  return {
    status: 'failed',
    summary: '',
    reason: input.reason,
    inputTokens: input.inputTokens ?? 0,
    outputTokens: input.outputTokens ?? 0,
    durationMs: Date.now() - input.start,
    source: input.source,
    sources: input.sources ?? [],
  };
}

export async function runScrapeTask(opts: RunScrapeOpts): Promise<ScrapeOutcome> {
  const start = Date.now();
  const log = opts.logger.child({ taskId: opts.taskId, runner: 'scrape' });
  const targetUrl = extractTargetUrl(opts.intent);
  let scrapeSource: 'scrape' | 'search';
  let observed: Array<{ url: string; markdown: string; title?: string }>;

  if (targetUrl) {
    scrapeSource = 'scrape';
    safeProgress(opts, '正在抓取网页数据…');
    const result = await opts.firecrawl.scrape(targetUrl);
    if (!result.ok) {
      log.warn({ code: 'FIRECRAWL_SCRAPE_FAILED' }, 'scrape-runner: Firecrawl scrape failed');
      return failed({ start, reason: '网页抓取失败，请稍后重试。', source: scrapeSource });
    }
    observed = [
      {
        url: result.url,
        markdown: result.markdown,
        ...(result.title ? { title: result.title } : {}),
      },
    ];
  } else {
    scrapeSource = 'search';
    const query = extractSearchQuery(opts.intent);
    if (!query) {
      return failed({ start, reason: '请输入要搜索的内容。', source: scrapeSource });
    }
    safeProgress(opts, '正在搜索网络数据…');
    const result = await opts.firecrawl.search(query, {
      limit: opts.searchLimit ?? DEFAULT_SEARCH_LIMIT,
    });
    if (!result.ok) {
      log.warn({ code: 'FIRECRAWL_SEARCH_FAILED' }, 'scrape-runner: Firecrawl search failed');
      return failed({ start, reason: '网络搜索失败，请稍后重试。', source: scrapeSource });
    }
    if (result.results.length === 0) {
      return failed({ start, reason: '搜索没有结果，换个关键词试试。', source: scrapeSource });
    }
    observed = result.results.map((item) => ({
      url: item.url,
      markdown: item.markdown,
      ...(item.title ? { title: item.title } : {}),
    }));
  }

  const explicitRole = opts.skillId && opts.skillId !== 'none' ? opts.skillId : null;
  const roleId = explicitRole ?? classifyRole(opts.intent);
  const instructions =
    buildLayeredSystemPrompt(roleId, opts.expertMode) + buildPromptSchemaSuffix(opts.intent);
  const { context, usedSources } = formatScrapedContext(observed);
  const input = `用户的请求：${opts.intent}\n\n下面是从网络上抓取的相关内容。请只基于这些真实数据回答；如果信息不足，明确说明缺什么，不要编造，不要引入未提供的新来源。\n\n--- 抓取内容 ---\n\n${context}`;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  safeProgress(opts, '正在分析整理…');

  try {
    const result = await opts.responsesAdapter.stream(
      {
        instructions,
        input: [{ role: 'user', content: input }],
        tools: [],
        maxOutputTokens: opts.maxTokens ?? DEFAULT_MAX_TOKENS,
      },
      {
        signal: controller.signal,
        timeoutMs,
        onTextDelta(delta) {
          if (!delta) return;
          try {
            opts.onStreamDelta?.(delta);
          } catch {
            log.warn({ code: 'STREAM_CALLBACK_ERROR' }, 'scrape: stream callback failed');
          }
        },
      },
    );
    const summary = result.text.trim();
    if (!summary) {
      return failed({
        start,
        reason: 'AI 没有生成内容，请重试。',
        source: scrapeSource,
        sources: usedSources,
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
      });
    }
    const visibleSummary =
      result.status === 'incomplete'
        ? `${summary}\n\n---\n【提示】内容因长度限制被截断，如需完整版请追问。`
        : summary;
    log.info(
      {
        source: scrapeSource,
        sourcesCount: usedSources.length,
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
        durationMs: Date.now() - start,
        provider: result.metadata.provider,
        model: result.metadata.model,
        region: result.metadata.region,
        deploymentScope: result.metadata.deploymentScope,
      },
      'scrape-runner: completed',
    );
    return {
      status: 'completed',
      summary: visibleSummary,
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
      durationMs: Date.now() - start,
      source: scrapeSource,
      sources: usedSources,
    };
  } catch (error) {
    const timeout =
      controller.signal.aborted ||
      (error instanceof ResponsesAdapterError &&
        (error.code === 'REQUEST_TIMEOUT' || error.code === 'REQUEST_ABORTED'));
    log.warn(
      {
        code: error instanceof ResponsesAdapterError ? error.code : 'UNKNOWN',
        timeout,
      },
      'scrape-runner: Qwen synthesis failed',
    );
    return failed({
      start,
      reason: timeout
        ? `生成超时（>${Math.round(timeoutMs / 1000)} 秒）`
        : '内容整理服务暂时不可用，请稍后重试。',
      source: scrapeSource,
      sources: usedSources,
    });
  } finally {
    clearTimeout(timer);
  }
}
