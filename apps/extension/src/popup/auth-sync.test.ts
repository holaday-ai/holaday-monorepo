import { describe, expect, it } from 'vitest';
import { shouldClearRejectedPopupToken } from './auth-sync.js';

describe('popup auth sync guards', () => {
  it('only clears a rejected token when it still matches current storage', () => {
    expect(shouldClearRejectedPopupToken('old-token', 'old-token')).toBe(true);
    expect(shouldClearRejectedPopupToken('new-token', 'old-token')).toBe(false);
    expect(shouldClearRejectedPopupToken(null, 'old-token')).toBe(false);
  });
});
