import { describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ admins: new Set<string>(['usr_admin']) }));
const check = vi.fn(async (request: { deps: { region: string }; force?: boolean }) => ({
  report: { region: request.deps.region, items: [], summary: { ok: 0, warn: 0, fail: 0 } },
  cached: false,
  cachedAt: '2026-10-04T00:00:00.000Z',
}));

vi.mock('../../self-check/self-check-runtime.js', () => ({
  selfCheckService: { check, latest: () => null },
}));
vi.mock('../../self-check/production-deps.js', () => ({
  defaultSelfCheckRegion: (preferred: string | null) => preferred ?? 'intl',
  createProductionSelfCheckDeps: (input: { region: string }) => ({ region: input.region }),
}));

const { selfCheckRouter } = await import('./self-check.js');

/** Minimal db: adminProcedure's role lookup, then the admin's region lookup. */
function dbFor(userId: string) {
  const row = state.admins.has(userId)
    ? { role: 'admin', status: 'active', region: 'cn' }
    : { role: 'user', status: 'active', region: 'cn' };
  const chain = { from: () => chain, where: () => chain, limit: async () => [row] };
  return { select: () => chain };
}

const caller = (userId: string) =>
  selfCheckRouter.createCaller({ userId, db: dbFor(userId) } as never);

describe('selfCheck router', () => {
  it('is admin only', async () => {
    await expect(caller('usr_plain').run()).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(caller('usr_plain').latest()).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(check).not.toHaveBeenCalled();
  });

  it("runs in the admin's region unless one is requested", async () => {
    await expect(caller('usr_admin').run()).resolves.toMatchObject({ report: { region: 'cn' } });
    await caller('usr_admin').run({ region: 'intl', force: true });
    expect(check).toHaveBeenLastCalledWith(
      expect.objectContaining({ actorExternalId: 'usr_admin', source: 'admin', force: true }),
    );
    expect(check.mock.calls[1]?.[0].deps.region).toBe('intl');
  });
});
