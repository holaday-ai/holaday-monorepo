import { Globe, Menu, Sparkles } from 'lucide-react';
import * as React from 'react';
import { InputArea } from '@/components/InputArea';
import { RoleNudgeBanner } from '@/components/RoleNudgeBanner';
import { TaskStream } from '@/components/TaskStream';
import { Button } from '@/components/ui/button';
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
  onOpenBrowser?: () => void;
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
 * input and submits it immediately.
 */
export function MainPanel({
  task,
  onSubmit,
  busy,
  onOpenSidebar,
  onOpenBrowser,
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
        {/* Phase 18 — globe always available on mobile so the empty
            state can also open the BrowserPanel (was previously gated
            on `task` so first-time users had no way in). */}
        {onOpenBrowser && (
          <Button
            variant="ghost"
            size="icon"
            onClick={onOpenBrowser}
            aria-label="打开浏览器面板"
          >
            <Globe className="h-4 w-4" />
          </Button>
        )}
      </div>
      <div className="flex-1 overflow-y-auto">
        {task ? (
          <TaskStream
            task={task}
            onPickSuggestion={(text) => setPrefillIntent(text)}
          />
        ) : (
          <div className="mx-auto max-w-3xl px-6 pt-12">
            <EmptyState
              greetingName={greetingName}
              onPick={(intent) => setPrefillIntent(intent)}
            />
          </div>
        )}
      </div>
      {userPlan ? (
        <RoleNudgeBanner plan={userPlan} selectedRoles={userSelectedRoles ?? null} />
      ) : null}
      <InputArea
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
    </main>
  );
}

function EmptyState({
  greetingName,
  onPick,
}: {
  greetingName?: string;
  onPick(intent: string): void;
}): JSX.Element {
  const who = greetingName ? `，${greetingName}` : '';
  return (
    <div className="flex flex-col items-center justify-center pb-8 pt-16 text-center">
      <div className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-pink-500 to-pink-700 text-white shadow-sm">
        <Sparkles className="h-5 w-5" />
      </div>
      <h2 className="mt-4 text-2xl font-semibold tracking-tight">你好{who}</h2>
      <p className="mt-2 text-sm text-muted-foreground">
        告诉 HOLA DAY 你想做什么，它会替你操作浏览器，把事情一步步做完。
      </p>
      <ul className="mt-6 grid w-full gap-2 text-left text-sm sm:grid-cols-2">
        {SUGGESTIONS.map((s) => (
          <li key={s}>
            <button
              type="button"
              onClick={() => onPick(s)}
              className="w-full rounded-lg border border-border bg-card px-3 py-2.5 text-left shadow-[0_1px_2px_rgba(0,0,0,0.03)] transition hover:border-foreground/20 hover:bg-accent"
            >
              {s}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

const SUGGESTIONS = [
  '帮我查一下今天的科技新闻',
  '打开 GitHub 看看 trending 项目',
  '去东方财富查一下茅台最新股价',
  '在百度搜索 claude opus 并把首条结果发给我',
];
