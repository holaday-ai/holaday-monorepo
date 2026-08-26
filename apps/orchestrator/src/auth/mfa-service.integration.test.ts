import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

beforeAll(() => {
  process.env.DATABASE_URL ??= 'mysql://holaday:holaday-dev@127.0.0.1:3306/holaday';
  process.env.REDIS_URL ??= 'redis://127.0.0.1:6379/0';
  process.env.JWT_SECRET ??= 'integration-test-secret-must-be-32-chars-or-more-please';
  process.env.MFA_MASTER_KEY = randomBytes(32).toString('base64');
});

describe('MfaService', () => {
  let cleanup: () => Promise<void> = async () => {};

  beforeAll(async () => {
    const { applyMigrations } = await import('../test/db-helper.js');
    await applyMigrations(process.env.DATABASE_URL as string);
    const { pool } = await import('../db/client.js');
    cleanup = () => pool.end();
  });

  afterAll(async () => {
    vi.useRealTimers();
    await cleanup();
  });

  it('enables TOTP, blocks replay, and consumes a recovery code once', async () => {
    const baseTime = new Date('2026-08-23T00:00:00.000Z');
    vi.useFakeTimers();
    vi.setSystemTime(baseTime);

    const { db } = await import('../db/client.js');
    const { users } = await import('../db/schema/users.js');
    const { hashPassword } = await import('./password.js');
    const { AuthService } = await import('./service.js');
    const { MfaService } = await import('./mfa-service.js');
    const { totpAt } = await import('./mfa.js');

    const externalId = `usr_mfa_${Date.now()}`;
    const email = `mfa+${Date.now()}@example.com`;
    await db.insert(users).values({
      externalId,
      email,
      passwordHash: await hashPassword('password-42'),
    });

    const mfa = new MfaService(db);
    const setup = await mfa.beginSetup(externalId);
    const setupCode = totpAt(setup.secret, baseTime.getTime());
    const enabled = await mfa.confirmSetup(externalId, setupCode);
    expect(enabled.recoveryCodes).toHaveLength(10);
    await expect(mfa.status(externalId)).resolves.toEqual({
      enabled: true,
      recoveryCodesRemaining: 10,
    });

    vi.setSystemTime(new Date(baseTime.getTime() + 30_000));
    const directFactorCode = totpAt(setup.secret, Date.now());
    await expect(mfa.verifyUserFactor(externalId, directFactorCode)).resolves.toBeUndefined();
    await expect(mfa.verifyUserFactor(externalId, directFactorCode)).rejects.toMatchObject({
      code: 'INVALID',
    });

    const login = await new AuthService(db).login({ email, password: 'password-42' });
    expect(login).toMatchObject({ mfaRequired: true });
    if (!('mfaToken' in login)) throw new Error('expected MFA challenge');

    vi.setSystemTime(new Date(baseTime.getTime() + 60_000));
    const loginCode = totpAt(setup.secret, Date.now());
    await expect(mfa.verifyChallenge(login.mfaToken, loginCode)).resolves.toHaveProperty(
      'accessToken',
    );

    const replayLogin = await new AuthService(db).login({ email, password: 'password-42' });
    if (!('mfaToken' in replayLogin)) throw new Error('expected MFA challenge');
    await expect(mfa.verifyChallenge(replayLogin.mfaToken, loginCode)).rejects.toMatchObject({
      code: 'INVALID',
    });

    const recoveryLogin = await new AuthService(db).login({ email, password: 'password-42' });
    if (!('mfaToken' in recoveryLogin)) throw new Error('expected MFA challenge');
    const recoveryCode = enabled.recoveryCodes[0] ?? '';
    await expect(mfa.verifyChallenge(recoveryLogin.mfaToken, recoveryCode)).resolves.toHaveProperty(
      'accessToken',
    );
    await expect(mfa.status(externalId)).resolves.toEqual({
      enabled: true,
      recoveryCodesRemaining: 9,
    });

    const consumedLogin = await new AuthService(db).login({ email, password: 'password-42' });
    if (!('mfaToken' in consumedLogin)) throw new Error('expected MFA challenge');
    await expect(mfa.verifyChallenge(consumedLogin.mfaToken, recoveryCode)).rejects.toMatchObject({
      code: 'INVALID',
    });

    for (let attempt = 0; attempt < 4; attempt += 1) {
      const failedLogin = await new AuthService(db).login({ email, password: 'password-42' });
      if (!('mfaToken' in failedLogin)) throw new Error('expected MFA challenge');
      await expect(mfa.verifyChallenge(failedLogin.mfaToken, '00000-00000')).rejects.toMatchObject({
        code: 'INVALID',
      });
    }
    const lockedLogin = await new AuthService(db).login({ email, password: 'password-42' });
    if (!('mfaToken' in lockedLogin)) throw new Error('expected MFA challenge');
    await expect(
      mfa.verifyChallenge(lockedLogin.mfaToken, enabled.recoveryCodes[1] ?? ''),
    ).rejects.toMatchObject({ code: 'LOCKED' });
  });
});
