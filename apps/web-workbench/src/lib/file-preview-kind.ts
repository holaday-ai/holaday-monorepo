export type FilePreviewKind = 'image' | 'pdf' | 'text' | 'download';

export function filePreviewKind(input: {
  mime?: string | null;
  filename: string;
}): FilePreviewKind {
  const mime = (input.mime ?? '').toLowerCase();
  const filename = input.filename.toLowerCase();
  if (mime.startsWith('image/')) return 'image';
  if (mime === 'application/pdf' || filename.endsWith('.pdf')) return 'pdf';
  if (
    mime.startsWith('text/') ||
    mime === 'application/json' ||
    /\.(md|txt|json|csv)$/i.test(filename)
  ) {
    return 'text';
  }
  return 'download';
}
