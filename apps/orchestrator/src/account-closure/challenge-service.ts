import { createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { and, eq, isNull } from 'drizzle-orm';
import type { Logger } from 'pino';
import type { EmailSender } from '../auth/email-code.js';
import { env } from '../config/env.js';
import type { DB } from '../db/client.js';
import { accountClosureChallenges } from '../db/schema/account-closures.js';
import { users } from '../db/schema/users.js';
import type { AccountClosureChallengeAction, AccountClosureChannel } from './types.js';

export interface CreateClosureChallengeInput {
  userId: number;
  requestId?: number;
  action: AccountClosureChallengeAction;
}

export interface ClosureChallengeDelivery {
  challengeId: string;
  channel: AccountClosureChannel;
  maskedDestination: string;
  expiresAt: Date;
}

export interface VerifyClosureChallengeInput extends CreateClosureChallengeInput {
  challengeId: string;
  code: string;
}

interface ChallengeServiceDependencies {
  emailSender: EmailSender;
  smsGateway: {
    sendAccountClosureCode(
      rawPhone: string,
      code: string,
      action: AccountClosureChallengeAction,
    ): Promise<void>;
  };
  logger: Pick<Logger, 'error'>;
}

export class AccountClosureChallengeError extends Error {
  constructor(
    public readonly code:
      | 'INVALID'
      | 'USED'
      | 'EXPIRED'
      | 'LOCKED'
      | 'NO_VERIFIED_DESTINATION'
      | 'DELIVERY_FAILED',
  ) {
    super(
      code === 'NO_VERIFIED_DESTINATION'
        ? 'No verified account-closure destination is available'
        : code === 'DELIVERY_FAILED'
          ? 'Account closure challenge delivery failed'
          : 'Account closure challenge is invalid',
    );
    this.name = 'AccountClosureChallengeError';
  }
}

const CHALLENGE_TTL_MS = 10 * 60 * 1_000;
const MAX_FAILED_ATTEMPTS = 5;
const HASH_VERSION = 'v1';

export class AccountClosureChallengeService {
  constructor(
    private readonly db: DB,
    private readonly dependencies: ChallengeServiceDependencies,
  ) {}

  async createChallenge(input: CreateClosureChallengeInput): Promise<ClosureChallengeDelivery> {
    const [user] = await this.db
      .select({
        email: users.email,
        emailVerified: users.emailVerified,
        phone: users.phone,
        phoneVerified: users.phoneVerified,
      })
      .from(users)
      .where(eq(users.id, input.userId))
      .limit(1);
    const destination = selectDestination(user);
    if (!destination) throw new AccountClosureChallengeError('NO_VERIFIED_DESTINATION');

    const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
    const challengeId = `ach_${randomBytes(12).toString('base64url')}`;
    const createdAt = new Date();
    const expiresAt = new Date(createdAt.getTime() + CHALLENGE_TTL_MS);
    await this.db.insert(accountClosureChallenges).values({
      externalId: challengeId,
      userId: input.userId,
      requestId: input.requestId,
      action: input.action,
      channel: destination.channel,
      codeHash: hashCode(code),
      expiresAt,
      createdAt,
    });

    try {
      if (destination.channel === 'email') {
        await this.dependencies.emailSender.send({
          to: destination.value,
          subject:
            input.action === 'begin' ? 'HOLA DAY 关闭账号验证码' : 'HOLA DAY 撤回账号关闭验证码',
          text: `你的验证码是：${code}\n\n10 分钟内有效。如果这不是你本人操作，请忽略此邮件。`,
        });
      } else {
        await this.dependencies.smsGateway.sendAccountClosureCode(
          destination.value,
          code,
          input.action,
        );
      }
    } catch {
      await this.db
        .update(accountClosureChallenges)
        .set({ expiresAt: createdAt })
        .where(
          and(
            eq(accountClosureChallenges.externalId, challengeId),
            isNull(accountClosureChallenges.usedAt),
          ),
        );
      this.dependencies.logger.error(
        {
          kind: 'account_closure_challenge_delivery',
          challengeId,
          action: input.action,
          channel: destination.channel,
          errorCode: 'provider_unavailable',
        },
        'account closure challenge delivery failed',
      );
      throw new AccountClosureChallengeError('DELIVERY_FAILED');
    }

    return {
      challengeId,
      channel: destination.channel,
      maskedDestination: maskDestination(destination),
      expiresAt,
    };
  }

  async verifyChallenge(input: VerifyClosureChallengeInput): Promise<void> {
    const failure = await this.db.transaction(async (tx) => {
      const [challenge] = await tx
        .select()
        .from(accountClosureChallenges)
        .where(eq(accountClosureChallenges.externalId, input.challengeId))
        .limit(1)
        .for('update');
      if (
        !challenge ||
        challenge.userId !== input.userId ||
        challenge.action !== input.action ||
        challenge.requestId !== (input.requestId ?? null)
      ) {
        return 'INVALID' as const;
      }
      if (challenge.usedAt) return 'USED' as const;
      if (Date.now() >= challenge.expiresAt.getTime()) {
        return 'EXPIRED' as const;
      }
      if (challenge.attemptCount >= MAX_FAILED_ATTEMPTS) {
        return 'LOCKED' as const;
      }
      if (!matchesCode(input.code.trim(), challenge.codeHash)) {
        await tx
          .update(accountClosureChallenges)
          .set({ attemptCount: challenge.attemptCount + 1 })
          .where(eq(accountClosureChallenges.id, challenge.id));
        return 'INVALID' as const;
      }
      const result = await tx
        .update(accountClosureChallenges)
        .set({ usedAt: new Date() })
        .where(
          and(
            eq(accountClosureChallenges.id, challenge.id),
            isNull(accountClosureChallenges.usedAt),
          ),
        );
      return affectedRows(result) === 1 ? null : ('USED' as const);
    });
    if (failure) throw new AccountClosureChallengeError(failure);
  }
}

type Destination = { channel: 'email'; value: string } | { channel: 'sms'; value: string };

function selectDestination(
  user:
    | {
        email: string | null;
        emailVerified: boolean;
        phone: string | null;
        phoneVerified: boolean;
      }
    | undefined,
): Destination | null {
  if (user?.emailVerified && user.email) return { channel: 'email', value: user.email };
  if (user?.phoneVerified && user.phone) return { channel: 'sms', value: user.phone };
  return null;
}

function maskDestination(destination: Destination): string {
  if (destination.channel === 'sms') {
    return destination.value.replace(/^(\d{3})\d+(\d{4})$/, '$1****$2');
  }
  const at = destination.value.lastIndexOf('@');
  if (at <= 0) return '***';
  const local = destination.value.slice(0, at);
  const domain = destination.value.slice(at);
  const maskedLocal = local.length === 1 ? '*' : `${local[0]}***${local[local.length - 1]}`;
  return `${maskedLocal}${domain}`;
}

function hashCode(code: string): string {
  const salt = randomBytes(16).toString('base64url');
  return `${HASH_VERSION}$${salt}$${codeDigest(salt, code)}`;
}

function matchesCode(code: string, stored: string): boolean {
  const [version, salt, digest] = stored.split('$');
  if (version !== HASH_VERSION || !salt || !digest) return false;
  const expected = Buffer.from(digest, 'base64url');
  const candidate = Buffer.from(codeDigest(salt, code), 'base64url');
  return expected.length === candidate.length && timingSafeEqual(expected, candidate);
}

function codeDigest(salt: string, code: string): string {
  return createHmac('sha256', env.JWT_SECRET)
    .update(salt)
    .update('\0')
    .update(code)
    .digest('base64url');
}

function affectedRows(result: unknown): number {
  if (Array.isArray(result)) {
    const header = result[0] as { affectedRows?: unknown } | undefined;
    return typeof header?.affectedRows === 'number' ? header.affectedRows : 0;
  }
  const header = result as { affectedRows?: unknown };
  return typeof header?.affectedRows === 'number' ? header.affectedRows : 0;
}
