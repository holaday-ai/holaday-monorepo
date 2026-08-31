import { cn } from '@/lib/utils';
import type * as React from 'react';

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
  /** Dense collaborative workspaces with a table, rail, and detail panel. */
  workspace: 'max-w-[1240px]',
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
        'mx-auto w-full px-4 pb-8 pt-14 sm:px-6 md:px-8 md:pb-10 min-[769px]:pt-20',
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
export function PageHeader({ title, description, action }: PageHeaderProps): JSX.Element {
  return (
    <header className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold leading-tight text-foreground">{title}</h1>
        {description && (
          <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">{description}</p>
        )}
      </div>
      {action && (
        <div className="flex w-full shrink-0 items-center gap-2 sm:w-auto sm:justify-end">
          {action}
        </div>
      )}
    </header>
  );
}

export function PageLoadingPanel({
  label = '加载中',
  description = '正在准备最新内容',
}: {
  label?: string;
  description?: string;
}): JSX.Element {
  return (
    <div
      aria-label={label}
      aria-live="polite"
      className="rounded-[8px] border border-[#DCDDDD] bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.03)] animate-fade-in motion-reduce:animate-none"
    >
      <div className="flex items-center gap-3">
        <div className="h-9 w-9 rounded-[8px] bg-[#EA1F59]/90 shadow-[0_8px_18px_rgba(234,31,89,0.16)]" />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium text-[#595757]">{label}</div>
          <div className="mt-1 text-xs text-muted-foreground">{description}</div>
        </div>
      </div>
      <div className="mt-5 grid gap-2 sm:grid-cols-3">
        <div className="hola-skel h-14 rounded-[8px] bg-[#EFEFEF]/85" />
        <div className="hola-skel h-14 rounded-[8px] bg-[#EFEFEF]/85" />
        <div className="hola-skel h-14 rounded-[8px] bg-[#EFEFEF]/85" />
      </div>
      <div className="mt-4 space-y-2">
        <div className="hola-skel h-3 w-full bg-[#EFEFEF]/85" />
        <div className="hola-skel h-3 w-5/6 bg-[#EFEFEF]/85" />
        <div className="hola-skel h-3 w-2/3 bg-[#EFEFEF]/85" />
      </div>
    </div>
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
        'scroll-mt-24 rounded-[8px] border border-[#DCDDDD] bg-white p-6 shadow-[0_1px_2px_rgba(15,23,42,0.03)]',
        className,
      )}
    >
      {(title || description) && (
        <header className="mb-4">
          {title && (
            <h2 id={headingId} className="text-base font-semibold">
              {title}
            </h2>
          )}
          {description && <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>}
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
    <div className="flex flex-col gap-2 border-b border-[#EFEFEF] py-4 last:border-b-0 md:flex-row md:items-center md:justify-between md:gap-6">
      <div className="min-w-0">
        <div className="text-sm font-medium">{label}</div>
        {description && <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>}
      </div>
      <div className="min-w-0 md:text-right">{children}</div>
    </div>
  );
}
