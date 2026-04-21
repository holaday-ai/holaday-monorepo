import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { TaskListItem } from '@/components/TaskListItem';
import { type UiTask, isActive } from '@/types/task';

interface Props {
  tasks: UiTask[];
  selectedTaskId: string | null;
  onSelectTask: (taskId: string) => void;
  onNewTask: () => void;
}

/**
 * 240px fixed-width left rail: logo + new-task button on top, task
 * list in the middle (split into 进行中 / 已完成), user chip at the
 * bottom. Uses a frosted white-panel aesthetic via rgba+blur so it
 * reads as a layer sitting on top of the main canvas.
 */
export function Sidebar({ tasks, selectedTaskId, onSelectTask, onNewTask }: Props): JSX.Element {
  const active = tasks.filter((t) => isActive(t.status));
  const done = tasks.filter((t) => !isActive(t.status));

  return (
    <aside
      className="flex h-full w-60 shrink-0 flex-col border-r border-black/[0.06] backdrop-blur-xl"
      style={{ backgroundColor: 'rgba(255,255,255,0.7)' }}
    >
      <header className="px-4 pb-3 pt-5">
        <h1 className="text-base font-semibold tracking-tight text-foreground">HOLA DAY</h1>
        <Button
          variant="default"
          size="sm"
          onClick={onNewTask}
          className="mt-3 w-full justify-start"
        >
          <Plus className="h-4 w-4" />
          新任务
        </Button>
      </header>

      <div className="flex-1 overflow-y-auto px-2 pb-4">
        {active.length > 0 && (
          <TaskGroup title="进行中" tasks={active}>
            {active.map((t) => (
              <TaskListItem
                key={t.taskId}
                task={t}
                selected={t.taskId === selectedTaskId}
                onSelect={onSelectTask}
              />
            ))}
          </TaskGroup>
        )}
        {done.length > 0 && (
          <TaskGroup title="已完成" tasks={done}>
            {done.map((t) => (
              <TaskListItem
                key={t.taskId}
                task={t}
                selected={t.taskId === selectedTaskId}
                onSelect={onSelectTask}
              />
            ))}
          </TaskGroup>
        )}
        {tasks.length === 0 && (
          <div className="px-3 py-6 text-center text-xs text-muted-foreground">暂无任务</div>
        )}
      </div>

      <footer className="flex items-center gap-3 border-t border-black/[0.06] px-4 py-3">
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-indigo-400 to-pink-400 text-sm font-semibold text-white">
          Y
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">Yalei</div>
          <div className="text-[11px] text-muted-foreground">Free · 试用版</div>
        </div>
      </footer>
    </aside>
  );
}

interface GroupProps {
  title: string;
  tasks: UiTask[];
  children: React.ReactNode;
}

function TaskGroup({ title, tasks, children }: GroupProps): JSX.Element {
  return (
    <section className="mt-3 first:mt-1">
      <div className="px-3 py-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
        {title} · {tasks.length}
      </div>
      <div className="mt-1 space-y-1">{children}</div>
    </section>
  );
}
