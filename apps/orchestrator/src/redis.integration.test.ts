import { afterAll, beforeAll, describe, expect, it } from 'vitest';

beforeAll(() => {
  process.env.DATABASE_URL ??= 'mysql://holaday:holaday-dev@127.0.0.1:3306/holaday';
  process.env.REDIS_URL ??= 'redis://127.0.0.1:6379/0';
  process.env.JWT_SECRET ??= 'integration-test-secret-must-be-32-chars-or-more-please';
});

describe('Redis client against real Redis', () => {
  let close: () => Promise<void> = async () => {};

  afterAll(async () => {
    await close();
  });

  it('round-trips set/get/del', async () => {
    const { redis } = await import('./redis.js');
    close = async () => {
      await redis.quit();
    };

    const key = `holaday:test:${Date.now()}`;
    await redis.connect();
    await redis.set(key, 'pong', 'EX', 30);
    expect(await redis.get(key)).toBe('pong');
    expect(await redis.del(key)).toBe(1);
    expect(await redis.get(key)).toBeNull();
  });
});
