import { describe, expect, it } from 'vitest';
import { screenshotThumbnailPresentation } from './screenshot-thumbnail-state.js';

describe('screenshot thumbnail presentation', () => {
  it('uses the unavailable file card as soon as the shared registry knows the file is gone', () => {
    expect(
      screenshotThumbnailPresentation({
        previewFailed: false,
        fileUnavailable: true,
      }),
    ).toBe('file-card');
  });

  it('keeps a retryable file card for non-permanent preview failures', () => {
    expect(
      screenshotThumbnailPresentation({
        previewFailed: true,
        fileUnavailable: false,
      }),
    ).toBe('file-card');
  });

  it('shows the screenshot only while the preview is healthy and the file is available', () => {
    expect(
      screenshotThumbnailPresentation({
        previewFailed: false,
        fileUnavailable: false,
      }),
    ).toBe('thumbnail');
  });
});
