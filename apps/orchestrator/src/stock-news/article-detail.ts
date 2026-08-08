import { PDFParse } from 'pdf-parse';

export type NewsContentStatus = 'source-body' | 'source-summary' | 'metadata-only';

export interface NewsDetailInput {
  url: string;
  sourceName: string;
  publishedAt: string;
  summary?: string;
}

export interface NewsDetail {
  url: string;
  contentStatus: NewsContentStatus;
  sourceName: string;
  publishedAt: string;
  summary?: string;
  body?: string[];
  extractedAt?: string;
}

interface ArticleDetailResolverOptions {
  fetchImpl?: typeof globalThis.fetch;
  now?: () => Date;
}

interface CachedDetail {
  expiresAt: number;
  value: Promise<NewsDetail>;
}

const MAX_REDIRECTS = 3;
const MAX_BODY_BYTES = 1_200_000;
const FETCH_TIMEOUT_MS = 8_000;
const CACHE_TTL_MS = 10 * 60_000;
const MAX_PARAGRAPHS = 14;
// The feed can only retrieve articles from this fixed, public-source registry.
// Keeping the registry explicit prevents this reader from becoming an arbitrary
// request proxy while allowing the trusted sources that actually appear in the
// market feed to render inside Holaday.
const ALLOWED_SOURCE_HOSTS = [
  'eastmoney.com',
  'cninfo.com.cn',
  'cls.cn',
  'stcn.com',
  'cnstock.com',
  'caixin.com',
  '21jingji.com',
  'cctv.com',
  'xinhuanet.com',
  'news.cn',
  'chinanews.com.cn',
  'people.com.cn',
  'thepaper.cn',
  'nbd.com.cn',
  'jiemian.com',
  'yicai.com',
  'sina.com.cn',
  'ifeng.com',
  '163.com',
  'qq.com',
] as const;
const detailCache = new Map<string, CachedDetail>();

function fallbackDetail(input: NewsDetailInput): NewsDetail {
  const summary = input.summary?.trim();
  return {
    url: input.url,
    contentStatus: summary ? 'source-summary' : 'metadata-only',
    sourceName: input.sourceName,
    publishedAt: input.publishedAt,
    ...(summary ? { summary } : {}),
  };
}

function isAllowedSourceHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, '');
  return ALLOWED_SOURCE_HOSTS.some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
}

/**
 * Only the existing public article-source hosts are fetchable. The feed's
 * original link remains available for every other source, but arbitrary user
 * input can never turn this endpoint into a server-side request proxy.
 */
export function validateArticleSourceUrl(rawUrl: string): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error('新闻原文链接格式无效。');
  }
  if (url.protocol !== 'https:') {
    throw new Error('新闻正文仅允许通过 https 读取。');
  }
  if (url.username || url.password) {
    throw new Error('新闻原文链接不能包含账号信息。');
  }
  if (!isAllowedSourceHost(url.hostname)) {
    throw new Error('当前仅支持已验证公开来源的正文读取。');
  }
  return url;
}

async function readBodyBytes(response: Response): Promise<Uint8Array | null> {
  const declaredLength = Number(response.headers.get('content-length') ?? '0');
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) return null;
  if (!response.body) return new Uint8Array();

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > MAX_BODY_BYTES) return null;
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

function decodeHtml(value: string): string {
  return value
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#(\d+);/g, (_match, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([\da-f]+);/gi, (_match, code: string) => String.fromCodePoint(Number.parseInt(code, 16)));
}

function plainText(value: string): string {
  return decodeHtml(value
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim());
}

function isReadableParagraph(value: string): boolean {
  if (value.length < 24 || value.length > 1_000) return false;
  return !/^(责任编辑|免责声明|版权声明|点击查看|更多精彩内容)/.test(value);
}

function uniqueReadableParagraphs(paragraphs: string[]): string[] {
  return Array.from(new Set(paragraphs)).slice(0, MAX_PARAGRAPHS);
}

function articleBodyParagraphs(value: string): string[] {
  const sourceText = decodeHtml(value
    .replace(/<br\s*\/?>/gi, '\n\n')
    .replace(/<\/p\s*>/gi, '\n\n')
    .replace(/<[^>]+>/g, ' '));
  const explicitParagraphs = sourceText
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.replace(/\s+/g, ' ').trim())
    .filter(isReadableParagraph);
  if (explicitParagraphs.length > 0) return uniqueReadableParagraphs(explicitParagraphs);
  const text = sourceText.replace(/\s+/g, ' ').trim();
  if (isReadableParagraph(text)) return [text];
  return [];
}

function jsonLdArticleParagraphs(html: string): string[] {
  const paragraphs: string[] = [];
  const scripts = Array.from(html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi));
  for (const script of scripts) {
    if (!/type\s*=\s*["']application\/ld\+json["']/i.test(script[1] ?? '')) continue;
    try {
      const parsed: unknown = JSON.parse(script[2] ?? '');
      const queue: unknown[] = Array.isArray(parsed) ? [...parsed] : [parsed];
      const seen = new Set<unknown>();
      while (queue.length > 0) {
        const current = queue.shift();
        if (!current || typeof current !== 'object' || seen.has(current)) continue;
        seen.add(current);
        const record = current as Record<string, unknown>;
        if (typeof record.articleBody === 'string') paragraphs.push(...articleBodyParagraphs(record.articleBody));
        if (Array.isArray(record['@graph'])) queue.push(...record['@graph']);
        if (Array.isArray(record.mainEntity)) queue.push(...record.mainEntity);
      }
    } catch {
      // A malformed structured-data payload must not block normal paragraph extraction.
    }
  }
  return uniqueReadableParagraphs(paragraphs);
}

export function htmlArticleParagraphs(html: string): string[] {
  const sanitized = html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, ' ');
  const paragraphs = Array.from(sanitized.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi))
    .map((match) => plainText(match[1] ?? ''))
    .filter(isReadableParagraph);
  return paragraphs.length > 0 ? uniqueReadableParagraphs(paragraphs) : jsonLdArticleParagraphs(html);
}

async function pdfArticleParagraphs(bytes: Uint8Array): Promise<string[]> {
  let parser: InstanceType<typeof PDFParse> | null = null;
  try {
    parser = new PDFParse({ data: bytes });
    const text = ((await parser.getText()) as { text?: string }).text ?? '';
    return text
      .split(/\n{2,}/)
      .map((paragraph) => paragraph.replace(/\s+/g, ' ').trim())
      .filter(isReadableParagraph)
      .slice(0, MAX_PARAGRAPHS);
  } catch {
    return [];
  } finally {
    await parser?.destroy().catch(() => undefined);
  }
}

async function fetchSourceParagraphs(
  initialUrl: URL,
  fetchImpl: typeof globalThis.fetch,
): Promise<string[]> {
  let currentUrl = initialUrl;
  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
    const response = await fetchImpl(currentUrl, {
      headers: {
        accept: 'text/html,application/pdf;q=0.9,*/*;q=0.1',
        'user-agent': 'HoladayNewsReader/1.0 (+https://holaday.ai)',
      },
      redirect: 'manual',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location || redirects === MAX_REDIRECTS) return [];
      currentUrl = validateArticleSourceUrl(new URL(location, currentUrl).href);
      continue;
    }
    if (!response.ok) return [];

    const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
    const bytes = await readBodyBytes(response);
    if (!bytes || bytes.length === 0) return [];
    if (contentType.includes('text/html') || contentType.includes('application/xhtml+xml')) {
      return htmlArticleParagraphs(new TextDecoder().decode(bytes));
    }
    if (contentType.includes('application/pdf')) return pdfArticleParagraphs(bytes);
    return [];
  }
  return [];
}

function cacheKey(input: NewsDetailInput): string {
  return `${input.url}\u0000${input.summary?.trim() ?? ''}`;
}

function pruneExpiredCache(now: number): void {
  for (const [key, cached] of detailCache) {
    if (cached.expiresAt <= now) detailCache.delete(key);
  }
}

export async function resolveNewsDetail(
  input: NewsDetailInput,
  options: ArticleDetailResolverOptions = {},
): Promise<NewsDetail> {
  const now = options.now ?? (() => new Date());
  const nowMs = now().getTime();
  pruneExpiredCache(nowMs);
  const key = cacheKey(input);
  const cached = detailCache.get(key);
  if (cached) return cached.value;

  const value = (async (): Promise<NewsDetail> => {
    let url: URL;
    try {
      url = validateArticleSourceUrl(input.url);
    } catch {
      return fallbackDetail(input);
    }
    try {
      const paragraphs = await fetchSourceParagraphs(url, options.fetchImpl ?? globalThis.fetch);
      if (paragraphs.length === 0) return fallbackDetail(input);
      return {
        ...fallbackDetail(input),
        contentStatus: 'source-body',
        body: paragraphs,
        extractedAt: now().toISOString(),
      };
    } catch {
      return fallbackDetail(input);
    }
  })();
  detailCache.set(key, { expiresAt: nowMs + CACHE_TTL_MS, value });
  return value;
}

export function clearNewsDetailCacheForTest(): void {
  detailCache.clear();
}
