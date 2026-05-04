/**
 * Centralised test env. Module-level so it runs before any
 * `import { env } from '../config/env.js'` lands and triggers
 * the env validator. Individual test files don't need to repeat
 * this — keep it here so a missing var fails one place, not 30.
 *
 * Each line uses `??=` so a real CI / dev value (set by the
 * shell, .env, or a docker-compose) wins over the placeholder.
 * Integration tests that need a real DB still rely on the shell-
 * set DATABASE_URL / REDIS_URL.
 */
process.env.JWT_SECRET ??=
  'test-secret-must-be-at-least-32-characters-long-yes';
process.env.DATABASE_URL ??=
  'mysql://holaday:holaday-dev@127.0.0.1:3306/holaday';
process.env.REDIS_URL ??= 'redis://127.0.0.1:6379/0';
process.env.NODE_ENV ??= 'test';
