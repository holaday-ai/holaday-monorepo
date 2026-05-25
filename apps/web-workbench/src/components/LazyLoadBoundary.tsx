import * as React from 'react';
import { lazyLoadErrorCopy } from '@/lib/lazy-load-error';

interface LazyLoadBoundaryProps {
  readonly children: React.ReactNode;
  readonly surfaceLabel?: string;
  readonly resetKey?: string | number | null;
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
        />
      );
    }
    return this.props.children;
  }
}

function LazyLoadFallback({
  error,
  surfaceLabel,
}: {
  readonly error: unknown;
  readonly surfaceLabel?: string;
}): JSX.Element {
  const copy = lazyLoadErrorCopy(error, surfaceLabel);
  return (
    <div className="flex min-h-[260px] items-center justify-center px-4 py-8">
      <div className="w-full max-w-md rounded-lg border border-border bg-card px-5 py-4 text-center shadow-sm">
        <div className="text-sm font-semibold text-foreground">{copy.title}</div>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">{copy.body}</p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="mt-4 inline-flex h-9 items-center justify-center rounded-md bg-foreground px-3 text-sm font-medium text-background transition-colors hover:bg-foreground/85"
        >
          {copy.actionLabel}
        </button>
      </div>
    </div>
  );
}
