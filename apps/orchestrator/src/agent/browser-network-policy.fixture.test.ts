import { afterEach, expect, it, vi } from 'vitest';
import { BrowserNetworkPolicy, isTestFixtureOrigin } from './browser-network-policy.js';

afterEach(() => vi.unstubAllEnvs());

it('CAPTCHA-UX-1 local acceptance: listed 127.0.0.1 fixture origins only, never in production', async () => {
  vi.stubEnv('BROWSER_TEST_FIXTURE_ORIGINS', 'http://127.0.0.1:8765, http://localhost:9000');
  vi.stubEnv('NODE_ENV', 'test');
  expect(isTestFixtureOrigin(new URL('http://127.0.0.1:8765/recaptcha/sim'))).toBe(true);
  expect(isTestFixtureOrigin(new URL('http://127.0.0.1:8766/anchor'))).toBe(false); // not listed
  expect(isTestFixtureOrigin(new URL('http://localhost:9000/'))).toBe(false); // listed, not 127.0.0.1
  const policy = new BrowserNetworkPolicy();
  expect((await policy.check('http://127.0.0.1:8765/recaptcha/sim')).allowed).toBe(true);
  expect((await policy.check('http://127.0.0.1:22/')).allowed).toBe(false);
  vi.stubEnv('NODE_ENV', 'production');
  expect(isTestFixtureOrigin(new URL('http://127.0.0.1:8765/recaptcha/sim'))).toBe(false);
  expect((await policy.check('http://127.0.0.1:8765/recaptcha/sim')).allowed).toBe(false);
  vi.stubEnv('NODE_ENV', 'test');
  vi.stubEnv('BROWSER_TEST_FIXTURE_ORIGINS', '');
  expect((await policy.check('http://127.0.0.1:8765/recaptcha/sim')).allowed).toBe(false);
});
