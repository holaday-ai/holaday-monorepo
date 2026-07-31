import { beforeAll, describe, expect, it } from 'vitest';

beforeAll(() => {
  process.env.JWT_SECRET ??= 'test-secret-must-be-at-least-32-characters-long-yes';
  process.env.DATABASE_URL ??= 'mysql://test:test@127.0.0.1:3306/test';
  process.env.REDIS_URL ??= 'redis://127.0.0.1:6379/0';
});

describe('JWT access tokens', () => {
  it('round-trips a token (sign -> verify)', async () => {
    const { signAccessToken, verifyAccessToken } = await import('./jwt.js');
    const token = await signAccessToken({ sub: 'usr_abc123', plan: 'free' });
    const claims = await verifyAccessToken(token);
    expect(claims).toEqual({ sub: 'usr_abc123', plan: 'free', authVersion: 0 });
  });

  it('round-trips the session invalidation version', async () => {
    const { signAccessToken, verifyAccessToken } = await import('./jwt.js');
    const token = await signAccessToken({
      sub: 'usr_versioned',
      plan: 'pro',
      authVersion: 3,
    });
    await expect(verifyAccessToken(token)).resolves.toEqual({
      sub: 'usr_versioned',
      plan: 'pro',
      authVersion: 3,
    });
  });

  it('returns null for a tampered token', async () => {
    const { signAccessToken, verifyAccessToken } = await import('./jwt.js');
    const token = await signAccessToken({ sub: 'usr_xyz', plan: 'pro' });
    const tampered = `${token.slice(0, -2)}xx`;
    expect(await verifyAccessToken(tampered)).toBeNull();
  });

  it('returns null for nonsense input', async () => {
    const { verifyAccessToken } = await import('./jwt.js');
    expect(await verifyAccessToken('not.a.jwt')).toBeNull();
    expect(await verifyAccessToken('')).toBeNull();
  });
});
