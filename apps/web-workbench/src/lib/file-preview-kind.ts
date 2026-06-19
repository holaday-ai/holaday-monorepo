export type FilePreviewKind = 'image' | 'video' | 'pdf' | 'text' | 'download';

export function filePreviewKind(input: {
  mime?: string | null;
  filename: string;
}): FilePreviewKind {
  const mime = (input.mime ?? '').toLowerCase();
  const filename = input.filename.toLowerCase();
  if (mime.startsWith('image/')) return 'image';
  if (
    mime.startsWith('video/') ||
    /\.(mp4|mov|webm|m4v)$/i.test(filename)
  ) {
    return 'video';
  }
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
