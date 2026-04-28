import { newExternalId } from '@holaday/shared-types';
import { eq, or } from 'drizzle-orm';
import type { DB } from '../db/client.js';
import { users } from '../db/schema/users.js';
import { signAccessToken } from './jwt.js';
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

export interface AuthResult {
  user: PublicUser;
  accessToken: string;
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

    const accessToken = await signAccessToken({ sub: row.externalId, plan: row.plan });

    return { user: toPublic(row), accessToken };
  }

  /**
   * Passwordless email-code login. Caller has already validated the
   * verification code; we just issue a token for the matching user,
   * creating one if the email is new (email-code flow doubles as
   * signup — no password set, user can add one via settings later).
   */
  async loginOrRegisterByEmail(email: string): Promise<AuthResult> {
    const normalized = email.trim().toLowerCase();
    const [existing] = await this.db.select().from(users).where(eq(users.email, normalized)).limit(1);
    if (existing) {
      const accessToken = await signAccessToken({
        sub: existing.externalId,
        plan: existing.plan,
      });
      return { user: toPublic(existing), accessToken };
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
    const accessToken = await signAccessToken({ sub: row.externalId, plan: row.plan });
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
  async loginOrRegisterByGoogle(profile: GoogleProfile): Promise<AuthResult> {
    const email = profile.email.trim().toLowerCase();
    const [existing] = await this.db
      .select()
      .from(users)
      .where(or(eq(users.googleId, profile.googleId), eq(users.email, email)))
      .limit(1);

    if (existing) {
      const patch: Partial<typeof users.$inferInsert> = {};
      if (!existing.googleId) patch.googleId = profile.googleId;
      if (!existing.emailVerified) patch.emailVerified = true;
      if (profile.avatarUrl && profile.avatarUrl !== existing.avatarUrl) {
        patch.avatarUrl = profile.avatarUrl;
      }
      if (profile.name && !existing.displayName) patch.displayName = profile.name;
      if (Object.keys(patch).length > 0) {
        await this.db.update(users).set(patch).where(eq(users.id, existing.id));
      }
      const [row] = await this.db
        .select()
        .from(users)
        .where(eq(users.id, existing.id))
        .limit(1);
      if (!row) throw new Error('user disappeared after google upsert');
      const accessToken = await signAccessToken({ sub: row.externalId, plan: row.plan });
      return { user: toPublic(row), accessToken };
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
    const accessToken = await signAccessToken({ sub: row.externalId, plan: row.plan });
    return { user: toPublic(row), accessToken };
  }

  /**
   * Replace the user's password hash. Caller must have already
   * verified proof of ownership (we use an email verification code in
   * the forgot-password flow). Returns the updated user + a fresh
   * access token so the frontend can log them in immediately.
   */
  async resetPasswordByEmail(email: string, newPassword: string): Promise<AuthResult> {
    const normalized = email.trim().toLowerCase();
    const [existing] = await this.db.select().from(users).where(eq(users.email, normalized)).limit(1);
    if (!existing) {
      throw new AuthError('INVALID_CREDENTIALS', 'email not registered');
    }
    const passwordHash = await hashPassword(newPassword);
    await this.db.update(users).set({ passwordHash }).where(eq(users.id, existing.id));
    const accessToken = await signAccessToken({ sub: existing.externalId, plan: existing.plan });
    return { user: toPublic(existing), accessToken };
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
  async loginOrRegisterByPhone(phone: string): Promise<AuthResult> {
    const normalized = phone.trim();
    const [existing] = await this.db
      .select()
      .from(users)
      .where(eq(users.phone, normalized))
      .limit(1);
    if (existing) {
      if (!existing.phoneVerified) {
        await this.db
          .update(users)
          .set({ phoneVerified: true })
          .where(eq(users.id, existing.id));
      }
      const accessToken = await signAccessToken({
        sub: existing.externalId,
        plan: existing.plan,
      });
      return { user: toPublic(existing), accessToken };
    }
    const externalId = newExternalId('user');
    const passwordHash = await hashPassword(
      `sms-only-${externalId}-${Math.random().toString(36).slice(2)}`,
    );
    const masked = normalized.replace(/(\d{3})\d{4}(\d{4})/, '$1****$2');
    await this.db.insert(users).values({
      externalId,
      email: null,
      passwordHash,
      phone: normalized,
      phoneVerified: true,
      displayName: masked,
    });
    const [row] = await this.db
      .select()
      .from(users)
      .where(eq(users.externalId, externalId))
      .limit(1);
    if (!row) throw new Error('user disappeared after sms insert');
    const accessToken = await signAccessToken({ sub: row.externalId, plan: row.plan });
    return { user: toPublic(row), accessToken };
  }

  async login(input: LoginInput): Promise<AuthResult> {
    const email = input.email.trim().toLowerCase();

    const [row] = await this.db.select().from(users).where(eq(users.email, email)).limit(1);
    if (!row) {
      throw new AuthError('INVALID_CREDENTIALS', 'email or password incorrect');
    }
    const ok = await verifyPassword(row.passwordHash, input.password);
    if (!ok) {
      throw new AuthError('INVALID_CREDENTIALS', 'email or password incorrect');
    }

    const accessToken = await signAccessToken({ sub: row.externalId, plan: row.plan });
    return { user: toPublic(row), accessToken };
  }
}

function toPublic(row: typeof users.$inferSelect): PublicUser {
  return {
    externalId: row.externalId,
    email: row.email,
    plan: row.plan,
    displayName: row.displayName,
    avatarUrl: row.avatarUrl,
    createdAt: row.createdAt,
  };
}
