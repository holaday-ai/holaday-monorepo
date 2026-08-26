import { afterEach, describe, expect, it, vi } from 'vitest';
import { assertDestructiveTestDatabaseAllowed } from './db-helper.js';

describe('assertDestructiveTestDatabaseAllowed', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('rejects a destructive reset unless the explicit opt-in is present', () => {
    vi.stubEnv('ALLOW_DESTRUCTIVE_TEST_DB_RESET', '');

    expect(() =>
      assertDestructiveTestDatabaseAllowed('mysql://root:secret@127.0.0.1:3306/holaday_test'),
    ).toThrow('ALLOW_DESTRUCTIVE_TEST_DB_RESET=1');
  });

  it('rejects the default development database even with the opt-in', () => {
    vi.stubEnv('ALLOW_DESTRUCTIVE_TEST_DB_RESET', '1');

    expect(() =>
      assertDestructiveTestDatabaseAllowed('mysql://root:secret@127.0.0.1:3306/holaday'),
    ).toThrow('dedicated database ending in _test or _integration');
  });

  it.each([
    'mysql://root:secret@127.0.0.1:3306/',
    'mysql://root:secret@127.0.0.1:3306/holaday_testing',
    'mysql://root:secret@127.0.0.1:3306/holaday_test_prod',
  ])('rejects an unsafe database target without exposing credentials: %s', (databaseUrl) => {
    vi.stubEnv('ALLOW_DESTRUCTIVE_TEST_DB_RESET', '1');

    let message = '';
    try {
      assertDestructiveTestDatabaseAllowed(databaseUrl);
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    expect(message).toContain('dedicated database ending in _test or _integration');
    expect(message).not.toContain('secret');
  });

  it.each(['holaday_test', 'holaday_account_closure_test', 'holaday_integration'])(
    'allows an explicitly opted-in dedicated database: %s',
    (databaseName) => {
      vi.stubEnv('ALLOW_DESTRUCTIVE_TEST_DB_RESET', '1');

      expect(() =>
        assertDestructiveTestDatabaseAllowed(`mysql://root:secret@127.0.0.1:3306/${databaseName}`),
      ).not.toThrow();
    },
  );
});
