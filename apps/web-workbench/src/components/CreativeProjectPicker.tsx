import { useEffect, useRef, useState } from 'react';
import { Folder, Check } from 'lucide-react';
import { CreativePopover } from './CreativePopover';
import { trpc } from '@/lib/trpc';
import { normalizeProjectRows } from '@/lib/project-page-state';
import type { UiProject } from '@/types/task';

/** Selection uses existing personal projects; association failure never recreates a task. */
export function useCreativeProject() {
  const [selected, setSelected] = useState<UiProject | null>(null);
  const [pending, setPending] = useState<{
    taskId: string;
    projectId: string;
    name: string;
  } | null>(null);
  const [retrying, setRetrying] = useState(false);
  async function assign(target: { taskId: string; projectId: string; name: string }) {
    try {
      await trpc.tasks.moveToProject.mutate({ taskId: target.taskId, projectId: target.projectId });
      setPending(null);
    } catch {
      setPending(target);
    }
  }
  return {
    renderPicker: (disabled = false) => (
      <CreativeProjectPicker selected={selected} onSelect={setSelected} disabled={disabled} />
    ),
    associate: async (taskId: string) => {
      if (selected) await assign({ taskId, projectId: selected.projectId, name: selected.name });
    },
    notice: pending ? (
      <p className="hd-mode-help" role="status">
        任务已创建，但未能关联到「{pending.name}」。
        <button
          type="button"
          className="hd-glass-pill"
          disabled={retrying}
          onClick={async () => {
            setRetrying(true);
            try {
              await assign(pending);
            } finally {
              setRetrying(false);
            }
          }}
        >
          {retrying ? '正在重试…' : '重试关联项目'}
        </button>
      </p>
    ) : null,
  };
}
function CreativeProjectPicker({
  selected,
  onSelect,
  disabled,
}: { selected: UiProject | null; onSelect(project: UiProject | null): void; disabled: boolean }) {
  const [open, setOpen] = useState(false),
    [rows, setRows] = useState<UiProject[]>([]),
    [loading, setLoading] = useState(false),
    [error, setError] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null),
    version = useRef(0);
  useEffect(
    () => () => {
      version.current++;
    },
    [],
  );
  async function load() {
    const id = ++version.current;
    setLoading(true);
    setRows([]);
    setError(false);
    try {
      const result = await trpc.projects.list.query();
      if (id === version.current)
        setRows(normalizeProjectRows(result).filter((project) => project.scope === 'personal'));
    } catch {
      if (id === version.current) setError(true);
    } finally {
      if (id === version.current) setLoading(false);
    }
  }
  return (
    <>
      <button
        ref={anchor}
        type="button"
        disabled={disabled}
        title="选择项目"
        aria-expanded={open}
        onClick={() => {
          setOpen(true);
          void load();
        }}
      >
        <Folder className="h-4 w-4" />
        {selected?.name ?? '选择项目'}
      </button>
      <CreativePopover
        open={open}
        onOpenChange={(value) => {
          setOpen(value);
          if (!value) version.current++;
        }}
        anchorRef={anchor}
        title="选择项目"
      >
        <div className="hd-model-options">
          <button
            type="button"
            aria-pressed={!selected}
            onClick={() => {
              onSelect(null);
              setOpen(false);
            }}
          >
            <span>不关联项目</span>
            {!selected && <Check />}
          </button>
          {rows.map((project) => (
            <button
              type="button"
              key={project.projectId}
              aria-pressed={selected?.projectId === project.projectId}
              onClick={() => {
                onSelect(project);
                setOpen(false);
              }}
            >
              <span>{project.name}</span>
              {selected?.projectId === project.projectId && <Check />}
            </button>
          ))}
        </div>
        {loading && (
          <p className="hd-picker-state" role="status">
            加载中…
          </p>
        )}
        {!loading && !error && rows.length === 0 && (
          <p className="hd-picker-state" role="status">
            还没有个人项目，可先在项目页创建。
          </p>
        )}
        {error && (
          <p role="alert">
            项目暂时无法加载{' '}
            <button type="button" onClick={() => void load()}>
              重试
            </button>
          </p>
        )}
        <p className="hd-mode-help">关联个人项目中的任务；团队任务请从团队项目工作台创建。</p>
      </CreativePopover>
    </>
  );
}
