import { describe, expect, it } from 'vitest';
import {
  classifyDownloadFileKind,
  downloadFileKindLabel,
  downloadFileMetaLabel,
} from './file-download-card-copy';

describe('file-download-card-copy', () => {
  it('classifies common generated file kinds', () => {
    expect(classifyDownloadFileKind('report.csv')).toBe('spreadsheet');
    expect(classifyDownloadFileKind('deck.pptx')).toBe('presentation');
    expect(classifyDownloadFileKind('screen.webp')).toBe('image');
    expect(classifyDownloadFileKind('summary.md')).toBe('document');
    expect(classifyDownloadFileKind('archive.bin')).toBe('generic');
  });

  it('renders concise Chinese file kind labels', () => {
    expect(downloadFileKindLabel('spreadsheet')).toBe('表格文件');
    expect(downloadFileKindLabel('presentation')).toBe('演示文稿');
    expect(downloadFileKindLabel('image')).toBe('图片文件');
    expect(downloadFileKindLabel('document')).toBe('文档文件');
    expect(downloadFileKindLabel('generic')).toBe('产出文件');
  });

  it('includes file kind, size and expiry in the idle meta label', () => {
    expect(
      downloadFileMetaLabel({ filename: 'report.csv', formattedSize: '1 KB' }),
    ).toBe('表格文件 · 1 KB · 24h 内可下载');
  });
});
