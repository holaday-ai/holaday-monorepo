import { useEffect, useRef, useState, type RefObject } from 'react';
import { CreativePopover } from '@/components/CreativePopover';
import type { DraftAttachment } from '@/components/AttachmentChip';
import { FileTypeBadge } from '@/components/FileTypeBadge';
import { normalizeFilesListPage, type NormalizedFileRow } from '@/lib/files-page-state';
import { formatFileSize } from '@/lib/file-size';
import { trpc } from '@/lib/trpc';

/** Existing authenticated library files, never demo files or public download URLs. */
export function CreativeReferenceLibrary({
  open,
  onOpenChange,
  anchorRef,
  disabled,
  onPick,
  onChooseLocal,
  selectedFileIds,
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
  anchorRef: RefObject<HTMLButtonElement>;
  disabled: boolean;
  onPick(file: DraftAttachment): void;
  onChooseLocal(): void;
  selectedFileIds: readonly string[];
}) {
  const [query, setQuery] = useState('');
  const [files, setFiles] = useState<NormalizedFileRow[]>([]);
  const [cursor, setCursor] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const version = useRef(0);
  useEffect(() => {
    const id = ++version.current;
    if (!open) return;
    setLoading(true);
    setError('');
    setFiles([]);
    setCursor(null);
    const timer = setTimeout(() => {
      void trpc.files.list
        .query({ type: 'images', q: query.trim() || undefined, limit: 50 })
        .then((result) => {
          if (version.current !== id) return;
          const page = normalizeFilesListPage(result);
          setFiles(page.items);
          setCursor(page.nextCursor);
        })
        .catch(() => {
          if (version.current === id) setError('参考资料暂时无法加载');
        })
        .finally(() => {
          if (version.current === id) setLoading(false);
        });
    }, 200);
    return () => {
      clearTimeout(timer);
      version.current += 1;
    };
  }, [open, query, retry]);
  async function more() {
    if (cursor === null || loading) return;
    const id = version.current;
    setLoading(true);
    setError('');
    try {
      const page = normalizeFilesListPage(
        await trpc.files.list.query({
          type: 'images',
          q: query.trim() || undefined,
          limit: 50,
          cursor,
        }),
      );
      if (id === version.current) {
        setFiles((current) => [
          ...current,
          ...page.items.filter(
            (item) => !current.some((existing) => existing.fileId === item.fileId),
          ),
        ]);
        setCursor(page.nextCursor);
      }
    } catch {
      if (id === version.current) setError('参考资料暂时无法加载');
    } finally {
      if (id === version.current) setLoading(false);
    }
  }
  return (
    <CreativePopover open={open} onOpenChange={onOpenChange} anchorRef={anchorRef} title="参考资料">
      <div className="hd-media-library">
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="搜索图片名称"
          aria-label="搜索参考图片"
        />
        {error && (
          <p role="alert">
            {error}
            <button type="button" onClick={() => setRetry((value) => value + 1)}>
              重试
            </button>
          </p>
        )}
        {files.map((file) => (
          <button
            className="hd-media-library-row"
            type="button"
            key={file.fileId}
            disabled={disabled || selectedFileIds.includes(file.fileId)}
            onClick={() =>
              onPick({
                clientId: `library:${file.fileId}`,
                fileId: file.fileId,
                filename: file.filename,
                mimetype: file.mimetype,
                size: file.sizeBytes,
                status: 'ready',
              })
            }
          >
            <FileTypeBadge filename={file.filename} mime={file.mimetype} />
            <span>
              {file.filename}
              <small>{formatFileSize(file.sizeBytes)}</small>
            </span>
            <small>{selectedFileIds.includes(file.fileId) ? '已添加' : '添加'}</small>
          </button>
        ))}
        {loading && <p role="status">加载中…</p>}
        {!loading && !error && files.length === 0 && <p>暂无可用图片，可从本地添加。</p>}
        {cursor !== null && (
          <button type="button" disabled={loading} onClick={() => void more()}>
            加载更多
          </button>
        )}
        <footer>
          <button
            className="hd-glass-pill"
            type="button"
            disabled={disabled}
            onClick={() => {
              onOpenChange(false);
              onChooseLocal();
            }}
          >
            从本地添加
          </button>
          <button type="button" onClick={() => onOpenChange(false)}>
            完成
          </button>
        </footer>
      </div>
    </CreativePopover>
  );
}
