import { describe, expect, it } from 'vitest';
import { filePreviewKind } from './file-preview-kind';

describe('filePreviewKind', () => {
  it('detects image previews from MIME', () => {
    expect(filePreviewKind({ mime: 'image/png', filename: 'report.bin' })).toBe(
      'image',
    );
  });

  it('detects PDFs from MIME or filename', () => {
    expect(filePreviewKind({ mime: 'application/pdf', filename: 'x' })).toBe('pdf');
    expect(filePreviewKind({ mime: '', filename: 'deck.PDF' })).toBe('pdf');
  });

  it('detects text previews from MIME or common text extensions', () => {
    expect(filePreviewKind({ mime: 'text/plain', filename: 'x' })).toBe('text');
    expect(filePreviewKind({ mime: '', filename: 'data.csv' })).toBe('text');
    expect(filePreviewKind({ mime: 'application/json', filename: 'payload.bin' })).toBe(
      'text',
    );
  });

  it('falls back to download for unsupported binary files', () => {
    expect(filePreviewKind({ mime: 'application/zip', filename: 'archive.zip' })).toBe(
      'download',
    );
  });
});
