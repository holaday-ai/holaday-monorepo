import { InputArea } from '@/components/InputArea';
import { TaskStream } from '@/components/TaskStream';
import type { UiTask } from '@/types/task';

interface Props {
  task: UiTask | null;
  onSubmit: (intent: string) => void;
  busy?: boolean;
}

/**
 * Centre column — header (task intent or empty-state headline), a
 * scrollable content area that G4 fills with streaming step cards,
 * and the InputArea pinned to the bottom.
 */
export function MainPanel({ task, onSubmit, busy }: Props): JSX.Element {
  return (
    <main className="flex h-full flex-1 flex-col bg-background">
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
    </div>
  );
}
