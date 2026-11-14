/**
 * CAPTCHA-UX-1 local acceptance only: the exact origins of a local test-fixture server (a simulated
 * verification page) that the browser may open and whose /anchor and /bframe frames count as a
 * captcha provider's. 协调方 2026-11-14: it opens a path to local addresses, so it takes effect only
 * in an explicit local-test environment (HOLADAY_ENV=local-test) that is not production — and a
 * production configuration that carries it refuses to start (config/env.ts) and to be switched to
 * (deploy preflight).
 */
export const TEST_FIXTURE_ORIGIN = /^http:\/\/127\.0\.0\.1:\d{2,5}$/;

export function testFixtureOrigins(env: NodeJS.ProcessEnv = process.env): string[] {
  if (env.NODE_ENV === 'production' || env.HOLADAY_ENV !== 'local-test') return [];
  return (env.BROWSER_TEST_FIXTURE_ORIGINS ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => TEST_FIXTURE_ORIGIN.test(origin));
}
