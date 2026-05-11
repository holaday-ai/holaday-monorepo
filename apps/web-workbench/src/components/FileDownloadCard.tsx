import { Download, File, FileSpreadsheet, FileText, Image as ImageIcon, Loader2, Presentation } from 'lucide-react';
import * as React from 'react';
import { useToast } from '@/components/ui/toast';
import { getAccessToken } from '@/lib/auth';
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
  const [state, setState] = React.useState<'idle' | 'loading' | 'failed'>('idle');
  // Reset transient 'failed' state ~3s after firing so a retry click
  // looks fresh instead of stuck red.
  React.useEffect(() => {
    if (state !== 'failed') return;
    const t = setTimeout(() => setState('idle'), 3_000);
    return () => clearTimeout(t);
  }, [state]);

  const handleClick = async (): Promise<void> => {
    if (state === 'loading') return;
    setState('loading');
    const result = await downloadAuthed(payload);
    if (result.ok) {
      setState('idle');
    } else {
      setState('failed');
      toast.show(
        result.status === 401 || result.status === 403
          ? '下载失败：未授权（请刷新页面后重试）'
          : result.status === 404 || result.status === 410
            ? '下载失败：链接已过期（产出文件保留 24 小时）'
            : '下载失败或链接已过期',
        'error',
      );
    }
  };

  return (
    <button
      type="button"
      onClick={() => void handleClick()}
      disabled={state === 'loading'}
      aria-busy={state === 'loading'}
      className={cn(
        'my-2 flex w-full max-w-md items-center gap-3 rounded-xl border bg-card px-4 py-3 text-left text-sm shadow-sm transition-colors',
        state === 'failed'
          ? 'border-destructive/40 bg-destructive/5'
          : state === 'loading'
            ? 'border-primary/40 opacity-80'
            : 'border-border hover:border-foreground/30 hover:bg-foreground/[0.03]',
      )}
    >
      <span
        className={cn(
          'inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md',
          state === 'failed'
            ? 'bg-destructive/10 text-destructive'
            : 'bg-foreground/[0.06] text-foreground',
        )}
      >
        <FileTypeIcon filename={payload.filename} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium" title={payload.filename}>
          {payload.filename}
        </div>
        <div
          className={cn(
            'text-[11px]',
            state === 'failed' ? 'text-destructive' : 'text-muted-foreground',
          )}
        >
          {state === 'loading'
            ? '正在下载…'
            : state === 'failed'
              ? '下载失败，点击重试'
              : `${formatBytes(payload.size)} · 24h 内可下载`}
        </div>
      </div>
      {state === 'loading' ? (
        <Loader2 className="h-4 w-4 shrink-0 animate-spin text-primary" />
      ) : (
        <Download
          className={cn(
            'h-4 w-4 shrink-0',
            state === 'failed' ? 'text-destructive' : 'text-muted-foreground',
          )}
        />
      )}
    </button>
  );
}

/**
 * Authed-fetch a file via Bearer token, blob it, trigger an anchor
 * click. Returns a result tuple so the caller can surface UI state
 * without coupling to the toast.
 *
 * Phase 4 Codex follow-up: was previously fire-and-forget with a
 * console.error on failure; the user got NO signal that 24h-expired
 * links were dead. The result.status carries the HTTP code so the
 * caller can craft a more specific message (401 vs 404 vs network).
 */
async function downloadAuthed(
  p: FileDownloadPayload,
): Promise<{ ok: true } | { ok: false; status: number | null; message: string }> {
  const token = getAccessToken();
  try {
    const res = await fetch(p.downloadUrl, {
      headers: token ? { authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) {
      return { ok: false, status: res.status, message: `HTTP ${res.status}` };
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = p.filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    // Revoke after a tick so the browser can complete the download.
    setTimeout(() => URL.revokeObjectURL(url), 5_000);
    return { ok: true };
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[FileDownloadCard] download failed', err);
    return {
      ok: false,
      status: null,
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

function FileTypeIcon({ filename }: { filename: string }): JSX.Element {
  const ext = filename.toLowerCase().split('.').pop() ?? '';
  const cls = 'h-4 w-4';
  if (['xlsx', 'xls', 'csv'].includes(ext)) return <FileSpreadsheet className={cls} />;
  if (['pptx', 'ppt'].includes(ext)) return <Presentation className={cls} />;
  if (['png', 'jpg', 'jpeg', 'webp', 'gif'].includes(ext)) return <ImageIcon className={cls} />;
  if (['pdf', 'docx', 'doc', 'txt', 'md', 'json'].includes(ext)) return <FileText className={cls} />;
  return <File className={cls} />;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
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
      typeof obj.filename === 'string' &&
      typeof obj.size === 'number' &&
      typeof obj.downloadUrl === 'string'
    ) {
      return {
        fileId: obj.fileId,
        filename: obj.filename,
        size: obj.size,
        downloadUrl: obj.downloadUrl,
      };
    }
  } catch {
    // Fall through to null
  }
  return null;
}
