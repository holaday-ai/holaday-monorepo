import { Menu } from 'lucide-react';
import * as React from 'react';
import { InputArea } from '@/components/InputArea';
import { RoleNudgeBanner } from '@/components/RoleNudgeBanner';
import { TaskStream } from '@/components/TaskStream';
import { Button } from '@/components/ui/button';
import { useTaskStore } from '@/stores/task-store';
import type { UiTask } from '@/types/task';

interface Props {
  task: UiTask | null;
  onSubmit: (
    intent: string,
    fileIds: string[],
    mode?: 'auto' | 'plan',
  ) => Promise<void> | void;
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
  // F1 — when the user moves to a HISTORICAL task (selectedTaskId
  // changes from null/A to B), clear any leftover composer draft.
  // The previous fix only set `prefillIntent=''` to push setValue('')
  // through InputArea's effect — which works for chip-prefilled
  // text BUT not for free-form drafts the user typed AFTER consume,
  // because at that point InputArea's local `value` state is the
  // sole source of truth and has no effect dep listening for outer
  // resets. Bumping `composerKey` forces InputArea to remount with
  // a fresh value=''. All composer-internal state (attachments,
  // task-mode toggle, plus menu) gets reset too — heavy hammer but
  // guarantees no cross-task pollution. Skip on transitions INTO
  // new-task mode (selectedTaskId becomes null) — that's exactly
  // the chip click pathway we want to keep prefilled.
  const selectedTaskId = useTaskStore((s) => s.selectedTaskId);
  const lastSelectedTaskIdRef = React.useRef<string | null>(selectedTaskId);
  const [composerKey, setComposerKey] = React.useState(0);
  React.useEffect(() => {
    const prev = lastSelectedTaskIdRef.current;
    lastSelectedTaskIdRef.current = selectedTaskId;
    if (selectedTaskId && prev !== selectedTaskId) {
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
          <div className="flex-1 overflow-y-auto">
            <TaskStream
              task={task}
              onPickSuggestion={handlePickFromTaskSummary}
            />
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
          className="inline-flex h-7 items-center rounded-full border border-border bg-card px-3 text-[12px] text-muted-foreground transition-colors hover:border-foreground/30 hover:bg-foreground/[0.04] hover:text-foreground"
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
