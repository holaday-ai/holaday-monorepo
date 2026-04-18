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
