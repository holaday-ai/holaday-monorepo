import { and, eq, isNull, lt, sql } from 'drizzle-orm';
import type { DB } from '../db/client.js';
import { userMfaRecoveryCodes } from '../db/schema/user-mfa-recovery-codes.js';
import { users } from '../db/schema/users.js';
import { signAccessToken, verifyMfaChallengeToken } from './jwt.js';
import {
  decryptMfaSecret,
  encryptMfaSecret,
  generateRecoveryCodes,
  generateTotpSecret,
  hashRecoveryCode,
  normalizeRecoveryCode,
  verifyTotp,
} from './mfa.js';
import { type LoginResult, issueLoginResult } from './service.js';

const SETUP_TTL_MS = 10 * 60 * 1000;
const LOCK_MINUTES = 5;
const MAX_FAILED_ATTEMPTS = 5;

export class MfaError extends Error {
  constructor(
    public readonly code:
      | 'INVALID'
      | 'LOCKED'
      | 'NOT_ENABLED'
      | 'ALREADY_ENABLED'
      | 'SETUP_EXPIRED',
    message: string,
  ) {
    super(message);
    this.name = 'MfaError';
  }
}

type MfaUserRow = typeof users.$inferSelect;

export class MfaService {
  constructor(private readonly db: DB) {}

  async status(externalId: string): Promise<{ enabled: boolean; recoveryCodesRemaining: number }> {
    const row = await this.user(externalId);
    if (!row.mfaEnabled) return { enabled: false, recoveryCodesRemaining: 0 };
    const available = await this.db
      .select({ id: userMfaRecoveryCodes.id })
      .from(userMfaRecoveryCodes)
      .where(and(eq(userMfaRecoveryCodes.userId, row.id), isNull(userMfaRecoveryCodes.consumedAt)));
    return { enabled: true, recoveryCodesRemaining: available.length };
  }

  async beginSetup(externalId: string): Promise<{ secret: string; otpauthUri: string }> {
    const row = await this.user(externalId);
    if (row.mfaEnabled) {
      throw new MfaError('ALREADY_ENABLED', '双重验证已经开启');
    }
    const secret = generateTotpSecret();
    await this.db
      .update(users)
      .set({
        mfaSecretEncrypted: encryptMfaSecret(secret),
        mfaSetupCreatedAt: new Date(),
        mfaLastUsedStep: null,
      })
      .where(eq(users.id, row.id));
    const account = row.email ?? row.phone ?? row.externalId;
    const issuer = 'HOLA DAY';
    const label = `${issuer}:${account}`;
    const params = new URLSearchParams({
      secret,
      issuer,
      algorithm: 'SHA1',
      digits: '6',
      period: '30',
    });
    return {
      secret,
      otpauthUri: `otpauth://totp/${encodeURIComponent(label)}?${params.toString()}`,
    };
  }

  async confirmSetup(
    externalId: string,
    code: string,
  ): Promise<{ accessToken: string; recoveryCodes: string[] }> {
    const row = await this.user(externalId);
    if (row.mfaEnabled) throw new MfaError('ALREADY_ENABLED', '双重验证已经开启');
    if (
      !row.mfaSecretEncrypted ||
      !row.mfaSetupCreatedAt ||
      Date.now() - row.mfaSetupCreatedAt.getTime() > SETUP_TTL_MS
    ) {
      throw new MfaError('SETUP_EXPIRED', '设置已过期，请重新开始');
    }
    const checked = verifyTotp(decryptMfaSecret(row.mfaSecretEncrypted), code);
    if (!checked.valid) throw new MfaError('INVALID', '验证码不正确');
    const recoveryCodes = generateRecoveryCodes();
    await this.db.transaction(async (tx) => {
      await tx.delete(userMfaRecoveryCodes).where(eq(userMfaRecoveryCodes.userId, row.id));
      await tx.insert(userMfaRecoveryCodes).values(
        recoveryCodes.map((recoveryCode) => ({
          userId: row.id,
          codeHash: hashRecoveryCode(recoveryCode),
        })),
      );
      await tx
        .update(users)
        .set({
          mfaEnabled: true,
          mfaSetupCreatedAt: null,
          mfaLastUsedStep: checked.step,
          mfaFailedAttempts: 0,
          mfaLockedUntil: null,
          authVersion: sql`${users.authVersion} + 1`,
        })
        .where(eq(users.id, row.id));
    });
    const updated = await this.user(externalId);
    return { accessToken: await issueAccess(updated), recoveryCodes };
  }

  async verifyChallenge(mfaToken: string, code: string): Promise<LoginResult> {
    const claims = await verifyMfaChallengeToken(mfaToken);
    if (!claims) throw new MfaError('INVALID', '验证已过期，请重新登录');
    const row = await this.user(claims.sub);
    if (row.status === 'closure_pending' || row.status === 'closure_processing') {
      assertDirectPreFreezeVersion(row.authVersion, claims.authVersion);
      return issueLoginResult(this.db, row, { mfaVerified: true });
    }
    if (!row.mfaEnabled || !row.mfaSecretEncrypted || row.authVersion !== claims.authVersion) {
      throw new MfaError('INVALID', '验证已过期，请重新登录');
    }
    await this.verifyFactor(row, code);
    const refreshed = await this.user(claims.sub);
    if (refreshed.status === 'closure_pending' || refreshed.status === 'closure_processing') {
      assertDirectPreFreezeVersion(refreshed.authVersion, claims.authVersion);
      return issueLoginResult(this.db, refreshed, { mfaVerified: true });
    }
    if (refreshed.status !== 'active' || refreshed.authVersion !== claims.authVersion) {
      throw new MfaError('INVALID', '验证已过期，请重新登录');
    }
    return issueLoginResult(this.db, refreshed, { mfaVerified: true });
  }

  async verifyUserFactor(userExternalId: string, code: string): Promise<void> {
    const row = await this.user(userExternalId);
    await this.verifyFactor(row, code);
  }

  async regenerateRecoveryCodes(
    externalId: string,
    code: string,
  ): Promise<{ recoveryCodes: string[] }> {
    const row = await this.user(externalId);
    await this.verifyFactor(row, code);
    const recoveryCodes = generateRecoveryCodes();
    await this.db.transaction(async (tx) => {
      await tx.delete(userMfaRecoveryCodes).where(eq(userMfaRecoveryCodes.userId, row.id));
      await tx.insert(userMfaRecoveryCodes).values(
        recoveryCodes.map((recoveryCode) => ({
          userId: row.id,
          codeHash: hashRecoveryCode(recoveryCode),
        })),
      );
    });
    return { recoveryCodes };
  }

  async disable(externalId: string, code: string): Promise<{ accessToken: string }> {
    const row = await this.user(externalId);
    await this.verifyFactor(row, code);
    await this.db.transaction(async (tx) => {
      await tx.delete(userMfaRecoveryCodes).where(eq(userMfaRecoveryCodes.userId, row.id));
      await tx
        .update(users)
        .set({
          mfaEnabled: false,
          mfaSecretEncrypted: null,
          mfaSetupCreatedAt: null,
          mfaLastUsedStep: null,
          mfaFailedAttempts: 0,
          mfaLockedUntil: null,
          authVersion: sql`${users.authVersion} + 1`,
        })
        .where(eq(users.id, row.id));
    });
    const updated = await this.user(externalId);
    return { accessToken: await issueAccess(updated) };
  }

  private async user(externalId: string): Promise<MfaUserRow> {
    const [row] = await this.db
      .select()
      .from(users)
      .where(eq(users.externalId, externalId))
      .limit(1);
    if (!row) throw new MfaError('INVALID', '账号不存在');
    return row;
  }

  private async verifyFactor(row: MfaUserRow, code: string): Promise<void> {
    if (!row.mfaEnabled || !row.mfaSecretEncrypted) {
      throw new MfaError('NOT_ENABLED', '双重验证尚未开启');
    }
    if (row.mfaLockedUntil && row.mfaLockedUntil.getTime() > Date.now()) {
      throw new MfaError('LOCKED', '尝试次数过多，请稍后再试');
    }

    if (/^\d{6}$/.test(code.trim())) {
      const checked = verifyTotp(decryptMfaSecret(row.mfaSecretEncrypted), code);
      if (checked.valid && (row.mfaLastUsedStep === null || checked.step > row.mfaLastUsedStep)) {
        const result = await this.db
          .update(users)
          .set({
            mfaLastUsedStep: checked.step,
            mfaFailedAttempts: 0,
            mfaLockedUntil: null,
          })
          .where(
            and(
              eq(users.id, row.id),
              row.mfaLastUsedStep === null
                ? isNull(users.mfaLastUsedStep)
                : lt(users.mfaLastUsedStep, checked.step),
            ),
          );
        if (affectedRows(result) === 1) return;
      }
    } else if (/^[A-Z0-9-]{10,11}$/i.test(code.trim())) {
      const normalized = normalizeRecoveryCode(code);
      if (normalized.length === 10) {
        const [recovery] = await this.db
          .select({ id: userMfaRecoveryCodes.id })
          .from(userMfaRecoveryCodes)
          .where(
            and(
              eq(userMfaRecoveryCodes.userId, row.id),
              eq(userMfaRecoveryCodes.codeHash, hashRecoveryCode(normalized)),
              isNull(userMfaRecoveryCodes.consumedAt),
            ),
          )
          .limit(1);
        if (recovery) {
          const result = await this.db
            .update(userMfaRecoveryCodes)
            .set({ consumedAt: new Date() })
            .where(
              and(
                eq(userMfaRecoveryCodes.id, recovery.id),
                isNull(userMfaRecoveryCodes.consumedAt),
              ),
            );
          if (affectedRows(result) === 1) {
            await this.clearFailures(row.id);
            return;
          }
        }
      }
    }

    await this.recordFailure(row.id);
    throw new MfaError('INVALID', '验证码或恢复码不正确');
  }

  private async clearFailures(userId: number): Promise<void> {
    await this.db
      .update(users)
      .set({ mfaFailedAttempts: 0, mfaLockedUntil: null })
      .where(eq(users.id, userId));
  }

  private async recordFailure(userId: number): Promise<void> {
    for (let retry = 0; retry < 3; retry += 1) {
      const [current] = await this.db
        .select({
          failedAttempts: users.mfaFailedAttempts,
          lockedUntil: users.mfaLockedUntil,
        })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);
      if (!current) return;
      if (current.lockedUntil && current.lockedUntil.getTime() > Date.now()) return;
      const failedAttempts = current.failedAttempts + 1;
      const result = await this.db
        .update(users)
        .set({
          mfaFailedAttempts: failedAttempts,
          mfaLockedUntil:
            failedAttempts >= MAX_FAILED_ATTEMPTS
              ? new Date(Date.now() + LOCK_MINUTES * 60_000)
              : current.lockedUntil,
        })
        .where(and(eq(users.id, userId), eq(users.mfaFailedAttempts, current.failedAttempts)));
      if (affectedRows(result) === 1) return;
    }
    throw new MfaError('LOCKED', '尝试次数过多，请稍后再试');
  }
}

function assertDirectPreFreezeVersion(currentVersion: number, challengeVersion: number): void {
  if (currentVersion !== challengeVersion + 1) {
    throw new MfaError('INVALID', '验证已过期，请重新登录');
  }
}

function affectedRows(result: unknown): number {
  if (Array.isArray(result)) {
    const header = result[0] as { affectedRows?: unknown } | undefined;
    return typeof header?.affectedRows === 'number' ? header.affectedRows : 0;
  }
  const header = result as { affectedRows?: unknown };
  return typeof header?.affectedRows === 'number' ? header.affectedRows : 0;
}

function issueAccess(
  row: Pick<MfaUserRow, 'externalId' | 'plan' | 'authVersion'>,
): Promise<string> {
  return signAccessToken({
    sub: row.externalId,
    plan: row.plan,
    authVersion: row.authVersion,
  });
}
