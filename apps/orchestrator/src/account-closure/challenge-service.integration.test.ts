import { randomBytes } from 'node:crypto';
import { and, eq, inArray } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { type PrivateEmailSender, resendSender } from '../auth/email-code.js';
import { logger as productionLogger } from '../config/logger.js';
import { accountClosureChallenges } from '../db/schema/account-closures.js';
import { users } from '../db/schema/users.js';
import {
  AccountClosureChallengeError,
  AccountClosureChallengeService,
} from './challenge-service.js';

describe.sequential('AccountClosureChallengeService', () => {
  const userIds: number[] = [];
  let cleanup: () => Promise<void> = async () => {};

  beforeAll(async () => {
    const { applyMigrations } = await import('../test/db-helper.js');
    await applyMigrations(process.env.DATABASE_URL as string);
    const { pool } = await import('../db/client.js');
    cleanup = () => pool.end();
  });

  afterEach(async () => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    if (userIds.length === 0) return;
    const { db } = await import('../db/client.js');
    await db
      .delete(accountClosureChallenges)
      .where(inArray(accountClosureChallenges.userId, userIds));
    await db.delete(users).where(inArray(users.id, userIds));
    userIds.length = 0;
  });

  afterAll(async () => {
    await cleanup();
  });

  async function createUser(input: {
    email?: string;
    emailVerified?: boolean;
    phone?: string;
    phoneVerified?: boolean;
  }): Promise<number> {
    const { db } = await import('../db/client.js');
    const suffix = randomBytes(8).toString('hex');
    const [result] = await db.insert(users).values({
      externalId: `usr_acl_${suffix}`,
      email: input.email,
      emailVerified: input.emailVerified ?? false,
      phone: input.phone,
      phoneVerified: input.phoneVerified ?? false,
      passwordHash: 'not-a-real-password',
    });
    const userId = Number(result.insertId);
    userIds.push(userId);
    return userId;
  }

  function deliveryDoubles() {
    const emails: Array<{ to: string; subject: string; text: string }> = [];
    const sms: Array<{ phone: string; code: string; action: 'begin' | 'cancel' }> = [];
    const logs: unknown[] = [];
    const emailSender: PrivateEmailSender = {
      privateDelivery: true,
      isAvailable: () => true,
      async send(message) {
        emails.push(message);
      },
    };
    return {
      emails,
      sms,
      logs,
      emailSender,
      smsGateway: {
        async sendAccountClosureCode(phone: string, code: string, action: 'begin' | 'cancel') {
          sms.push({ phone, code, action });
        },
      },
      logger: {
        error(fields: unknown) {
          logs.push(fields);
        },
      },
    };
  }

  it('selects verified email before phone and returns only a masked destination', async () => {
    const { db } = await import('../db/client.js');
    const userId = await createUser({
      email: 'owner@example.test',
      emailVerified: true,
      phone: '13800138000',
      phoneVerified: true,
    });
    const delivery = deliveryDoubles();
    const service = new AccountClosureChallengeService(db, delivery);

    const result = await service.createChallenge({ userId, action: 'begin' });

    expect(result).toMatchObject({
      channel: 'email',
      maskedDestination: 'o***r@example.test',
    });
    expect(result).not.toHaveProperty('code');
    expect(result).not.toHaveProperty('destination');
    expect(delivery.emails).toHaveLength(1);
    expect(delivery.sms).toHaveLength(0);
  });

  it('uses verified phone only when no verified email exists', async () => {
    const { db } = await import('../db/client.js');
    const userId = await createUser({ phone: '13800138000', phoneVerified: true });
    const delivery = deliveryDoubles();
    const service = new AccountClosureChallengeService(db, delivery);

    const result = await service.createChallenge({ userId, action: 'cancel' });

    expect(result).toMatchObject({ channel: 'sms', maskedDestination: '138****8000' });
    expect(delivery.sms).toHaveLength(1);
    expect(delivery.emails).toHaveLength(0);
  });

  it('persists only a salted hash before delivery and never logs raw secrets', async () => {
    const { db } = await import('../db/client.js');
    const rawEmail = 'private-owner@example.test';
    const userId = await createUser({ email: rawEmail, emailVerified: true });
    let persistedBeforeDelivery = false;
    let rawCode = '';
    const logs: unknown[] = [];
    const emailSender: PrivateEmailSender = {
      privateDelivery: true,
      isAvailable: () => true,
      async send(message) {
        rawCode = message.text.match(/\b\d{6}\b/)?.[0] ?? '';
        const rows = await db
          .select()
          .from(accountClosureChallenges)
          .where(eq(accountClosureChallenges.userId, userId));
        persistedBeforeDelivery = rows.length === 1;
      },
    };
    const service = new AccountClosureChallengeService(db, {
      emailSender,
      smsGateway: { async sendAccountClosureCode() {} },
      logger: {
        error(fields: unknown) {
          logs.push(fields);
        },
      },
    });

    const result = await service.createChallenge({ userId, action: 'begin' });
    const [row] = await db
      .select()
      .from(accountClosureChallenges)
      .where(eq(accountClosureChallenges.externalId, result.challengeId));

    expect(persistedBeforeDelivery).toBe(true);
    expect(rawCode).toMatch(/^\d{6}$/);
    expect(row?.codeHash).toMatch(/^v1\$[A-Za-z0-9_-]+\$[A-Za-z0-9_-]+$/);
    expect(row?.codeHash).not.toContain(rawCode);
    expect(JSON.stringify(row)).not.toContain(rawEmail);
    expect(JSON.stringify(logs)).not.toContain(rawEmail);
    expect(JSON.stringify(logs)).not.toContain(rawCode);
  });

  it('isolates begin and cancel purposes and consumes a correct code once', async () => {
    const { db } = await import('../db/client.js');
    const userId = await createUser({ email: 'purpose@example.test', emailVerified: true });
    const delivery = deliveryDoubles();
    const service = new AccountClosureChallengeService(db, delivery);
    const challenge = await service.createChallenge({ userId, action: 'begin' });
    const code = delivery.emails[0]?.text.match(/\b\d{6}\b/)?.[0] ?? '';

    await expect(
      service.verifyChallenge({
        challengeId: challenge.challengeId,
        userId,
        action: 'cancel',
        code,
      }),
    ).rejects.toMatchObject({ code: 'INVALID' });
    await expect(
      service.verifyChallenge({
        challengeId: challenge.challengeId,
        userId,
        action: 'begin',
        code,
      }),
    ).resolves.toBeUndefined();
    await expect(
      service.verifyChallenge({
        challengeId: challenge.challengeId,
        userId,
        action: 'begin',
        code,
      }),
    ).rejects.toMatchObject({ code: 'USED' });
  });

  it('expires a code at the ten-minute deadline', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-26T01:00:00.000Z'));
    const { db } = await import('../db/client.js');
    const userId = await createUser({ email: 'expiry@example.test', emailVerified: true });
    const delivery = deliveryDoubles();
    const service = new AccountClosureChallengeService(db, delivery);
    const challenge = await service.createChallenge({ userId, action: 'begin' });
    const code = delivery.emails[0]?.text.match(/\b\d{6}\b/)?.[0] ?? '';

    vi.setSystemTime(new Date('2026-08-26T01:10:00.000Z'));
    await expect(
      service.verifyChallenge({
        challengeId: challenge.challengeId,
        userId,
        action: 'begin',
        code,
      }),
    ).rejects.toMatchObject({ code: 'EXPIRED' });
  });

  it('locks a challenge after five failed attempts', async () => {
    const { db } = await import('../db/client.js');
    const userId = await createUser({ email: 'lockout@example.test', emailVerified: true });
    const delivery = deliveryDoubles();
    const service = new AccountClosureChallengeService(db, delivery);
    const challenge = await service.createChallenge({ userId, action: 'begin' });
    const code = delivery.emails[0]?.text.match(/\b\d{6}\b/)?.[0] ?? '';
    const wrongCode = code === '000000' ? '999999' : '000000';

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await expect(
        service.verifyChallenge({
          challengeId: challenge.challengeId,
          userId,
          action: 'begin',
          code: wrongCode,
        }),
      ).rejects.toBeInstanceOf(AccountClosureChallengeError);
    }
    await expect(
      service.verifyChallenge({
        challengeId: challenge.challengeId,
        userId,
        action: 'begin',
        code,
      }),
    ).rejects.toMatchObject({ code: 'LOCKED' });
    const [row] = await db
      .select({ attemptCount: accountClosureChallenges.attemptCount })
      .from(accountClosureChallenges)
      .where(
        and(
          eq(accountClosureChallenges.externalId, challenge.challengeId),
          eq(accountClosureChallenges.userId, userId),
        ),
      );
    expect(row?.attemptCount).toBe(5);
  });

  it('keeps a failed delivery persisted and unused but makes it unusable immediately', async () => {
    vi.useFakeTimers();
    const failedAt = new Date('2026-08-26T02:00:00.000Z');
    vi.setSystemTime(failedAt);
    const { db } = await import('../db/client.js');
    const rawEmail = 'delivery-failure@example.test';
    const userId = await createUser({ email: rawEmail, emailVerified: true });
    const logs: unknown[] = [];
    const service = new AccountClosureChallengeService(db, {
      emailSender: {
        privateDelivery: true,
        isAvailable: () => true,
        async send() {
          throw new Error('provider rejected code=123456');
        },
      },
      smsGateway: { async sendAccountClosureCode() {} },
      logger: {
        error(fields: unknown) {
          logs.push(fields);
        },
      },
    });

    await expect(service.createChallenge({ userId, action: 'begin' })).rejects.toMatchObject({
      code: 'DELIVERY_FAILED',
    });
    const [row] = await db
      .select()
      .from(accountClosureChallenges)
      .where(eq(accountClosureChallenges.userId, userId));

    expect(row).toMatchObject({ usedAt: null, expiresAt: failedAt });
    expect(JSON.stringify(logs)).not.toContain(rawEmail);
    expect(JSON.stringify(logs)).not.toContain('123456');
    expect(JSON.stringify(logs)).not.toContain('provider rejected');
  });

  it('refuses the ordinary raw-logging email fallback before closure delivery', async () => {
    vi.stubEnv('RESEND_API_KEY', '');
    const rawEmail = 'closure-private@example.test';
    const userId = await createUser({ email: rawEmail, emailVerified: true });
    const capturedLogs: unknown[] = [];
    vi.spyOn(productionLogger, 'info').mockImplementation((...args: unknown[]) => {
      capturedLogs.push(args);
    });
    const { db } = await import('../db/client.js');
    const service = new AccountClosureChallengeService(db, {
      emailSender: resendSender as unknown as PrivateEmailSender,
      smsGateway: { async sendAccountClosureCode() {} },
      logger: { error() {} },
    });

    let failure: unknown;
    try {
      await service.createChallenge({ userId, action: 'begin' });
    } catch (error) {
      failure = error;
    }

    expect.soft(failure).toMatchObject({ code: 'DELIVERY_FAILED' });
    const serializedLogs = JSON.stringify(capturedLogs);
    expect(serializedLogs).not.toContain(rawEmail);
    expect(serializedLogs).not.toMatch(/\b\d{6}\b/);
  });
});
