import { describe, expect, it } from 'vitest';
import { normaliseAttachmentDownloadUrl } from './attachment-download-url';

describe('normaliseAttachmentDownloadUrl', () => {
  it('keeps relative API download routes', () => {
    expect(
      normaliseAttachmentDownloadUrl('/api/files/file_123/download?token=short-lived'),
    ).toBe('/api/files/file_123/download?token=short-lived');
  });

  it('maps trusted production hosts onto the current app route', () => {
    expect(
      normaliseAttachmentDownloadUrl(
        'https://hd-app.orangebench.tech/files/file_123/download?token=short-lived',
      ),
    ).toBe('/api/files/file_123/download?token=short-lived');
  });

  it('rejects download-shaped links from untrusted hosts', () => {
    expect(
      normaliseAttachmentDownloadUrl(
        'https://files.example.com/files/file_123/download?token=short-lived',
      ),
    ).toBeNull();
  });
});
