import { attachmentChipCopy } from '@/lib/attachment-chip-copy';
import { cn } from '@/lib/utils';
import { File, FileSpreadsheet, FileText, Image as ImageIcon, Loader2, X } from 'lucide-react';

export interface DraftAttachment {
  /** Client-only id for matching async upload / preview callbacks. */
  clientId?: string;
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
  badge?: string;
  actionLabel?: string;
  onAction?(): void;
  disabled?: boolean;
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
export function AttachmentChip({
  attachment,
  onRemove,
  badge,
  actionLabel,
  onAction,
  disabled = false,
}: Props): JSX.Element {
  const isError = attachment.status === 'error';
  const isUploading = attachment.status === 'uploading';
  const copy = attachmentChipCopy(attachment);
  const hasImagePreview =
    attachment.mimetype.startsWith('image/') &&
    typeof attachment.previewDataUrl === 'string' &&
    attachment.previewDataUrl.length > 0;
  return (
    <div
      className={cn(
        'inline-flex max-w-full items-center gap-2 rounded-[8px] border bg-white px-2 py-1.5 text-xs shadow-[0_1px_2px_rgba(15,23,42,0.03)] transition-colors sm:max-w-[320px]',
        isError
          ? 'border-[#EA1F59]/28 bg-[#EA1F59]/[0.04] text-foreground dark:border-[#EA1F59]/35 dark:bg-[#EA1F59]/10'
          : isUploading
            ? 'border-[#42C0EF]/35 text-foreground dark:border-[#42C0EF]/35 dark:bg-white/[0.04]'
            : 'border-[#DCDDDD] text-foreground dark:border-white/10 dark:bg-white/[0.04]',
      )}
      title={copy.title}
    >
      {hasImagePreview ? (
        <img
          src={attachment.previewDataUrl}
          alt=""
          aria-hidden
          draggable={false}
          className={cn(
            'h-8 w-8 shrink-0 rounded-[7px] border border-[#EFEFEF] object-cover',
            isUploading && 'opacity-60',
            isError && 'opacity-70',
          )}
        />
      ) : isUploading ? (
        <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[7px] border border-[#42C0EF]/30 bg-white text-[#1688AA]">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        </span>
      ) : (
        <span
          className={cn(
            'inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[7px] border bg-white',
            isError ? 'border-[#EA1F59]/25 text-[#EA1F59]' : 'border-[#DCDDDD] text-[#595757]',
          )}
        >
          <FileTypeIcon mimetype={attachment.mimetype} />
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="block min-w-0 truncate font-medium text-foreground">
            {attachment.filename || '未命名附件'}
          </span>
          {badge ? (
            <span className="shrink-0 rounded-full bg-[#42C0EF]/[0.12] px-1.5 py-0.5 text-[9px] font-semibold text-[#237B9D]">
              {badge}
            </span>
          ) : null}
        </span>
        <span
          className={cn(
            'block truncate text-[10px] leading-4',
            isError ? 'text-[#EA1F59]' : 'text-[#595757]',
          )}
        >
          {isUploading ? copy.statusText : copy.detailText}
        </span>
      </span>
      {actionLabel && onAction ? (
        <button
          type="button"
          onClick={onAction}
          disabled={disabled}
          className="shrink-0 rounded-[6px] px-1.5 py-1 text-[10px] font-semibold text-[#237B9D] transition-colors hover:bg-[#42C0EF]/10 disabled:cursor-wait disabled:opacity-50"
        >
          {actionLabel}
        </button>
      ) : null}
      <button
        type="button"
        onClick={onRemove}
        disabled={disabled}
        aria-label={copy.removeLabel}
        title={copy.removeLabel}
        className="shrink-0 rounded-[6px] p-0.5 text-[#ADADAD] transition-colors hover:bg-[#EFEFEF]/70 hover:text-[#595757] disabled:cursor-wait disabled:opacity-50 dark:hover:bg-white/10"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

function FileTypeIcon({ mimetype }: { mimetype: string }): JSX.Element {
  const cn = 'h-3.5 w-3.5 shrink-0';
  if (mimetype.startsWith('image/')) return <ImageIcon className={cn} />;
  if (mimetype.includes('spreadsheet') || mimetype === 'text/csv')
    return <FileSpreadsheet className={cn} />;
  if (mimetype === 'application/pdf' || mimetype.startsWith('text/'))
    return <FileText className={cn} />;
  return <File className={cn} />;
}
