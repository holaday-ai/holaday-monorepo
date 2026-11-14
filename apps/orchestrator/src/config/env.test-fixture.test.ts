import { expect, it } from 'vitest';
import { envSchema } from './env.js';

const BASE_ENV = {
  DATABASE_URL: 'mysql://holaday:holaday-dev@127.0.0.1:3306/holaday',
  REDIS_URL: 'redis://127.0.0.1:6379',
  JWT_SECRET: '0123456789abcdef0123456789abcdef',
};

it('协调方 2026-11-14: a production configuration carrying the local test-fixture switch refuses to start', () => {
  expect(() =>
    envSchema.parse({
      ...BASE_ENV,
      NODE_ENV: 'production',
      BROWSER_TEST_FIXTURE_ORIGINS: 'http://127.0.0.1:8765',
    }),
  ).toThrow(/local acceptance only/);
  expect(() =>
    envSchema.parse({ ...BASE_ENV, NODE_ENV: 'production', HOLADAY_ENV: 'local-test' }),
  ).toThrow(/local acceptance only/);
  // Unset (or blank) in production is fine; set in a local-test environment is fine.
  expect(() =>
    envSchema.parse({ ...BASE_ENV, NODE_ENV: 'production', BROWSER_TEST_FIXTURE_ORIGINS: ' ' }),
  ).not.toThrow();
  expect(() =>
    envSchema.parse({
      ...BASE_ENV,
      NODE_ENV: 'development',
      HOLADAY_ENV: 'local-test',
      BROWSER_TEST_FIXTURE_ORIGINS: 'http://127.0.0.1:8765',
    }),
  ).not.toThrow();
});
