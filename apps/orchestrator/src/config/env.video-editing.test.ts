import { describe, expect, it } from 'vitest';
import { envSchema } from './env.js';

const BASE_ENV = {
  DATABASE_URL: 'mysql://holaday:holaday-dev@127.0.0.1:3306/holaday',
  REDIS_URL: 'redis://127.0.0.1:6379',
  JWT_SECRET: '0123456789abcdef0123456789abcdef',
};

describe('video editing environment contract', () => {
  it('keeps production editing unavailable without an explicit flag and license', () => {
    const parsed = envSchema.parse(BASE_ENV);

    expect(parsed).toMatchObject({
      VIDEO_EDITING_ENABLED: false,
      VIDEO_EDITING_ALLOWLIST: '',
      VIDEO_EDITING_PROVIDER: 'cesdk',
      CESDK_LICENSE: '',
    });
  });

  it('accepts an explicit allowlisted CE.SDK configuration', () => {
    const parsed = envSchema.parse({
      ...BASE_ENV,
      VIDEO_EDITING_ENABLED: 'true',
      VIDEO_EDITING_ALLOWLIST: 'usr_one,usr_two',
      VIDEO_EDITING_PROVIDER: 'cesdk',
      CESDK_LICENSE: 'commercial-license',
    });

    expect(parsed).toMatchObject({
      VIDEO_EDITING_ENABLED: true,
      VIDEO_EDITING_ALLOWLIST: 'usr_one,usr_two',
      VIDEO_EDITING_PROVIDER: 'cesdk',
      CESDK_LICENSE: 'commercial-license',
    });
  });

  it('rejects unknown editor providers instead of silently choosing one', () => {
    expect(() =>
      envSchema.parse({
        ...BASE_ENV,
        VIDEO_EDITING_PROVIDER: 'unreviewed-provider',
      }),
    ).toThrow();
  });
});
