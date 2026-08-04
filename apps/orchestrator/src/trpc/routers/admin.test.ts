/**
 * Phase 27 — admin router unit tests.
 *
 * Locks the two pieces of behaviour that don't need a live DB:
 *   1. adminProcedure middleware: FORBIDDEN unless users.role='admin'.
 *   2. Beijing-day helpers: handle DST-free zone correctly, daysAgo
 *      window walks back exactly 24h × N at the UTC level.
 *
 * The query bodies (dashboard / userList / userDetail) build SQL that
 * resists clean mocking (correlated subqueries, GROUP BY, ORDER BY
 * subquery expressions). Their behaviour is covered by manual smoke
 * after deploy + the type checker.
 */

import { TRPCError } from '@trpc/server';
import { drizzle } from 'drizzle-orm/mysql2';
import { describe, expect, it, vi } from 'vitest';
import * as schema from '../../db/schema/index.js';
import { __adminInternals, adminRouter, mapIpComplianceRow } from './admin.js';

describe('mapIpComplianceRow — IP 合规追溯 row assembly', () => {
  const base = {
    taskId: 'tsk_ip1',
    userExternalId: 'usr_1',
    userEmail: 'a@b.com',
    status: 'completed',
    createdAt: new Date('2026-06-21T00:00:00Z'),
    ipCopyText: '早睡早起身体好',
    authorizedAt: new Date('2026-06-20T00:00:00Z'),
    baseVideoFileId: 'file_base',
    qwenVoiceId: 'voice_x',
  };
  const meta = {
    videoType: 'ip_person',
    attachments: [{ fileId: 'file_out', filename: 'holaday-ip-video.mp4', sizeBytes: 5_000_000 }],
  };

  it('extracts output file + videoType + 素材引用 from an OBJECT result', () => {
    const out = mapIpComplianceRow({ ...base, result: { metadata: meta } });
    expect(out.outputFile).toEqual({
      fileId: 'file_out',
      filename: 'holaday-ip-video.mp4',
      sizeBytes: 5_000_000,
    });
    expect(out.videoType).toBe('ip_person');
    expect(out.authorizedAt).toEqual(base.authorizedAt);
    expect(out.baseVideoFileId).toBe('file_base');
    expect(out.qwenVoiceId).toBe('voice_x');
    expect(out.ipCopyText).toBe('早睡早起身体好');
  });

  it('handles MariaDB string-JSON result', () => {
    const out = mapIpComplianceRow({ ...base, result: JSON.stringify({ metadata: meta }) });
    expect(out.outputFile?.fileId).toBe('file_out');
    expect(out.videoType).toBe('ip_person');
  });

  it('null outputFile when no attachment / unparseable / null result', () => {
    expect(
      mapIpComplianceRow({ ...base, result: { metadata: { videoType: 'ip_person' } } }).outputFile,
    ).toBeNull();
    expect(mapIpComplianceRow({ ...base, result: 'not json' }).outputFile).toBeNull();
    expect(mapIpComplianceRow({ ...base, result: null }).outputFile).toBeNull();
  });
});

const { beijingDayStartUtc, beijingDayString, buildDashboardDayStats } =
  __adminInternals;

const fakeLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  child: vi.fn(),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any;

function makeCtx(
  roleByExternalId: Record<string, string | undefined>,
  userId: string | null,
  statusByExternalId: Record<string, string | undefined> = {},
) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db: any = {
    select(_fields?: unknown) {
      return {
        from(_table: unknown) {
          return {
            where(predicate: unknown) {
              return {
                async limit(_n: number): Promise<Array<{ role: string; status: string }>> {
                  // eslint-disable-next-line @typescript-eslint/no-require-imports
                  const s = require('node:util').inspect(predicate, {
                    depth: 6,
                    getters: true,
                  });
                  // Find the externalId in the predicate match.
                  for (const [ext, role] of Object.entries(roleByExternalId)) {
                    if (s.includes(`value: '${ext}'`)) {
                      return role ? [{ role, status: statusByExternalId[ext] ?? 'active' }] : [];
                    }
                  }
                  return [];
                },
              };
            },
          };
        },
      };
    },
  };
  return {
    db,
    userId,
    logger: fakeLogger,
  };
}

describe('adminProcedure (via adminRouter.dashboard gate)', () => {
  it('rejects unauthenticated with UNAUTHORIZED', async () => {
    const ctx = makeCtx({}, null);
    const caller = adminRouter.createCaller(ctx as never);
    await expect(caller.dashboard()).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    });
  });

  it("rejects non-admin role='user' with FORBIDDEN", async () => {
    const ctx = makeCtx({ usr_alice: 'user' }, 'usr_alice');
    const caller = adminRouter.createCaller(ctx as never);
    await expect(caller.dashboard()).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });

  it('rejects an inactive admin account with FORBIDDEN', async () => {
    const ctx = makeCtx(
      { usr_suspended_admin: 'admin' },
      'usr_suspended_admin',
      { usr_suspended_admin: 'suspended' },
    );
    const caller = adminRouter.createCaller(ctx as never);

    await expect(caller.dashboard()).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });

  it('rejects missing user (deleted account) with FORBIDDEN', async () => {
    const ctx = makeCtx({}, 'usr_ghost');
    const caller = adminRouter.createCaller(ctx as never);
    await expect(caller.dashboard()).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });

  it('admin role passes the gate (and proceeds into query body)', async () => {
    // The query body will explode against this hand-rolled fake db
    // — that's expected. We just need to assert it got PAST the
    // FORBIDDEN check, so the rejection should NOT be FORBIDDEN.
    const ctx = makeCtx({ usr_boss: 'admin' }, 'usr_boss');
    const caller = adminRouter.createCaller(ctx as never);
    try {
      await caller.dashboard();
      // If it didn't throw, the gate passed AND the query succeeded
      // — either way, gate is fine.
    } catch (err) {
      const e = err as TRPCError;
      expect(e.code).not.toBe('FORBIDDEN');
      expect(e.code).not.toBe('UNAUTHORIZED');
    }
  });
});

describe('beijingDayStartUtc', () => {
  it('returns the UTC instant of 00:00 Beijing for the same day', () => {
    // 2026-05-17 06:00 UTC → still 2026-05-17 in Beijing (14:00 BJ)
    const start = beijingDayStartUtc(new Date('2026-05-17T06:00:00Z'));
    // Beijing day start = 2026-05-17 00:00 BJ = 2026-05-16 16:00 UTC
    expect(start.toISOString()).toBe('2026-05-16T16:00:00.000Z');
  });

  it('walks back daysAgo whole days', () => {
    const start = beijingDayStartUtc(new Date('2026-05-17T06:00:00Z'), 3);
    // 3 Beijing days earlier → 2026-05-14 00:00 BJ = 2026-05-13 16:00 UTC
    expect(start.toISOString()).toBe('2026-05-13T16:00:00.000Z');
  });

  it("preserves day boundary near midnight UTC (it's 08:xx in Beijing)", () => {
    // 2026-05-17 00:30 UTC is 2026-05-17 08:30 BJ — same Beijing day.
    const start = beijingDayStartUtc(new Date('2026-05-17T00:30:00Z'));
    expect(start.toISOString()).toBe('2026-05-16T16:00:00.000Z');
  });
});

describe('beijingDayString', () => {
  it("formats as YYYY-MM-DD for today's Beijing day", () => {
    expect(beijingDayString(new Date('2026-05-17T06:00:00Z'))).toBe('2026-05-17');
  });

  it('handles UTC-to-Beijing day boundary near 16:xx UTC', () => {
    // 2026-05-17 16:30 UTC is 2026-05-18 00:30 BJ.
    expect(beijingDayString(new Date('2026-05-17T16:30:00Z'))).toBe('2026-05-18');
  });

  it('walks back daysAgo Beijing days', () => {
    expect(beijingDayString(new Date('2026-05-17T06:00:00Z'), 6)).toBe('2026-05-11');
  });
});

describe('buildDashboardDayStats', () => {
  it('keeps cancelled tasks in volume but out of failure rate math', () => {
    const stats = buildDashboardDayStats([
      { day: '2026-05-21', status: 'completed', count: 4 },
      { day: '2026-05-21', status: 'failed', count: 1 },
      { day: '2026-05-21', status: 'partial_success', count: 2 },
      { day: '2026-05-21', status: 'cancelled', count: 3 },
    ]).get('2026-05-21');

    expect(stats).toEqual({ total: 10, completed: 4, failed: 3 });
  });
});

describe('admin user aggregate sorting query', () => {
  it('paginates aggregate sorts in SQL without a 1000-user lookahead cap', () => {
    const buildAdminUserPageQuery = (
      __adminInternals as unknown as {
        buildAdminUserPageQuery?: (
          db: unknown,
          input: {
            search?: string;
            sort: 'createdAt' | 'taskCount' | 'lastActive';
            order: 'asc' | 'desc';
            offset: number;
            limit: number;
          },
          monthStart: Date,
        ) => { toSQL(): { sql: string; params: unknown[] } };
      }
    ).buildAdminUserPageQuery;

    expect(buildAdminUserPageQuery).toBeTypeOf('function');
    if (!buildAdminUserPageQuery) return;

    const mockDb = drizzle.mock({ schema, mode: 'default', casing: 'snake_case' });
    const query = buildAdminUserPageQuery(
      mockDb,
      {
        sort: 'taskCount',
        order: 'desc',
        offset: 1_200,
        limit: 50,
      },
      new Date('2026-07-01T00:00:00.000Z'),
    );
    const generated = query.toSQL();

    expect(generated.sql).toContain('left join');
    expect(generated.sql).toContain('order by');
    expect(generated.sql).not.toContain('limit 1000');
    expect(generated.params).toContain(1_200);
    expect(generated.params).toContain(50);
  });

  it('excludes system identities from the user page query', () => {
    const buildAdminUserPageQuery = (
      __adminInternals as unknown as {
        buildAdminUserPageQuery?: (
          db: unknown,
          input: {
            search?: string;
            sort: 'createdAt' | 'taskCount' | 'lastActive';
            order: 'asc' | 'desc';
            offset: number;
            limit: number;
          },
          monthStart: Date,
        ) => { toSQL(): { sql: string; params: unknown[] } };
      }
    ).buildAdminUserPageQuery;

    expect(buildAdminUserPageQuery).toBeTypeOf('function');
    if (!buildAdminUserPageQuery) return;

    const mockDb = drizzle.mock({ schema, mode: 'default', casing: 'snake_case' });
    const generated = buildAdminUserPageQuery(
      mockDb,
      {
        search: 'alice',
        sort: 'taskCount',
        order: 'desc',
        offset: 0,
        limit: 50,
      },
      new Date('2026-07-01T00:00:00.000Z'),
    ).toSQL();

    expect(generated.sql).toContain('`users`.`role` <>');
    expect(generated.params).toContain('system');
  });
});
