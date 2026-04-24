import { ArrowLeft } from 'lucide-react';
import * as React from 'react';
import { Link } from 'react-router-dom';
import { cn } from '@/lib/utils';

interface Props {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  /** Override the back-link target. Default: `/` (workbench). */
  backTo?: string;
  backLabel?: string;
  /** Tighten max-w for text-heavy pages (legal). Default: `5xl`. */
  width?: '2xl' | '3xl' | '4xl' | '5xl' | '6xl';
}

/**
 * Common shell for secondary product pages. Centers a max-width
 * container on the page background, shows a sticky header with a
 * back-arrow link, and renders children below.
 *
 * Uses the shadcn token palette so it tracks light/dark theme with
 * the rest of the app — no bespoke colors.
 */
export function PageShell({
  title,
  subtitle,
  children,
  backTo = '/',
  backLabel = '返回',
  width = '5xl',
}: Props): JSX.Element {
  const widthClass = {
    '2xl': 'max-w-2xl',
    '3xl': 'max-w-3xl',
    '4xl': 'max-w-4xl',
    '5xl': 'max-w-5xl',
    '6xl': 'max-w-6xl',
  }[width];

  return (
    <div className="min-h-full w-full overflow-y-auto bg-background text-foreground">
      <header className="sticky top-0 z-30 border-b border-border bg-background/80 backdrop-blur-xl">
        <div className={cn('mx-auto flex items-center gap-3 px-4 py-3 md:px-6', widthClass)}>
          <Link
            to={backTo}
            className="inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-sm text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
            <span>{backLabel}</span>
          </Link>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-sm font-semibold tracking-tight">{title}</h1>
            {subtitle && (
              <p className="truncate text-[11px] text-muted-foreground">{subtitle}</p>
            )}
          </div>
        </div>
      </header>
      <main className={cn('mx-auto px-4 py-8 md:px-6 md:py-10', widthClass)}>{children}</main>
    </div>
  );
}

/**
 * Card-style section used on most secondary pages. Consistent rounded
 * border + card bg so pages feel like part of one system.
 */
export function Section({
  title,
  description,
  children,
  className,
}: {
  title?: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
}): JSX.Element {
  return (
    <section
      className={cn(
        'rounded-xl border border-border bg-card p-6 shadow-sm',
        className,
      )}
    >
      {(title || description) && (
        <header className="mb-4">
          {title && <h2 className="text-base font-semibold tracking-tight">{title}</h2>}
          {description && (
            <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
          )}
        </header>
      )}
      {children}
    </section>
  );
}

/**
 * Two-column row used for read-only profile rows / settings rows:
 * label on the left, value/control on the right. Stacks on mobile.
 */
export function Row({
  label,
  description,
  children,
}: {
  label: string;
  description?: string;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <div className="flex flex-col gap-2 border-b border-border py-4 last:border-b-0 md:flex-row md:items-center md:justify-between md:gap-6">
      <div className="min-w-0">
        <div className="text-sm font-medium">{label}</div>
        {description && (
          <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
        )}
      </div>
      <div className="min-w-0 md:text-right">{children}</div>
    </div>
  );
}
