import { FileText, Image, Menu, PencilLine } from 'lucide-react';
import * as React from 'react';
import { BrandWordmark } from '@/components/BrandLogo';
import { AmbientGrid } from '@/components/AmbientGrid';
import { InputArea } from '@/components/InputArea';
import { LazyLoadBoundary } from '@/components/LazyLoadBoundary';
import { RoleNudgeBanner } from '@/components/RoleNudgeBanner';
import { TaskToolbar, isBrowserLikely } from '@/components/TaskToolbar';
import { Button } from '@/components/ui/button';
import type { ComposerSubmitResult } from '@/components/composer-submit';
import { shouldResetComposerOnSelectionChange } from '@/components/composer-reset';
import { taskDisplayIntent, taskDisplaySource } from '@/lib/task-display-copy';
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
  /** True when the desktop browser is sharing the row with this panel. */
  browserPanelOpen?: boolean;
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
    <main
      data-testid="workbench-main-panel"
      className="flex h-full min-w-0 flex-[2] flex-col bg-background lg:min-w-[560px]"
    >
      <div
        data-testid="mobile-task-header"
        className="hidden h-11 items-center border-b border-[#DCDDDD]/70 bg-white/70 px-3 backdrop-blur max-[768px]:flex dark:border-white/10 dark:bg-card/70"
      >
        <Button
          variant="ghost"
          size="icon"
          onClick={onOpenSidebar}
          aria-label="打开任务列表"
          title="打开任务列表"
          className="h-8 w-8 rounded-[8px] text-[#595757] hover:bg-[#EFEFEF]/70 hover:text-[#FF0061] dark:text-foreground/75 dark:hover:bg-white/10"
        >
          <Menu className="h-4 w-4" />
        </Button>
        <div className="ml-2 min-w-0 flex-1 truncate pr-12 text-sm font-medium text-[#595757] dark:text-foreground/85">
          {task ? (
            taskDisplayIntent(task.intent)
          ) : (
            <BrandWordmark className="h-3.5" />
          )}
        </div>
      </div>
      {showEmptyHome ? (
        <div className="hd-new-task-stage">
          <AmbientGrid />
          <div className="hd-new-task-home">
            <header className="hd-start-intro">
              <span className="hd-start-eyebrow">YOUR NEXT IDEA</span>
              <h1>今天，想完成什么？</h1>
              <p>从一个想法开始，也可以带上你的资料。</p>
            </header>
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
              approved
            />
            <SuggestionChips onPick={handlePickFromEmptyState} />
            <p className="hd-starter-note">也可以直接拖入文件</p>
            {userPlan ? <div className="hd-start-account-note">
              <RoleNudgeBanner plan={userPlan} selectedRoles={userSelectedRoles ?? null} />
            </div> : null}
          </div>
        </div>
      ) : (
        <>
          {/* Desktop tasks reserve one calm top band for the fixed account
              dock. Browser-shaped tasks also place their per-task browser
              action here; the result card stays focused on the work product. */}
          <div
            data-testid="desktop-task-header-band"
            className="hidden h-16 shrink-0 items-center justify-end gap-2 border-b border-[#DCDDDD]/70 bg-white/60 px-4 pr-40 backdrop-blur min-[769px]:flex min-[1360px]:pr-52 dark:border-white/10 dark:bg-card/50"
          >
            {isBrowserLikely(task) && (
              <TaskToolbar
                task={task}
                sidePanelMode={sidePanelMode}
                attentionNeeded={browserAttentionNeeded}
                onToggleSidePanel={onToggleSidePanel ?? (() => {})}
              />
            )}
          </div>
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
            {taskDisplaySource(task)}
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
function SuggestionChips({ onPick }: { onPick(intent: string): void }): JSX.Element {
  const items = [
    { label: '整理资料', icon: FileText, intent: '帮我整理这些资料，提炼要点：' },
    { label: '写点内容', icon: PencilLine, intent: '帮我写一段内容：' },
    { label: '做张图片', icon: Image, intent: '帮我做一张图片：' },
  ];
  return <div className="hd-starter-row">{items.map(({ label, icon: Icon, intent }) => (
    <button key={label} type="button" className="hd-starter" onClick={() => onPick(intent)} aria-label={`用示例填入：${label}`}>
      <Icon aria-hidden="true" />{label}
    </button>
  ))}</div>;
}
