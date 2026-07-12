import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  downloadFailureMessage,
  downloadFileAuthed,
  fetchFileBlobAuthed,
  safeDownloadFilename,
} from './download-file';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
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
  it('keeps auth and expiry failures specific', () => {
    expect(downloadFailureMessage(401)).toContain('刷新页面后重试');
    expect(downloadFailureMessage(403)).toContain('刷新页面后重试');
    expect(downloadFailureMessage(404)).toContain('链接已过期');
    expect(downloadFailureMessage(410)).toContain('链接已过期');
  });
});

describe('fetchFileBlobAuthed', () => {
  it('returns a quiet failure when an inline preview fetch is blocked', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    }));

    const result = await fetchFileBlobAuthed({ url: '/api/files/stale/download' });

    expect(result).toMatchObject({
      ok: false,
      status: null,
      message: 'Failed to fetch',
    });
    expect(consoleError).not.toHaveBeenCalled();
  });
});

describe('downloadFileAuthed', () => {
  it('returns a quiet failure when a user-triggered download fetch is blocked', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    }));

    const result = await downloadFileAuthed({
      url: '/api/files/stale/download',
      filename: 'stale.png',
    });

    expect(result).toMatchObject({
      ok: false,
      status: null,
      message: 'Failed to fetch',
    });
    expect(consoleError).not.toHaveBeenCalled();
  });
});
