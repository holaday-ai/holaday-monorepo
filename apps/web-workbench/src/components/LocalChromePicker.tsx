import { Globe, Loader2, X } from 'lucide-react';
import * as React from 'react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { trpc } from '@/lib/trpc';
import { useTaskStore } from '@/stores/task-store';

type Discovery = Awaited<ReturnType<typeof trpc.tasks.localChromeTabs.query>>;
export function LocalChromePicker({ disabled = false, compact = false }: { disabled?: boolean; compact?: boolean }) {
  const selected = useTaskStore(state => state.localChromeSelection);
  const [open, setOpen] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [result, setResult] = React.useState<Discovery | null>(null);
  const [error, setError] = React.useState(false);
  const sequence = React.useRef(0);
  React.useEffect(() => () => { sequence.current++; }, []);
  async function discover() {
    const revision = ++sequence.current;
    setLoading(true); setError(false); setResult(null);
    try {
      const next = await trpc.tasks.localChromeTabs.query();
      if (revision === sequence.current) setResult(next);
    } catch { if (revision === sequence.current) setError(true); }
    finally { if (revision === sequence.current) setLoading(false); }
  }
  return <div className={compact ? 'hd-chrome-compact' : 'flex min-w-0 items-center gap-1 px-3 py-1 text-xs text-muted-foreground'}>
    <DropdownMenu open={open} onOpenChange={next => { setOpen(next); if (next) void discover(); }}>
      <DropdownMenuTrigger asChild>
        <button type="button" disabled={disabled} aria-label="选择 Chrome 页面" title="使用你已登录的 Chrome 页面执行任务" className="flex min-w-0 max-w-64 items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-foreground/5 disabled:opacity-50">
          <Globe className="h-3.5 w-3.5 shrink-0" />{(!compact || selected) && <span className="truncate">{selected ? selected.title || selected.expectedUrl : '连接 Chrome'}</span>}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" className="w-80 max-w-[90vw] p-2">
        <div className="px-2 py-2 text-xs text-muted-foreground">选择一个页面 · 使用现有登录态</div>
        {loading ? <div role="status" className="flex gap-2 p-3 text-sm"><Loader2 className="h-4 w-4 animate-spin" />正在查找页面</div> : null}
        {result?.needsUpdate ? <p role="alert" className="p-2 text-xs">请更新并重新连接 HOLADAY Chrome 扩展。</p> : error || result?.unavailable ? <p role="alert" className="p-2 text-xs">部分连接暂时无法读取页面，请重新连接；若使用旧版扩展，请先更新。</p> : null}
        {result && !result.connected ? <p className="p-2 text-xs">请先连接 HOLADAY Chrome 扩展</p> : null}
        {result?.connected && !result.tabs.length && !result.unavailable ? <p className="p-2 text-xs">没有可选网页，请在 Chrome 打开一个网站。</p> : null}
        <div className="max-h-64 overflow-y-auto">{result?.tabs.map(tab => <DropdownMenuItem key={`${tab.extensionClientId}:${tab.tabId}`} className="block w-full rounded-lg px-2 py-2 text-left hover:bg-foreground/5 focus:bg-foreground/5" onSelect={() => { useTaskStore.setState({ localChromeSelection: tab }); setOpen(false); }}>
          <span className="block truncate text-sm">{tab.title || '未命名页面'}</span><span className="block truncate text-xs text-muted-foreground">{tab.expectedUrl}</span>
        </DropdownMenuItem>)}</div>
      </DropdownMenuContent>
    </DropdownMenu>
    {selected ? <button type="button" disabled={disabled} aria-label="移除 Chrome 页面" title="改用默认执行方式" className="rounded p-1 hover:bg-foreground/5" onClick={() => useTaskStore.setState({ localChromeSelection: null })}><X className="h-3 w-3" /></button> : null}
  </div>;
}
