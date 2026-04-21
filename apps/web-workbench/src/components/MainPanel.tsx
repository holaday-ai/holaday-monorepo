import { Menu } from 'lucide-react';
import { InputArea } from '@/components/InputArea';
import { TaskStream } from '@/components/TaskStream';
import { Button } from '@/components/ui/button';
import type { UiTask } from '@/types/task';

interface Props {
  task: UiTask | null;
  onSubmit: (intent: string) => Promise<void> | void;
  busy?: boolean;
  onOpenSidebar?: () => void;
}

/**
 * Centre column — a scrollable TaskStream area on top, InputArea
 * pinned to the bottom, and a mobile-only top bar that hosts the
 * hamburger toggle (the sidebar collapses into a drawer below `md`).
 */
export function MainPanel({ task, onSubmit, busy, onOpenSidebar }: Props): JSX.Element {
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
            <EmptyState />
          </div>
        )}
      </div>
      <InputArea onSubmit={onSubmit} busy={busy} />
    </main>
  );
}

function EmptyState(): JSX.Element {
  return (
    <div className="flex flex-col items-center justify-center pb-8 pt-16 text-center">
      <h2 className="text-2xl font-semibold tracking-tight">你好，Yalei</h2>
      <p className="mt-2 text-sm text-muted-foreground">
        告诉 HOLA DAY 你想在浏览器里完成什么，它会一步步把事情做完。
      </p>
      <ul className="mt-6 grid gap-2 text-left text-xs text-muted-foreground sm:grid-cols-2">
        <Suggestion text="帮我在小红书发一条关于春日咖啡店探店的笔记" />
        <Suggestion text="查看本周互动最多的 5 条评论并整理成表格" />
        <Suggestion text="在百度搜索 claude opus 4 并把首条结果发给我" />
        <Suggestion text="打开 Gmail，抓取今天未读邮件的标题清单" />
      </ul>
    </div>
  );
}

function Suggestion({ text }: { text: string }): JSX.Element {
  return (
    <li className="rounded-lg border border-border/70 bg-white/70 px-3 py-2 shadow-[0_1px_2px_rgba(0,0,0,0.03)]">
      {text}
    </li>
  );
}
