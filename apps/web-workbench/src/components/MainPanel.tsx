import {
  CalendarClock,
  Download,
  Globe2,
  Languages,
  ListChecks,
  Menu,
  Radio,
  Search,
  Sparkles,
  TrendingUp,
  X,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import * as React from 'react';
import { BrandWordmark } from '@/components/BrandLogo';
import { InputArea } from '@/components/InputArea';
import { LazyLoadBoundary } from '@/components/LazyLoadBoundary';
import { RoleNudgeBanner } from '@/components/RoleNudgeBanner';
import { TaskToolbar, isBrowserLikely } from '@/components/TaskToolbar';
import { Button } from '@/components/ui/button';
import type { ComposerSubmitResult } from '@/components/composer-submit';
import { shouldResetComposerOnSelectionChange } from '@/components/composer-reset';
import { cn } from '@/lib/utils';
import { taskStatusLabel } from '@/lib/task-status-copy';
import { useTaskStore } from '@/stores/task-store';
import type { AwaitingKind } from '@/lib/awaiting-user-copy';
import type { SidePanelMode } from '@/types/side-panel';
import type { UiSkillSelection, UiTask } from '@/types/task';

const TaskStream = React.lazy(() =>
  import('@/components/TaskStream').then((module) => ({
    default: module.TaskStream,
  })),
);

interface Props {
  task: UiTask | null;
  onSubmit: (
    intent: string,
    fileIds: string[],
    mode?: 'auto' | 'plan',
    expertMode?: 'normal' | 'expert' | 'auto',
    skillSelection?: UiSkillSelection,
  ) => Promise<ComposerSubmitResult> | ComposerSubmitResult;
  busy?: boolean;
  onOpenSidebar?: () => void;
  // Codex follow-up — onOpenBrowser removed (panel now auto-opens).
  greetingName?: string;
  /** Ref to focus the composer textarea via keyboard shortcut. */
  inputRef?: React.Ref<HTMLTextAreaElement>;
  /**
   * Supercar: when true the composer's placeholder + copy flip to
   * "reply to agent" mode. Drives the App's onSubmit branching too.
   */
  replyMode?: boolean;
  replyKind?: AwaitingKind;
  /** Phase 14 audit follow-up — passed straight through to InputArea. */
  followUpTarget?: { taskId: string; title: string } | null;
  /** Plan id from auth.me — drives the role-nudge banner visibility. */
  userPlan?: string;
  /** selected_roles list from auth.me — empty/null triggers the nudge. */
  userSelectedRoles?: readonly string[] | null;
  /**
   * Phase 10 polish — when true, the composer renders the
   * "quota exhausted" card instead of the textarea + send button.
   * Caller computes this from `quota.status` so a server-side
   * TOO_MANY_REQUESTS isn't the only signal the user gets.
   */
  quotaExhausted?: boolean;
  /** Phase 10 Tier 3 — drives the paperclip button enabled state. */
  attachmentsAllowed?: boolean;
  /** Plan-specific attachment byte cap (5MB basic / 10MB pro). */
  attachmentByteCap?: number;
  /**
   * Codex IA close-out — current side-panel mode + toggle callback.
   * Drives the TaskToolbar in this column's top-right. The result
   * card no longer hosts a 查看浏览器 entry; the toolbar is the
   * single canonical surface for opening / closing the panel on the
   * currently-selected task.
   */
  sidePanelMode?: SidePanelMode;
  browserAttentionNeeded?: boolean;
  onToggleSidePanel?: () => void;
  profileStorageScope?: string | null;
}

/**
 * Centre column — a scrollable TaskStream area on top, InputArea
 * pinned to the bottom, and a mobile-only top bar that hosts the
 * hamburger toggle. Empty state (no task selected) shows a welcome
   * line plus clickable suggestion chips; clicking a chip prefills the
   * input so the user can edit before sending.
 */
export function MainPanel({
  task,
  onSubmit,
  busy,
  onOpenSidebar,
  greetingName,
  inputRef,
  replyMode,
  replyKind,
  followUpTarget,
  userPlan,
  userSelectedRoles,
  quotaExhausted,
  attachmentsAllowed,
  attachmentByteCap,
  sidePanelMode = 'closed',
  browserAttentionNeeded = false,
  onToggleSidePanel,
  profileStorageScope = null,
}: Props): JSX.Element {
  // Suggestion-chip clicks (empty-state EmptyState picks + the
  // "继续探索" chips inside TaskStream) prefill the composer instead
  // of firing onSubmit directly. The previous straight-to-submit
  // behaviour read as a quota landmine on mobile where the chips sit
  // close to the thumb. Pulse-style state — InputArea consumes once
  // and signals back to clear so a second tap on the same chip
  // re-fires the effect.
  const [prefillIntent, setPrefillIntent] = React.useState<string | null>(null);
  // F1 — chip clicks must enter new-task mode BEFORE prefilling, so
  // the next submit creates a fresh task instead of getting interpreted
  // as a follow-up reply on whichever historical task happens to be
  // currently selected. enterNewTaskMode() also clears followUpTarget
  // and any draft, then setPrefillIntent puts the suggestion text into
  // the composer. Composer mode flips to 'new', InputArea routes
  // onSubmit through createTask not tasks.reply.
  const enterNewTaskMode = useTaskStore((s) => s.enterNewTaskMode);
  // F4 — split suggestion entry points by surface:
  //   - EmptyState (no task selected) → user has nothing to follow up
  //     on, so enter new-task mode + prefill (the existing flow).
  //   - TerminalSummary "继续探索" chips on a completed task → KEEP
  //     the selected task + followUpTarget context, only prefill the
  //     composer. User edits the suggestion and submits it as a
  //     linked follow-up (replyToTaskId points back to the parent).
  // The earlier unified behaviour (always enterNewTaskMode) lost the
  // parent context, so post-completion suggestions read as random
  // new tasks rather than continuations.
  const handlePickFromEmptyState = React.useCallback(
    (text: string) => {
      enterNewTaskMode();
      setPrefillIntent(text);
    },
    [enterNewTaskMode],
  );
  const handlePickFromTaskSummary = React.useCallback((text: string) => {
    setPrefillIntent(text);
  }, []);
  // Composer-reset effect. Bumping `composerKey` forces InputArea to
  // remount with a fresh local `value=''`, which is the ONLY way to
  // wipe free-form text the user typed (InputArea's value lives in
  // useState — no outer reset path otherwise). prefillIntent='' is
  // belt-and-suspenders for chip-prefilled text that hadn't yet been
  // edited.
  //
  // Triggers on transitions where the InputArea JSX position stays
  // the same — i.e. task → task (both render in the task-detail
  // branch) AND task → null (the "新任务" click). The previous guard
  // skipped task → null on the assumption that the empty-home JSX
  // swap would unmount the InputArea naturally, but reports of
  // "occasionally doesn't clear old content" pointed at the typed-
  // reply scenario where reliance on the structural reset was
  // brittle. See `composer-reset.ts` for the full truth table.
  const selectedTaskId = useTaskStore((s) => s.selectedTaskId);
  const lastSelectedTaskIdRef = React.useRef<string | null>(selectedTaskId);
  const [composerKey, setComposerKey] = React.useState(0);
  React.useEffect(() => {
    const prev = lastSelectedTaskIdRef.current;
    lastSelectedTaskIdRef.current = selectedTaskId;
    if (shouldResetComposerOnSelectionChange(prev, selectedTaskId)) {
      setPrefillIntent('');
      setComposerKey((k) => k + 1);
    }
  }, [selectedTaskId]);
  // Empty home is composer-first: the H1 + composer + chips are
  // the visual centre. We fold the composer into the EmptyState
  // column on `/` (no selected task) so the user sees a single
  // workspace surface, not "header + scroll area + footer composer."
  const showEmptyHome = !task;
  return (
    <main className="flex h-full min-w-0 flex-[2] flex-col bg-background lg:min-w-[420px]">
      <div className="flex h-11 items-center border-b border-[#DCDDDD]/70 bg-white/70 px-3 backdrop-blur md:hidden dark:border-white/10 dark:bg-card/70">
        <Button
          variant="ghost"
          size="icon"
          onClick={onOpenSidebar}
          aria-label="打开任务列表"
          title="打开任务列表"
          className="h-8 w-8 rounded-[8px] text-[#595757] hover:bg-[#EFEFEF]/70 hover:text-[#EA1F59] dark:text-foreground/75 dark:hover:bg-white/10"
        >
          <Menu className="h-4 w-4" />
        </Button>
        <div className="ml-2 min-w-0 flex-1 truncate pr-12 text-sm font-medium text-[#595757] dark:text-foreground/85">
          {task ? (
            task.intent
          ) : (
            <BrandWordmark className="h-3.5" />
          )}
        </div>
      </div>
      {showEmptyHome ? (
        <div className="flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-[1180px] px-6 pb-14 pt-[clamp(78px,10vh,92px)] sm:px-12 lg:px-14">
            <div className="mx-auto w-full max-w-[1040px]">
              <h1 className="text-left text-[28px] font-semibold leading-tight tracking-tight text-foreground sm:text-[34px]">
                Hello, <span className="text-[#EA1F59]">{greetingName || '今天想做点什么'}</span>~
              </h1>
              <p className="mt-2 text-left text-[14px] font-medium text-[#8B93A6] sm:text-[16px]">
                欢迎回来！ 今天又是高效的一天呢！ 🚀
              </p>
              <div className="mx-auto w-full max-w-[870px] sm:ml-[56px] sm:mr-0 sm:w-[calc(100%-112px)]">
                <div className="relative mx-auto mt-4 h-[clamp(180px,15vw,209px)] overflow-visible">
                  <div className="absolute inset-x-0 top-0 h-full overflow-hidden">
                    <img
                      src="/design-ref/home-hero.png?v=20260701"
                      alt=""
                      aria-hidden="true"
                      loading="eager"
                      className="pointer-events-none absolute bottom-0 left-1/2 h-auto w-[min(1160px,calc(100%+300px))] max-w-none -translate-x-1/2 select-none"
                    />
                  </div>
                  <div className="absolute bottom-4 left-0 z-40 w-[min(390px,calc(100%-2rem))]">
                    <OnboardingHint />
                  </div>
                </div>
                <div className="relative z-30 mx-auto mt-0">
                  <InputArea
                    key={composerKey}
                    onSubmit={onSubmit}
                    busy={busy}
                    inputRef={inputRef}
                    replyMode={replyMode}
                    replyKind={replyKind}
                    followUpTarget={followUpTarget}
                    quotaExhausted={quotaExhausted}
                    quotaPlan={userPlan}
                    attachmentsAllowed={attachmentsAllowed}
                    attachmentByteCap={attachmentByteCap}
                    prefillIntent={prefillIntent}
                    onPrefillConsumed={() => setPrefillIntent(null)}
                    fullBleed
                    compact
                  />
                </div>
                <SuggestionChips onPick={handlePickFromEmptyState} />
              </div>
              {userPlan ? (
                <div className="mx-auto mt-8 max-w-[900px]">
                  <RoleNudgeBanner
                    plan={userPlan}
                    selectedRoles={userSelectedRoles ?? null}
                  />
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : (
        <>
          {/* Per-task toolbar lives at the top of the column. Hosts
              the browser-panel entry (Codex IA close-out moved it
              off the result card so the result stays focused on the
              work product). Only rendered for browser-shaped tasks
              so generate / scrape don't pay a header height. */}
          {isBrowserLikely(task) && (
            <div className="flex h-10 items-center justify-start gap-2 border-b border-[#DCDDDD]/70 bg-white/60 px-3 backdrop-blur sm:justify-end sm:px-4 dark:border-white/10 dark:bg-card/50">
              <TaskToolbar
                task={task}
                sidePanelMode={sidePanelMode}
                attentionNeeded={browserAttentionNeeded}
                onToggleSidePanel={onToggleSidePanel ?? (() => {})}
              />
            </div>
          )}
          <div className="flex-1 overflow-y-auto scroll-pb-40 pb-40">
            <LazyLoadBoundary
              surfaceLabel="任务详情"
              resetKey={task.taskId}
              staleVersionFallback={<StaticTaskDetailFallback task={task} />}
            >
              <React.Suspense fallback={<TaskStreamFallback />}>
                <TaskStream
                  task={task}
                  onPickSuggestion={handlePickFromTaskSummary}
                  profileStorageScope={profileStorageScope}
                />
              </React.Suspense>
            </LazyLoadBoundary>
          </div>
          {userPlan ? (
            <RoleNudgeBanner
              plan={userPlan}
              selectedRoles={userSelectedRoles ?? null}
            />
          ) : null}
          <InputArea
            key={composerKey}
            onSubmit={onSubmit}
            busy={busy}
            inputRef={inputRef}
            replyMode={replyMode}
            replyKind={replyKind}
            followUpTarget={followUpTarget}
            compact={Boolean(followUpTarget) && !replyMode}
            quotaExhausted={quotaExhausted}
            quotaPlan={userPlan}
            attachmentsAllowed={attachmentsAllowed}
            attachmentByteCap={attachmentByteCap}
            prefillIntent={prefillIntent}
            onPrefillConsumed={() => setPrefillIntent(null)}
          />
        </>
      )}
    </main>
  );
}

function TaskStreamFallback(): JSX.Element {
  return (
    <div className="mx-auto flex min-h-[220px] max-w-3xl items-center justify-center px-6 text-sm text-muted-foreground">
      加载任务详情…
    </div>
  );
}

export interface StaticTaskEvidenceRow {
  label: string;
  value: string;
}

export function staticTaskEvidenceRows(input: {
  finalUrl?: string | null;
  finalScreenshot?: string | null;
  attachments?: readonly unknown[] | null;
}): StaticTaskEvidenceRow[] {
  const rows: StaticTaskEvidenceRow[] = [];
  if (input.finalUrl?.trim()) {
    rows.push({ label: '最终页面', value: '已记录' });
  }
  if (input.finalScreenshot) {
    rows.push({ label: '最终截图', value: '已保存' });
  }
  const attachmentCount = input.attachments?.length ?? 0;
  if (attachmentCount > 0) {
    rows.push({ label: '产物文件', value: `${attachmentCount} 个` });
  }
  return rows;
}

function StaticTaskDetailFallback({ task }: { task: UiTask }): JSX.Element {
  const statusLabel = taskStatusLabel(task.status, task.awaitingKind);
  const hasResult = Boolean(task.resultText?.trim());
  const evidenceRows = staticTaskEvidenceRows({
    finalUrl: task.finalUrl,
    finalScreenshot: task.finalScreenshot,
    attachments: task.attachments,
  });
  return (
    <div className="rounded-[8px] border border-[#DCDDDD] bg-white px-5 py-4 text-sm shadow-[0_1px_3px_rgba(17,24,39,0.05)] dark:border-white/10 dark:bg-card/85">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            任务摘要
          </div>
          <h2 className="mt-1 break-words text-base font-semibold leading-snug text-foreground">
            {task.title || task.intent}
          </h2>
        </div>
        <span className="rounded-md border border-[#DCDDDD] bg-[#EFEFEF]/55 px-2 py-0.5 text-[11px] font-medium text-[#595757] dark:border-white/10 dark:bg-white/5 dark:text-foreground/80">
          {statusLabel}
        </span>
      </div>
      <div className="mt-4 rounded-[7px] border border-[#DCDDDD]/70 bg-[#F7FBFC]/80 px-3 py-2.5 dark:border-white/10 dark:bg-white/5">
        <div className="text-[11px] font-medium text-muted-foreground">
          已加载结果
        </div>
        {hasResult ? (
          <p className="mt-1 max-h-[360px] overflow-y-auto whitespace-pre-wrap break-words text-sm leading-6 text-foreground">
            {task.resultText}
          </p>
        ) : (
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            当前版本无法加载完整任务详情组件，但没有可展示的文本结果。刷新后会恢复完整步骤、附件和操作按钮。
          </p>
        )}
      </div>
      {evidenceRows.length > 0 ? (
        <div className="mt-3 grid gap-2 text-xs text-muted-foreground sm:grid-cols-3">
          {evidenceRows.map((row) => (
            <div
              key={row.label}
              className="rounded-[7px] border border-[#DCDDDD]/70 bg-white/60 px-3 py-2 dark:border-white/10 dark:bg-white/5"
            >
              {row.label}：{row.value}
            </div>
          ))}
        </div>
      ) : (
        <p className="mt-3 rounded-[7px] border border-[#DCDDDD]/70 bg-white/60 px-3 py-2 text-xs leading-5 text-muted-foreground dark:border-white/10 dark:bg-white/5">
          暂无可复核的链接、截图或产物；已加载文本只能作为过程线索。
        </p>
      )}
    </div>
  );
}

/**
 * Suggestion chips below the composer. They are grouped by the
 * product jobs users understand first: web execution, expert work,
 * and task management. Click fills the composer (does NOT submit).
 */
function SuggestionChips({
  onPick,
}: {
  onPick(intent: string): void;
}): JSX.Element {
  const allItems = SUGGESTION_GROUPS.flatMap((group) => group.items);
  const primaryItems = HOME_SUGGESTION_LABELS.map((label) =>
    allItems.find((item) => item.label === label),
  ).filter((item): item is SuggestionItem => Boolean(item));

  return (
    <div className="mx-auto mt-14 max-w-[900px]">
      <div className="flex flex-wrap items-center justify-center gap-3">
        {primaryItems.map((s) => {
          const Icon = s.icon;
          const tone = suggestionTone(s.label);
          return (
            <button
              key={s.label}
              type="button"
              onClick={() => onPick(s.intent)}
              aria-label={`用示例填入：${s.label}`}
              className={cn(
                'group inline-flex h-9 min-w-[118px] items-center justify-center gap-2 rounded-[7px] border px-4 text-[13px] font-semibold shadow-[0_7px_16px_rgba(17,24,39,0.035)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#57479C]/20',
                tone.button,
              )}
            >
              <Icon className={cn('h-3.5 w-3.5 transition-colors', tone.icon)} />
              {s.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Chip seeds covering the common entry points. Label is the
 * short tap target; intent is the prefill text that lands in the
 * composer (user can edit before submitting).
 */
/**
 * First-time-user hint above the composer. It belongs to the empty
 * home surface, so it should not disappear just because the sidebar
 * finishes loading historical tasks. ✕ closes for good
 * (localStorage).
 */
const ONBOARDING_DISMISSED_KEY = 'holaday.onboarding.first-task.dismissed';

function OnboardingHint(): JSX.Element | null {
  const [dismissed, setDismissed] = React.useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    try {
      return window.localStorage.getItem(ONBOARDING_DISMISSED_KEY) === '1';
    } catch {
      return false;
    }
  });

  if (dismissed) return null;

  return (
    <div className="flex items-center gap-2 rounded-[12px] border border-[#EA1F59]/25 bg-[#FFF7FA] px-3 py-1.5 text-[11px] text-[#595757] shadow-[0_6px_16px_rgba(234,31,89,0.12)] dark:border-[#EA1F59]/35 dark:bg-card dark:text-foreground/75">
      <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-[7px] text-[#EA1F59]">
        <Sparkles className="h-3.5 w-3.5" />
      </span>
      <div className="min-w-0 flex-1 leading-4 sm:truncate">
        第一次来？点击下方的任务示例，或直接输入你想做的事情。
      </div>
      <button
        type="button"
        onClick={() => {
          try {
            window.localStorage.setItem(ONBOARDING_DISMISSED_KEY, '1');
          } catch {
            /* localStorage disabled — still hide for this session */
          }
          setDismissed(true);
        }}
        className="-mr-1 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-[7px] text-[#595757]/70 transition-colors hover:bg-white/70 hover:text-[#595757] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#57479C]/20 dark:hover:bg-white/10 dark:hover:text-foreground"
        aria-label="关闭引导"
        title="关闭"
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}

type SuggestionItem = {
  label: string;
  intent: string;
  icon: LucideIcon;
};

const HOME_SUGGESTION_LABELS = [
  '直播复盘',
  '查资料',
  '打开网页',
  '行情查询',
  '下载文件',
  '定时任务',
] as const;

function suggestionTone(label: string): { button: string; icon: string } {
  switch (label) {
    case '直播复盘':
    case '定时任务':
      return {
        button: 'border-[#EA1F59]/[0.16] bg-[#EA1F59]/[0.09] text-[#EA1F59] hover:border-[#EA1F59]/[0.28] hover:bg-[#EA1F59]/[0.13]',
        icon: 'text-[#EA1F59]',
      };
    case '查资料':
    case '行情查询':
      return {
        button: 'border-[#FFC910]/[0.22] bg-[#FFC910]/[0.12] text-[#7A5A00] hover:border-[#FFC910]/35 hover:bg-[#FFC910]/[0.18]',
        icon: 'text-[#D29A00]',
      };
    case '打开网页':
      return {
        button: 'border-[#42C0EF]/20 bg-[#42C0EF]/[0.12] text-[#0F6F8D] hover:border-[#42C0EF]/35 hover:bg-[#42C0EF]/[0.18]',
        icon: 'text-[#0F96BE]',
      };
    case '下载文件':
      return {
        button: 'border-[#57479C]/[0.18] bg-[#57479C]/10 text-[#57479C] hover:border-[#57479C]/30 hover:bg-[#57479C]/[0.14]',
        icon: 'text-[#57479C]',
      };
    default:
      return {
        button: 'border-[#DCDDDD]/75 bg-white/70 text-[#595757] hover:border-[#EA1F59]/25 hover:bg-[#EA1F59]/5 hover:text-[#EA1F59]',
        icon: 'text-[#ADADAD] group-hover:text-[#EA1F59]',
      };
  }
}

const SUGGESTION_GROUPS: ReadonlyArray<{
  title: string;
  items: readonly SuggestionItem[];
}> = [
  {
    title: '网页执行',
    items: [
      { label: '查资料', intent: '帮我查一下今天的科技新闻', icon: Search },
      { label: '打开网页', intent: '打开 GitHub 看看 trending 项目', icon: Globe2 },
      { label: '下载文件', intent: '把这页内容保存成 PDF：', icon: Download },
    ],
  },
  {
    title: '专业任务',
    items: [
      {
        label: '直播复盘',
        intent: '帮我复盘昨天的抖音直播数据，做总结和优化策略',
        icon: Radio,
      },
      { label: '行情查询', intent: '去东方财富查一下茅台最新股价', icon: TrendingUp },
      { label: '翻译内容', intent: '帮我翻译这段内容：', icon: Languages },
    ],
  },
  {
    title: '任务管理',
    items: [
      {
        label: '定时任务',
        intent: '每天早上 9 点跑一次昨天的电商日报',
        icon: CalendarClock,
      },
      {
        label: '批量执行',
        intent: '帮我对这些链接逐个执行抓取：\n',
        icon: ListChecks,
      },
    ],
  },
];
