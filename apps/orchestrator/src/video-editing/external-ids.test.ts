import { isExternalId, newExternalId } from '@holaday/shared-types';
import { describe, expect, it } from 'vitest';

describe('video editing external ids', () => {
  it.each(['videoEditProject', 'videoEditVersion', 'videoEditQuote'] as const)(
    'creates a distinct valid %s id',
    (kind) => {
      const first = newExternalId(kind);
      const second = newExternalId(kind);

      expect(first).not.toBe(second);
      expect(isExternalId(first, kind)).toBe(true);
      expect(
        isExternalId(first, kind === 'videoEditProject' ? 'videoEditVersion' : 'videoEditProject'),
      ).toBe(false);
    },
  );
});
