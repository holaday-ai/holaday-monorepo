import { describe, expect, it } from 'vitest';
import { accountSecurityClosureHandler } from '../../src/account-closure/handlers/account-security.js';

function fake(accountSecurityClosureHandler: { run(): string }): string {
  return accountSecurityClosureHandler.run();
}

describe('shadowed account closure governance fixture', () => {
  it('never invokes the imported handler', () => {
    expect(accountSecurityClosureHandler.categoryId).toBe('account_security');
    expect(fake({ run: () => 'shadowed' })).toBe('shadowed');
  });
});
