import { File, FileSpreadsheet, FileText, Image as ImageIcon, Loader2, X } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface DraftAttachment {
  /** Server-issued id once upload completes. Empty while uploading. */
  fileId: string;
  filename: string;
  mimetype: string;
  size: number;
  /** State machine: uploading → ready, or uploading → error. */
  status: 'uploading' | 'ready' | 'error';
  /** Server message when status === 'error'. */
  errorMessage?: string;
}

interface Props {
  attachment: DraftAttachment;
  onRemove(): void;
}

/**
 * Compact chip for an attached file inside the composer. Three states:
 *
 *   uploading → spinner + filename
 *   ready     → file-type icon + filename + size + remove button
 *   error     → red text + remove button
 *
 * Pure presentation — caller (InputArea) owns the attachment list
 * and dispatches the actual upload via lib/upload-file.
 */
export function AttachmentChip({ attachment, onRemove }: Props): JSX.Element {
  const isError = attachment.status === 'error';
  const isUploading = attachment.status === 'uploading';
  return (
    <div
      className={cn(
        'inline-flex max-w-[260px] items-center gap-1.5 rounded-md border px-2 py-1 text-xs',
        isError
          ? 'border-red-300/60 bg-red-50/40 text-red-700 dark:border-red-700/40 dark:bg-red-950/20 dark:text-red-400'
          : 'border-border bg-card',
      )}
    >
      {isUploading ? (
        <Loader2 className="h-3 w-3 shrink-0 animate-spin text-muted-foreground" />
      ) : (
        <FileTypeIcon mimetype={attachment.mimetype} />
      )}
      <span className="min-w-0 flex-1 truncate" title={attachment.filename}>
        {attachment.filename}
      </span>
      {!isError && !isUploading && (
        <span className="shrink-0 text-[10px] text-muted-foreground/80">
          {formatBytes(attachment.size)}
        </span>
      )}
      <button
        type="button"
        onClick={onRemove}
        aria-label="移除附件"
        className="shrink-0 rounded text-muted-foreground transition-colors hover:bg-foreground/[0.05] hover:text-foreground"
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}

function FileTypeIcon({ mimetype }: { mimetype: string }): JSX.Element {
  const cn = 'h-3 w-3 shrink-0 text-muted-foreground';
  if (mimetype.startsWith('image/')) return <ImageIcon className={cn} />;
  if (mimetype.includes('spreadsheet') || mimetype === 'text/csv') return <FileSpreadsheet className={cn} />;
  if (mimetype === 'application/pdf' || mimetype.startsWith('text/')) return <FileText className={cn} />;
  return <File className={cn} />;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
