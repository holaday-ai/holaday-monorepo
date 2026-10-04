// @vitest-environment happy-dom

import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FileDownloadCard } from './FileDownloadCard';
import { LazyPosterImg } from './LazyPosterImg';

const mocks = vi.hoisted(() => ({
  fetchFileBlobAuthed: vi.fn(),
}));

vi.mock('@/lib/download-file', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/download-file')>();
  return {
    ...actual,
    fetchFileBlobAuthed: mocks.fetchFileBlobAuthed,
    blobToDataUrl: async () => 'data:image/png;base64,AAAA',
  };
});

vi.mock('@/components/ui/toast', () => ({
  useToast: () => ({ show: vi.fn() }),
}));

type ObserverRecord = {
  callback: IntersectionObserverCallback;
  elements: Element[];
  disconnected: boolean;
};

const observers: ObserverRecord[] = [];

class FakeIntersectionObserver {
  private readonly record: ObserverRecord;
  constructor(callback: IntersectionObserverCallback) {
    this.record = { callback, elements: [], disconnected: false };
    observers.push(this.record);
  }
  observe(element: Element): void {
    this.record.elements.push(element);
  }
  disconnect(): void {
    this.record.disconnected = true;
  }
  unobserve(): void {}
  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }
}

function scrollIntoView(): void {
  for (const record of observers) {
    if (record.disconnected) continue;
    record.callback(
      record.elements.map(
        (target) => ({ isIntersecting: true, target }) as unknown as IntersectionObserverEntry,
      ),
      record as unknown as IntersectionObserver,
    );
  }
}

const payload = (filename: string) => ({
  fileId: `fil_${filename}`,
  filename,
  size: 5_000_000,
  downloadUrl: `/api/files/fil_${filename}/download`,
});

beforeEach(() => {
  observers.length = 0;
  mocks.fetchFileBlobAuthed.mockReset();
  mocks.fetchFileBlobAuthed.mockResolvedValue({
    ok: true,
    status: 200,
    blob: new Blob(['x'], { type: 'image/png' }),
  });
  vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('FileDownloadCard lazy preview', () => {
  it('does not fetch an image preview until the card nears the viewport', async () => {
    render(<FileDownloadCard payload={payload('poster.png')} />);
    expect(mocks.fetchFileBlobAuthed).not.toHaveBeenCalled();
    expect(screen.getByLabelText('图片预览待加载')).toBeTruthy();

    act(() => scrollIntoView());
    await waitFor(() => expect(mocks.fetchFileBlobAuthed).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByRole('img', { name: 'poster.png' })).toBeTruthy());
  });

  it('defers the full video blob for off-screen history cards', () => {
    render(<FileDownloadCard payload={payload('clip.mp4')} />);
    expect(screen.getByLabelText('视频预览待加载')).toBeTruthy();
    expect(mocks.fetchFileBlobAuthed).not.toHaveBeenCalled();
  });

  it('never observes cards that show no media preview', () => {
    render(<FileDownloadCard payload={payload('report.pdf')} />);
    render(<FileDownloadCard payload={payload('cover.png')} showPreview={false} />);
    expect(observers).toHaveLength(0);
    expect(mocks.fetchFileBlobAuthed).not.toHaveBeenCalled();
  });

  it('loads immediately where IntersectionObserver is unavailable', async () => {
    vi.stubGlobal('IntersectionObserver', undefined);
    render(<FileDownloadCard payload={payload('poster.png')} />);
    await waitFor(() => expect(mocks.fetchFileBlobAuthed).toHaveBeenCalledTimes(1));
  });
});

describe('LazyPosterImg', () => {
  it('fetches the video cover only after it scrolls into view', async () => {
    render(<LazyPosterImg posterUrl="/api/files/fil_cover/download" alt="视频封面" />);
    expect(mocks.fetchFileBlobAuthed).not.toHaveBeenCalled();
    act(() => scrollIntoView());
    await waitFor(() =>
      expect(mocks.fetchFileBlobAuthed).toHaveBeenCalledWith({ url: '/api/files/fil_cover/download' }),
    );
    await waitFor(() => expect(screen.getByRole('img', { name: '视频封面' })).toBeTruthy());
  });
});
