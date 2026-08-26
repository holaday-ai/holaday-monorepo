import { describe, expect, it } from 'vitest';
import { envSchema } from './env.js';

const base = {
  DATABASE_URL: 'mysql://test:test@127.0.0.1:3306/holaday_account_closure_test',
  REDIS_URL: 'redis://127.0.0.1:6379',
  JWT_SECRET: 'j'.repeat(32),
};
const sanitizedPrerequisites = {
  ACCOUNT_CLOSURE_LEGACY_FEEDBACK_SANITIZED: 'true',
  ACCOUNT_CLOSURE_LEGACY_ANALYTICS_LOGS_SANITIZED: 'true',
};

describe('account closure environment contract', () => {
  it('defaults both flags off and secrets/allowlist empty', () => {
    const parsed = envSchema.parse(base);
    expect(parsed).toMatchObject({
      ACCOUNT_CLOSURE_ENABLED: false,
      ACCOUNT_CLOSURE_WORKER_ENABLED: false,
      ACCOUNT_CLOSURE_ALLOWLIST: '',
      ACCOUNT_CLOSURE_HMAC_SECRET: '',
      ACCOUNT_CLOSURE_LEGACY_FEEDBACK_SANITIZED: false,
      ACCOUNT_CLOSURE_LEGACY_ANALYTICS_LOGS_SANITIZED: false,
    });
  });

  it.each(['ACCOUNT_CLOSURE_ENABLED', 'ACCOUNT_CLOSURE_WORKER_ENABLED'] as const)(
    'requires a 32-character HMAC secret when %s is enabled',
    (flag) => {
      expect(
        envSchema.safeParse({
          ...base,
          ...sanitizedPrerequisites,
          [flag]: 'true',
          ACCOUNT_CLOSURE_HMAC_SECRET: '',
        }).success,
      ).toBe(false);
      expect(
        envSchema.safeParse({
          ...base,
          ...sanitizedPrerequisites,
          [flag]: 'true',
          ACCOUNT_CLOSURE_HMAC_SECRET: 'h'.repeat(31),
        }).success,
      ).toBe(false);
      expect(
        envSchema.safeParse({
          ...base,
          ...sanitizedPrerequisites,
          [flag]: 'true',
          ACCOUNT_CLOSURE_HMAC_SECRET: ' '.repeat(32),
        }).success,
      ).toBe(false);
      expect(
        envSchema.safeParse({
          ...base,
          ...sanitizedPrerequisites,
          [flag]: 'true',
          ACCOUNT_CLOSURE_HMAC_SECRET: 'h'.repeat(32),
        }).success,
      ).toBe(true);
    },
  );

  it('accepts an empty HMAC secret only while both flags are disabled', () => {
    expect(
      envSchema.safeParse({
        ...base,
        ACCOUNT_CLOSURE_ENABLED: 'false',
        ACCOUNT_CLOSURE_WORKER_ENABLED: 'false',
        ACCOUNT_CLOSURE_HMAC_SECRET: '',
      }).success,
    ).toBe(true);
  });

  it.each(['ACCOUNT_CLOSURE_ENABLED', 'ACCOUNT_CLOSURE_WORKER_ENABLED'] as const)(
    'requires both legacy sanitation prerequisites when %s is enabled',
    (flag) => {
      const enabled = {
        ...base,
        [flag]: 'true',
        ACCOUNT_CLOSURE_HMAC_SECRET: 'h'.repeat(32),
      };
      expect(envSchema.safeParse(enabled).success).toBe(false);
      expect(
        envSchema.safeParse({
          ...enabled,
          ACCOUNT_CLOSURE_LEGACY_FEEDBACK_SANITIZED: 'true',
        }).success,
      ).toBe(false);
      expect(
        envSchema.safeParse({
          ...enabled,
          ACCOUNT_CLOSURE_LEGACY_FEEDBACK_SANITIZED: 'true',
          ACCOUNT_CLOSURE_LEGACY_ANALYTICS_LOGS_SANITIZED: 'true',
        }).success,
      ).toBe(true);
    },
  );
});
