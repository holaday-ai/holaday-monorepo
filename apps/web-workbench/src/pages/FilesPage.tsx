import {
  Download,
  Eye,
  File as FileIcon,
  FileSpreadsheet,
  FileText,
  Image as ImageIcon,
  MoreHorizontal,
  Plus,
  Search,
  Trash2,
} from 'lucide-react';
import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import {
  FilePreviewModal,
  type FilePreviewPayload,
} from '@/components/FilePreviewModal';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useToast } from '@/components/ui/toast';
import {
  downloadFailureMessage,
  downloadFileAuthed,
} from '@/lib/download-file';
import { filesEmptyCopy, type FileFilter } from '@/lib/files-empty-copy';
import { trpc } from '@/lib/trpc';
import { useDebouncedValue } from '@/lib/use-debounced-value';
import { cn } from '@/lib/utils';
import { PageContainer, PageHeader } from '@/pages/PageShell';

interface UiFile {
  fileId: string;
  filename: string;
  mimetype: string;
  sizeBytes: number;
  createdAt: Date | string;
}

type Filter = FileFilter;

/**
 * P2.8 — files library. Each row shows two always-visible primary
 * actions (filename = 预览, plus 用于新任务) and folds 下载 / 复制链接
 * / 删除 into a Radix More dropdown. The earlier hover-to-reveal row
 * action strip was unreachable on touch and easy to miss on desktop,
 * which made delete in particular feel like a hidden hazard.
 *
 * Delete uses the product ConfirmDialog (no window.confirm) so users
 * see the filename + size and a clear "the link will stop working"
 * notice before the destructive call lands.
 */
export function FilesPage(): JSX.Element {
  const toast = useToast();
  const navigate = useNavigate();
  const [filter, setFilter] = React.useState<Filter>('all');
  const [q, setQ] = React.useState('');
  const [files, setFiles] = React.useState<UiFile[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [pendingDelete, setPendingDelete] = React.useState<UiFile | null>(null);
  const [previewing, setPreviewing] = React.useState<FilePreviewPayload | null>(
    null,
  );
  const debouncedQuery = useDebouncedValue(q.trim(), 250);

  const refresh = React.useCallback(async () => {
    setLoading(true);
    try {
      const list = await trpc.files.list.query({
        type: filter,
        q: debouncedQuery || undefined,
      });
      setFiles(list as UiFile[]);
    } catch (err) {
      toast.show(
        err instanceof Error ? `加载失败：${err.message}` : '加载失败',
        'error',
      );
    } finally {
      setLoading(false);
    }
  }, [debouncedQuery, filter, toast]);

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  function downloadUrl(fileId: string): string {
    return `/api/files/${encodeURIComponent(fileId)}/download`;
  }

  function onPreview(f: UiFile): void {
    // In-product authed preview. The previous `window.open` path
    // opened a top-level GET that browsers refuse to send the Bearer
    // header on — users on hd-app would land on a 401 page from the
    // orchestrator. The modal fetches the blob with auth and renders
    // inline (image / pdf / text), with a 下载到本地 fallback for
    // formats it can't show.
    setPreviewing({
      fileId: f.fileId,
      filename: f.filename,
      mimetype: f.mimetype,
      sizeBytes: f.sizeBytes,
      url: downloadUrl(f.fileId),
    });
  }

  async function onDownload(f: UiFile): Promise<void> {
    const res = await downloadFileAuthed({
      url: downloadUrl(f.fileId),
      filename: f.filename,
    });
    if (!res.ok) {
      toast.show(downloadFailureMessage(res.status), 'error');
    }
  }

  function onUseInNewTask(f: UiFile): void {
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

  const emptyCopy = filesEmptyCopy({ query: q, filter });

  // 复制下载链接 is intentionally gone: the orchestrator's
  // /api/files/:id/download endpoint requires an Authorization
  // header, so a raw link copied to clipboard 401s the moment the
  // user (or a tool they paste it into) navigates to it. Use 用于
  // 新任务 or 下载 instead.

  async function performDelete(f: UiFile): Promise<void> {
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
      <PageHeader title="文件库" description="管理你上传的文件和资料" />
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
          <div className="text-sm font-medium text-foreground/80">
            {emptyCopy.title}
          </div>
          <div className="text-xs text-muted-foreground">
            {emptyCopy.body}
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
                onPreview={() => onPreview(f)}
                onUseInNewTask={() => onUseInNewTask(f)}
                onDownload={() => void onDownload(f)}
                onDelete={() => setPendingDelete(f)}
              />
            ))}
          </div>
        </div>
      )}
      <FilePreviewModal payload={previewing} onClose={() => setPreviewing(null)} />
      <ConfirmDialog
        open={pendingDelete !== null}
        title="删除这个文件？"
        description={
          pendingDelete
            ? `${pendingDelete.filename} · ${formatBytes(pendingDelete.sizeBytes)}\n已完成任务的结果文本不会受影响，但文件的下载链接会失效。`
            : ''
        }
        confirmLabel="删除"
        destructive
        onClose={() => setPendingDelete(null)}
        onConfirm={async () => {
          const f = pendingDelete;
          if (!f) return;
          await performDelete(f);
          setPendingDelete(null);
        }}
      />
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
  onPreview,
  onUseInNewTask,
  onDownload,
  onDelete,
}: {
  file: UiFile;
  onPreview: () => void;
  onUseInNewTask: () => void;
  onDownload: () => void;
  onDelete: () => void;
}): JSX.Element {
  const Icon = iconForMime(file.mimetype);
  const date = new Date(file.createdAt as string | number | Date);
  return (
    <div className="flex flex-col gap-1.5 px-4 py-2.5 transition-colors hover:bg-foreground/[0.03] sm:grid sm:grid-cols-[1fr_auto_auto_auto] sm:items-center sm:gap-3">
      {/* Filename = preview. Always reachable, no hover required. */}
      <button
        type="button"
        onClick={onPreview}
        title={`预览 ${file.filename}`}
        className="flex min-w-0 items-center gap-2.5 text-left"
      >
        <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 truncate text-sm text-foreground hover:underline">
          {file.filename}
        </span>
      </button>
      {/* Size + time always rendered. Mobile shows them inline beneath
          the filename; sm+ snaps them into the grid columns. */}
      <div className="flex items-center gap-3 text-xs text-muted-foreground sm:contents">
        <span className="whitespace-nowrap sm:text-xs">{formatRelative(date)}</span>
        <span className="whitespace-nowrap sm:text-xs">{formatBytes(file.sizeBytes)}</span>
      </div>
      {/* Always-visible primary action + More menu. No hover-only
          opacity tricks — every action is reachable on touch. */}
      <div className="flex shrink-0 items-center gap-1">
        <button
          type="button"
          onClick={onUseInNewTask}
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-background px-2.5 text-xs font-medium text-foreground/85 transition-colors hover:border-foreground/30 hover:bg-foreground/[0.04]"
        >
          <Plus className="h-3.5 w-3.5" />
          用于新任务
        </button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label="更多操作"
              title="更多"
              className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-foreground/[0.05] hover:text-foreground"
            >
              <MoreHorizontal className="h-4 w-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44">
            <DropdownMenuItem onSelect={onPreview}>
              <Eye className="text-muted-foreground" />
              <span>预览</span>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onDownload}>
              <Download className="text-muted-foreground" />
              <span>下载</span>
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={onDelete}
              className="text-red-600 focus:bg-red-500/10 focus:text-red-600 dark:text-red-400 dark:focus:text-red-300"
            >
              <Trash2 />
              <span>删除</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
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
