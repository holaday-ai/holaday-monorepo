import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * Page-level building blocks for secondary product pages. Sub-pages
 * compose these inside the unified AppShell's main slot:
 *
 *   <PageContainer width="list">
 *     <PageHeader title="..." description="..." action={...} />
 *     <Section>...</Section>
 *   </PageContainer>
 *
 * No more sticky sub-shell, no more "← 返回" — the AppShell sidebar
 * stays mounted across every authed route, so a "back" link inside
 * each page just duplicates the navigation surface the user already
 * has on the left.
 */

const WIDTH_CLASS = {
  /** Forms / settings — narrow column so labels and inputs read cleanly. */
  form: 'max-w-[880px]',
  /** Tables / lists — wider so rows breathe + columns line up. */
  list: 'max-w-[960px]',
  /** Wide content (billing, plan comparison). */
  wide: 'max-w-5xl',
  /** Reading column for legal text. */
  prose: 'max-w-3xl',
} as const;

export type PageContainerWidth = keyof typeof WIDTH_CLASS;

interface PageContainerProps {
  children: React.ReactNode;
  width?: PageContainerWidth;
  className?: string;
}

/**
 * Centered max-width wrapper for a secondary page's main content.
 * Provides the horizontal padding (16/24/32 px responsive) + vertical
 * rhythm. Lives inside the AppShell's `<main>` slot, which itself
 * supplies the scrolling container + background.
 */
export function PageContainer({
  children,
  width = 'list',
  className,
}: PageContainerProps): JSX.Element {
  return (
    <div
      className={cn(
        'mx-auto w-full px-4 py-8 sm:px-6 md:px-8 md:py-10',
        WIDTH_CLASS[width],
        className,
      )}
    >
      {children}
    </div>
  );
}

interface PageHeaderProps {
  title: string;
  description?: string;
  /** Right-side action button(s). Renders inline with the title row. */
  action?: React.ReactNode;
}

/**
 * Page header row. Two-column layout: title + description on the
 * left, action button(s) on the right. Tokenised type sizes match
 * the design spec (20/600 title, 13 muted description). Below it,
 * the page's body sections render with their own card / list
 * affordances.
 */
export function PageHeader({
  title,
  description,
  action,
}: PageHeaderProps): JSX.Element {
  return (
    <header className="mb-6 flex items-start justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold leading-tight tracking-tight text-foreground">
          {title}
        </h1>
        {description && (
          <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
            {description}
          </p>
        )}
      </div>
      {action && <div className="flex shrink-0 items-center gap-2">{action}</div>}
    </header>
  );
}

/**
 * Card-style section used on most secondary pages. Consistent
 * rounded border + card bg so pages feel like part of one system.
 */
export function Section({
  id,
  title,
  description,
  children,
  className,
}: {
  id?: string;
  title?: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
}): JSX.Element {
  const headingId = id && title ? `${id}-heading` : undefined;
  return (
    <section
      id={id}
      aria-labelledby={headingId}
      className={cn(
        'scroll-mt-24 rounded-xl border border-border bg-card p-6 shadow-sm',
        className,
      )}
    >
      {(title || description) && (
        <header className="mb-4">
          {title && (
            <h2 id={headingId} className="text-base font-semibold tracking-tight">
              {title}
            </h2>
          )}
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
