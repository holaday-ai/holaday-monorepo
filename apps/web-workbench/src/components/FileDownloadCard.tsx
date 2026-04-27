import { Download, File, FileSpreadsheet, FileText, Image as ImageIcon, Presentation } from 'lucide-react';
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
 */
export function FileDownloadCard({ payload }: { payload: FileDownloadPayload }): JSX.Element {
  return (
    <button
      type="button"
      onClick={() => void downloadAuthed(payload)}
      className={cn(
        'my-2 flex w-full max-w-md items-center gap-3 rounded-xl border border-border bg-card px-4 py-3 text-left text-sm shadow-sm transition-colors',
        'hover:border-foreground/30 hover:bg-foreground/[0.03]',
      )}
    >
      <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-foreground/[0.06] text-foreground">
        <FileTypeIcon filename={payload.filename} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium" title={payload.filename}>
          {payload.filename}
        </div>
        <div className="text-[11px] text-muted-foreground">
          {formatBytes(payload.size)} · 24h 内可下载
        </div>
      </div>
      <Download className="h-4 w-4 shrink-0 text-muted-foreground" />
    </button>
  );
}

async function downloadAuthed(p: FileDownloadPayload): Promise<void> {
  const token = getAccessToken();
  try {
    const res = await fetch(p.downloadUrl, {
      headers: token ? { authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
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
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[FileDownloadCard] download failed', err);
  }
}

function FileTypeIcon({ filename }: { filename: string }): JSX.Element {
  const ext = filename.toLowerCase().split('.').pop() ?? '';
  const cn = 'h-4 w-4';
  if (['xlsx', 'xls', 'csv'].includes(ext)) return <FileSpreadsheet className={cn} />;
  if (['pptx', 'ppt'].includes(ext)) return <Presentation className={cn} />;
  if (['png', 'jpg', 'jpeg', 'webp', 'gif'].includes(ext)) return <ImageIcon className={cn} />;
  if (['pdf', 'docx', 'doc', 'txt', 'md', 'json'].includes(ext)) return <FileText className={cn} />;
  return <File className={cn} />;
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
