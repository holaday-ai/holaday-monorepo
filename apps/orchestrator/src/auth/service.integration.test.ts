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
