import { newExternalId } from '@holaday/shared-types';
import { eq } from 'drizzle-orm';
import type { DB } from '../db/client.js';
import { users } from '../db/schema/users.js';
import { signAccessToken } from './jwt.js';
import { hashPassword, verifyPassword } from './password.js';

export interface PublicUser {
  externalId: string;
  email: string;
  plan: string;
  displayName: string | null;
  createdAt: Date;
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
    createdAt: row.createdAt,
  };
}
