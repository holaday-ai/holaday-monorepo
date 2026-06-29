import * as React from 'react';
import { RefreshCw } from 'lucide-react';
import { lazyLoadErrorCopy } from '@/lib/lazy-load-error';

interface LazyLoadBoundaryProps {
  readonly children: React.ReactNode;
  readonly surfaceLabel?: string;
  readonly resetKey?: string | number | null;
  /**
   * Optional fallback shown when a lazy chunk failed because the app
   * version changed. Used for task detail: the rich stream chunk may be
   * stale, but the parent still has enough task data to let the user
   * read the historical result without a hard blocker.
   */
  readonly staleVersionFallback?: React.ReactNode;
}

interface LazyLoadBoundaryState {
  readonly error: unknown;
}

export class LazyLoadBoundary extends React.Component<
  LazyLoadBoundaryProps,
  LazyLoadBoundaryState
> {
  state: LazyLoadBoundaryState = { error: null };

  static getDerivedStateFromError(error: unknown): LazyLoadBoundaryState {
    return { error };
  }

  componentDidUpdate(prevProps: LazyLoadBoundaryProps): void {
    if (
      this.state.error !== null &&
      prevProps.resetKey !== this.props.resetKey
    ) {
      this.setState({ error: null });
    }
  }

  render(): React.ReactNode {
    if (this.state.error !== null) {
      return (
        <LazyLoadFallback
          error={this.state.error}
          surfaceLabel={this.props.surfaceLabel}
          staleVersionFallback={this.props.staleVersionFallback}
        />
      );
    }
    return this.props.children;
  }
}

export function RouteLoadingFallback(): JSX.Element {
  return (
    <div
      aria-label="页面加载中"
      aria-live="polite"
      className="flex min-h-[320px] w-full items-start justify-center px-4 py-10 sm:px-6"
    >
      <div className="w-full max-w-[720px] pt-[7vh]">
        <div className="hola-skel mx-auto mb-6 h-7 w-48 bg-[#DCDDDD]/80" />
        <div className="rounded-[8px] border border-[#DCDDDD]/75 bg-white/75 p-4 shadow-[0_8px_24px_rgba(89,87,87,0.06)]">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-[8px] bg-[#EA1F59]/90 shadow-[0_8px_18px_rgba(234,31,89,0.16)]" />
            <div className="min-w-0 flex-1 space-y-2">
              <div className="hola-skel h-3.5 w-1/2 max-w-56 bg-[#DCDDDD]/80" />
              <div className="hola-skel h-2.5 w-1/3 max-w-40 bg-[#EFEFEF]" />
            </div>
          </div>
          <div className="mt-6 grid gap-2 sm:grid-cols-3">
            <div className="hola-skel h-16 rounded-[8px] bg-[#EFEFEF]/80" />
            <div className="hola-skel h-16 rounded-[8px] bg-[#EFEFEF]/80" />
            <div className="hola-skel h-16 rounded-[8px] bg-[#EFEFEF]/80" />
          </div>
          <div className="mt-5 space-y-2">
            <div className="hola-skel h-3 w-full bg-[#EFEFEF]/85" />
            <div className="hola-skel h-3 w-5/6 bg-[#EFEFEF]/85" />
            <div className="hola-skel h-3 w-2/3 bg-[#EFEFEF]/85" />
          </div>
        </div>
      </div>
    </div>
  );
}

function LazyLoadFallback({
  error,
  surfaceLabel,
  staleVersionFallback,
}: {
  readonly error: unknown;
  readonly surfaceLabel?: string;
  readonly staleVersionFallback?: React.ReactNode;
}): JSX.Element {
  const copy = lazyLoadErrorCopy(error, surfaceLabel);
  if (staleVersionFallback && copy.kind === 'stale_version') {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6">
        <div className="mb-4 rounded-[8px] border border-[#FFC910]/55 bg-white px-4 py-3 text-left shadow-[0_8px_24px_rgba(89,87,87,0.06)] dark:border-[#FFC910]/35 dark:bg-card">
          <div className="flex items-start gap-2.5">
            <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] bg-[#FFC910]/12 text-[#57479C]">
              <RefreshCw className="h-4 w-4" aria-hidden />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold text-[#595757] dark:text-foreground">
                {copy.title}
              </div>
              <p className="mt-1 text-sm leading-6 text-[#595757]/75 dark:text-muted-foreground">
                {copy.body}
              </p>
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="mt-2 inline-flex h-8 items-center justify-center rounded-[8px] bg-[#EA1F59] px-3 text-xs font-medium text-white shadow-[0_8px_18px_rgba(234,31,89,0.16)] transition-colors hover:bg-[#d81b52]"
              >
                {copy.actionLabel}
              </button>
            </div>
          </div>
        </div>
        {staleVersionFallback}
      </div>
    );
  }
  return (
    <div className="flex min-h-[260px] items-center justify-center px-4 py-8">
      <div className="w-full max-w-md rounded-[8px] border border-[#DCDDDD] bg-white px-5 py-4 text-center shadow-[0_12px_32px_rgba(89,87,87,0.10)] dark:border-border dark:bg-card">
        <div className="mx-auto mb-3 flex h-9 w-9 items-center justify-center rounded-[8px] bg-[#EA1F59]/10 text-[#EA1F59]">
          <RefreshCw className="h-4 w-4" aria-hidden />
        </div>
        <div className="text-sm font-semibold text-[#595757] dark:text-foreground">{copy.title}</div>
        <p className="mt-2 text-sm leading-6 text-[#595757]/75 dark:text-muted-foreground">{copy.body}</p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="mt-4 inline-flex h-9 items-center justify-center rounded-[8px] bg-[#EA1F59] px-3 text-sm font-medium text-white shadow-[0_8px_18px_rgba(234,31,89,0.16)] transition-colors hover:bg-[#d81b52]"
        >
          {copy.actionLabel}
        </button>
      </div>
    </div>
  );
}
