export type QuotaMode = 'metered' | 'unmetered_test';

/**
 * Production smoke-test accounts keep normal task history but do not consume
 * plan quota. Keep this policy in one place so task admission and read-side
 * quota surfaces cannot disagree about whether an account is metered.
 */
const UNMETERED_TEST_USERS: ReadonlySet<string> = new Set(['usr_EeYpvsvLtyDzN4VLQi7BT']);

export function quotaModeForExternalUser(externalUserId: string): QuotaMode {
  return UNMETERED_TEST_USERS.has(externalUserId) ? 'unmetered_test' : 'metered';
}

export function isQuotaBypassUser(externalUserId: string): boolean {
  return quotaModeForExternalUser(externalUserId) === 'unmetered_test';
}
