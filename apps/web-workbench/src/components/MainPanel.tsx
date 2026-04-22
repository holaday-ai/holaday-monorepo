import { Menu, Sparkles } from 'lucide-react';
import { InputArea } from '@/components/InputArea';
import { TaskStream } from '@/components/TaskStream';
import { Button } from '@/components/ui/button';
import type { UiTask } from '@/types/task';

interface Props {
  task: UiTask | null;
  onSubmit: (intent: string) => Promise<void> | void;
  busy?: boolean;
  onOpenSidebar?: () => void;
  greetingName?: string;
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
  greetingName,
}: Props): JSX.Element {
  return (
    <main className="flex h-full flex-1 flex-col bg-background">
      <div className="flex h-11 items-center border-b border-black/[0.04] px-3 md:hidden">
        <Button
          variant="ghost"
          size="icon"
          onClick={onOpenSidebar}
          aria-label="打开任务列表"
        >
          <Menu className="h-4 w-4" />
        </Button>
        <div className="ml-2 min-w-0 flex-1 truncate text-sm font-medium">
          {task ? task.intent : 'HOLA DAY'}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto">
        {task ? (
          <TaskStream task={task} />
        ) : (
          <div className="mx-auto max-w-3xl px-6 pt-12">
            <EmptyState greetingName={greetingName} onPick={(intent) => void onSubmit(intent)} />
          </div>
        )}
      </div>
      <InputArea onSubmit={onSubmit} busy={busy} />
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
      <div className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 to-pink-500 text-white shadow-sm">
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
              className="w-full rounded-lg border border-border/70 bg-white/70 px-3 py-2.5 text-left shadow-[0_1px_2px_rgba(0,0,0,0.03)] transition hover:border-foreground/20 hover:bg-white"
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
