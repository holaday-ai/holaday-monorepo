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
    <div className="mt-2 flex flex-col gap-1.5">
      {visible.map((s, i) => (
        <SourceRow key={`${s.url}-${i}`} source={s} />
      ))}
      {hidden > 0 && !expanded && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="self-start text-[12px] text-muted-foreground hover:text-foreground"
        >
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
      className="group flex items-start gap-2 rounded-md border border-border/40 bg-background/40 px-2 py-1.5 text-[12px] transition-colors hover:border-border hover:bg-foreground/[0.03]"
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
          <span className="text-[11px] text-muted-foreground">{domain}</span>
        </div>
        <div className="truncate font-medium text-foreground group-hover:underline">
          {source.title}
        </div>
        {source.snippet && (
          <div className="line-clamp-2 text-muted-foreground/80">{source.snippet}</div>
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
