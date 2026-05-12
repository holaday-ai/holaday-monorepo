import {
  Download,
  Eye,
  File as FileIcon,
  FileSpreadsheet,
  FileText,
  Image as ImageIcon,
  Plus,
  Search,
  Trash2,
} from 'lucide-react';
import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import { useToast } from '@/components/ui/toast';
import { trpc } from '@/lib/trpc';
import { cn } from '@/lib/utils';
import { PageContainer, PageHeader } from '@/pages/PageShell';

interface UiFile {
  fileId: string;
  filename: string;
  mimetype: string;
  sizeBytes: number;
  createdAt: Date | string;
}

type Filter = 'all' | 'images' | 'documents';

/**
 * P2.8 — files library polish. Inventory of every task_files row the
 * user has accumulated. Each row exposes 预览 (open in new tab), 下载
 * (direct download), 用于新任务 (jump to home with the file pre-
 * staged), and 删除. Mobile shows size + time inline (was hidden
 * behind sm:block).
 */
export function FilesPage(): JSX.Element {
  const toast = useToast();
  const navigate = useNavigate();
  const [filter, setFilter] = React.useState<Filter>('all');
  const [q, setQ] = React.useState('');
  const [files, setFiles] = React.useState<UiFile[]>([]);
  const [loading, setLoading] = React.useState(true);

  const refresh = React.useCallback(async () => {
    setLoading(true);
    try {
      const list = await trpc.files.list.query({ type: filter, q: q.trim() || undefined });
      setFiles(list as UiFile[]);
    } catch (err) {
      toast.show(
        err instanceof Error ? `加载失败：${err.message}` : '加载失败',
        'error',
      );
    } finally {
      setLoading(false);
    }
  }, [filter, q, toast]);

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  function downloadUrl(fileId: string): string {
    return `/api/files/${encodeURIComponent(fileId)}/download`;
  }

  function onPreview(f: UiFile): void {
    // Open in a new tab — for images / PDFs the browser renders
    // inline; for everything else this triggers a download. The
    // download endpoint sets Content-Disposition: inline so
    // browsers prefer preview when they know how to.
    window.open(downloadUrl(f.fileId), '_blank', 'noopener');
  }

  function onUseInNewTask(f: UiFile): void {
    // Hand off to the home composer via React Router location.state.
    // Carrying the full UiFile means InputArea can pre-stage the
    // DraftAttachment without a separate metadata round-trip — the
    // chip renders immediately and submission already has the fileId.
    //
    // Item 3 — `newTask: true` tells the composer to drop any
    // currently-selected terminal task and dismiss the follow-up
    // chip. Otherwise a user with a recently-completed task selected
    // would land on /, see the file pre-attached, and unknowingly
    // submit a 追问 of the old task instead of a fresh task.
    navigate('/', {
      state: {
        attachFile: {
          fileId: f.fileId,
          filename: f.filename,
          mimetype: f.mimetype,
          sizeBytes: f.sizeBytes,
        },
        newTask: true,
      },
    });
  }

  async function onDelete(f: UiFile): Promise<void> {
    if (!window.confirm(`删除文件「${f.filename}」？`)) return;
    try {
      await trpc.files.delete.mutate({ fileId: f.fileId });
      toast.show('文件已删除');
      await refresh();
    } catch (err) {
      toast.show(
        err instanceof Error ? `删除失败：${err.message}` : '删除失败',
        'error',
      );
    }
  }

  return (
    <PageContainer width="wide">
      <PageHeader title="文件库" description="在这里管理任务中上传和生成的文件" />
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-1">
          <FilterTab label="全部" active={filter === 'all'} onClick={() => setFilter('all')} />
          <FilterTab
            label="图片"
            active={filter === 'images'}
            onClick={() => setFilter('images')}
          />
          <FilterTab
            label="文件"
            active={filter === 'documents'}
            onClick={() => setFilter('documents')}
          />
        </div>
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="搜索文件名…"
            className="w-full rounded-md border border-input bg-background py-1.5 pl-8 pr-3 text-sm focus-visible:border-foreground/30 focus-visible:outline-none sm:w-64"
          />
        </div>
      </div>

      {loading ? (
        <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
          加载中…
        </div>
      ) : files.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border bg-card/40 px-6 py-12 text-center">
          <FileIcon className="h-8 w-8 text-muted-foreground/40" />
          <div className="text-sm font-medium text-foreground/80">还没有文件</div>
          <div className="text-xs text-muted-foreground">
            在任务输入框点 + 号上传文件，文件会出现在这里。
          </div>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border bg-card">
          <div className="hidden grid-cols-[1fr_auto_auto_auto] items-center gap-3 border-b border-border bg-muted/40 px-4 py-2 text-[11px] font-medium tracking-wider text-muted-foreground sm:grid">
            <div>名称</div>
            <div>已修改</div>
            <div>大小</div>
            <div />
          </div>
          <div className="divide-y divide-border">
            {files.map((f) => (
              <FileRow
                key={f.fileId}
                file={f}
                downloadHref={downloadUrl(f.fileId)}
                onPreview={() => onPreview(f)}
                onUseInNewTask={() => onUseInNewTask(f)}
                onDelete={() => void onDelete(f)}
              />
            ))}
          </div>
        </div>
      )}
    </PageContainer>
  );
}

function FilterTab({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
        active
          ? 'bg-foreground text-background'
          : 'text-muted-foreground hover:bg-foreground/[0.05] hover:text-foreground',
      )}
    >
      {label}
    </button>
  );
}

function FileRow({
  file,
  downloadHref,
  onPreview,
  onUseInNewTask,
  onDelete,
}: {
  file: UiFile;
  downloadHref: string;
  onPreview: () => void;
  onUseInNewTask: () => void;
  onDelete: () => void;
}): JSX.Element {
  const Icon = iconForMime(file.mimetype);
  const date = new Date(file.createdAt as string | number | Date);
  return (
    <div className="group flex flex-col gap-1.5 px-4 py-2.5 transition-colors hover:bg-foreground/[0.03] sm:grid sm:grid-cols-[1fr_auto_auto_auto] sm:items-center sm:gap-3">
      <div className="flex min-w-0 items-center gap-2.5">
        <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 truncate text-sm text-foreground" title={file.filename}>
          {file.filename}
        </span>
      </div>
      {/* P2.8 — size + time always rendered. Mobile shows them inline
          beneath the filename; sm+ snaps them into the grid columns. */}
      <div className="flex items-center gap-3 text-xs text-muted-foreground sm:contents">
        <span className="whitespace-nowrap sm:text-xs">{formatRelative(date)}</span>
        <span className="whitespace-nowrap sm:text-xs">{formatBytes(file.sizeBytes)}</span>
      </div>
      <div className="flex shrink-0 items-center gap-1 sm:opacity-0 sm:transition-opacity sm:group-hover:opacity-100">
        <RowAction onClick={onPreview} label="预览" icon={<Eye className="h-3.5 w-3.5" />} />
        <RowAction
          asLink
          href={downloadHref}
          download={file.filename}
          label="下载"
          icon={<Download className="h-3.5 w-3.5" />}
        />
        <RowAction
          onClick={onUseInNewTask}
          label="用于新任务"
          icon={<Plus className="h-3.5 w-3.5" />}
        />
        <RowAction
          onClick={onDelete}
          label={`删除 ${file.filename}`}
          icon={<Trash2 className="h-3.5 w-3.5" />}
          danger
        />
      </div>
    </div>
  );
}

function RowAction({
  onClick,
  label,
  icon,
  danger = false,
  asLink = false,
  href,
  download,
}: {
  onClick?: () => void;
  label: string;
  icon: React.ReactNode;
  danger?: boolean;
  asLink?: boolean;
  href?: string;
  download?: string;
}): JSX.Element {
  const className = cn(
    'rounded p-1 text-muted-foreground transition-colors hover:bg-foreground/[0.06] hover:text-foreground',
    danger && 'hover:bg-red-500/10 hover:text-red-600 dark:hover:text-red-400',
  );
  if (asLink && href) {
    return (
      <a
        href={href}
        download={download}
        aria-label={label}
        title={label}
        className={className}
      >
        {icon}
      </a>
    );
  }
  return (
    <button type="button" onClick={onClick} aria-label={label} title={label} className={className}>
      {icon}
    </button>
  );
}

function iconForMime(mime: string): typeof FileIcon {
  if (mime.startsWith('image/')) return ImageIcon;
  if (mime.includes('pdf')) return FileText;
  if (mime.includes('sheet') || mime.includes('excel') || mime.includes('csv')) {
    return FileSpreadsheet;
  }
  if (mime.includes('text') || mime.includes('word') || mime.includes('document')) {
    return FileText;
  }
  return FileIcon;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function formatRelative(d: Date): string {
  const now = Date.now();
  const t = d.getTime();
  if (Number.isNaN(t)) return '';
  const diff = now - t;
  const day = 24 * 3600 * 1000;
  if (diff < day) return '今天';
  if (diff < 2 * day) return '昨天';
  if (diff < 7 * day) return `${Math.floor(diff / day)}天前`;
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}
