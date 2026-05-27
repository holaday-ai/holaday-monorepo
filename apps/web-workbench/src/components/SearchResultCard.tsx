import * as React from 'react';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { externalLinkConfirmDescription } from '@/lib/external-link-copy';
import {
  buildSearchSourceLink,
  type SearchSourceLink,
} from '@/lib/search-source-link';

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
 * Click asks for confirmation before opening the URL in a new tab.
 * Used inside the per-iteration `WebSearchLine` so users can see
 * WHERE the agent's information came from, not just that a search
 * happened.
 */
export function SearchResultCard({ sources, initialVisible = 6 }: Props): JSX.Element | null {
  const [expanded, setExpanded] = React.useState(false);
  const [pendingHref, setPendingHref] = React.useState<string | null>(null);
  const safeSources = React.useMemo(
    () =>
      sources
        .map((source) => ({ source, link: buildSearchSourceLink(source.url) }))
        .filter(
          (row): row is { source: SearchSource; link: SearchSourceLink } =>
            row.link !== null,
        ),
    [sources],
  );
  if (safeSources.length === 0) return null;
  const visible = expanded ? safeSources : safeSources.slice(0, initialVisible);
  const hidden = safeSources.length - visible.length;
  return (
    <div className="mt-2 flex flex-col">
      <div className="overflow-hidden rounded-[8px] border border-[#DCDDDD] bg-white shadow-[0_1px_2px_rgba(15,23,42,0.02)]">
        {visible.map(({ source, link }, i) => (
          <SourceRow
            key={`${link.href}-${i}`}
            source={source}
            link={link}
            onOpen={setPendingHref}
          />
        ))}
      </div>
      {hidden > 0 && !expanded && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="mt-1.5 inline-flex items-center gap-1 self-start rounded-[8px] px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-[#EFEFEF] hover:text-[#EA1F59]"
        >
          <span aria-hidden className="text-[10px]">▾</span>
          展开 {hidden} 条更多来源
        </button>
      )}
      <ConfirmDialog
        open={pendingHref !== null}
        title="即将打开外部链接"
        description={
          pendingHref ? externalLinkConfirmDescription(pendingHref) : undefined
        }
        confirmLabel="打开"
        cancelLabel="取消"
        onClose={() => setPendingHref(null)}
        onConfirm={() => {
          const href = pendingHref;
          setPendingHref(null);
          if (href) window.open(href, '_blank', 'noopener,noreferrer');
        }}
      />
    </div>
  );
}

function SourceRow({
  source,
  link,
  onOpen,
}: {
  source: SearchSource;
  link: SearchSourceLink;
  onOpen: (href: string) => void;
}): JSX.Element {
  const faviconUrl = `https://www.google.com/s2/favicons?domain=${encodeURIComponent(link.domain)}&sz=32`;
  return (
    <a
      href={link.href}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => {
        e.preventDefault();
        onOpen(link.href);
      }}
      className="group flex items-start gap-2.5 border-b border-[#EFEFEF] px-3 py-2.5 transition-colors last:border-b-0 hover:bg-[#EFEFEF]/50"
    >
      <img
        src={faviconUrl}
        alt=""
        width={16}
        height={16}
        loading="lazy"
        className="mt-0.5 h-4 w-4 shrink-0 rounded-[4px]"
        onError={(e) => {
          (e.currentTarget as HTMLImageElement).style.visibility = 'hidden';
        }}
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-xs text-muted-foreground">{link.domain}</span>
        </div>
        <div className="truncate text-sm font-medium text-foreground group-hover:text-[#EA1F59]">
          {source.title}
        </div>
        {source.snippet && (
          <div className="line-clamp-2 text-xs text-muted-foreground">{source.snippet}</div>
        )}
      </div>
    </a>
  );
}
