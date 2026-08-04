import { describe, expect, it } from 'vitest';
import { parseHoladayFilePayload } from './FileDownloadCard.js';

describe('parseHoladayFilePayload', () => {
  it('parses and trims a valid holaday-file payload', () => {
    expect(
      parseHoladayFilePayload(
        JSON.stringify({
          fileId: ' file_123 ',
          filename: ' report.csv ',
          size: 1024,
          downloadUrl: ' /api/files/file_123/download ',
        }),
      ),
    ).toEqual({
      fileId: 'file_123',
      filename: 'report.csv',
      size: 1024,
      downloadUrl: '/api/files/file_123/download',
    });
  });

  it('keeps a valid optional expiry timestamp', () => {
    expect(
      parseHoladayFilePayload(
        JSON.stringify({
          fileId: 'file_123',
          filename: 'report.csv',
          size: 1024,
          downloadUrl: '/api/files/file_123/download',
          expiresAt: '2026-07-24T10:00:00.000Z',
        }),
      ),
    ).toMatchObject({
      expiresAt: '2026-07-24T10:00:00.000Z',
    });
  });

  it('drops an invalid optional expiry without dropping the file card', () => {
    expect(
      parseHoladayFilePayload(
        JSON.stringify({
          fileId: 'file_123',
          filename: 'report.csv',
          size: 1024,
          downloadUrl: '/api/files/file_123/download',
          expiresAt: 'not-a-date',
        }),
      ),
    ).toEqual({
      fileId: 'file_123',
      filename: 'report.csv',
      size: 1024,
      downloadUrl: '/api/files/file_123/download',
    });
  });

  it('rejects malformed JSON and incomplete payloads', () => {
    expect(parseHoladayFilePayload('{not json')).toBeNull();
    expect(parseHoladayFilePayload(JSON.stringify({ fileId: 'file_123' }))).toBeNull();
  });

  it('rejects empty strings and non-finite or negative sizes', () => {
    const base = {
      fileId: 'file_123',
      filename: 'report.csv',
      size: 1,
      downloadUrl: '/api/files/file_123/download',
    };
    expect(parseHoladayFilePayload(JSON.stringify({ ...base, fileId: '   ' }))).toBeNull();
    expect(parseHoladayFilePayload(JSON.stringify({ ...base, filename: '' }))).toBeNull();
    expect(parseHoladayFilePayload(JSON.stringify({ ...base, downloadUrl: '' }))).toBeNull();
    expect(parseHoladayFilePayload(JSON.stringify({ ...base, size: -1 }))).toBeNull();
    expect(parseHoladayFilePayload(JSON.stringify({ ...base, size: Number.NaN }))).toBeNull();
  });

  it('only accepts same-origin Holaday file download paths', () => {
    const base = {
      fileId: 'file_123',
      filename: 'report.csv',
      size: 1,
      downloadUrl: '/api/files/file_123/download',
    };

    expect(
      parseHoladayFilePayload(
        JSON.stringify({
          ...base,
          downloadUrl: '/api/files/file_123/download?download=1#ready',
        }),
      )?.downloadUrl,
    ).toBe('/api/files/file_123/download?download=1#ready');
    expect(
      parseHoladayFilePayload(
        JSON.stringify({
          ...base,
          downloadUrl: 'https://evil.example/api/files/file_123/download',
        }),
      ),
    ).toBeNull();
    expect(
      parseHoladayFilePayload(
        JSON.stringify({
          ...base,
          downloadUrl: '/api/files/file_123/preview',
        }),
      ),
    ).toBeNull();
  });
});
