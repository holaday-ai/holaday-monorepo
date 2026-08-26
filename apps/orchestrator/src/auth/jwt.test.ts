import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

beforeAll(() => {
  process.env.JWT_SECRET ??= 'test-secret-must-be-at-least-32-characters-long-yes';
  process.env.DATABASE_URL ??= 'mysql://test:test@127.0.0.1:3306/test';
  process.env.REDIS_URL ??= 'redis://127.0.0.1:6379/0';
});

describe('JWT access tokens', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

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

  it('round-trips a trusted internal task origin for the eval runner', async () => {
    const { signAccessToken, verifyAccessToken } = await import('./jwt.js');
    const token = await signAccessToken({
      sub: 'usr_eval_runner',
      plan: 'free',
      taskOrigin: 'eval',
    });

    await expect(verifyAccessToken(token)).resolves.toEqual({
      sub: 'usr_eval_runner',
      plan: 'free',
      authVersion: 0,
      taskOrigin: 'eval',
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

  it('keeps short-lived MFA challenges separate from access tokens', async () => {
    const { signMfaChallengeToken, verifyAccessToken, verifyMfaChallengeToken } = await import(
      './jwt.js'
    );
    const token = await signMfaChallengeToken({ sub: 'usr_mfa', authVersion: 7 });
    await expect(verifyMfaChallengeToken(token)).resolves.toEqual({
      sub: 'usr_mfa',
      authVersion: 7,
    });
    await expect(verifyAccessToken(token)).resolves.toBeNull();
  });

  it('rejects an access token as an MFA challenge', async () => {
    const { signAccessToken, verifyMfaChallengeToken } = await import('./jwt.js');
    const token = await signAccessToken({ sub: 'usr_regular', plan: 'free', authVersion: 0 });
    await expect(verifyMfaChallengeToken(token)).resolves.toBeNull();
  });

  it('keeps account-closure recovery credentials separate from access tokens', async () => {
    const {
      signAccountClosureRecoveryToken,
      verifyAccessToken,
      verifyAccountClosureRecoveryToken,
    } = await import('./jwt.js');
    const token = await signAccountClosureRecoveryToken({
      sub: 'usr_closure_pending',
      requestId: 'acl_req_123',
      authVersion: 9,
    });

    await expect(verifyAccountClosureRecoveryToken(token)).resolves.toEqual({
      sub: 'usr_closure_pending',
      requestId: 'acl_req_123',
      authVersion: 9,
      aud: 'account-closure-recovery',
    });
    await expect(verifyAccessToken(token)).resolves.toBeNull();
  });

  it('rejects access and MFA tokens as account-closure recovery credentials', async () => {
    const { signAccessToken, signMfaChallengeToken, verifyAccountClosureRecoveryToken } =
      await import('./jwt.js');
    const access = await signAccessToken({ sub: 'usr_active', plan: 'free', authVersion: 1 });
    const mfa = await signMfaChallengeToken({ sub: 'usr_active', authVersion: 1 });

    await expect(verifyAccountClosureRecoveryToken(access)).resolves.toBeNull();
    await expect(verifyAccountClosureRecoveryToken(mfa)).resolves.toBeNull();
  });

  it('expires account-closure recovery credentials after ten minutes', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-26T00:00:00.000Z'));
    const { signAccountClosureRecoveryToken, verifyAccountClosureRecoveryToken } = await import(
      './jwt.js'
    );
    const token = await signAccountClosureRecoveryToken({
      sub: 'usr_closure_pending',
      requestId: 'acl_req_expiring',
      authVersion: 2,
    });

    vi.setSystemTime(new Date('2026-08-26T00:10:01.000Z'));
    await expect(verifyAccountClosureRecoveryToken(token)).resolves.toBeNull();
  });
});
