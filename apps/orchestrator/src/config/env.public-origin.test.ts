import { describe, expect, it } from 'vitest';
import { envSchema, parseHoladayPublicBaseUrl } from './env.js';

const BASE_ENV = {
  DATABASE_URL: 'mysql://holaday:holaday-dev@127.0.0.1:3306/holaday',
  REDIS_URL: 'redis://127.0.0.1:6379',
  JWT_SECRET: '0123456789abcdef0123456789abcdef',
};

describe('HOLADAY_PUBLIC_BASE_URL', () => {
  it('uses an empty root-relative default and canonicalizes a trusted origin', () => {
    expect(parseHoladayPublicBaseUrl('', 'production')).toBe('');
    expect(parseHoladayPublicBaseUrl('https://holaday.example/', 'production')).toBe(
      'https://holaday.example',
    );
    expect(
      envSchema.parse({
        ...BASE_ENV,
        NODE_ENV: 'development',
        HOLADAY_PUBLIC_BASE_URL: 'http://localhost:5173/',
      }).HOLADAY_PUBLIC_BASE_URL,
    ).toBe('http://localhost:5173');
  });

  it.each([
    '//untrusted.example',
    'https://user:password@holaday.example',
    'javascript:alert(1)',
    'ftp://holaday.example',
    'https://holaday.example/invite',
    'https://holaday.example/?next=invite',
    'https://holaday.example/#invite',
  ])('rejects an untrusted public origin %s', (origin) => {
    expect(() => parseHoladayPublicBaseUrl(origin, 'development')).toThrow(
      /HOLADAY_PUBLIC_BASE_URL/,
    );
  });

  it('rejects HTTP in production at environment startup', () => {
    expect(() =>
      envSchema.parse({
        ...BASE_ENV,
        NODE_ENV: 'production',
        HOLADAY_PUBLIC_BASE_URL: 'http://localhost:5173',
      }),
    ).toThrow(/HOLADAY_PUBLIC_BASE_URL/);
  });
});
