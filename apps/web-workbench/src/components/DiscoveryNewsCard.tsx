import { ExternalLink, Heart, MoreHorizontal } from 'lucide-react';
import { useState, type KeyboardEvent } from 'react';
import { newsDisplayType, newsTimeLabel, type StockNewsRow } from '@/lib/stock-news';
import { cn } from '@/lib/utils';

export function DiscoveryNewsCard({
  item,
  onOpen,
  onImageError,
  variant = 'standard',
}: {
  item: StockNewsRow;
  onOpen: () => void;
  onImageError?: (imageUrl: string) => void;
  variant?: 'standard' | 'lead' | 'compact';
}): JSX.Element {
  const type = newsDisplayType(item);
  const sourceMedia = item.imageKind === 'source-cover';
  const [imageFailed, setImageFailed] = useState(false);
  const showImage = Boolean(item.imageUrl && !imageFailed);
  const isLead = variant === 'lead';
  const isCompact = variant === 'compact';
  const onKeyDown = (event: KeyboardEvent<HTMLElement>): void => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onOpen();
    }
  };

  return (
    <article
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={onKeyDown}
      className={cn(
        'group min-w-0 overflow-hidden rounded-[8px] border border-[#E7E7EB] bg-white text-left shadow-[0_10px_24px_rgba(18,24,38,0.04)] transition hover:-translate-y-0.5 hover:border-[#EA1F59]/25 hover:shadow-[0_16px_32px_rgba(18,24,38,0.08)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#EA1F59]/20 motion-reduce:hover:translate-y-0',
        isLead ? 'flex min-h-[330px] flex-col sm:grid sm:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]' : 'flex flex-col',
        isCompact ? 'min-h-[154px]' : isLead ? '' : 'min-h-[266px]',
      )}
    >
      {showImage ? (
        <div className={cn(
          'relative shrink-0 overflow-hidden bg-[#EEF1F5]',
          isLead ? 'h-[210px] sm:h-full sm:min-h-[330px]' : isCompact ? 'h-[104px]' : 'h-[132px]',
        )}>
          <img
            src={item.imageUrl}
            alt=""
            loading="lazy"
            onError={() => {
              if (sourceMedia && item.imageUrl && onImageError) {
                onImageError(item.imageUrl);
                return;
              }
              setImageFailed(true);
            }}
            className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.03] motion-reduce:transition-none motion-reduce:group-hover:scale-100"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/35 via-transparent to-black/10" aria-hidden />
          <div className="absolute left-3 top-3 flex items-center gap-2">
            <span className={cn(
              'rounded-full px-2 py-1 text-[11px] font-semibold shadow-sm',
              type === '公告' ? 'bg-white/92 text-[#344054]' : 'bg-[#EA1F59] text-white',
            )}>
              {type}
            </span>
            <span className="rounded-full bg-white/88 px-2 py-1 text-[11px] tabular-nums text-[#667085] shadow-sm">
              {newsTimeLabel(item)}
            </span>
          </div>
          {!sourceMedia ? (
            <span className="absolute bottom-2 right-2 rounded-full bg-black/45 px-2 py-1 text-[10px] font-medium text-white/90">
              主题配图
            </span>
          ) : null}
        </div>
      ) : (
        <div className={cn(
          'flex shrink-0 flex-col border-b border-[#E7EAF0] bg-[#FAFBFC] p-3',
          isLead ? 'min-h-[210px] sm:min-h-[330px]' : isCompact ? 'min-h-[104px]' : 'min-h-[132px]',
        )}>
          <div className="flex items-center gap-2">
            <span className={cn(
              'rounded-full px-2 py-1 text-[11px] font-semibold',
              type === '公告' ? 'bg-white text-[#344054] ring-1 ring-[#E7EAF0]' : 'bg-[#EA1F59] text-white',
            )}>
              {type}
            </span>
            <span className="rounded-full bg-white px-2 py-1 text-[11px] tabular-nums text-[#667085] ring-1 ring-[#E7EAF0]">
              {newsTimeLabel(item)}
            </span>
          </div>
          <p className={cn(
            'mt-3 font-semibold leading-relaxed text-[#344054] transition group-hover:text-[#EA1F59]',
            isLead ? 'line-clamp-4 text-[20px]' : isCompact ? 'line-clamp-2 text-[14px]' : 'line-clamp-3 text-[15px]',
          )}>
            {item.title}
            {item.url ? <ExternalLink className="ml-1 inline h-3 w-3 opacity-60 transition group-hover:opacity-100" aria-hidden /> : null}
          </p>
        </div>
      )}
      <div className={cn('flex flex-1 flex-col', isLead ? 'p-5 sm:p-6' : 'p-3')}>
        {showImage ? (
          <p className={cn(
            'font-semibold leading-relaxed text-[#344054] transition group-hover:text-[#EA1F59]',
            isLead ? 'line-clamp-3 text-[21px]' : isCompact ? 'line-clamp-2 text-[14px]' : 'line-clamp-2 min-h-[48px] text-[15px]',
          )}>
            {item.title}
            {item.url ? <ExternalLink className="ml-1 inline h-3 w-3 opacity-60 transition group-hover:opacity-100" aria-hidden /> : null}
          </p>
        ) : item.summary ? (
          <p className={cn('leading-relaxed text-[#667085]', isLead ? 'line-clamp-5 text-[14px]' : 'line-clamp-2 text-[12px]')}>{item.summary}</p>
        ) : null}
        {showImage && item.summary && (isLead || isCompact) ? (
          <p className={cn('mt-3 leading-relaxed text-[#667085]', isLead ? 'line-clamp-4 text-[14px]' : 'line-clamp-2 text-[12px]')}>{item.summary}</p>
        ) : null}
        <div className={cn('mt-auto flex items-center justify-between gap-2', showImage || item.summary ? 'pt-3' : '')}>
          <div className="flex min-w-0 items-center gap-2">
            <NewsSourceDots />
            <span className="truncate text-[12px] text-[#667085]">
              {item.source ?? '公开来源'}
              {item.symbols.length > 0 ? ` · ${item.symbols.length} 个关联` : ''}
            </span>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={(event) => event.stopPropagation()}
              className="rounded-full p-1.5 text-[#8B92A1] transition hover:bg-[#F7F8FA] hover:text-[#EA1F59]"
              aria-label="收藏动态"
              title="收藏动态"
            >
              <Heart className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={(event) => event.stopPropagation()}
              className="rounded-full p-1.5 text-[#8B92A1] transition hover:bg-[#F7F8FA] hover:text-[#344054]"
              aria-label="更多动态操作"
              title="更多动态操作"
            >
              <MoreHorizontal className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </div>
    </article>
  );
}

function NewsSourceDots(): JSX.Element {
  return (
    <span className="h-3 w-3 shrink-0 rounded-full bg-[#EA1F59]" aria-hidden />
  );
}
