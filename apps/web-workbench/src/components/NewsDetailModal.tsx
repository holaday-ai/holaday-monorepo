import { Check, ChevronLeft, ChevronRight, Copy, FileText, Loader2, X } from 'lucide-react';
import * as React from 'react';
import { newsDisplayType, newsTimeLabel, type StockNewsRow } from '@/lib/stock-news';
import { trpc } from '@/lib/trpc';
import { cn } from '@/lib/utils';

type SourceDetail = Awaited<ReturnType<typeof trpc.stocks.newsDetail.query>>;

export function NewsDetailModal({
  news,
  activeIndex,
  onClose,
  onChangeIndex,
}: {
  news: StockNewsRow[];
  activeIndex: number | null;
  onClose: () => void;
  onChangeIndex: (index: number | null) => void;
}): JSX.Element | null {
  const closeRef = React.useRef<HTMLButtonElement>(null);
  const item = activeIndex === null ? null : news[activeIndex] ?? null;
  const [detail, setDetail] = React.useState<SourceDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = React.useState(false);
  const [detailUnavailable, setDetailUnavailable] = React.useState(false);
  const [showSourceUrl, setShowSourceUrl] = React.useState(false);
  const [sourceUrlCopied, setSourceUrlCopied] = React.useState(false);
  const hasPrevious = activeIndex !== null && activeIndex > 0;
  const hasNext = activeIndex !== null && activeIndex < news.length - 1;

  React.useEffect(() => {
    if (!item?.url) {
      setDetail(null);
      setLoadingDetail(false);
      setDetailUnavailable(false);
      return;
    }
    let alive = true;
    setDetail(null);
    setLoadingDetail(true);
    setDetailUnavailable(false);
    setShowSourceUrl(false);
    setSourceUrlCopied(false);
    void trpc.stocks.newsDetail.query({
      url: item.url,
      sourceName: item.source ?? '公开来源',
      publishedAt: item.publishedAt ?? item.time,
      summary: item.summary,
    }).then((result) => {
      if (alive) setDetail(result);
    }).catch(() => {
      if (alive) setDetailUnavailable(true);
    }).finally(() => {
      if (alive) setLoadingDetail(false);
    });
    return () => {
      alive = false;
    };
  }, [item?.publishedAt, item?.source, item?.summary, item?.time, item?.url]);

  React.useEffect(() => {
    if (!item) return;
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
      if (event.key === 'ArrowLeft' && hasPrevious && activeIndex !== null) {
        event.preventDefault();
        onChangeIndex(activeIndex - 1);
      }
      if (event.key === 'ArrowRight' && hasNext && activeIndex !== null) {
        event.preventDefault();
        onChangeIndex(activeIndex + 1);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [activeIndex, hasNext, hasPrevious, item, onChangeIndex, onClose]);

  if (!item || activeIndex === null) return null;

  const type = newsDisplayType(item);
  const body = detail?.contentStatus === 'source-body' ? detail.body ?? [] : [];
  const hasSourceSummary = Boolean(detail?.summary ?? item.summary?.trim());
  const summary = detail?.summary ?? item.summary?.trim();
  const contentLabel = detail?.contentStatus === 'source-body'
    ? '已提取公开来源正文'
    : hasSourceSummary
      ? '来源摘要'
      : '仅保留来源记录';
  const sourceMedia = item.imageKind === 'source-cover';
  const readerItemKey = item.url ?? `${item.publishedAt ?? item.time}:${item.title}`;
  const copySourceUrl = async (): Promise<void> => {
    if (!item.url) return;
    try {
      await navigator.clipboard.writeText(item.url);
      setSourceUrlCopied(true);
    } catch {
      setSourceUrlCopied(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/35 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="stock-news-dialog-title"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <article className="flex h-[min(92vh,860px)] w-[min(94vw,980px)] flex-col overflow-hidden rounded-[12px] border border-[#DCDDDD] bg-[#FBFAF8] shadow-[0_24px_80px_rgba(17,24,39,0.24)]">
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-[#E4E1DC] bg-[#FBFAF8] px-5 py-3">
          <div className="flex min-w-0 items-center gap-2">
            <span className={cn(
              'rounded-full px-2.5 py-1 text-[12px] font-semibold',
              type === '公告' ? 'bg-white text-[#344054] ring-1 ring-[#E1E3E8]' : 'bg-[#EA1F59] text-white',
            )}>
              {type}
            </span>
            <span className="truncate text-[12px] text-[#667085]">
              {item.source ?? '公开来源'} · {newsTimeLabel(item)}
            </span>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={() => onChangeIndex(activeIndex - 1)}
              disabled={!hasPrevious}
              className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-[#E1E3E8] bg-white text-[#667085] transition hover:border-[#EA1F59]/25 hover:text-[#EA1F59] disabled:cursor-not-allowed disabled:opacity-40"
              aria-label="上一条"
              title="上一条"
            >
              <ChevronLeft className="h-4 w-4" aria-hidden />
            </button>
            <button
              type="button"
              onClick={() => onChangeIndex(activeIndex + 1)}
              disabled={!hasNext}
              className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-[#E1E3E8] bg-white text-[#667085] transition hover:border-[#EA1F59]/25 hover:text-[#EA1F59] disabled:cursor-not-allowed disabled:opacity-40"
              aria-label="下一条"
              title="下一条"
            >
              <ChevronRight className="h-4 w-4" aria-hidden />
            </button>
            <button
              ref={closeRef}
              type="button"
              onClick={onClose}
              className="inline-flex h-8 w-8 items-center justify-center rounded-full text-[#667085] transition hover:bg-white hover:text-[#121826]"
              aria-label="关闭"
              title="关闭"
            >
              <X className="h-4 w-4" aria-hidden />
            </button>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-6 sm:px-8 lg:px-10">
          <div className="mx-auto max-w-[760px]">
            <div className="mb-4 flex flex-wrap items-center gap-2 text-[12px] text-[#667085]">
              <span>{activeIndex + 1} / {news.length}</span>
              {item.symbols.length > 0 ? (
                <>
                  <span className="h-1 w-1 rounded-full bg-[#CBD0DA]" />
                  <span className="truncate">关联：{item.symbols.join('、')}</span>
                </>
              ) : null}
            </div>
            <h2 id="stock-news-dialog-title" className="text-[28px] font-semibold leading-tight tracking-normal text-[#242424] sm:text-[34px]">
              {item.title}
            </h2>

            {item.imageUrl ? (
              <figure key={readerItemKey} className="mt-6 overflow-hidden rounded-[10px] border border-[#E4E8EF] bg-[#F1F3F6]">
                <img key={`${readerItemKey}:${item.imageUrl}`} src={item.imageUrl} alt="" className="max-h-[340px] w-full object-cover" />
                <figcaption className="border-t border-[#E4E8EF] bg-white px-3 py-2 text-[11px] text-[#667085]">
                  {sourceMedia ? '来源配图' : '与当前内容关联的主题配图'}
                </figcaption>
              </figure>
            ) : null}

            <section className="mt-6 flex items-start gap-3 rounded-[10px] border border-[#E4E8EF] bg-[#F8FAFC] px-4 py-4">
              <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-[8px] bg-white text-[#667085] shadow-sm ring-1 ring-[#E8ECF2]">
                <FileText className="h-4 w-4" aria-hidden />
              </span>
              <div className="min-w-0">
                <p className="text-[13px] font-semibold text-[#344054]">来源与阅读边界</p>
                <p className="mt-1 text-[13px] leading-6 text-[#667085]">
                  {item.source ?? '公开来源'} · {newsTimeLabel(item)} · {contentLabel}。正文在当前弹窗内阅读；站内只展示来源返回字段或从已验证来源提取的文本。
                </p>
              </div>
            </section>

            <div className="mt-7 space-y-5">
              <section>
                <h3 className="text-[16px] font-semibold text-[#242424]">
                  {detail?.contentStatus === 'source-body' ? '原文正文' : contentLabel}
                </h3>
                <div className="mt-3 space-y-3 text-[15px] leading-8 text-[#3F4652]">
                  {loadingDetail ? (
                    <p className="inline-flex items-center gap-2 text-[#667085]">
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                      正在核对公开来源正文…
                    </p>
                  ) : body.length > 0 ? body.map((paragraph) => <p key={paragraph}>{paragraph}</p>) : summary ? (
                    <p>{summary}</p>
                  ) : (
                    <p>当前未收到可展示的来源摘要或正文。来源链接仍可在本页展开核对。</p>
                  )}
                </div>
                {!loadingDetail && detail?.contentStatus !== 'source-body' ? (
                  <p className="mt-4 rounded-[8px] border border-dashed border-[#D7DCE5] bg-[#FCFCFD] px-3 py-2.5 text-[12px] leading-6 text-[#667085]">
                    {detailUnavailable
                      ? '正文读取暂不可用，未使用补写内容替代。'
                      : '正文暂未从已验证来源提取，未使用补写内容替代。'}
                  </p>
                ) : null}
              </section>

              {item.url ? (
                <section className="rounded-[10px] border border-[#E4E8EF] bg-white px-4 py-3">
                  <button
                    type="button"
                    onClick={() => setShowSourceUrl((visible) => !visible)}
                    className="inline-flex h-8 items-center gap-2 text-[13px] font-medium text-[#4F5868] transition hover:text-[#EA1F59]"
                    aria-expanded={showSourceUrl}
                  >
                    <FileText className="h-3.5 w-3.5" aria-hidden />
                    {showSourceUrl ? '收起来源链接' : '查看来源链接'}
                  </button>
                  {showSourceUrl ? (
                    <div className="mt-3 flex flex-col gap-2 border-t border-[#EEF0F3] pt-3 sm:flex-row sm:items-center">
                      <code className="min-w-0 flex-1 break-all text-[12px] leading-5 text-[#667085]">{item.url}</code>
                      <button
                        type="button"
                        onClick={() => void copySourceUrl()}
                        className="inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-[7px] border border-[#E1E3E8] bg-white px-2.5 text-[12px] font-medium text-[#4F5868] transition hover:border-[#EA1F59]/25 hover:text-[#EA1F59]"
                      >
                        {sourceUrlCopied ? <Check className="h-3.5 w-3.5" aria-hidden /> : <Copy className="h-3.5 w-3.5" aria-hidden />}
                        {sourceUrlCopied ? '已复制' : '复制链接'}
                      </button>
                    </div>
                  ) : null}
                </section>
              ) : null}

              <section className="rounded-[10px] border border-[#E4E1DC] bg-white px-4 py-3">
                <div className="grid gap-3 text-[13px] text-[#4F5868] sm:grid-cols-3">
                  <NewsDetailMetric label="类型" value={type} />
                  <NewsDetailMetric label="来源" value={item.source ?? '公开来源'} />
                  <NewsDetailMetric label="关联标的" value={item.symbols.length > 0 ? item.symbols.join('、') : '暂无'} />
                </div>
              </section>
            </div>
          </div>
        </div>

        <footer className="flex shrink-0 flex-col gap-3 border-t border-[#E4E1DC] bg-[#FBFAF8] px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-[12px] leading-relaxed text-[#667085]">站内阅读保留来源边界；发布时间与完整语境以公开来源为准。</div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-9 items-center justify-center rounded-[8px] bg-[#121826] px-3 text-[13px] font-medium text-white transition hover:bg-[#242B3A]"
            >
              关闭
            </button>
          </div>
        </footer>
      </article>
    </div>
  );
}

function NewsDetailMetric({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="min-w-0">
      <div className="text-[11px] text-[#8B92A1]">{label}</div>
      <div className="mt-1 truncate font-medium text-[#121826]" title={value}>{value}</div>
    </div>
  );
}
