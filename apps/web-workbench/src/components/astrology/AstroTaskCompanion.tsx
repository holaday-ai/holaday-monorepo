import { Brain, CheckCircle2, MoonStar, RefreshCcw, Sparkles, X } from 'lucide-react';
import * as React from 'react';
import {
  buildAstroTaskInsight,
  defaultAstroProfile,
  isCosmicEnabled,
  readAstroProfile,
} from '@/lib/astrology';
import { cn } from '@/lib/utils';
import type { UiTaskStatus } from '@/types/task';

const ACCENT_CLASS = {
  rose: {
    shell: 'border-[#F5A3B7]/45 bg-[#FFF6F8]',
    icon: 'bg-[#EA1F59]/10 text-[#EA1F59]',
    bar: 'from-[#EA1F59] to-[#FFC910]',
  },
  sky: {
    shell: 'border-[#42C0EF]/40 bg-[#F3FBFE]',
    icon: 'bg-[#42C0EF]/12 text-[#1687B8]',
    bar: 'from-[#42C0EF] to-[#7ED9A8]',
  },
  sage: {
    shell: 'border-[#7ED9A8]/45 bg-[#F5FCF8]',
    icon: 'bg-[#7ED9A8]/14 text-[#288D5D]',
    bar: 'from-[#7ED9A8] to-[#FFC910]',
  },
  violet: {
    shell: 'border-[#8F7AE5]/35 bg-[#F8F6FF]',
    icon: 'bg-[#57479C]/10 text-[#57479C]',
    bar: 'from-[#57479C] to-[#42C0EF]',
  },
} as const;

const WAITING_TEST_OPTIONS = [
  {
    id: 'speed',
    label: '想快点',
    resultTitle: '等待风格：先抓重点',
    result:
      '先写下你最想确认的一件事，结果回来就先看它。',
  },
  {
    id: 'calm',
    label: '想放松',
    resultTitle: '等待风格：降噪恢复',
    result:
      '把肩膀放松，等任务跑完再做判断。',
  },
  {
    id: 'organize',
    label: '先整理',
    resultTitle: '等待风格：整理控场',
    result:
      '把下一步拆成一个动作，完成后直接接上。',
  },
] as const;

interface Props {
  taskId: string;
  intent: string;
  status: UiTaskStatus;
  surface: 'waiting' | 'complete';
  profileStorageScope?: string | null;
}

function storageKey(taskId: string, surface: Props['surface']): string {
  return `holaday.cosmic.dismissed.${surface}.${taskId}`;
}

function readDismissed(key: string): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.sessionStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}

function writeDismissed(key: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(key, '1');
  } catch {
    /* sessionStorage can be disabled. */
  }
}

export function AstroTaskCompanion({
  taskId,
  intent,
  status,
  surface,
  profileStorageScope = null,
}: Props): JSX.Element | null {
  const dismissKey = React.useMemo(() => storageKey(taskId, surface), [surface, taskId]);
  const [dismissed, setDismissed] = React.useState(() => readDismissed(dismissKey));
  const [spin, setSpin] = React.useState(0);
  const [selectedTest, setSelectedTest] =
    React.useState<(typeof WAITING_TEST_OPTIONS)[number] | null>(null);
  const storageScope = profileStorageScope?.trim() || null;
  const profile = React.useMemo(
    () =>
      storageScope
        ? (readAstroProfile(storageScope) ?? defaultAstroProfile())
        : defaultAstroProfile(),
    [storageScope],
  );
  const insight = React.useMemo(
    () =>
      buildAstroTaskInsight({
        profile,
        intent,
        surface,
        date: new Date(Date.now() + spin * 86_400_000),
      }),
    [intent, profile, spin, surface],
  );
  React.useEffect(() => {
    setSelectedTest(null);
  }, [surface, taskId]);

  if (!isCosmicEnabled() || dismissed) return null;
  if (surface === 'waiting' && status !== 'queued' && status !== 'executing') return null;
  if (surface === 'complete' && status !== 'completed' && status !== 'partial_success') return null;

  const accent = ACCENT_CLASS[insight.accent];
  const Icon = surface === 'complete' ? CheckCircle2 : MoonStar;

  return (
    <section
      aria-label={surface === 'complete' ? '任务完成后的今日能量提示' : '任务等待时的今日能量提示'}
      className={cn(
        'overflow-hidden rounded-lg border px-4 py-3 shadow-[0_1px_3px_rgba(17,24,39,0.05)] transition-colors dark:border-white/10 dark:bg-card/80',
        accent.shell,
      )}
    >
      <div className="flex items-start gap-3">
        <span
          className={cn(
            'mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md',
            accent.icon,
          )}
        >
          <Icon className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wide text-[#57479C] dark:text-[#B9AEFF]">
                {insight.eyebrow}
              </div>
              <h3 className="mt-0.5 text-sm font-semibold leading-snug text-[#2F2F33] dark:text-foreground">
                {insight.title}
              </h3>
            </div>
            <button
              type="button"
              onClick={() => {
                writeDismissed(dismissKey);
                setDismissed(true);
              }}
              aria-label="收起今日能量提示"
              title="收起"
              className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[#595757]/70 transition-colors hover:bg-white/65 hover:text-[#2F2F33] dark:text-foreground/70 dark:hover:bg-white/10 dark:hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <p className="mt-1.5 text-sm leading-relaxed text-[#595757] dark:text-foreground/85">
            {insight.body}
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <div className="h-1.5 w-24 overflow-hidden rounded-full bg-white/80 dark:bg-white/10">
              <div
                className={cn('h-full rounded-full bg-gradient-to-r', accent.bar)}
                style={{ width: `${insight.energyScore}%` }}
              />
            </div>
            <span className="text-[11px] text-[#595757]/75 dark:text-foreground/60">
              今日能量 {insight.energyScore}
            </span>
            {surface === 'waiting' && (
              <button
                type="button"
                onClick={() => setSpin((value) => value + 1)}
                className="ml-auto inline-flex h-7 items-center gap-1.5 rounded-md border border-white/75 bg-white/70 px-2.5 text-[11px] font-medium text-[#57479C] transition-colors hover:border-[#57479C]/30 hover:bg-white dark:border-white/10 dark:bg-white/5 dark:text-[#B9AEFF] dark:hover:bg-white/10"
              >
                <RefreshCcw className="h-3 w-3" />
                <span>{insight.action}</span>
              </button>
            )}
            {surface === 'complete' && (
              <span className="ml-auto inline-flex items-center gap-1.5 rounded-md border border-white/75 bg-white/70 px-2.5 py-1 text-[11px] font-medium text-[#57479C] dark:border-white/10 dark:bg-white/5 dark:text-[#B9AEFF]">
                <Sparkles className="h-3 w-3" />
                {insight.action}
              </span>
            )}
          </div>
          {surface === 'waiting' && (
            <div className="mt-3 rounded-[8px] border border-white/70 bg-white/60 p-3 dark:border-white/10 dark:bg-white/5">
              {selectedTest ? (
                <div className="flex items-start gap-2">
                  <span className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-[#57479C]/10 text-[#57479C] dark:bg-white/10 dark:text-[#B9AEFF]">
                    <Brain className="h-3.5 w-3.5" aria-hidden />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-semibold text-[#2F2F33] dark:text-foreground">
                      {selectedTest.resultTitle}
                    </div>
                    <p className="mt-1 text-xs leading-5 text-[#595757] dark:text-foreground/75">
                      {selectedTest.result}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setSelectedTest(null)}
                    className="inline-flex h-6 shrink-0 items-center rounded-md px-2 text-[11px] font-medium text-[#57479C] transition-colors hover:bg-white/75 dark:text-[#B9AEFF] dark:hover:bg-white/10"
                  >
                    重选
                  </button>
                </div>
              ) : (
                <>
                  <div className="flex items-center gap-1.5 text-[11px] font-medium text-[#57479C] dark:text-[#B9AEFF]">
                    <Brain className="h-3.5 w-3.5" aria-hidden />
                    等结果时做个 3 秒小测试：你现在更想？
                  </div>
                  <div className="mt-2 grid gap-2 sm:grid-cols-3">
                    {WAITING_TEST_OPTIONS.map((option) => (
                      <button
                        key={option.id}
                        type="button"
                        onClick={() => setSelectedTest(option)}
                        className="h-8 rounded-md border border-white/75 bg-white/70 px-2 text-xs font-medium text-[#2F2F33] transition-colors hover:border-[#EA1F59]/35 hover:bg-[#FFF6F8] dark:border-white/10 dark:bg-white/5 dark:text-foreground dark:hover:bg-white/10"
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
