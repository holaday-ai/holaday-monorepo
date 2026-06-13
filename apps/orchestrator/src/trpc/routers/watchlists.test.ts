/**
 * Phase 1 指令 #2 — watchlist tRPC router unit tests.
 *
 * Driven via `createCaller` with a minimal fake drizzle-shaped db (same
 * approach as scheduled-tasks.test.ts) so we don't need MySQL. The fake
 * distinguishes a single-row lookup (`.limit(1)` — used by requireUserId
 * and the add-existence probe) from a list scan (`.orderBy(...)` — used
 * by `list`).
 */

import { TRPCError } from '@trpc/server';
import { describe, expect, it, vi } from 'vitest';
import { watchlistsRouter } from './watchlists.js';

const fakeLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  child: vi.fn(),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any;

interface WlRow {
  externalId: string;
  symbol: string;
  market: string;
  displayName: string | null;
  note: string | null;
  sortOrder: number;
  createdAt: Date;
}

function row(partial: Partial<WlRow> & { symbol: string }): WlRow {
  return {
    externalId: `wl_${partial.symbol}`,
    market: 'A',
    displayName: null,
    note: null,
    sortOrder: 0,
    createdAt: new Date('2026-06-01T00:00:00.000Z'),
    ...partial,
  };
}

function makeCtx(
  opts: {
    watchlist?: WlRow[];
    userExternalId?: string;
    userId?: number;
    userKnown?: boolean;
  } = {},
) {
  const wlRows = opts.watchlist ?? [];
  const userExternalId = opts.userExternalId ?? 'usr_test';
  const userId = opts.userId ?? 42;
  const userKnown = opts.userKnown ?? true;
  const inserts: Array<Record<string, unknown>> = [];
  const deletes: string[] = [];
  const updates: Array<{ values: Record<string, unknown>; predicate: string }> = [];

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const inspect = (p: unknown): string =>
    require('node:util').inspect(p, { depth: 8, getters: true });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db: any = {
    select(_fields?: unknown) {
      return {
        from(table: unknown) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const tName = (table as any)?.[Symbol.for('drizzle:Name')] ?? '';
          return {
            where(predicate: unknown) {
              const s = inspect(predicate);
              const userMatch =
                userKnown && s.includes(`value: '${userExternalId}'`) ? [{ id: userId }] : [];
              const symbolHit = wlRows.filter((r) => s.includes(`value: '${r.symbol}'`));
              const listRows = tName === 'watchlists' ? [...wlRows] : [];
              return {
                // list path: `.where(...).orderBy(...)` is awaited directly
                orderBy: () => Promise.resolve(listRows),
                // single-row lookup path: requireUserId + add-existence use `.limit(1)`
                limit: (_n: number) => Promise.resolve(tName === 'users' ? userMatch : symbolHit),
              };
            },
          };
        },
      };
    },
    insert(_table: unknown) {
      return {
        async values(v: Record<string, unknown>) {
          inserts.push(v);
          wlRows.push(row({ ...(v as Partial<WlRow>), symbol: String(v.symbol) }));
          return { affectedRows: 1 };
        },
      };
    },
    delete(_table: unknown) {
      return {
        async where(predicate: unknown) {
          const s = inspect(predicate);
          const before = wlRows.length;
          for (let i = wlRows.length - 1; i >= 0; i--) {
            const r = wlRows[i];
            if (r && s.includes(`value: '${r.symbol}'`)) wlRows.splice(i, 1);
          }
          deletes.push(s);
          return { affectedRows: before - wlRows.length };
        },
      };
    },
    update(_table: unknown) {
      return {
        set(values: Record<string, unknown>) {
          return {
            async where(predicate: unknown) {
              updates.push({ values, predicate: inspect(predicate) });
              return { affectedRows: 1 };
            },
          };
        },
      };
    },
  };

  return {
    ctx: { db, userId: userExternalId, logger: fakeLogger },
    wlRows,
    inserts,
    deletes,
    updates,
  };
}

describe('watchlistsRouter', () => {
  it('list — maps rows to the SPA shape', async () => {
    const { ctx } = makeCtx({
      watchlist: [
        row({ symbol: '600519', displayName: '贵州茅台' }),
        row({ symbol: '300750', displayName: '宁德时代', note: '动力电池' }),
      ],
    });
    const caller = watchlistsRouter.createCaller(ctx as never);
    const result = await caller.list();
    expect(result).toEqual([
      {
        watchlistId: 'wl_600519',
        symbol: '600519',
        market: 'A',
        displayName: '贵州茅台',
        note: null,
        createdAt: new Date('2026-06-01T00:00:00.000Z'),
      },
      {
        watchlistId: 'wl_300750',
        symbol: '300750',
        market: 'A',
        displayName: '宁德时代',
        note: '动力电池',
        createdAt: new Date('2026-06-01T00:00:00.000Z'),
      },
    ]);
  });

  it('add — inserts a new symbol with defaults', async () => {
    const { ctx, inserts } = makeCtx({ watchlist: [] });
    const caller = watchlistsRouter.createCaller(ctx as never);
    const result = await caller.add({ symbol: '600519', displayName: '贵州茅台' });
    expect(result).toMatchObject({ ok: true, symbol: '600519', already: false });
    expect(result.watchlistId.startsWith('wl_')).toBe(true);
    expect(inserts).toHaveLength(1);
    expect(inserts[0]).toMatchObject({
      symbol: '600519',
      market: 'A',
      displayName: '贵州茅台',
      userId: 42,
      note: null,
    });
  });

  it('add — idempotent when the symbol is already on the list', async () => {
    const { ctx, inserts } = makeCtx({
      watchlist: [row({ symbol: '600519', externalId: 'wl_existing' })],
    });
    const caller = watchlistsRouter.createCaller(ctx as never);
    const result = await caller.add({ symbol: '600519' });
    expect(result).toEqual({
      ok: true,
      watchlistId: 'wl_existing',
      symbol: '600519',
      already: true,
    });
    expect(inserts).toHaveLength(0);
  });

  it('add — trims surrounding whitespace from the symbol', async () => {
    const { ctx, inserts } = makeCtx({ watchlist: [] });
    const caller = watchlistsRouter.createCaller(ctx as never);
    const result = await caller.add({ symbol: '  000001  ' });
    expect(result.symbol).toBe('000001');
    expect(inserts[0]).toMatchObject({ symbol: '000001' });
  });

  it('remove — deletes the symbol', async () => {
    const { ctx, wlRows } = makeCtx({
      watchlist: [row({ symbol: '600519' }), row({ symbol: '300750' })],
    });
    const caller = watchlistsRouter.createCaller(ctx as never);
    const result = await caller.remove({ symbol: '600519' });
    expect(result).toEqual({ ok: true, symbol: '600519' });
    expect(wlRows.map((r) => r.symbol)).toEqual(['300750']);
  });

  it('remove — non-existent symbol is an idempotent no-op success', async () => {
    const { ctx } = makeCtx({ watchlist: [] });
    const caller = watchlistsRouter.createCaller(ctx as never);
    await expect(caller.remove({ symbol: '000001' })).resolves.toEqual({
      ok: true,
      symbol: '000001',
    });
  });

  it('update — sets the note and reports updated', async () => {
    const { ctx, updates } = makeCtx({ watchlist: [row({ symbol: '600519' })] });
    const caller = watchlistsRouter.createCaller(ctx as never);
    const result = await caller.update({ symbol: '600519', note: '核心仓位' });
    expect(result).toEqual({ ok: true, symbol: '600519', updated: true });
    expect(updates).toHaveLength(1);
    expect(updates[0]?.values).toMatchObject({ note: '核心仓位' });
  });

  it('update — no fields given is a no-op (updated: false)', async () => {
    const { ctx, updates } = makeCtx({ watchlist: [row({ symbol: '600519' })] });
    const caller = watchlistsRouter.createCaller(ctx as never);
    const result = await caller.update({ symbol: '600519' });
    expect(result).toEqual({ ok: true, symbol: '600519', updated: false });
    expect(updates).toHaveLength(0);
  });

  it('rejects an unknown user with UNAUTHORIZED', async () => {
    const { ctx } = makeCtx({ userKnown: false });
    const caller = watchlistsRouter.createCaller(ctx as never);
    await expect(caller.list()).rejects.toBeInstanceOf(TRPCError);
    await expect(caller.list()).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });
});
