import { describe, expect, it } from 'vitest';
import { downloadFailureMessage, safeDownloadFilename } from './download-file';

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
