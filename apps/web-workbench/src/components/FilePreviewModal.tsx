import { Download, ExternalLink, FileText, Loader2, X } from 'lucide-react';
import * as React from 'react';
import {
  downloadFailureMessage,
  downloadFileAuthed,
  fetchFileBlobAuthed,
} from '@/lib/download-file';
import { formatFileSize } from '@/lib/file-size';
import { filePreviewKind } from '@/lib/file-preview-kind';
import { useToast } from '@/components/ui/toast';

export interface FilePreviewPayload {
  fileId: string;
  filename: string;
  mimetype: string;
  /** Bytes; shown in the header for context. */
  sizeBytes: number;
  /** Relative path to the authed download endpoint. */
  url: string;
}

interface Props {
  /** When `payload` is non-null the modal is visible. */
  payload: FilePreviewPayload | null;
  onClose(): void;
}

/**
 * In-product file preview. Opens the file via authed fetch + object
 * URL, then renders it inline based on the MIME:
 *   • image/* → <img>
 *   • application/pdf → <iframe>
 *   • text/* / json / md → <pre> with the decoded text
 *   • anything else → "无法预览此文件类型" + 下载到本地 button
 *
 * Never opens a new tab. The previous `window.open('/api/files/...')`
 * path failed because top-level navigation can't send the Bearer
 * header — the user would land on a 401.
 */
export function FilePreviewModal({ payload, onClose }: Props): JSX.Element | null {
  const toast = useToast();
  const mountedRef = React.useRef(false);
  const [objectUrl, setObjectUrl] = React.useState<string | null>(null);
  const [textBody, setTextBody] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [downloading, setDownloading] = React.useState(false);
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);
  const [resolvedMime, setResolvedMime] = React.useState<string>('');

  React.useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Reset / re-fetch when the payload changes. Skip cleanly when the
  // payload is null (modal closed).
  React.useEffect(() => {
    if (!payload) {
      setObjectUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return null;
      });
      setTextBody(null);
      setErrorMessage(null);
      setResolvedMime('');
      setDownloading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setErrorMessage(null);
    setObjectUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
    setTextBody(null);
    setResolvedMime('');
    void fetchFileBlobAuthed({ url: payload.url }).then(async (res) => {
      if (cancelled) return;
      if (!res.ok || !res.blob) {
        setErrorMessage(downloadFailureMessage(res.status));
        setLoading(false);
        return;
      }
      const mime = res.mime ?? payload.mimetype ?? '';
      setResolvedMime(mime);
      const previewKind = filePreviewKind({ mime, filename: payload.filename });
      if (previewKind === 'download') {
        setLoading(false);
        return;
      }
      if (previewKind === 'text') {
        // Decode small text payloads inline. Cap at ~1MB so a huge
        // log file doesn't lock up the renderer.
        if (res.blob.size <= 1_000_000) {
          try {
            const txt = await res.blob.text();
            if (cancelled) return;
            setTextBody(txt);
            setLoading(false);
            return;
          } catch {
            /* fall through to object URL */
          }
        }
      }
      const url = URL.createObjectURL(res.blob);
      if (cancelled) {
        URL.revokeObjectURL(url);
        return;
      }
      setObjectUrl(url);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [payload]);

  // Revoke any object URL we held when the modal closes / the file
  // changes. setObjectUrl(null) takes care of state — this just
  // releases the underlying Blob handle.
  React.useEffect(() => {
    return () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [objectUrl]);

  React.useEffect(() => {
    if (!payload) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [payload, onClose]);

  if (!payload) return null;

  const handleDownload = async (): Promise<void> => {
    if (downloading) return;
    setDownloading(true);
    try {
      const res = await downloadFileAuthed({
        url: payload.url,
        filename: payload.filename,
      });
      if (!mountedRef.current) return;
      if (!res.ok) {
        toast.show(downloadFailureMessage(res.status), 'error');
      }
    } finally {
      if (mountedRef.current) {
        setDownloading(false);
      }
    }
  };

  const mime = resolvedMime || payload.mimetype;
  const kind = filePreviewKind({ mime, filename: payload.filename });

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/35 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal
      onClick={onClose}
    >
      <div
        className="flex h-[min(90vh,820px)] w-[min(92vw,960px)] flex-col overflow-hidden rounded-lg border border-[#DCDDDD] bg-white shadow-[0_16px_48px_rgba(17,24,39,0.16)] dark:border-white/10 dark:bg-card"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between gap-3 border-b border-[#DCDDDD]/80 px-4 py-2.5 dark:border-white/10">
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium text-foreground" title={payload.filename}>
              {payload.filename}
            </div>
            <div className="text-[11px] text-muted-foreground">
              {formatFileSize(payload.sizeBytes)} · {mime || '未知类型'}
            </div>
          </div>
          <button
            type="button"
            onClick={() => void handleDownload()}
            disabled={downloading}
            aria-label="下载到本地"
            title={downloading ? '下载中' : '下载'}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-[#DCDDDD] bg-white text-muted-foreground transition-colors hover:border-[#ADADAD] hover:bg-[#EFEFEF]/55 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60 dark:border-white/10 dark:bg-card dark:hover:bg-white/10"
          >
            {downloading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Download className="h-3.5 w-3.5" />
            )}
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭预览"
            title="关闭"
            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-[#EFEFEF]/70 hover:text-foreground dark:hover:bg-white/10"
          >
            <X className="h-4 w-4" />
          </button>
        </header>
        <div className="relative flex flex-1 items-center justify-center overflow-auto bg-[#EFEFEF]/45 dark:bg-background/40">
          {loading && (
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          )}
          {!loading && errorMessage && (
            <div className="flex flex-col items-center gap-2 px-6 text-center text-sm text-muted-foreground">
              <ExternalLink className="h-8 w-8 text-[#EA1F59]" />
              <div className="font-medium text-foreground/85">无法加载预览</div>
              <div className="text-xs">{errorMessage}</div>
            </div>
          )}
          {!loading && !errorMessage && objectUrl && kind === 'image' && (
            <img
              src={objectUrl}
              alt={payload.filename}
              className="max-h-full max-w-full object-contain"
            />
          )}
          {!loading && !errorMessage && objectUrl && kind === 'pdf' && (
            <iframe
              src={objectUrl}
              title={payload.filename}
              className="h-full w-full border-0"
            />
          )}
          {!loading && !errorMessage && textBody !== null && (
            <pre className="m-0 max-h-full w-full overflow-auto whitespace-pre-wrap break-words bg-white px-6 py-4 font-mono text-[12px] text-[#2F2F2F] dark:bg-card dark:text-foreground">
              {textBody}
            </pre>
          )}
          {!loading &&
            !errorMessage &&
            !objectUrl &&
            textBody === null &&
            kind === 'download' && (
              <div className="flex flex-col items-center gap-2 px-6 text-center text-sm text-muted-foreground">
                <FileText className="h-8 w-8 text-[#595757]" />
                <div className="font-medium text-foreground/85">
                  无法预览此文件类型
                </div>
                <button
                  type="button"
                  onClick={() => void handleDownload()}
                  disabled={downloading}
                  aria-label="下载到本地"
                  title={downloading ? '下载中' : '下载'}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-[#DCDDDD] bg-white text-foreground transition-colors hover:border-[#ADADAD] hover:bg-[#EFEFEF]/55 dark:border-white/10 dark:bg-card dark:hover:bg-white/10"
                >
                  {downloading ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Download className="h-3.5 w-3.5" />
                  )}
                </button>
              </div>
            )}
        </div>
      </div>
    </div>
  );
}
