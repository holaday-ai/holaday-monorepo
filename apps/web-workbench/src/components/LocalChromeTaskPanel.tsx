import { Globe, Loader2, X } from 'lucide-react';
import * as React from 'react';
import { Button } from '@/components/ui/button';
import { useBrowserOwnership } from '@/hooks/useBrowserOwnership';
import { trpc } from '@/lib/trpc';
import type { UiTaskStatus } from '@/types/task';

export function LocalChromeTaskPanel({ taskId, status, onClose }: { taskId: string; status?: UiTaskStatus | null; onClose?: () => void }) {
  const ownership = useBrowserOwnership(taskId, true);
  const [stopping, setStopping] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const terminal = ['completed', 'failed', 'cancelled', 'timeout', 'partial_success'].includes(status ?? '');
  const phase = ownership.state?.phase;
  const transitioning = phase === 'requested' || phase === 'resuming' || ownership.pending;
  async function stop() {
    setStopping(true); setError(null);
    try {
      const result = await trpc.tasks.abort.mutate({ taskId });
      if (!result.ok) { setError('未能确认停止，请重试。'); setStopping(false); }
    } catch { setError('未能确认停止，请重试。'); setStopping(false); }
  }
  return <aside aria-label="本地 Chrome 任务" className="flex h-full min-h-64 flex-col rounded-2xl bg-background/80 p-5 text-foreground">
    <header className="flex items-center justify-between gap-3"><span className="flex items-center gap-2 text-sm"><Globe className="h-4 w-4" />Chrome</span>{onClose ? <button type="button" onClick={onClose} aria-label="关闭浏览器面板" title="关闭浏览器面板"><X className="h-4 w-4" /></button> : null}</header>
    <div className="flex flex-1 flex-col items-center justify-center gap-3 py-10 text-center">
      <Globe className="h-8 w-8 text-muted-foreground" />
      <h2 className="text-base font-medium">在你的 Chrome 中执行</h2>
      <p role="status" className="max-w-xs text-sm text-muted-foreground">{terminal ? '任务已结束，页面保留在 Chrome。' : stopping ? '正在停止，等待执行结果确认…' : phase === 'human' ? '已交给你，请在 Chrome 操作，完成后交还 AI。' : phase === 'requested' ? '正在等待当前动作结束，请稍候再操作。' : phase === 'resuming' ? '正在重新读取页面…' : phase === 'agent' ? 'AI 正在处理你选择的页面。' : '正在确认 Chrome 会话…'}</p>
      {transitioning ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /> : null}
      {error || (!terminal && ownership.error) ? <p role="alert" className="max-w-xs text-xs text-muted-foreground">{error || '暂时无法确认控制状态，请等待恢复或停止任务。'}</p> : null}
    </div>
    {!terminal ? <footer className="flex justify-center gap-2">
      <Button variant="secondary" disabled={!ownership.supported || transitioning || stopping || (phase !== 'agent' && phase !== 'human')} onClick={() => { void ownership.request(phase === 'human' ? 'return' : 'takeover'); }}>{phase === 'human' ? '交还 AI' : '接管'}</Button>
      <Button variant="ghost" disabled={stopping} onClick={() => { void stop(); }}>停止任务</Button>
    </footer> : null}
  </aside>;
}
