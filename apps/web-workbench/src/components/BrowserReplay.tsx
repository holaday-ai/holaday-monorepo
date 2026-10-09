import { useRef, useState } from 'react';
import { trpc } from '@/lib/trpc';

type Replay = NonNullable<Awaited<ReturnType<typeof trpc.browserReplay.read.query>>>;
export function BrowserReplay({ taskId }: { taskId: string }) {
  const [replay, setReplay] = useState<Replay | null>(null);
  const [index, setIndex] = useState(0);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const generation = useRef(0);
  const load = async (offset = 0) => {
    const request = ++generation.current;
    setBusy(true);
    if (!offset) setIndex(0);
    try {
      const next = await trpc.browserReplay.read.query({ taskId, offset });
      if (request !== generation.current) return;
      setReplay((current) =>
        next && offset && current ? { ...next, frames: [...current.frames, ...next.frames] } : next,
      );
      setStatus(next ? '' : '暂无可用回放');
    } catch {
      if (request === generation.current) setStatus('回放暂时不可用，请重试');
    } finally {
      if (request === generation.current) setBusy(false);
    }
  };
  const remove = async () => {
    ++generation.current;
    setBusy(true);
    try {
      await trpc.browserReplay.remove.mutate({ taskId });
      setReplay(null);
      setIndex(0);
      setStatus('回放已删除');
    } catch {
      setStatus('删除失败，请重试');
    } finally {
      setBusy(false);
    }
  };
  const frame = replay?.frames[index];
  return (
    <div className="shrink-0 border-t border-border px-3 py-2 text-xs">
      <div className="flex items-center gap-3">
        <button
          type="button"
          disabled={busy}
          onClick={() => void load()}
          className="text-muted-foreground hover:text-foreground"
        >
          查看回放
        </button>
        {replay && (
          <button
            type="button"
            disabled={busy}
            onClick={() => void remove()}
            className="text-muted-foreground hover:text-foreground"
          >
            删除回放
          </button>
        )}
        {replay && (
          <button
            type="button"
            onClick={() => {
              generation.current++;
              setBusy(false);
              setReplay(null);
              setIndex(0);
            }}
            className="ml-auto"
          >
            收起
          </button>
        )}
        {status && <span role="status">{status}</span>}
      </div>
      {replay && (
        <div className="mt-2 space-y-2">
          <p className="text-muted-foreground">
            仅你可见 · 默认保留 7 天 · {replay.total} 帧
            {replay.truncated ? ' · 已达到录制上限' : ''}
          </p>
          {frame && (
            <>
              {frame.image ? (
                <img
                  className="max-h-64 w-full object-contain"
                  src={frame.image}
                  alt={`步骤 ${frame.actionId} 的${frame.phase === 'before' ? '操作前' : frame.phase === 'failure' ? '失败' : '操作后'}画面`}
                />
              ) : (
                <div className="rounded bg-muted p-6 text-center">
                  {frame.redacted ? '敏感页面已遮挡' : '此处未录制或连接中断'}
                </div>
              )}
              <input
                aria-label="回放时间轴"
                type="range"
                min={0}
                max={Math.max(0, replay.frames.length - 1)}
                value={index}
                onChange={(event) => setIndex(Number(event.target.value))}
                className="w-full"
              />
              <p>
                {index + 1} / {replay.frames.length} · {frame.actionId} · {frame.phase} ·{' '}
                {new Date(frame.capturedAt).toLocaleTimeString()}
              </p>
            </>
          )}
          {replay.next !== null && (
            <button disabled={busy} type="button" onClick={() => void load(replay.next!)}>
              加载后续画面
            </button>
          )}
        </div>
      )}
    </div>
  );
}
