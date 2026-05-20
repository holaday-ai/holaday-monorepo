import { describe, expect, it, vi } from 'vitest';
import { authRouter } from './auth.js';

describe('auth router — unexpected error masking', () => {
  it('does not leak raw database errors from password login', async () => {
    const db = {
      select: () => ({
        from: () => ({
          where: () => ({
            limit: async () => {
              throw new Error("Unknown column 'role' in 'field list'");
            },
          }),
        }),
      }),
    };
    const logger = { error: vi.fn() };
    const caller = authRouter.createCaller({ db, logger } as never);

    await expect(
      caller.login({ email: 'person@example.com', password: 'secret' }),
    ).rejects.toMatchObject({
      code: 'INTERNAL_SERVER_ERROR',
      message: '登录服务暂时不可用，请稍后重试。',
    });
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        procedure: 'auth.login',
        err: "Unknown column 'role' in 'field list'",
      }),
      'auth: unexpected error',
    );
  });
});
