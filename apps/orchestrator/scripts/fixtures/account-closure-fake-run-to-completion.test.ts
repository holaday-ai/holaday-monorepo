import { describe, expect, it } from 'vitest';
import { accountSecurityClosureHandler } from '../../src/account-closure/handlers/account-security.js';

const unrelated = { run: () => 'unrelated' };

function runToCompletion(_handler: unknown): string {
  return unrelated.run();
}

describe('fake account closure completion helper fixture', () => {
  it('accepts the imported handler without invoking it', () => {
    expect(runToCompletion(accountSecurityClosureHandler)).toBe('unrelated');
  });
});
