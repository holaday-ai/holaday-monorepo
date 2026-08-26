import { describe, expect, it } from 'vitest';
import { envSchema } from './env.js';

const base = {
  DATABASE_URL: 'mysql://test:test@127.0.0.1:3306/holaday_account_closure_test',
  REDIS_URL: 'redis://127.0.0.1:6379',
  JWT_SECRET: 'j'.repeat(32),
};

describe('account closure environment contract', () => {
  it('defaults both flags off and secrets/allowlist empty', () => {
    const parsed = envSchema.parse(base);
    expect(parsed).toMatchObject({
      ACCOUNT_CLOSURE_ENABLED: false,
      ACCOUNT_CLOSURE_WORKER_ENABLED: false,
      ACCOUNT_CLOSURE_ALLOWLIST: '',
      ACCOUNT_CLOSURE_HMAC_SECRET: '',
    });
  });

  it.each(['ACCOUNT_CLOSURE_ENABLED', 'ACCOUNT_CLOSURE_WORKER_ENABLED'] as const)(
    'requires a 32-character HMAC secret when %s is enabled',
    (flag) => {
      expect(
        envSchema.safeParse({ ...base, [flag]: 'true', ACCOUNT_CLOSURE_HMAC_SECRET: '' }).success,
      ).toBe(false);
      expect(
        envSchema.safeParse({
          ...base,
          [flag]: 'true',
          ACCOUNT_CLOSURE_HMAC_SECRET: 'h'.repeat(31),
        }).success,
      ).toBe(false);
      expect(
        envSchema.safeParse({
          ...base,
          [flag]: 'true',
          ACCOUNT_CLOSURE_HMAC_SECRET: ' '.repeat(32),
        }).success,
      ).toBe(false);
      expect(
        envSchema.safeParse({
          ...base,
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
});
