import { File, FileSpreadsheet, FileText, Image as ImageIcon, Loader2, X } from 'lucide-react';
import { formatFileSize } from '@/lib/file-size';
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
  /**
   * O17 — for image attachments, a `data:image/...;base64,...` URL
   * read off the local File via FileReader. Lets the chip render a
   * 32×32 thumbnail instead of just a generic image icon. Set
   * synchronously before upload starts so the preview is visible
   * during the uploading state too.
   */
  previewDataUrl?: string;
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
  const hasImagePreview =
    attachment.mimetype.startsWith('image/') &&
    typeof attachment.previewDataUrl === 'string' &&
    attachment.previewDataUrl.length > 0;
  return (
    <div
      className={cn(
        'inline-flex max-w-[260px] items-center gap-1.5 rounded-md border px-2 py-1 text-xs',
        isError
          ? 'border-red-300/60 bg-red-50/40 text-red-700 dark:border-red-700/40 dark:bg-red-950/20 dark:text-red-400'
          : 'border-border bg-card',
      )}
    >
      {hasImagePreview ? (
        <img
          src={attachment.previewDataUrl}
          alt=""
          aria-hidden
          draggable={false}
          className={cn(
            'h-7 w-7 shrink-0 rounded object-cover',
            isUploading && 'opacity-60',
          )}
        />
      ) : isUploading ? (
        <Loader2 className="h-3 w-3 shrink-0 animate-spin text-muted-foreground" />
      ) : (
        <FileTypeIcon mimetype={attachment.mimetype} />
      )}
      <span className="min-w-0 flex-1 truncate" title={attachment.filename}>
        {attachment.filename}
      </span>
      {!isError && !isUploading && (
        <span className="shrink-0 text-[10px] text-muted-foreground/80">
          {formatFileSize(attachment.size)}
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
