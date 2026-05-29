import { ChevronDown, ChevronUp, ExternalLink, Globe2 } from 'lucide-react';
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
      <div className="overflow-hidden rounded-[8px] border border-[#DCDDDD] bg-white shadow-[0_1px_3px_rgba(17,24,39,0.05)] dark:border-white/10 dark:bg-card/85">
        <div className="flex items-center justify-between gap-3 border-b border-[#EFEFEF] bg-[#EFEFEF]/35 px-3 py-2 dark:border-white/10 dark:bg-white/[0.03]">
          <div className="flex min-w-0 items-center gap-2">
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[#42C0EF]" />
            <span className="truncate text-[11px] font-medium text-foreground/80">
              搜索来源
            </span>
          </div>
          <span className="shrink-0 text-[11px] text-muted-foreground">
            {safeSources.length} 条
          </span>
        </div>
        {visible.map(({ source, link }, i) => (
          <SourceRow
            key={`${link.href}-${i}`}
            index={i + 1}
            source={source}
            link={link}
            onOpen={setPendingHref}
          />
        ))}
      </div>
      {safeSources.length > initialVisible && (
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          className="mt-1.5 inline-flex h-7 items-center gap-1.5 self-start rounded-[8px] px-2 text-xs text-muted-foreground transition-colors hover:bg-[#EFEFEF] hover:text-[#EA1F59] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#EA1F59]/15 dark:hover:bg-white/5"
          aria-label={expanded ? '收起来源' : `展开 ${hidden} 条更多来源`}
          title={expanded ? '收起来源' : `展开 ${hidden} 条更多来源`}
        >
          {expanded ? (
            <ChevronUp className="h-3.5 w-3.5" aria-hidden />
          ) : (
            <>
              <ChevronDown className="h-3.5 w-3.5" aria-hidden />
              <span className="font-medium tabular-nums">+{hidden}</span>
            </>
          )}
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
  index,
  source,
  link,
  onOpen,
}: {
  index: number;
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
      aria-label={`打开搜索来源：${source.title}`}
      className="group flex items-start gap-2.5 border-b border-[#EFEFEF] px-3 py-2.5 transition-colors last:border-b-0 hover:bg-[#EFEFEF]/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#EA1F59]/15 dark:border-white/10 dark:hover:bg-white/[0.04]"
    >
      <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-[#DCDDDD] bg-white text-[10px] font-medium text-[#595757] shadow-[0_1px_2px_rgba(17,24,39,0.04)] dark:border-white/10 dark:bg-white/5 dark:text-foreground/70">
        {index}
      </span>
      <span className="relative mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center overflow-hidden rounded-[6px] border border-[#DCDDDD]/80 bg-[#EFEFEF]/55 text-[#42C0EF] dark:border-white/10 dark:bg-white/5">
        <Globe2 className="h-3 w-3" />
        <img
          src={faviconUrl}
          alt=""
          width={20}
          height={20}
          loading="lazy"
          className="absolute inset-0 h-full w-full object-cover"
          onError={(e) => {
            (e.currentTarget as HTMLImageElement).remove();
          }}
        />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
          <span className="truncate">{link.domain}</span>
          <span aria-hidden className="shrink-0 text-muted-foreground/45">/</span>
          <span className="truncate text-muted-foreground/80">{link.pathLabel}</span>
        </div>
        <div className="mt-0.5 flex min-w-0 items-start gap-2">
          <span className="line-clamp-2 flex-1 text-sm font-medium leading-snug text-foreground transition-colors group-hover:text-[#EA1F59]">
            {source.title}
          </span>
          <ExternalLink className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground/55 transition-colors group-hover:text-[#EA1F59]" />
        </div>
        {source.snippet && (
          <div className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
            {source.snippet}
          </div>
        )}
      </div>
    </a>
  );
}
