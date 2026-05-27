import { Menu, X } from 'lucide-react';
import * as React from 'react';
import { InputArea } from '@/components/InputArea';
import { LazyLoadBoundary } from '@/components/LazyLoadBoundary';
import { RoleNudgeBanner } from '@/components/RoleNudgeBanner';
import { TaskToolbar, isBrowserLikely } from '@/components/TaskToolbar';
import { Button } from '@/components/ui/button';
import type { ComposerSubmitResult } from '@/components/composer-submit';
import { shouldResetComposerOnSelectionChange } from '@/components/composer-reset';
import { useTaskStore } from '@/stores/task-store';
import type { SidePanelMode } from '@/types/side-panel';
import type { UiTask } from '@/types/task';

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
  /** Phase 14 audit follow-up — passed straight through to InputArea. */
  followUpTarget?: { taskId: string; title: string } | null;
  onCancelFollowUp?: () => void;
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
  onToggleSidePanel?: () => void;
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
  followUpTarget,
  onCancelFollowUp,
  userPlan,
  userSelectedRoles,
  quotaExhausted,
  attachmentsAllowed,
  attachmentByteCap,
  sidePanelMode = 'closed',
  onToggleSidePanel,
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
      <div className="flex h-11 items-center border-b border-border px-3 lg:hidden">
        <Button
          variant="ghost"
          size="icon"
          onClick={onOpenSidebar}
          aria-label="打开任务列表"
          className="md:hidden"
        >
          <Menu className="h-4 w-4" />
        </Button>
        <div className="ml-2 min-w-0 flex-1 truncate text-sm font-medium">
          {task ? task.intent : 'HOLA DAY'}
        </div>
      </div>
      {showEmptyHome ? (
        <div className="flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-[720px] px-4 pb-12 pt-[18vh] sm:px-6">
            <h1 className="mb-6 text-center text-[28px] font-semibold leading-tight tracking-tight text-foreground">
              你好，{greetingName || '今天想做点什么？'}
            </h1>
            <OnboardingHint />
            <InputArea
              key={composerKey}
              onSubmit={onSubmit}
              busy={busy}
              inputRef={inputRef}
              replyMode={replyMode}
              followUpTarget={followUpTarget}
              onCancelFollowUp={onCancelFollowUp}
              quotaExhausted={quotaExhausted}
              quotaPlan={userPlan}
              attachmentsAllowed={attachmentsAllowed}
              attachmentByteCap={attachmentByteCap}
              prefillIntent={prefillIntent}
              onPrefillConsumed={() => setPrefillIntent(null)}
              fullBleed
            />
            <SuggestionChips onPick={handlePickFromEmptyState} />
            {userPlan ? (
              <div className="mt-10">
                <RoleNudgeBanner
                  plan={userPlan}
                  selectedRoles={userSelectedRoles ?? null}
                />
              </div>
            ) : null}
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
            <div className="flex h-10 items-center justify-end gap-2 border-b border-[#DCDDDD]/70 bg-white/60 px-4 backdrop-blur dark:border-white/10 dark:bg-card/50">
              <TaskToolbar
                task={task}
                sidePanelMode={sidePanelMode}
                onToggleSidePanel={onToggleSidePanel ?? (() => {})}
              />
            </div>
          )}
          <div className="flex-1 overflow-y-auto">
            <LazyLoadBoundary surfaceLabel="任务详情" resetKey={task.taskId}>
              <React.Suspense fallback={<TaskStreamFallback />}>
                <TaskStream
                  task={task}
                  onPickSuggestion={handlePickFromTaskSummary}
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
            followUpTarget={followUpTarget}
            onCancelFollowUp={onCancelFollowUp}
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

/**
 * Suggestion chips below the composer. Small, single-line, click
 * fills the composer (does NOT submit). Eight chips covering the
 * common entry points; tap a chip to seed an intent then edit.
 */
function SuggestionChips({
  onPick,
}: {
  onPick(intent: string): void;
}): JSX.Element {
  return (
    <div className="mt-5 flex flex-wrap items-center justify-center gap-1.5">
      {SUGGESTIONS.map((s) => (
        <button
          key={s.label}
          type="button"
          onClick={() => onPick(s.intent)}
          className="inline-flex h-7 items-center rounded-full border border-[#DCDDDD] bg-white px-3 text-[12px] text-muted-foreground transition-colors hover:border-[#ADADAD] hover:bg-[#EFEFEF]/50 hover:text-foreground dark:border-white/10 dark:bg-transparent dark:hover:bg-white/10"
        >
          {s.label}
        </button>
      ))}
    </div>
  );
}

/**
 * Eight chip seeds covering the common entry points. Label is the
 * short tap target; intent is the prefill text that lands in the
 * composer (user can edit before submitting).
 */
/**
 * First-time-user hint above the composer. Renders only when the
 * user has zero tasks AND hasn't dismissed it before. ✕ closes for
 * good (localStorage). Sits between the greeting and the composer
 * so it doesn't compete with the input's visual weight.
 */
const ONBOARDING_DISMISSED_KEY = 'holaday.onboarding.first-task.dismissed';

function OnboardingHint(): JSX.Element | null {
  const tasksCount = useTaskStore((s) => s.tasks.length);
  const [dismissed, setDismissed] = React.useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    try {
      return window.localStorage.getItem(ONBOARDING_DISMISSED_KEY) === '1';
    } catch {
      return false;
    }
  });
  // Don't render until the initial task fetch has had a chance to
  // populate. The store has no "bootstrapped" flag and tasks=[]
  // could mean "still loading" OR "truly empty" — so wait 400 ms
  // (longer than a typical fetch) before showing the hint. Avoids
  // a flash for users who DO have tasks but the list is mid-fetch.
  const [readyToShow, setReadyToShow] = React.useState(false);
  React.useEffect(() => {
    const id = window.setTimeout(() => setReadyToShow(true), 400);
    return () => window.clearTimeout(id);
  }, []);

  if (!readyToShow) return null;
  if (tasksCount > 0) return null;
  if (dismissed) return null;

  return (
    <div className="mb-4 flex items-start gap-2.5 rounded-lg border border-[#DCDDDD] bg-white px-3.5 py-2.5 text-[13px] text-foreground shadow-[0_1px_3px_rgba(17,24,39,0.05)] dark:border-white/10 dark:bg-card/90">
      <div className="min-w-0 flex-1">
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
        className="-mr-1 -mt-1 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-[#EFEFEF]/70 hover:text-foreground dark:hover:bg-white/10"
        aria-label="关闭引导"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

const SUGGESTIONS: ReadonlyArray<{ label: string; intent: string }> = [
  { label: '直播复盘', intent: '帮我复盘昨天的抖音直播数据，做总结和优化策略' },
  { label: '查资料', intent: '帮我查一下今天的科技新闻' },
  { label: '打开网页', intent: '打开 GitHub 看看 trending 项目' },
  { label: '行情查询', intent: '去东方财富查一下茅台最新股价' },
  { label: '下载文件', intent: '把这页内容保存成 PDF：' },
  { label: '定时任务', intent: '每天早上 9 点跑一次昨天的电商日报' },
  { label: '批量执行', intent: '帮我对这些链接逐个执行抓取：\n' },
  { label: '翻译内容', intent: '帮我翻译这段内容：' },
];
