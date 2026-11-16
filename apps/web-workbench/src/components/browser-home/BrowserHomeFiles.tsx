import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { downloadFailureMessage } from '@/lib/download-file';
import { formatFileSize } from '@/lib/file-size';
import {
  type HomeFiles,
  type HomeFilesContext,
  createHomeFilesContext,
} from '@/lib/home-files-context';
import { Download, FolderDown, Loader2, RefreshCw } from 'lucide-react';
import * as React from 'react';

const BUTTON =
  'inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40';
const TRANSFER = {
  pending: '正在接收',
  failed: '保存失败',
  unconfirmed: '保存结果待核对',
  saved: '已保存',
};
const date = (value: string) => new Date(value).toLocaleString('zh-CN', { hour12: false });

export function BrowserHomeFiles(props: { ownerId: string; receiving: boolean }): JSX.Element {
  return <OwnerFiles key={props.ownerId} {...props} />;
}

function OwnerFiles({ ownerId, receiving }: { ownerId: string; receiving: boolean }): JSX.Element {
  const [open, setOpen] = React.useState(false);
  const [data, setData] = React.useState<HomeFiles | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [downloading, setDownloading] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [message, setMessage] = React.useState<string | null>(null);
  const context = React.useRef<HomeFilesContext | null>(null);
  const load = React.useRef<null | (() => Promise<void>)>(null);
  const mounted = React.useRef(true);
  React.useLayoutEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  React.useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    let active = true;
    let fetching = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const current = () => {
      if (!mounted.current || !active) throw new Error('文件面板已关闭。');
    };
    const refresh = async () => {
      if (fetching) return;
      fetching = true;
      setBusy(true);
      clearTimeout(timer);
      try {
        const bound =
          context.current ?? (await createHomeFilesContext(ownerId, current, controller.signal));
        current();
        context.current = bound;
        const result = await bound.list();
        current();
        setData(result);
        setError(null);
        timer = setTimeout(() => void refresh(), 5000);
      } catch (failure) {
        if (active && mounted.current) {
          setData(null);
          setError(failure instanceof Error ? failure.message : '暂时无法读取文件，请重试。');
        }
      } finally {
        fetching = false;
        if (active && mounted.current) setBusy(false);
      }
    };
    context.current = null;
    load.current = refresh;
    void refresh();
    return () => {
      active = false;
      controller.abort();
      clearTimeout(timer);
      context.current = null;
      load.current = null;
    };
  }, [open, ownerId]);

  const download = async (file: NonNullable<HomeFiles>['files'][number]) => {
    const bound = context.current;
    if (!bound || downloading) return;
    setDownloading(file.fileId);
    setMessage(null);
    setError(null);
    try {
      const result = await bound.download(file);
      bound.current();
      if (!result.ok) throw new Error(downloadFailureMessage(result.status));
      setMessage(`已交给浏览器下载：${file.filename}`);
    } catch (failure) {
      if (mounted.current && context.current === bound) {
        setData(null);
        setError(failure instanceof Error ? failure.message : '下载失败，请重试。');
      }
    } finally {
      if (mounted.current && context.current === bound) setDownloading(null);
    }
  };
  const files = data?.enabled ? data.files : [];
  const transfers = data?.enabled
    ? data.transfers.filter(
        (row) => row.state !== 'saved' || !files.some((file) => file.fileId === row.fileId),
      )
    : [];
  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        setData(null);
        setError(null);
        setMessage(null);
        setDownloading(null);
      }}
    >
      <SheetTrigger asChild>
        <button type="button" className={BUTTON} aria-label="浏览器文件" title="浏览器文件">
          <FolderDown className="h-4 w-4" aria-hidden />
          <span className="sr-only">浏览器文件</span>
        </button>
      </SheetTrigger>
      <SheetContent className="flex w-full max-w-full flex-col gap-4 sm:max-w-lg">
        <SheetHeader className="pr-6 text-left">
          <SheetTitle>浏览器文件</SheetTitle>
          <SheetDescription>
            从云浏览器下载并保存的文件。关闭网页后仍可在有效期内取回。
          </SheetDescription>
        </SheetHeader>
        {!receiving && (
          <p className="text-sm text-muted-foreground">
            当前浏览器尚未启用文件接收；这里可取回此前保存的文件。
          </p>
        )}
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">最近保存的 50 个文件</p>
          <button
            type="button"
            className={BUTTON}
            disabled={busy}
            onClick={() => void load.current?.()}
          >
            <RefreshCw className="h-4 w-4" aria-hidden />
            刷新
          </button>
        </div>
        {busy && !data && (
          <output className="flex items-center gap-2 text-sm">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            正在读取文件…
          </output>
        )}
        {error && (
          <p role="alert" className="break-words text-sm text-destructive">
            {error}
          </p>
        )}
        {message && <output className="block break-words text-sm">{message}</output>}
        {data && !data.enabled && (
          <p className="text-sm text-muted-foreground">文件功能暂未启用。</p>
        )}
        {data?.enabled && files.length === 0 && transfers.length === 0 && (
          <p className="py-8 text-sm text-muted-foreground">还没有保存的浏览器文件。</p>
        )}
        <div className="min-h-0 flex-1 overflow-y-auto">
          <ul className="divide-y divide-border">
            {transfers.map((row) => (
              <li key={row.id} className="space-y-1 py-4">
                <p className="break-all text-sm font-medium">{row.filename}</p>
                <p className="text-sm">{TRANSFER[row.state]}</p>
                <p className="break-all text-xs text-muted-foreground">
                  来源：{row.origin}
                  {row.taskId ? ` · 任务 ${row.taskId}` : ' · 手动浏览'}
                </p>
                {row.state === 'unconfirmed' && (
                  <p className="text-sm text-muted-foreground">
                    正在核对保存结果，请勿重复触发网页操作。
                  </p>
                )}
              </li>
            ))}
            {files.map((file) => (
              <li key={file.fileId} className="space-y-2 py-4">
                <p className="break-all text-sm font-medium">{file.filename}</p>
                <p className="break-all text-xs text-muted-foreground">
                  来源：{file.origin}
                  {file.taskId ? ` · 任务 ${file.taskId}` : ' · 手动浏览'}
                </p>
                <p className="text-xs text-muted-foreground">
                  {formatFileSize(file.sizeBytes)} · 保存于 {date(file.createdAt)}
                </p>
                <p className="text-xs text-muted-foreground">
                  {file.expiresAt ? `有效至 ${date(file.expiresAt)}` : '长期保存'}
                  {!file.available ? ' · 文件已不可用' : ''}
                </p>
                <button
                  type="button"
                  className={`${BUTTON} max-w-full`}
                  disabled={!file.available || downloading !== null}
                  onClick={() => void download(file)}
                >
                  <Download className="h-4 w-4 shrink-0" aria-hidden />
                  <span className="min-w-0 break-all text-left">
                    {downloading === file.fileId ? '正在取回…' : `下载 ${file.filename}`}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      </SheetContent>
    </Sheet>
  );
}
