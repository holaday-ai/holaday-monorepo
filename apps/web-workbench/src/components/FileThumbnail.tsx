import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { FileTypeBadge, fileTypePresentation } from '@/components/FileTypeBadge';
import { fetchFileBlobAuthed } from '@/lib/download-file';

let activeLoads = 0;
const waiting: Array<() => void> = [];
async function boundedThumbnailLoad(signal: AbortSignal, load: () => Promise<void>) {
  if (activeLoads >= 2) await new Promise<void>((resolve) => waiting.push(resolve));
  else activeLoads += 1;
  try {
    if (!signal.aborted) await load();
  } finally {
    const next = waiting.shift();
    if (next) next();
    else activeLoads -= 1;
  }
}
interface Props {
  fileId: string;
  filename: string;
  mime: string;
  sizeBytes: number;
  unavailable?: boolean;
}
/** Authenticated, viewport-lazy thumbnails. No token-bearing public media URLs. */
export function FileThumbnail({ fileId, filename, mime, sizeBytes, unavailable }: Props) {
  const ref = useRef<HTMLSpanElement>(null);
  const [visible, setVisible] = useState(false);
  const [src, setSrc] = useState('');
  const image = /^image\/(png|jpe?g|webp|gif|avif)$/i.test(mime);
  const video = /^video\/(mp4|webm|quicktime)$/i.test(mime);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    if (typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: '80px' },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    setSrc('');
    // The current service has no thumbnail endpoint; avoid background downloads
    // of large originals. Their explicit preview action remains available.
    if (!visible || unavailable || !(image || video) || sizeBytes > 20 * 1024 * 1024) return;
    const controller = new AbortController();
    let url = '';
    void boundedThumbnailLoad(controller.signal, async () => {
      const result = await fetchFileBlobAuthed({
        url: `/api/files/${encodeURIComponent(fileId)}/download`,
        signal: controller.signal,
      });
      if (controller.signal.aborted || !result.ok || !result.blob) return;
      url = URL.createObjectURL(result.blob);
      setSrc(url);
    }).catch(() => {
      /* Keep the file-type badge if a preview cannot be loaded. */
    });
    return () => {
      controller.abort();
      if (url) URL.revokeObjectURL(url);
    };
  }, [fileId, visible, unavailable, image, video, sizeBytes]);
  const [format, color] = fileTypePresentation(filename, mime);
  return (
    <span
      ref={ref}
      className="hd-file-preview"
      style={{ '--file-color': color } as CSSProperties}
      data-document={(!image && !video) || undefined}
      data-media={image || video ? 'true' : undefined}
    >
      {!image && !video && (
        <span className="hd-document-art" aria-hidden>
          <strong>HOLADAY</strong>
          <small>{filename}</small>
          <i />
          <i />
          <i />
          <b>{format}</b>
        </span>
      )}
      {src ? (
        video ? (
          <video src={src} muted playsInline preload="metadata" aria-hidden />
        ) : (
          <img src={src} alt="" loading="lazy" />
        )
      ) : (
        <FileTypeBadge filename={filename} mime={mime} />
      )}
      {src && video && <span className="hd-thumb-kind">VIDEO</span>}
    </span>
  );
}
