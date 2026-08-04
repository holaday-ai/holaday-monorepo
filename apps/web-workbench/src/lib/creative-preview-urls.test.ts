import { describe, expect, it, vi } from 'vitest';

import { revokeCreativePreviewUrls } from './creative-preview-urls';

describe('revokeCreativePreviewUrls', () => {
  it('revokes each unique local blob preview and ignores non-blob values', () => {
    const revokeObjectURL = vi.fn();

    revokeCreativePreviewUrls(
      [
        { previewDataUrl: 'blob:first' },
        { previewDataUrl: 'blob:first' },
        { previewDataUrl: 'blob:second' },
        { previewDataUrl: 'https://cdn.example.com/reference.png' },
        {},
      ],
      revokeObjectURL,
    );

    expect(revokeObjectURL).toHaveBeenCalledTimes(2);
    expect(revokeObjectURL).toHaveBeenNthCalledWith(1, 'blob:first');
    expect(revokeObjectURL).toHaveBeenNthCalledWith(2, 'blob:second');
  });
});
