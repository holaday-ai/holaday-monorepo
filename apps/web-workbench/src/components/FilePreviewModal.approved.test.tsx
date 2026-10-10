// @vitest-environment happy-dom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { FilePreviewModal } from './FilePreviewModal';
const { fetchBlob } = vi.hoisted(() => ({ fetchBlob: vi.fn() }));
vi.mock('@/lib/download-file', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/download-file')>()),
  fetchFileBlobAuthed: fetchBlob,
}));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ show: vi.fn() }) }));
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
const payload = {
  fileId: 'file_preview_closeout',
  filename: '选题.txt',
  mimetype: 'text/plain',
  sizeBytes: 1024,
  url: '/api/files/file_preview_closeout/download',
};
it('shows supplied file facts and references the file without requiring a successful preview', async () => {
  fetchBlob.mockResolvedValue({ ok: false, status: 503 });
  const onUse = vi.fn();
  render(
    <FilePreviewModal
      payload={payload}
      onClose={vi.fn()}
      approved
      onUse={onUse}
      createdAt="2026-10-06T12:00:00Z"
    />,
  );
  expect(screen.getByRole('heading', { name: '文件信息' })).toBeTruthy();
  expect(screen.getByText('text/plain')).toBeTruthy();
  await screen.findByText('无法加载预览');
  await userEvent.setup().click(screen.getByRole('button', { name: '用于新任务' }));
  expect(onUse).toHaveBeenCalledTimes(1);
});
it('prevents referencing a file whose authenticated preview reports it gone', async () => {
  fetchBlob.mockResolvedValue({ ok: false, status: 404 });
  const onUse = vi.fn();
  render(
    <FilePreviewModal
      payload={{
        ...payload,
        fileId: 'file_preview_gone',
        url: '/api/files/file_preview_gone/download',
      }}
      onClose={vi.fn()}
      approved
      onUse={onUse}
    />,
  );
  await waitFor(() =>
    expect((screen.getByRole('button', { name: '用于新任务' }) as HTMLButtonElement).disabled).toBe(
      true,
    ),
  );
  await userEvent.setup().click(screen.getByRole('button', { name: '用于新任务' }));
  expect(onUse).not.toHaveBeenCalled();
  expect(screen.getByText('文件已不可用')).toBeTruthy();
  expect(screen.queryByRole('button', { name: /下载|已失效/ })).toBeNull();
});
it('initially focuses the preview surface rather than a download tooltip trigger', async () => {
  fetchBlob.mockResolvedValue({ ok: false, status: 503 });
  render(
    <FilePreviewModal
      payload={{ ...payload, fileId: 'file_preview_focus' }}
      onClose={vi.fn()}
      approved
    />,
  );
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('dialog')));
});
