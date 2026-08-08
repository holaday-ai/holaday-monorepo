/**
 * Provider-returned search results are observed evidence, but a model may
 * omit their URLs in its prose. Preserve them as a separate, explicitly
 * labelled section so users can verify the answer without implying that each
 * source proves every sentence in the summary.
 */
export interface SearchSourceReference {
  readonly title: string;
  readonly url: string;
}

const MAX_SOURCE_REFERENCES = 5;

function normaliseHttpUrl(value: string): string | null {
  const url = value.trim();
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? url : null;
  } catch {
    return null;
  }
}

function sourceTitle(title: string, url: string): string {
  const cleaned = title.replace(/[\r\n]+/g, ' ').replace(/[\[\]]/g, '').trim();
  if (cleaned) return cleaned.slice(0, 180);
  return new URL(url).hostname;
}

function urlsAlreadyIn(text: string): Set<string> {
  const rawUrls = text.match(/https?:\/\/[^\s<>)\]]+/gi) ?? [];
  return new Set(rawUrls.map((url) => url.replace(/[.,;:!?，。；：！？]+$/u, '')));
}

/**
 * Append a compact source list from the web-search tool. The caller must only
 * pass sources received from that tool, never URLs inferred from model prose.
 */
export function appendSearchSourceReferences(
  summary: string,
  sources: ReadonlyArray<SearchSourceReference>,
): string {
  if (!summary || sources.length === 0) return summary;

  const seen = urlsAlreadyIn(summary);
  const references: SearchSourceReference[] = [];
  for (const source of sources) {
    const url = normaliseHttpUrl(source.url);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    references.push({ title: sourceTitle(source.title, url), url });
    if (references.length === MAX_SOURCE_REFERENCES) break;
  }

  if (references.length === 0) return summary;
  return [
    summary,
    '',
    '### 检索来源',
    '以下链接由联网检索返回，供核验；结论请以来源正文为准。',
    ...references.map((source) => `- [${source.title}](<${source.url}>)`),
  ].join('\n');
}
