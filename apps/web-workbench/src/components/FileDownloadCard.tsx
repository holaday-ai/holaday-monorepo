import { Download, File, FileSpreadsheet, FileText, Image as ImageIcon, Loader2, Presentation } from 'lucide-react';
import * as React from 'react';
import { useToast } from '@/components/ui/toast';
import {
  downloadFailureMessage,
  downloadFileAuthed,
} from '@/lib/download-file';
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
    const result = await downloadFileAuthed({
      url: payload.downloadUrl,
      filename: payload.filename,
    });
    if (result.ok) {
      setState('idle');
    } else {
      setState('failed');
      toast.show(downloadFailureMessage(result.status), 'error');
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
              : `${formatFileSize(payload.size)} · 24h 内可下载`}
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

function FileTypeIcon({ filename }: { filename: string }): JSX.Element {
  const ext = filename.toLowerCase().split('.').pop() ?? '';
  const cls = 'h-4 w-4';
  if (['xlsx', 'xls', 'csv'].includes(ext)) return <FileSpreadsheet className={cls} />;
  if (['pptx', 'ppt'].includes(ext)) return <Presentation className={cls} />;
  if (['png', 'jpg', 'jpeg', 'webp', 'gif'].includes(ext)) return <ImageIcon className={cls} />;
  if (['pdf', 'docx', 'doc', 'txt', 'md', 'json'].includes(ext)) return <FileText className={cls} />;
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
