import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  downloadFailureMessage,
  downloadFileAuthed,
  fetchFileBlobAuthed,
  isUnavailableFileStatus,
  safeDownloadFilename,
} from './download-file';
import {
  isFileUnavailable,
  markFileUnavailable,
  resetUnavailableFilesForTests,
} from './unavailable-file-registry';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  resetUnavailableFilesForTests();
});

describe('safeDownloadFilename', () => {
  it('keeps ordinary filenames readable', () => {
    expect(safeDownloadFilename(' report final.csv ')).toBe('report final.csv');
    expect(safeDownloadFilename('deck-v2.1.pptx')).toBe('deck-v2.1.pptx');
  });

  it('removes path separators and unsafe characters', () => {
    expect(safeDownloadFilename('../secret/report:final?.csv')).toBe(
      'secret-report-final-.csv',
    );
    expect(safeDownloadFilename('folder\\report<>.pdf')).toBe(
      'folder-report-.pdf',
    );
  });

  it('falls back when no safe filename remains', () => {
    expect(safeDownloadFilename('   ')).toBe('holaday-file');
    expect(safeDownloadFilename('///')).toBe('holaday-file');
  });
});

describe('downloadFailureMessage', () => {
  it('keeps auth and unavailable-file failures specific', () => {
    expect(downloadFailureMessage(401)).toContain('刷新页面后重试');
    expect(downloadFailureMessage(403)).toContain('刷新页面后重试');
    expect(downloadFailureMessage(404)).toBe('文件已失效，无法下载。');
    expect(downloadFailureMessage(410)).toBe('文件已失效，无法下载。');
  });
});

describe('isUnavailableFileStatus', () => {
  it('only treats permanent missing-file responses as unavailable', () => {
    expect(isUnavailableFileStatus(404)).toBe(true);
    expect(isUnavailableFileStatus(410)).toBe(true);
    expect(isUnavailableFileStatus(401)).toBe(false);
    expect(isUnavailableFileStatus(500)).toBe(false);
    expect(isUnavailableFileStatus(null)).toBe(false);
  });
});

describe('fetchFileBlobAuthed', () => {
  it('remembers a definitive missing-file response for other consumers', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 404 }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchFileBlobAuthed({
      url: '/api/files/stale/download',
    });

    expect(result.status).toBe(404);
    expect(isFileUnavailable('/files/stale/download')).toBe(true);
  });

  it('does not fetch a file already known to be unavailable', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    markFileUnavailable('/api/files/stale/download');

    const result = await fetchFileBlobAuthed({
      url: '/files/stale/download',
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      ok: false,
      status: 410,
    });
  });

  it('returns a quiet failure when an inline preview fetch is blocked', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const fetchMock = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchFileBlobAuthed({ url: '/api/files/stale/download' });

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/files/stale/download',
      expect.objectContaining({ cache: 'no-store' }),
    );
    expect(result).toMatchObject({
      ok: false,
      status: null,
      message: 'Failed to fetch',
    });
    expect(consoleError).not.toHaveBeenCalled();
  });
});

describe('downloadFileAuthed', () => {
  it('does not fetch a file already known to be unavailable', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    markFileUnavailable('stale');

    const result = await downloadFileAuthed({
      url: '/api/files/stale/download',
      filename: 'stale.png',
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      ok: false,
      status: 410,
    });
  });

  it('returns a quiet failure when a user-triggered download fetch is blocked', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const fetchMock = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await downloadFileAuthed({
      url: '/api/files/stale/download',
      filename: 'stale.png',
    });

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/files/stale/download',
      expect.objectContaining({ cache: 'no-store' }),
    );
    expect(result).toMatchObject({
      ok: false,
      status: null,
      message: 'Failed to fetch',
    });
    expect(consoleError).not.toHaveBeenCalled();
  });
});
