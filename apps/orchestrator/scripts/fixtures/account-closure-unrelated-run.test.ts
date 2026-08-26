import { describe, expect, it } from 'vitest';
import { accountSecurityClosureHandler } from '../../src/account-closure/handlers/account-security.js';

const unrelated = { run: () => 'unrelated' };

describe('negative governance evidence fixture', () => {
  it('imports the target but executes only an unrelated run method', () => {
    expect(accountSecurityClosureHandler.categoryId).toBe('account_security');
    expect(unrelated.run()).toBe('unrelated');
  });
});
