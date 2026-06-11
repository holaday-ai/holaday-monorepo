import { Download, File, FileSpreadsheet, FileText, Image as ImageIcon, Loader2, Presentation } from 'lucide-react';
import * as React from 'react';
import { useToast } from '@/components/ui/toast';
import {
  downloadFailureMessage,
  downloadFileAuthed,
  fetchFileBlobAuthed,
} from '@/lib/download-file';
import {
  classifyDownloadFileKind,
  downloadFileKindLabel,
  downloadFileMetaLabel,
  type DownloadFileKind,
} from '@/lib/file-download-card-copy';
import { formatFileSize } from '@/lib/file-size';
import { cn } from '@/lib/utils';

export interface FileDownloadPayload {
  fileId: string;
  filename: string;
  size: number;
  downloadUrl: string;
}

/**
 * Card surfaced inside an agent summary whenever the model emits a
 * fenced code block tagged `holaday-file`. The fence body is JSON
 * matching FileDownloadPayload — see agent-loop.ts's create_file
 * tool_result text for the format.
 *
 * Click → fetch the file with the user's bearer token, build a blob
 * URL, trigger a download. Direct anchor href on the orchestrator's
 * /api/files/:id/download path won't work because the browser won't
 * attach the Authorization header on a top-level GET; the blob hop
 * is the cleanest workaround without a per-link signed URL flow.
 *
 * Phase 4 Codex follow-up — surface loading + failure states. The
 * 24h TTL means a stale card eventually 404s; previously the click
 * just printed to console.error with no user feedback. Now:
 *   - while fetching: spinner + dim
 *   - on failure: toast "下载失败或链接已过期" + brief error tone
 *   - on success: silent (browser's own download UI takes over)
 */
export function FileDownloadCard({ payload }: { payload: FileDownloadPayload }): JSX.Element {
  const toast = useToast();
  const mountedRef = React.useRef(false);
  const [state, setState] = React.useState<'idle' | 'loading' | 'failed'>('idle');
  const [previewUrl, setPreviewUrl] = React.useState<string | null>(null);
  const kind = classifyDownloadFileKind(payload.filename);
  const kindLabel = downloadFileKindLabel(kind);
  const metaLabel = downloadFileMetaLabel({
    filename: payload.filename,
    formattedSize: formatFileSize(payload.size),
  });
  // Reset transient 'failed' state ~3s after firing so a retry click
  // looks fresh instead of stuck red.
  React.useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);
  React.useEffect(() => {
    if (state !== 'failed') return;
    const t = setTimeout(() => {
      if (mountedRef.current) setState('idle');
    }, 3_000);
    return () => clearTimeout(t);
  }, [state]);

  // Image outputs (文生图 / 图生图) get an inline thumbnail. The
  // download URL is Bearer-gated, so a plain <img src> would 401 —
  // fetch the blob once with auth and render from an object URL
  // (revoked on unmount / url change). Non-image kinds keep the
  // icon-only card; a fetch failure silently falls back to the icon.
  React.useEffect(() => {
    if (kind !== 'image') return;
    let cancelled = false;
    let objectUrl: string | null = null;
    void (async () => {
      const res = await fetchFileBlobAuthed({ url: payload.downloadUrl });
      if (cancelled) return;
      if (res.ok && res.blob) {
        objectUrl = URL.createObjectURL(res.blob);
        setPreviewUrl(objectUrl);
      }
    })();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      setPreviewUrl(null);
    };
  }, [kind, payload.downloadUrl]);

  const handleClick = async (): Promise<void> => {
    if (state === 'loading') return;
    setState('loading');
    const result = await downloadFileAuthed({
      url: payload.downloadUrl,
      filename: payload.filename,
    });
    if (!mountedRef.current) return;
    if (result.ok) {
      setState('idle');
    } else {
      setState('failed');
      toast.show(downloadFailureMessage(result.status), 'error');
    }
  };
  const actionLabel = `下载${kindLabel} ${payload.filename}`;

  return (
    <button
      type="button"
      onClick={() => void handleClick()}
      disabled={state === 'loading'}
      aria-busy={state === 'loading'}
      className={cn(
        'group my-2 flex w-full max-w-md flex-col gap-2 rounded-[8px] border bg-white px-3 py-3 text-left text-sm shadow-[0_1px_3px_rgba(17,24,39,0.05)] transition-colors dark:bg-card/85 sm:px-4',
        state === 'failed'
          ? 'border-[#EA1F59]/40 bg-[#EA1F59]/5'
          : state === 'loading'
            ? 'border-[#57479C]/40 bg-[#57479C]/5 opacity-90'
            : 'border-[#DCDDDD] hover:border-[#ADADAD] hover:bg-[#EFEFEF]/35 dark:border-white/10 dark:hover:border-white/20 dark:hover:bg-white/[0.04]',
      )}
      aria-label={actionLabel}
      title={actionLabel}
    >
      {previewUrl ? (
        <img
          src={previewUrl}
          alt={payload.filename}
          loading="lazy"
          className="max-h-64 w-full rounded-[6px] border border-[#DCDDDD] object-contain dark:border-white/10"
        />
      ) : null}
      <span className="flex w-full items-center gap-3">
        <span
          className={cn(
            'inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-[8px] border',
            state === 'failed'
              ? 'border-[#EA1F59]/35 bg-[#EA1F59]/10 text-[#EA1F59]'
              : state === 'loading'
                ? 'border-[#57479C]/30 bg-[#57479C]/10 text-[#57479C]'
                : 'border-[#DCDDDD] bg-[#EFEFEF]/55 text-[#595757] group-hover:border-[#42C0EF]/45 group-hover:bg-[#42C0EF]/10 group-hover:text-[#42C0EF] dark:border-white/10 dark:bg-white/10 dark:text-foreground',
          )}
        >
          <FileTypeIcon kind={kind} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium text-foreground" title={payload.filename}>
            {payload.filename}
          </div>
          <div
            className={cn(
              'text-[11px]',
              state === 'failed' ? 'text-[#EA1F59]' : 'text-muted-foreground',
            )}
          >
            {state === 'loading'
              ? '正在下载…'
              : state === 'failed'
                ? '下载失败，点击重试'
                : metaLabel}
          </div>
        </div>
        {state === 'loading' ? (
          <Loader2 className="h-4 w-4 shrink-0 animate-spin text-[#EA1F59]" />
        ) : (
          <Download
            className={cn(
              'h-4 w-4 shrink-0 transition-colors',
              state === 'failed'
                ? 'text-[#EA1F59]'
                : 'text-muted-foreground group-hover:text-[#EA1F59]',
            )}
          />
        )}
      </span>
    </button>
  );
}

function FileTypeIcon({ kind }: { kind: DownloadFileKind }): JSX.Element {
  const cls = 'h-4 w-4';
  if (kind === 'spreadsheet') return <FileSpreadsheet className={cls} />;
  if (kind === 'presentation') return <Presentation className={cls} />;
  if (kind === 'image') return <ImageIcon className={cls} />;
  if (kind === 'document') return <FileText className={cls} />;
  return <File className={cls} />;
}

/**
 * Parse the `holaday-file` fenced JSON body. Returns null when the
 * payload is malformed or missing required fields — caller falls
 * back to the plain code-block render in that case.
 */
export function parseHoladayFilePayload(raw: string): FileDownloadPayload | null {
  try {
    const obj = JSON.parse(raw) as Partial<FileDownloadPayload>;
    if (
      typeof obj.fileId === 'string' &&
      obj.fileId.trim().length > 0 &&
      typeof obj.filename === 'string' &&
      obj.filename.trim().length > 0 &&
      typeof obj.size === 'number' &&
      Number.isFinite(obj.size) &&
      obj.size >= 0 &&
      typeof obj.downloadUrl === 'string'
    ) {
      const downloadUrl = normaliseFileDownloadUrl(obj.downloadUrl);
      if (!downloadUrl) return null;
      return {
        fileId: obj.fileId.trim(),
        filename: obj.filename.trim(),
        size: obj.size,
        downloadUrl,
      };
    }
  } catch {
    // Fall through to null
  }
  return null;
}

function normaliseFileDownloadUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed.startsWith('/api/files/')) return null;
  if (trimmed.startsWith('//')) return null;
  try {
    const parsed = new URL(trimmed, 'https://holaday.local');
    if (parsed.origin !== 'https://holaday.local') return null;
    if (!/^\/api\/files\/[^/]+\/download$/.test(parsed.pathname)) return null;
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return null;
  }
}
