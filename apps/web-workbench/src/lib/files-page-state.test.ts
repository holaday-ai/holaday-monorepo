import { describe, expect, it } from 'vitest';
import { formatFileRelativeDate, normalizeFileRows } from './files-page-state';

describe('normalizeFileRows', () => {
  it('returns an empty list for malformed payloads', () => {
    expect(normalizeFileRows(null)).toEqual([]);
    expect(normalizeFileRows({ fileId: 'f_1' })).toEqual([]);
  });

  it('normalizes valid file rows and trims display fields', () => {
    expect(
      normalizeFileRows([
        {
          fileId: ' file_1 ',
          filename: ' Report.pdf ',
          mimetype: ' APPLICATION/PDF ',
          sizeBytes: '1536.6',
          createdAt: '2026-05-17T12:00:00Z',
        },
      ]),
    ).toEqual([
      {
        fileId: 'file_1',
        filename: 'Report.pdf',
        mimetype: 'application/pdf',
        sizeBytes: 1537,
        createdAt: '2026-05-17T12:00:00Z',
      },
    ]);
  });

  it('skips rows without a usable file id', () => {
    expect(
      normalizeFileRows([
        { fileId: '', filename: 'empty.txt' },
        { fileId: 123, filename: 'number.txt' },
        { fileId: 'ok', filename: 'ok.txt' },
      ]),
    ).toHaveLength(1);
  });

  it('falls back for malformed optional fields', () => {
    expect(
      normalizeFileRows([
        {
          fileId: 'file_1',
          filename: '',
          mimetype: null,
          sizeBytes: -100,
          createdAt: 'bad-date',
        },
      ]),
    ).toEqual([
      {
        fileId: 'file_1',
        filename: '未命名文件',
        mimetype: 'application/octet-stream',
        sizeBytes: 0,
        createdAt: '',
      },
    ]);
  });
});

describe('formatFileRelativeDate', () => {
  const now = new Date('2026-05-17T12:00:00Z');

  it('formats recent dates relative to now', () => {
    expect(formatFileRelativeDate('2026-05-17T01:00:00Z', now)).toBe('今天');
    expect(formatFileRelativeDate('2026-05-16T12:00:00Z', now)).toBe('昨天');
    expect(formatFileRelativeDate('2026-05-13T12:00:00Z', now)).toBe('4天前');
  });

  it('formats older dates as calendar labels', () => {
    expect(formatFileRelativeDate('2026-04-15T12:00:00Z', now)).toBe('4月15日');
  });

  it('uses a placeholder for malformed dates', () => {
    expect(formatFileRelativeDate('not-a-date', now)).toBe('—');
    expect(formatFileRelativeDate(null, now)).toBe('—');
  });

  it('accepts Date and timestamp values', () => {
    expect(formatFileRelativeDate(new Date('2026-05-17T11:00:00Z'), now)).toBe(
      '今天',
    );
    expect(formatFileRelativeDate(Date.parse('2026-05-16T12:00:00Z'), now)).toBe(
      '昨天',
    );
  });
});
