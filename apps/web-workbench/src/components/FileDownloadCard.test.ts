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
});
