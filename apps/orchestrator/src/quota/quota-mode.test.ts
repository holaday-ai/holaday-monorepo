import { describe, expect, it } from 'vitest';
import { isQuotaBypassUser, quotaModeForExternalUser } from './quota-mode.js';

describe('quota mode', () => {
  it('reports the production smoke-test account as unmetered', () => {
    expect(quotaModeForExternalUser('usr_EeYpvsvLtyDzN4VLQi7BT')).toBe('unmetered_test');
    expect(isQuotaBypassUser('usr_EeYpvsvLtyDzN4VLQi7BT')).toBe(true);
  });

  it('keeps ordinary accounts metered', () => {
    expect(quotaModeForExternalUser('usr_regular')).toBe('metered');
    expect(isQuotaBypassUser('usr_regular')).toBe(false);
  });
});
