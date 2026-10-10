const SOURCES: Record<string, string> = {
  eastmoney: '东方财富', akshare: 'AkShare', cninfo: '巨潮资讯', sina: '新浪财经',
  sse: '上海证券交易所', szse: '深圳证券交易所',
};
/** Only generated attribution lines; never rewrite URLs or ordinary prose. */
export function formatSourceAttribution(text: string): string {
  return text.replace(/^(来源[：:]?\s+)([a-z][a-z0-9_-]*):[a-z0-9_-]+(\s*·\s*)抓取(?:于)?\s+([^\n]+)$/gim,
    (line, _prefix: string, source: string, separator: string, time: string) =>
      SOURCES[source.toLowerCase()] ? `${SOURCES[source.toLowerCase()]}${separator}抓取于 ${time}` : line);
}

/** Translate only an exact provider/tool identifier used as a search-card title. */
export function formatSourceTitle(title: string): string {
  const match = /^([a-z][a-z0-9_-]*):[a-z0-9_-]+$/i.exec(title.trim());
  return match && SOURCES[match[1].toLowerCase()] ? SOURCES[match[1].toLowerCase()] : title;
}
