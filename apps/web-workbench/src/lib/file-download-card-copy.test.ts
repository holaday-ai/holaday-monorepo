import { describe, expect, it } from 'vitest';
import {
  classifyDownloadFileKind,
  downloadFileAvailability,
  downloadFileKindLabel,
  downloadFileMetaLabel,
} from './file-download-card-copy';

describe('file-download-card-copy', () => {
  it('classifies common generated file kinds', () => {
    expect(classifyDownloadFileKind('report.csv')).toBe('spreadsheet');
    expect(classifyDownloadFileKind('deck.pptx')).toBe('presentation');
    expect(classifyDownloadFileKind('screen.webp')).toBe('image');
    expect(classifyDownloadFileKind('demo.MP4')).toBe('video');
    expect(classifyDownloadFileKind('summary.md')).toBe('document');
    expect(classifyDownloadFileKind('archive.bin')).toBe('generic');
  });

  it('renders concise Chinese file kind labels', () => {
    expect(downloadFileKindLabel('spreadsheet')).toBe('表格文件');
    expect(downloadFileKindLabel('presentation')).toBe('演示文稿');
    expect(downloadFileKindLabel('image')).toBe('图片文件');
    expect(downloadFileKindLabel('video')).toBe('视频文件');
    expect(downloadFileKindLabel('document')).toBe('文档文件');
    expect(downloadFileKindLabel('generic')).toBe('产出文件');
  });

  it('shows whether a file is still available when expiry is known', () => {
    expect(
      downloadFileMetaLabel({
        filename: 'report.csv',
        formattedSize: '1 KB',
        expiresAt: '2026-07-24T10:00:00.000Z',
        now: Date.parse('2026-07-23T10:00:00.000Z'),
      }),
    ).toBe('表格文件 · 1 KB · 当前可下载');
  });

  it('labels a known expired file without inviting a failed download', () => {
    expect(
      downloadFileMetaLabel({
        filename: 'report.csv',
        formattedSize: '1 KB',
        expiresAt: '2026-07-22T10:00:00.000Z',
        now: Date.parse('2026-07-23T10:00:00.000Z'),
      }),
    ).toBe('表格文件 · 1 KB · 文件已过期');
  });

  it('states the retention policy without claiming unknown files are active', () => {
    expect(
      downloadFileMetaLabel({ filename: 'report.csv', formattedSize: '1 KB' }),
    ).toBe('表格文件 · 1 KB · 文件生成后保留 24 小时');
  });

  it('normalizes valid, expired and unknown availability states', () => {
    const now = Date.parse('2026-07-23T10:00:00.000Z');
    expect(downloadFileAvailability('2026-07-23T10:00:01.000Z', now)).toBe('available');
    expect(downloadFileAvailability('2026-07-23T09:59:59.000Z', now)).toBe('expired');
    expect(downloadFileAvailability('not-a-date', now)).toBe('unknown');
    expect(downloadFileAvailability(undefined, now)).toBe('unknown');
  });
});
