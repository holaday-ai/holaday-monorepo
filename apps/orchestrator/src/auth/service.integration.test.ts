import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const DATABASE_URL =
  process.env.DATABASE_URL ?? 'mysql://holaday:holaday-dev@127.0.0.1:3306/holaday';
const REDIS_URL = process.env.REDIS_URL ?? 'redis://127.0.0.1:6379/0';
const JWT_SECRET = 'integration-test-secret-must-be-32-chars-or-more-please';

beforeAll(() => {
  process.env.DATABASE_URL = DATABASE_URL;
  process.env.REDIS_URL = REDIS_URL;
  process.env.JWT_SECRET = JWT_SECRET;
});

describe('AuthService against real MySQL', () => {
  let cleanup: () => Promise<void> = async () => {};

  beforeAll(async () => {
    const { applyMigrations } = await import('../test/db-helper.js');
    await applyMigrations(DATABASE_URL);

    const { pool } = await import('../db/client.js');
    cleanup = async () => {
      await pool.end();
    };
  });

  afterAll(async () => {
    await cleanup();
  });

  it('register inserts a user, login round-trips, JWT decodes', async () => {
    const { AuthService } = await import('./service.js');
    const { verifyAccessToken } = await import('./jwt.js');
    const { db } = await import('../db/client.js');
    const svc = new AuthService(db);

    const email = `alice+${Date.now()}@example.com`;

    const reg = await svc.register({
      email,
      password: 'hunter22hunter22',
      displayName: 'Alice',
    });
    expect(reg.user.externalId).toMatch(/^usr_/);
    expect(reg.user.email).toBe(email);
    expect(reg.user.plan).toBe('free');

    const claims = await verifyAccessToken(reg.accessToken);
    expect(claims).toEqual({ sub: reg.user.externalId, plan: 'free', authVersion: 0 });

    const login = await svc.login({ email, password: 'hunter22hunter22' });
    expect(login.user.externalId).toBe(reg.user.externalId);

    await expect(svc.login({ email, password: 'wrongwrongwrong' })).rejects.toMatchObject({
      code: 'INVALID_CREDENTIALS',
    });

    await expect(svc.register({ email, password: 'hunter22hunter22' })).rejects.toMatchObject({
      code: 'EMAIL_TAKEN',
    });
  });

  it('keeps email, Google, and phone identities attached to one pending account', async () => {
    const { randomBytes } = await import('node:crypto');
    const { eq, or } = await import('drizzle-orm');
    const { db } = await import('../db/client.js');
    const { accountClosureRequests } = await import('../db/schema/account-closures.js');
    const { users } = await import('../db/schema/users.js');
    const { hashPassword } = await import('./password.js');
    const { AuthService, isClosureRecoveryResult } = await import('./service.js');

    const suffix = randomBytes(6).toString('hex');
    const externalId = `usr_pending_id_${suffix}`;
    const email = `pending-identity-${suffix}@example.com`;
    const googleId = `google-pending-${suffix}`;
    const phone = `139${String(Date.now()).slice(-8)}`;
    await db.insert(users).values({
      externalId,
      email,
      passwordHash: await hashPassword('password-42'),
      googleId,
      phone,
      phoneVerified: true,
      status: 'closure_pending',
      authVersion: 3,
    });
    const [user] = await db.select().from(users).where(eq(users.externalId, externalId)).limit(1);
    if (!user) throw new Error('expected pending user');
    await db.insert(accountClosureRequests).values({
      externalId: `acl_req_${suffix}`,
      userId: user.id,
      activeUserId: user.id,
      status: 'pending_grace',
      requestedAt: new Date(),
      graceEndsAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    });

    const service = new AuthService(db);
    await expect(service.register({ email, password: 'password-42' })).rejects.toMatchObject({
      code: 'EMAIL_TAKEN',
    });
    const results = await Promise.all([
      service.loginOrRegisterByEmail(email),
      service.loginOrRegisterByGoogle({ email, googleId }),
      service.loginOrRegisterByPhone(phone),
    ]);

    expect(results.every(isClosureRecoveryResult)).toBe(true);
    const matchingRows = await db
      .select({ id: users.id })
      .from(users)
      .where(or(eq(users.email, email), eq(users.googleId, googleId), eq(users.phone, phone)));
    expect(matchingRows).toHaveLength(1);
    expect(matchingRows[0]?.id).toBe(user.id);
  });

  it('leaves pending identity and credential fields unchanged across Google, phone, and reset', async () => {
    const { randomBytes } = await import('node:crypto');
    const { eq } = await import('drizzle-orm');
    const { db } = await import('../db/client.js');
    const { accountClosureRequests } = await import('../db/schema/account-closures.js');
    const { users } = await import('../db/schema/users.js');
    const { AuthService, isClosureRecoveryResult } = await import('./service.js');

    const suffix = randomBytes(5).toString('hex');
    const externalId = `usr_pending_zero_${suffix}`;
    const email = `pending-zero-${suffix}@example.com`;
    const phone = `137${String(Date.now()).slice(-8)}`;
    await db.insert(users).values({
      externalId,
      email,
      passwordHash: 'unchanged-password-hash',
      phone,
      status: 'closure_pending',
      authVersion: 7,
      googleId: null,
      emailVerified: false,
      phoneVerified: false,
      avatarUrl: null,
      displayName: null,
    });
    const [user] = await db.select().from(users).where(eq(users.externalId, externalId)).limit(1);
    if (!user) throw new Error('expected pending mutation user');
    await db.insert(accountClosureRequests).values({
      externalId: `acl_zero_${suffix}`,
      userId: user.id,
      activeUserId: user.id,
      status: 'pending_grace',
      requestedAt: new Date(),
      graceEndsAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    });

    const service = new AuthService(db);
    const results = await Promise.all([
      service.loginOrRegisterByGoogle({
        email,
        googleId: `google-zero-${suffix}`,
        name: 'Must Not Persist',
        avatarUrl: 'https://images.example/must-not-persist.png',
      }),
      service.loginOrRegisterByPhone(phone),
      service.resetPasswordByEmail(email, 'must-not-persist-password'),
    ]);

    expect(results.every(isClosureRecoveryResult)).toBe(true);
    const [after] = await db.select().from(users).where(eq(users.id, user.id)).limit(1);
    expect(after).toMatchObject({
      googleId: null,
      emailVerified: false,
      phoneVerified: false,
      avatarUrl: null,
      displayName: null,
      passwordHash: 'unchanged-password-hash',
      authVersion: 7,
    });
  });

  it('inserts user_profile linked to user via FK', async () => {
    const { newExternalId, matchOccupation } = await import('@holaday/shared-types');
    const { db } = await import('../db/client.js');
    const { users } = await import('../db/schema/users.js');
    const { userProfiles } = await import('../db/schema/user-profiles.js');
    const { eq } = await import('drizzle-orm');

    const userExternalId = newExternalId('user');
    const email = `bob+${Date.now()}@example.com`;
    await db.insert(users).values({
      externalId: userExternalId,
      email,
      passwordHash: 'placeholder',
    });

    const [u] = await db.select().from(users).where(eq(users.email, email));
    expect(u).toBeDefined();
    if (!u) throw new Error('user missing');

    const occ = matchOccupation('我是天猫电商运营');
    expect(occ?.tag).toBe('ecommerce-ops');

    await db.insert(userProfiles).values({
      externalId: newExternalId('userProfile'),
      userId: u.id,
      occupationRaw: '我是天猫电商运营',
      occupationCanonical: occ?.tag ?? null,
      fingerprint: { tools: ['千牛', '生意参谋'] },
    });

    const [profile] = await db.select().from(userProfiles).where(eq(userProfiles.userId, u.id));
    expect(profile?.occupationCanonical).toBe('ecommerce-ops');
    // MariaDB stores JSON as LONGTEXT; mysql2 returns it as a string. Drizzle's
    // mysql json codec parses on read against MySQL 8 but not against MariaDB,
    // so we normalize here for env-portability.
    const fingerprint =
      typeof profile?.fingerprint === 'string'
        ? (JSON.parse(profile.fingerprint) as { tools: string[] })
        : (profile?.fingerprint as { tools: string[] } | null | undefined);
    expect(fingerprint?.tools).toEqual(['千牛', '生意参谋']);
  });
});
