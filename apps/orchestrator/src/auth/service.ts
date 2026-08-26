import { newExternalId } from '@holaday/shared-types';
import { type SQL, and, eq, or, sql } from 'drizzle-orm';
import type { DB } from '../db/client.js';
import { readAffectedRows } from '../db/mysql-result.js';
import { accountClosureRequests } from '../db/schema/account-closures.js';
import { users } from '../db/schema/users.js';
import { signAccessToken, signAccountClosureRecoveryToken, signMfaChallengeToken } from './jwt.js';
import { hashPassword, verifyPassword } from './password.js';

export interface PublicUser {
  externalId: string;
  /** Nullable since Phase 12 — SMS-first users have no email yet. */
  email: string | null;
  plan: string;
  displayName: string | null;
  avatarUrl: string | null;
  createdAt: Date;
}

export interface GoogleProfile {
  email: string;
  googleId: string;
  name?: string | null;
  avatarUrl?: string | null;
}

export interface AuthenticatedResult {
  user: PublicUser;
  accessToken: string;
  mfaRequired?: false;
}

export interface MfaRequiredResult {
  user: PublicUser;
  mfaRequired: true;
  mfaToken: string;
}

export interface ClosureRecoveryRequiredResult {
  user: PublicUser;
  closureRecoveryRequired: true;
  recoveryToken: string;
  closureStatus: 'pending_grace' | 'processing' | 'needs_attention';
}

export type LoginResult = AuthenticatedResult | MfaRequiredResult | ClosureRecoveryRequiredResult;
export type AuthResult = AuthenticatedResult;

export function isClosureRecoveryResult(
  result: LoginResult,
): result is ClosureRecoveryRequiredResult {
  return 'closureRecoveryRequired' in result && result.closureRecoveryRequired === true;
}

export class AuthError extends Error {
  constructor(
    public readonly code: 'EMAIL_TAKEN' | 'INVALID_CREDENTIALS',
    message: string,
  ) {
    super(message);
    this.name = 'AuthError';
  }
}

export interface RegisterInput {
  email: string;
  password: string;
  displayName?: string;
}

export interface LoginInput {
  email: string;
  password: string;
}

export class AuthService {
  constructor(private readonly db: DB) {}

  async register(input: RegisterInput): Promise<AuthResult> {
    const email = input.email.trim().toLowerCase();

    const existing = await this.db.select().from(users).where(eq(users.email, email)).limit(1);
    if (existing.length > 0) {
      throw new AuthError('EMAIL_TAKEN', 'email already registered');
    }

    const externalId = newExternalId('user');
    const passwordHash = await hashPassword(input.password);

    await this.db.insert(users).values({
      externalId,
      email,
      passwordHash,
      displayName: input.displayName ?? null,
    });

    const [row] = await this.db
      .select()
      .from(users)
      .where(eq(users.externalId, externalId))
      .limit(1);

    if (!row) {
      // Should be unreachable; insert succeeded above.
      throw new Error('user disappeared after insert');
    }

    const accessToken = await issueAccessToken(row);

    return { user: toPublic(row), accessToken };
  }

  /**
   * Passwordless email-code login. Caller has already validated the
   * verification code; we just issue a token for the matching user,
   * creating one if the email is new (email-code flow doubles as
   * signup — no password set, user can add one via settings later).
   */
  async loginOrRegisterByEmail(email: string): Promise<LoginResult> {
    const normalized = email.trim().toLowerCase();
    const [existing] = await this.db
      .select()
      .from(users)
      .where(eq(users.email, normalized))
      .limit(1);
    if (existing) {
      return issueLoginResult(this.db, existing);
    }
    const externalId = newExternalId('user');
    // Stash a random, un-learnable password hash so the password login
    // path still refuses (email-code users can /auth/setPassword later).
    const passwordHash = await hashPassword(
      `email-code-only-${externalId}-${Math.random().toString(36).slice(2)}`,
    );
    await this.db.insert(users).values({ externalId, email: normalized, passwordHash });
    const [row] = await this.db
      .select()
      .from(users)
      .where(eq(users.externalId, externalId))
      .limit(1);
    if (!row) throw new Error('user disappeared after insert');
    const accessToken = await issueAccessToken(row);
    return { user: toPublic(row), accessToken };
  }

  /**
   * Google-OAuth identity resolution. Three lanes:
   *   1. row matched by google_id → return it (user came back through Google)
   *   2. row matched by email     → link google_id + refresh avatar/displayName
   *                                 (legacy password account adopting Google)
   *   3. no match                 → create a fresh row, email_verified=true
   *                                 because Google already verified it
   *
   * Always returns email_verified=true on the resulting row — Google
   * gates this method behind its own email_verified check at the OAuth
   * layer, so by the time we get here, ownership is proven.
   */
  async loginOrRegisterByGoogle(profile: GoogleProfile): Promise<LoginResult> {
    const email = profile.email.trim().toLowerCase();
    const [existing] = await this.db
      .select()
      .from(users)
      .where(or(eq(users.googleId, profile.googleId), eq(users.email, email)))
      .limit(1);

    if (existing) {
      if (existing.status !== 'active') {
        return issueLoginResult(this.db, existing);
      }
      const patch: Partial<typeof users.$inferInsert> = {};
      if (!existing.googleId) patch.googleId = profile.googleId;
      if (!existing.emailVerified) patch.emailVerified = true;
      if (profile.avatarUrl && profile.avatarUrl !== existing.avatarUrl) {
        patch.avatarUrl = profile.avatarUrl;
      }
      if (profile.name && !existing.displayName) patch.displayName = profile.name;
      if (Object.keys(patch).length > 0) {
        return updateActiveUserAndIssue(this.db, existing, patch, 'google upsert');
      }
      const [row] = await this.db.select().from(users).where(eq(users.id, existing.id)).limit(1);
      if (!row) throw new Error('user disappeared after google upsert');
      return issueLoginResult(this.db, row);
    }

    // Fresh user. Sentinel password hash so the password-login path
    // can never authenticate them — they must come back via Google.
    const externalId = newExternalId('user');
    const passwordHash = await hashPassword(
      `google-only-${externalId}-${Math.random().toString(36).slice(2)}`,
    );
    await this.db.insert(users).values({
      externalId,
      email,
      passwordHash,
      googleId: profile.googleId,
      avatarUrl: profile.avatarUrl ?? null,
      displayName: profile.name ?? null,
      emailVerified: true,
    });
    const [row] = await this.db
      .select()
      .from(users)
      .where(eq(users.externalId, externalId))
      .limit(1);
    if (!row) throw new Error('user disappeared after insert');
    const accessToken = await issueAccessToken(row);
    return { user: toPublic(row), accessToken };
  }

  /**
   * Replace the user's password hash. Caller must have already
   * verified proof of ownership (we use an email verification code in
   * the forgot-password flow). Returns the updated user + a fresh
   * access token so the frontend can log them in immediately.
   */
  async resetPasswordByEmail(email: string, newPassword: string): Promise<LoginResult> {
    const normalized = email.trim().toLowerCase();
    const [existing] = await this.db
      .select()
      .from(users)
      .where(eq(users.email, normalized))
      .limit(1);
    if (!existing) {
      throw new AuthError('INVALID_CREDENTIALS', 'email not registered');
    }
    if (existing.status !== 'active') {
      return issueLoginResult(this.db, existing);
    }
    const passwordHash = await hashPassword(newPassword);
    return updateActiveUserAndIssue(
      this.db,
      existing,
      {
        passwordHash,
        authVersion: sql`${users.authVersion} + 1`,
      },
      'password reset',
    );
  }

  /**
   * Change the password for the already-authenticated account. The router
   * verifies an account-bound password-change code before calling this method.
   * Incrementing authVersion invalidates every previously issued access token;
   * the returned token keeps the current device signed in at the new version.
   */
  async changePasswordForUser(externalId: string, newPassword: string): Promise<AuthResult> {
    const [existing] = await this.db
      .select()
      .from(users)
      .where(eq(users.externalId, externalId))
      .limit(1);
    if (!existing) {
      throw new AuthError('INVALID_CREDENTIALS', 'account not found');
    }
    if (existing.status !== 'active') {
      throw new AuthError('INVALID_CREDENTIALS', 'account not found');
    }
    const passwordHash = await hashPassword(newPassword);
    const updateResult = await this.db
      .update(users)
      .set({
        passwordHash,
        authVersion: sql`${users.authVersion} + 1`,
      })
      .where(
        and(
          eq(users.id, existing.id),
          eq(users.status, 'active'),
          eq(users.authVersion, existing.authVersion),
        ),
      );
    const [updated] = await this.db.select().from(users).where(eq(users.id, existing.id)).limit(1);
    if (!updated) throw new Error('user disappeared after password change');
    if (readAffectedRows(updateResult) !== 1 || updated.status !== 'active') {
      throw new AuthError('INVALID_CREDENTIALS', 'account not found');
    }
    const accessToken = await issueAccessToken(updated);
    return { user: toPublic(updated), accessToken };
  }

  /**
   * SMS-code login. Caller (the cn-payment gateway via the internal
   * /api/internal/auth/sms-login endpoint) has already validated the
   * verification code; we just upsert by phone and issue a token.
   *
   * Three branches mirror the Google flow:
   *   1. row matched by phone → return + flip phone_verified=true
   *      if it wasn't already
   *   2. (no email-merge — phone is the primary key for SMS-first
   *      users; a user wanting to merge an email account onto their
   *      phone goes through /profile manually)
   *   3. no match → fresh row with phone set, sentinel password
   *      hash so the password lane never authenticates them, and a
   *      masked display_name like 138****1234 so the UI has
   *      something to show before they pick a real one.
   */
  async loginOrRegisterByPhone(phone: string): Promise<LoginResult> {
    const normalized = phone.trim();
    const [existing] = await this.db
      .select()
      .from(users)
      .where(eq(users.phone, normalized))
      .limit(1);
    if (existing) {
      if (existing.status !== 'active') {
        return issueLoginResult(this.db, existing);
      }
      if (!existing.phoneVerified) {
        return updateActiveUserAndIssue(
          this.db,
          existing,
          { phoneVerified: true },
          'sms verification',
        );
      }
      const [row] = await this.db.select().from(users).where(eq(users.id, existing.id)).limit(1);
      if (!row) throw new Error('user disappeared after sms verification');
      return issueLoginResult(this.db, row);
    }
    const externalId = newExternalId('user');
    const passwordHash = await hashPassword(
      `sms-only-${externalId}-${Math.random().toString(36).slice(2)}`,
    );
    // Default displayName: 用户_XXXX (last 4 digits of phone). The
    // previous "138****1234" exposed the full phone in every place
    // displayName surfaces (sidebar avatar, top greeting). 用户_XXXX
    // is short, doesn't leak the area code, and reads as "未起名"
    // which nudges users to set a real one in /settings.
    const last4 = normalized.slice(-4);
    const defaultName = `用户_${last4}`;
    await this.db.insert(users).values({
      externalId,
      email: null,
      passwordHash,
      phone: normalized,
      phoneVerified: true,
      displayName: defaultName,
    });
    const [row] = await this.db
      .select()
      .from(users)
      .where(eq(users.externalId, externalId))
      .limit(1);
    if (!row) throw new Error('user disappeared after sms insert');
    const accessToken = await issueAccessToken(row);
    return { user: toPublic(row), accessToken };
  }

  async login(input: LoginInput): Promise<LoginResult> {
    const email = input.email.trim().toLowerCase();

    const [row] = await this.db.select().from(users).where(eq(users.email, email)).limit(1);
    if (!row) {
      throw new AuthError('INVALID_CREDENTIALS', 'email or password incorrect');
    }
    const ok = await verifyPassword(row.passwordHash, input.password);
    if (!ok) {
      throw new AuthError('INVALID_CREDENTIALS', 'email or password incorrect');
    }

    return issueLoginResult(this.db, row);
  }
}

async function updateActiveUserAndIssue(
  database: DB,
  row: typeof users.$inferSelect,
  patch: {
    passwordHash?: string;
    authVersion?: number | SQL;
    googleId?: string | null;
    avatarUrl?: string | null;
    displayName?: string | null;
    emailVerified?: boolean;
    phoneVerified?: boolean;
  },
  operation: string,
): Promise<LoginResult> {
  const result = await database
    .update(users)
    .set(patch)
    .where(
      and(eq(users.id, row.id), eq(users.status, 'active'), eq(users.authVersion, row.authVersion)),
    );
  const [current] = await database.select().from(users).where(eq(users.id, row.id)).limit(1);
  if (!current) throw new Error(`user disappeared after ${operation}`);
  if (readAffectedRows(result) !== 1 && current.status === 'active') {
    throw new AuthError('INVALID_CREDENTIALS', 'email or password incorrect');
  }
  return issueLoginResult(database, current);
}

function toPublic(
  row: Pick<
    typeof users.$inferSelect,
    'externalId' | 'email' | 'plan' | 'displayName' | 'avatarUrl' | 'createdAt'
  >,
): PublicUser {
  return {
    externalId: row.externalId,
    email: row.email,
    plan: row.plan,
    displayName: row.displayName,
    avatarUrl: row.avatarUrl,
    createdAt: row.createdAt,
  };
}

function issueAccessToken(
  row: Pick<typeof users.$inferSelect, 'externalId' | 'plan' | 'authVersion'>,
): Promise<string> {
  return signAccessToken({
    sub: row.externalId,
    plan: row.plan,
    authVersion: row.authVersion,
  });
}

export async function issueLoginResult(
  database: DB,
  row: Pick<
    typeof users.$inferSelect,
    | 'id'
    | 'externalId'
    | 'plan'
    | 'authVersion'
    | 'status'
    | 'mfaEnabled'
    | 'email'
    | 'displayName'
    | 'avatarUrl'
    | 'createdAt'
  >,
  options: { mfaVerified?: boolean } = {},
): Promise<LoginResult> {
  if (row.status === 'suspended' || row.status === 'closed') {
    throw new AuthError('INVALID_CREDENTIALS', 'email or password incorrect');
  }
  if (row.status === 'closure_pending' || row.status === 'closure_processing') {
    const [request] = await database
      .select({
        externalId: accountClosureRequests.externalId,
        status: accountClosureRequests.status,
      })
      .from(accountClosureRequests)
      .where(eq(accountClosureRequests.activeUserId, row.id))
      .limit(1);
    if (!request) {
      throw new AuthError('INVALID_CREDENTIALS', 'email or password incorrect');
    }
    let closureStatus: ClosureRecoveryRequiredResult['closureStatus'];
    if (row.status === 'closure_pending' && request.status === 'pending_grace') {
      closureStatus = 'pending_grace';
    } else if (
      row.status === 'closure_processing' &&
      (request.status === 'processing' || request.status === 'needs_attention')
    ) {
      closureStatus = request.status;
    } else {
      throw new AuthError('INVALID_CREDENTIALS', 'email or password incorrect');
    }
    return {
      user: toPublic(row),
      closureRecoveryRequired: true,
      recoveryToken: await signAccountClosureRecoveryToken({
        sub: row.externalId,
        requestId: request.externalId,
        authVersion: row.authVersion,
      }),
      closureStatus,
    };
  }
  if (row.mfaEnabled && !options.mfaVerified) {
    return {
      user: toPublic(row),
      mfaRequired: true,
      mfaToken: await signMfaChallengeToken({
        sub: row.externalId,
        authVersion: row.authVersion,
      }),
    };
  }
  return {
    user: toPublic(row),
    accessToken: await issueAccessToken(row),
  };
}
