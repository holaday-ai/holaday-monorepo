import {
  AlertCircle,
  Check,
  Download,
  Copy,
  Eye,
  File as FileIcon,
  FileSpreadsheet,
  FileText,
  Film,
  Image as ImageIcon,
  Loader2,
  MoreHorizontal,
  Plus,
  Search,
  Scissors,
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
import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { copyTextToClipboard } from '@/lib/copy-text';
import { useToast } from '@/components/ui/toast';
import {
  downloadFailureMessage,
  downloadFileAuthed,
} from '@/lib/download-file';
import { formatFileSize } from '@/lib/file-size';
import {
  canApplyFilesResponse,
  fileReferenceText,
  formatFileRelativeDate,
  normalizeFilesListPage,
  type NormalizedFileRow,
} from '@/lib/files-page-state';
import { filesEmptyCopy, type FileFilter } from '@/lib/files-empty-copy';
import { pageActionError } from '@/lib/page-error-copy';
import { trpc } from '@/lib/trpc';
import {
  isFileUnavailable,
  markFileUnavailable,
  markFileUnavailableFromStatus,
  useUnavailableFiles,
} from '@/lib/unavailable-file-registry';
import { useDebouncedValue } from '@/lib/use-debounced-value';
import { cn } from '@/lib/utils';
import { PageContainer, PageHeader, PageLoadingPanel } from '@/pages/PageShell';
import {
  canCombineVideoRows,
  canContinueEditing,
  createVideoEditingProject,
  type VideoEditingEntryArtifact,
} from '@/features/video-editing/video-edit-entry';

type UiFile = NormalizedFileRow;

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
  const mountedRef = React.useRef(false);
  const requestIdRef = React.useRef(0);
  const [filter, setFilter] = React.useState<Filter>('all');
  const [q, setQ] = React.useState('');
  const [files, setFiles] = React.useState<UiFile[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [loadingMore, setLoadingMore] = React.useState(false);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [nextCursor, setNextCursor] = React.useState<number | null>(null);
  const [pendingDelete, setPendingDelete] = React.useState<UiFile | null>(null);
  const [previewing, setPreviewing] = React.useState<FilePreviewPayload | null>(
    null,
  );
  const [videoEditingEnabled, setVideoEditingEnabled] = React.useState(false);
  const [selectionMode, setSelectionMode] = React.useState(false);
  const [selectedVideoFileIds, setSelectedVideoFileIds] = React.useState<string[]>([]);
  const [editingFileId, setEditingFileId] = React.useState<string | null>(null);
  const unavailableFiles = useUnavailableFiles();
  const debouncedQuery = useDebouncedValue(q.trim(), 250);

  const refresh = React.useCallback(async () => {
    const requestId = ++requestIdRef.current;
    setLoading(true);
    setLoadingMore(false);
    setLoadError(null);
    try {
      const page = normalizeFilesListPage(await trpc.files.list.query({
        type: filter,
        q: debouncedQuery || undefined,
        limit: 50,
      }));
      if (!mountedRef.current || requestId !== requestIdRef.current) return;
      setFiles(page.items);
      setNextCursor(page.nextCursor);
    } catch (err) {
      if (!mountedRef.current || requestId !== requestIdRef.current) return;
      setFiles([]);
      setNextCursor(null);
      setLoadError(pageActionError('文件暂时无法加载', err));
    } finally {
      if (mountedRef.current && requestId === requestIdRef.current) setLoading(false);
    }
  }, [debouncedQuery, filter]);

  const loadMore = React.useCallback(async () => {
    if (loadingMore || nextCursor === null) return;
    const requestId = requestIdRef.current;
    setLoadingMore(true);
    setLoadError(null);
    try {
      const page = normalizeFilesListPage(await trpc.files.list.query({
        type: filter,
        q: debouncedQuery || undefined,
        cursor: nextCursor,
        limit: 50,
      }));
      if (
        !mountedRef.current ||
        !canApplyFilesResponse(requestId, requestIdRef.current)
      ) {
        return;
      }
      setFiles((current) => {
        const seen = new Set(current.map((file) => file.fileId));
        return [...current, ...page.items.filter((file) => !seen.has(file.fileId))];
      });
      setNextCursor(page.nextCursor);
    } catch (err) {
      if (
        !mountedRef.current ||
        !canApplyFilesResponse(requestId, requestIdRef.current)
      ) {
        return;
      }
      setLoadError(pageActionError('更多文件暂时无法加载', err));
    } finally {
      if (
        mountedRef.current &&
        canApplyFilesResponse(requestId, requestIdRef.current)
      ) {
        setLoadingMore(false);
      }
    }
  }, [debouncedQuery, filter, loadingMore, nextCursor]);

  React.useEffect(() => {
    mountedRef.current = true;
    void refresh();
    return () => {
      mountedRef.current = false;
      requestIdRef.current += 1;
    };
  }, [refresh]);

  React.useEffect(() => {
    let active = true;
    void trpc.videoEditing.capability.query().then(
      (result) => {
        if (active) setVideoEditingEnabled(result.enabled);
      },
      () => {
        if (active) setVideoEditingEnabled(false);
      },
    );
    return () => {
      active = false;
    };
  }, []);

  React.useEffect(() => {
    if (filter === 'videos') return;
    setSelectionMode(false);
    setSelectedVideoFileIds([]);
  }, [filter]);

  function downloadUrl(fileId: string): string {
    return `/api/files/${encodeURIComponent(fileId)}/download`;
  }

  function onPreview(f: UiFile): void {
    if (isFileUnavailable({ fileId: f.fileId, url: downloadUrl(f.fileId) })) return;
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
    const reference = { fileId: f.fileId, url: downloadUrl(f.fileId) };
    if (isFileUnavailable(reference)) return;
    const res = await downloadFileAuthed({
      url: reference.url,
      filename: f.filename,
    });
    if (!mountedRef.current) return;
    if (!res.ok) {
      markFileUnavailableFromStatus(reference, res.status);
      toast.show(downloadFailureMessage(res.status), 'error');
    }
  }

  async function onCopyReference(f: UiFile): Promise<void> {
    const ok = await copyTextToClipboard(fileReferenceText(f));
    if (!mountedRef.current) return;
    toast.show(ok ? '文件引用已复制' : '复制失败，请稍后重试', ok ? 'info' : 'error');
  }

  function onUseInNewTask(f: UiFile): void {
    if (isFileUnavailable({ fileId: f.fileId, url: downloadUrl(f.fileId) })) return;
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

  function editingArtifact(file: UiFile): VideoEditingEntryArtifact {
    return {
      fileId: file.fileId,
      mimetype: file.mimetype,
      availability: isFileUnavailable(
        { fileId: file.fileId, url: downloadUrl(file.fileId) },
        unavailableFiles,
      )
        ? 'unavailable'
        : 'active',
    };
  }

  async function openEditingProject(sourceFileIds: string[]): Promise<void> {
    if (editingFileId || sourceFileIds.length === 0) return;
    setEditingFileId(sourceFileIds.length === 1 ? sourceFileIds[0]! : 'combined');
    try {
      const { projectId } = await createVideoEditingProject({
        sourceFileIds,
        create: (input) => trpc.videoEditing.createProject.mutate(input),
      });
      navigate(`/video/edit/${encodeURIComponent(projectId)}`);
    } catch (error) {
      toast.show(error instanceof Error ? error.message : '暂时无法打开剪辑', 'error');
    } finally {
      if (mountedRef.current) setEditingFileId(null);
    }
  }

  function toggleVideoSelection(fileId: string): void {
    setSelectedVideoFileIds((current) =>
      current.includes(fileId) ? current.filter((id) => id !== fileId) : [...current, fileId],
    );
  }

  const selectedVideoFiles = selectedVideoFileIds.flatMap((fileId) => {
    const file = files.find((candidate) => candidate.fileId === fileId);
    return file ? [editingArtifact(file)] : [];
  });
  const combination = canCombineVideoRows(selectedVideoFiles);

  const emptyCopy = filesEmptyCopy({ query: q, filter });
  const summary = loading
    ? '文件加载中…'
    : loadError && files.length === 0
      ? '文件暂时无法加载'
    : files.length > 0
      ? `已加载 ${files.length} 个文件`
      : q.trim()
        ? '没有匹配文件'
        : '文件库为空';

  // 复制下载链接 is intentionally gone: the orchestrator's
  // /api/files/:id/download endpoint requires an Authorization
  // header, so a raw link copied to clipboard 401s the moment the
  // user (or a tool they paste it into) navigates to it. Use 用于
  // 新任务 or 下载 instead.

  async function performDelete(f: UiFile): Promise<void> {
    try {
      await trpc.files.delete.mutate({ fileId: f.fileId });
      if (!mountedRef.current) return;
      markFileUnavailable(f.fileId);
      toast.show('文件已删除');
      await refresh();
    } catch (err) {
      if (!mountedRef.current) return;
      toast.show(pageActionError('删除失败', err), 'error');
    }
  }

  return (
    <TooltipProvider delayDuration={120}>
      <PageContainer width="wide">
        <PageHeader
          title="文件库"
          description="管理你上传的文件和资料"
          action={
            <div className="inline-flex items-center rounded-full border border-[#DCDDDD] bg-white px-3 py-1 text-[12px] font-medium text-[#595757] shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
              {summary}
            </div>
          }
        />
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="inline-flex w-fit items-center gap-0.5 rounded-[8px] border border-[#DCDDDD] bg-[#EFEFEF]/55 p-0.5">
            <FilterTab label="全部" active={filter === 'all'} onClick={() => setFilter('all')} />
            <FilterTab
              label="图片"
              active={filter === 'images'}
              onClick={() => setFilter('images')}
            />
            <FilterTab
              label="视频"
              active={filter === 'videos'}
              onClick={() => setFilter('videos')}
            />
            <FilterTab
              label="文件"
              active={filter === 'documents'}
              onClick={() => setFilter('documents')}
            />
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            {videoEditingEnabled && filter === 'videos' ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => {
                  setSelectionMode((current) => !current);
                  setSelectedVideoFileIds([]);
                }}
                className="h-8 gap-1.5 border-[#E0D2DF] bg-white text-[#6E5667] hover:bg-[#FFF7FA] hover:text-[#C02B66]"
              >
                <Scissors className="h-3.5 w-3.5" aria-hidden />
                {selectionMode ? '退出拼接' : '选择视频拼接'}
              </Button>
            ) : null}
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="搜索文件名…"
                className="w-full rounded-[8px] border border-[#DCDDDD] bg-white py-1.5 pl-8 pr-3 text-sm shadow-[0_1px_2px_rgba(15,23,42,0.03)] focus-visible:border-[#ADADAD] focus-visible:outline-none sm:w-64"
              />
            </div>
          </div>
        </div>

        {selectionMode ? (
          <div className="mb-4 flex flex-col gap-3 rounded-[16px] border border-[#E8DDE8] bg-[linear-gradient(120deg,#FFF9FB,#F6F8FF)] px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="text-[13px] font-semibold text-[#3B333D]">
                已按顺序选择 {selectedVideoFileIds.length} 段
              </div>
              <div className="mt-0.5 text-[11px] text-[#817783]">
                {combination.reason ?? '将按选择顺序创建一个可恢复的新剪辑项目。'}
              </div>
            </div>
            <Button
              type="button"
              disabled={!combination.compatible || editingFileId !== null}
              onClick={() => void openEditingProject(combination.sourceFileIds)}
              className="h-10 shrink-0 gap-2 rounded-[10px]"
            >
              {editingFileId === 'combined' ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              ) : (
                <Scissors className="h-4 w-4" aria-hidden />
              )}
              {editingFileId === 'combined'
                ? '正在创建…'
                : `把选中的 ${selectedVideoFileIds.length} 段串成一条`}
            </Button>
          </div>
        ) : null}

        {loading ? (
          <PageLoadingPanel label="文件加载中" description="正在整理文件库" />
        ) : loadError && files.length === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-[8px] border border-[#DCDDDD] bg-white px-6 py-12 text-center shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
            <AlertCircle className="h-8 w-8 text-[#EA1F59]" aria-hidden />
            <div className="text-sm font-medium text-foreground/80">文件暂时无法加载</div>
            <div className="max-w-md text-xs leading-5 text-muted-foreground">{loadError}</div>
            <Button type="button" size="sm" onClick={() => void refresh()}>
              重试
            </Button>
          </div>
        ) : files.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-[8px] border border-dashed border-[#DCDDDD] bg-white px-6 py-12 text-center shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
            <FileIcon className="h-8 w-8 text-muted-foreground/40" />
            <div className="text-sm font-medium text-foreground/80">
              {emptyCopy.title}
            </div>
            <div className="text-xs text-muted-foreground">
              {emptyCopy.body}
            </div>
          </div>
        ) : (
          <div className="overflow-hidden rounded-[8px] border border-[#DCDDDD] bg-white shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
            <div className="hidden grid-cols-[1fr_auto_auto_auto] items-center gap-3 border-b border-[#EFEFEF] bg-white px-4 py-2 text-[11px] font-medium tracking-wider text-[#595757] sm:grid">
              <div>名称</div>
              <div>已修改</div>
              <div>大小</div>
              <div />
            </div>
            <div className="divide-y divide-[#EFEFEF]">
              {files.map((f) => (
                <FileRow
                  key={f.fileId}
                  file={f}
                  unavailable={isFileUnavailable(
                    { fileId: f.fileId, url: downloadUrl(f.fileId) },
                    unavailableFiles,
                  )}
                  onPreview={() => onPreview(f)}
                  onUseInNewTask={() => onUseInNewTask(f)}
                  canContinueEditing={canContinueEditing({
                    capabilityEnabled: videoEditingEnabled,
                    artifact: editingArtifact(f),
                  })}
                  editing={editingFileId === f.fileId}
                  selectionMode={selectionMode}
                  selected={selectedVideoFileIds.includes(f.fileId)}
                  onContinueEditing={() => void openEditingProject([f.fileId])}
                  onToggleSelection={() => toggleVideoSelection(f.fileId)}
                  onDownload={() => void onDownload(f)}
                  onCopyReference={() => void onCopyReference(f)}
                  onDelete={() => setPendingDelete(f)}
                />
              ))}
            </div>
            {loadError ? (
              <div className="flex flex-col gap-2 border-t border-[#EFEFEF] bg-[#EA1F59]/[0.03] px-4 py-3 text-xs text-[#595757] sm:flex-row sm:items-center sm:justify-between">
                <span>{loadError}</span>
                <Button type="button" variant="outline" size="sm" onClick={() => void loadMore()}>
                  重试
                </Button>
              </div>
            ) : nextCursor !== null ? (
              <div className="flex justify-center border-t border-[#EFEFEF] px-4 py-3">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => void loadMore()}
                  disabled={loadingMore}
                >
                  {loadingMore ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                      加载中…
                    </>
                  ) : (
                    '加载更多'
                  )}
                </Button>
              </div>
            ) : null}
          </div>
        )}
        <FilePreviewModal
          payload={previewing}
          onClose={() => setPreviewing(null)}
        />
        <ConfirmDialog
          open={pendingDelete !== null}
          title="删除这个文件？"
          description={
            pendingDelete
              ? `${pendingDelete.filename} · ${formatFileSize(pendingDelete.sizeBytes)}\n已完成任务的结果文本不会受影响，但文件的下载链接会失效。`
              : ''
          }
          confirmLabel="删除"
          destructive
          onClose={() => setPendingDelete(null)}
          onConfirm={async () => {
            const f = pendingDelete;
            if (!f) return;
            await performDelete(f);
            if (mountedRef.current) setPendingDelete(null);
          }}
        />
      </PageContainer>
    </TooltipProvider>
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
        'h-8 rounded-md px-3 text-xs font-medium transition-[background-color,box-shadow,color]',
        active
          ? 'bg-white text-foreground shadow-[0_1px_2px_rgba(15,23,42,0.05)]'
          : 'text-[#595757] hover:bg-white/70 hover:text-foreground',
      )}
    >
      {label}
    </button>
  );
}

function FileRow({
  file,
  unavailable,
  onPreview,
  onUseInNewTask,
  canContinueEditing: showContinueEditing,
  editing,
  selectionMode,
  selected,
  onContinueEditing,
  onToggleSelection,
  onDownload,
  onCopyReference,
  onDelete,
}: {
  file: UiFile;
  unavailable: boolean;
  onPreview: () => void;
  onUseInNewTask: () => void;
  canContinueEditing: boolean;
  editing: boolean;
  selectionMode: boolean;
  selected: boolean;
  onContinueEditing: () => void;
  onToggleSelection: () => void;
  onDownload: () => void;
  onCopyReference: () => void;
  onDelete: () => void;
}): JSX.Element {
  const Icon = iconForMime(file.mimetype);
  return (
    <div
      className={cn(
        'flex flex-col gap-1.5 px-4 py-2.5 transition-colors sm:grid sm:grid-cols-[1fr_auto_auto_auto] sm:items-center sm:gap-3',
        unavailable ? 'bg-[#EFEFEF]/35' : 'hover:bg-[#EFEFEF]/35',
      )}
    >
      {/* Filename = preview. Always reachable, no hover required. */}
      <button
        type="button"
        onClick={onPreview}
        disabled={unavailable}
        title={unavailable ? `${file.filename} 已失效` : `预览 ${file.filename}`}
        className="group flex min-w-0 items-center gap-2.5 text-left disabled:cursor-not-allowed"
      >
        <span
          className={cn(
            'flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-[#DCDDDD] bg-white transition-colors',
            unavailable
              ? 'text-[#ADADAD]'
              : 'text-[#595757] group-hover:border-[#ADADAD]',
          )}
        >
          <Icon className="h-4 w-4" aria-hidden />
        </span>
        <span className="flex min-w-0 items-center gap-2">
          <span
            className={cn(
              'min-w-0 truncate text-sm font-medium',
              unavailable
                ? 'text-[#8B93A6]'
                : 'text-foreground group-hover:text-[#EA1F59]',
            )}
          >
            {file.filename}
          </span>
          {unavailable ? (
            <span className="shrink-0 rounded-full bg-[#EFEFEF] px-2 py-0.5 text-[10px] font-medium text-[#8B93A6]">
              已失效
            </span>
          ) : null}
        </span>
      </button>
      {/* Size + time always rendered. Mobile shows them inline beneath
          the filename; sm+ snaps them into the grid columns. */}
      <div className="flex items-center gap-3 text-xs text-muted-foreground sm:contents">
        <span className="whitespace-nowrap sm:text-xs">
          {formatFileRelativeDate(file.createdAt)}
        </span>
        <span className="whitespace-nowrap sm:text-xs">{formatFileSize(file.sizeBytes)}</span>
      </div>
      {/* Always-visible primary action + More menu. No hover-only
          opacity tricks — every action is reachable on touch. */}
      <div className="flex shrink-0 items-center gap-1">
        {showContinueEditing && selectionMode ? (
          <IconTooltip label={selected ? '取消选择' : '选择用于拼接'}>
            <button
              type="button"
              onClick={onToggleSelection}
              aria-pressed={selected}
              aria-label={`${selected ? '取消选择' : '选择'} ${file.filename}`}
              title={`${selected ? '取消选择' : '选择'} ${file.filename}`}
              className={cn(
                'inline-flex h-8 w-8 items-center justify-center rounded-md border transition-colors',
                selected
                  ? 'border-[#EA1F59] bg-[#EA1F59] text-white'
                  : 'border-[#DCDDDD] bg-white text-[#8B8390] hover:border-[#EA1F59]/40 hover:text-[#EA1F59]',
              )}
            >
              <Check className="h-3.5 w-3.5" aria-hidden />
            </button>
          </IconTooltip>
        ) : null}
        {showContinueEditing && !selectionMode ? (
          <IconTooltip label="继续剪辑">
            <button
              type="button"
              onClick={onContinueEditing}
              disabled={editing}
              aria-label={`继续剪辑 ${file.filename}`}
              title={`继续剪辑 ${file.filename}`}
              className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-[#DCDDDD] bg-white text-[#7A6473] transition-colors hover:border-[#EA1F59]/35 hover:bg-[#EA1F59]/5 hover:text-[#EA1F59] disabled:cursor-wait disabled:opacity-60"
            >
              {editing ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
              ) : (
                <Scissors className="h-3.5 w-3.5" aria-hidden />
              )}
            </button>
          </IconTooltip>
        ) : null}
        <IconTooltip label="用于新任务">
          <button
            type="button"
            onClick={onUseInNewTask}
            disabled={unavailable}
            aria-label={`把 ${file.filename} 用于新任务`}
            title={
              unavailable
                ? `${file.filename} 已失效`
                : `把 ${file.filename} 用于新任务`
            }
            className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-[#DCDDDD] bg-white text-[#595757] transition-colors hover:border-[#EA1F59]/35 hover:bg-[#EA1F59]/5 hover:text-[#EA1F59] disabled:cursor-not-allowed disabled:text-[#ADADAD] disabled:hover:border-[#DCDDDD] disabled:hover:bg-white"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        </IconTooltip>
        <DropdownMenu>
          <IconTooltip label="更多操作">
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label="更多操作"
                title="更多操作"
                className="inline-flex h-8 w-8 items-center justify-center rounded-md text-[#595757] transition-colors hover:bg-[#EFEFEF]/60 hover:text-foreground"
              >
                <MoreHorizontal className="h-4 w-4" />
              </button>
            </DropdownMenuTrigger>
          </IconTooltip>
          <DropdownMenuContent align="end" className="w-44">
            <DropdownMenuItem onSelect={onPreview} disabled={unavailable}>
              <Eye className="text-muted-foreground" />
              <span>预览</span>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onDownload} disabled={unavailable}>
              <Download className="text-muted-foreground" />
              <span>下载</span>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onCopyReference} disabled={unavailable}>
              <Copy className="text-muted-foreground" />
              <span>复制引用</span>
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={onDelete}
              className="text-[#EA1F59] focus:bg-[#EA1F59]/[0.06] focus:text-[#EA1F59]"
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

function IconTooltip({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

function iconForMime(mime: string): typeof FileIcon {
  if (mime.startsWith('image/')) return ImageIcon;
  if (mime.startsWith('video/')) return Film;
  if (mime.includes('pdf')) return FileText;
  if (mime.includes('sheet') || mime.includes('excel') || mime.includes('csv')) {
    return FileSpreadsheet;
  }
  if (mime.includes('text') || mime.includes('word') || mime.includes('document')) {
    return FileText;
  }
  return FileIcon;
}
