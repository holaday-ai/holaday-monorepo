// @vitest-environment happy-dom
import * as React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CreativeReferenceLibrary } from './CreativeReferenceLibrary';
const { query } = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('@/lib/trpc', () => ({ trpc: { files: { list: { query } } } }));
vi.mock('@/components/CreativePopover', () => ({
  CreativePopover: ({ open, children }: { open: boolean; children: React.ReactNode }) =>
    open ? <div>{children}</div> : null,
}));
const file = {
  fileId: 'file_image',
  filename: '参考图.png',
  mimetype: 'image/png',
  sizeBytes: 2048,
  createdAt: '2026-10-06T00:00:00Z',
};
const props = () => ({
  open: true,
  onOpenChange: vi.fn(),
  anchorRef: React.createRef<HTMLButtonElement>(),
  disabled: false,
  onPick: vi.fn(),
  onChooseLocal: vi.fn(),
  selectedFileIds: [] as string[],
});
beforeEach(() => {
  vi.useFakeTimers();
  query.mockReset();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
it('queries the authenticated image category and returns the selected file identity', async () => {
  query.mockResolvedValue({ items: [file], nextCursor: null });
  const p = props();
  const view = render(<CreativeReferenceLibrary {...p} />);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(201);
  });
  expect(query).toHaveBeenCalledWith({ type: 'images', q: undefined, limit: 50 });
  fireEvent.click(screen.getByRole('button', { name: /参考图.png/ }));
  expect(p.onPick).toHaveBeenCalledWith(
    expect.objectContaining({
      fileId: file.fileId,
      filename: file.filename,
      status: 'ready',
      mimetype: 'image/png',
    }),
  );
  view.rerender(<CreativeReferenceLibrary {...p} selectedFileIds={[file.fileId]} />);
  expect((screen.getByRole('button', { name: /参考图.png/ }) as HTMLButtonElement).disabled).toBe(
    true,
  );
});
it('ignores a slow response after closing and reopening the picker', async () => {
  let resolveOld: (value: unknown) => void = () => {};
  query
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveOld = resolve;
        }),
    )
    .mockResolvedValueOnce({ items: [], nextCursor: null });
  const p = props();
  const view = render(<CreativeReferenceLibrary {...p} />);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(201);
  });
  view.rerender(<CreativeReferenceLibrary {...p} open={false} />);
  view.rerender(<CreativeReferenceLibrary {...p} />);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(201);
  });
  await act(async () => {
    resolveOld({ items: [file], nextCursor: null });
  });
  expect(screen.queryByRole('button', { name: /参考图.png/ })).toBeNull();
  expect(screen.getByText(/暂无可用图片/)).toBeTruthy();
});

it('allows document references for stock research while preserving their file identity', async () => {
  query.mockResolvedValue({ items: [{ ...file, fileId: 'file_report', filename: '财报.pdf', mimetype: 'application/pdf' }], nextCursor: null });
  const p = props();
  render(<CreativeReferenceLibrary {...p} fileType="all" theme="light" />);
  await act(async () => { await vi.advanceTimersByTimeAsync(201); });
  expect(query).toHaveBeenCalledWith({ type: 'all', q: undefined, limit: 50 });
  fireEvent.click(screen.getByRole('button', { name: /财报.pdf/ }));
  expect(p.onPick).toHaveBeenCalledWith(expect.objectContaining({ fileId: 'file_report', mimetype: 'application/pdf', status: 'ready' }));
});
