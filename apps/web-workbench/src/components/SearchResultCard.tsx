import * as React from 'react';

export interface SearchSource {
  /** Page title from the search engine. Trimmed; never empty. */
  title: string;
  /** Absolute URL. Used as the link target and to derive the favicon. */
  url: string;
  /** Optional snippet / description from the search result. */
  snippet?: string;
}

interface Props {
  sources: readonly SearchSource[];
  /** Defaults to 6 — the rest collapse behind a "+N more" toggle. */
  initialVisible?: number;
}

/**
 * Renders a list of web-search source cards Claude-style: row of
 * favicon + domain + title, with the snippet on the second line.
 * Click opens the URL in a new tab. Used inside the per-iteration
 * `WebSearchLine` so users can see WHERE the agent's information
 * came from, not just that a search happened.
 */
export function SearchResultCard({ sources, initialVisible = 6 }: Props): JSX.Element | null {
  const [expanded, setExpanded] = React.useState(false);
  if (!sources || sources.length === 0) return null;
  const visible = expanded ? sources : sources.slice(0, initialVisible);
  const hidden = sources.length - visible.length;
  return (
    <div className="mt-2 flex flex-col">
      <div className="divide-y divide-border/40">
        {visible.map((s, i) => (
          <SourceRow key={`${s.url}-${i}`} source={s} />
        ))}
      </div>
      {hidden > 0 && !expanded && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="mt-1.5 inline-flex items-center gap-1 self-start text-xs text-muted-foreground hover:text-foreground"
        >
          <span aria-hidden className="text-[10px]">▾</span>
          展开 {hidden} 条更多来源
        </button>
      )}
    </div>
  );
}

function SourceRow({ source }: { source: SearchSource }): JSX.Element {
  const domain = safeDomain(source.url);
  const faviconUrl = `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=32`;
  return (
    <a
      href={source.url}
      target="_blank"
      rel="noopener noreferrer"
      className="group flex items-start gap-2.5 px-1 py-2 transition-colors hover:bg-foreground/[0.03]"
    >
      <img
        src={faviconUrl}
        alt=""
        width={16}
        height={16}
        loading="lazy"
        className="mt-0.5 h-4 w-4 shrink-0 rounded-sm"
        onError={(e) => {
          (e.currentTarget as HTMLImageElement).style.visibility = 'hidden';
        }}
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-muted-foreground">{domain}</span>
        </div>
        <div className="truncate text-sm font-medium text-foreground group-hover:underline">
          {source.title}
        </div>
        {source.snippet && (
          <div className="line-clamp-2 text-xs text-muted-foreground">{source.snippet}</div>
        )}
      </div>
    </a>
  );
}

function safeDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url.slice(0, 40);
  }
}
