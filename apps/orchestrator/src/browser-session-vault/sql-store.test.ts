import { MySqlDialect } from 'drizzle-orm/mysql-core';
import { describe, expect, it, vi } from 'vitest';
import { browserSessionVaults } from '../db/schema/browser-session-vaults.js';
import { SqlVaultStore } from './sql-store.js';

function fake(status = 'active', affectedRows = 1) {
  const locks: string[] = [];
  const where: unknown[] = [];
  const updates: unknown[] = [];
  const tx = {
    select: () => {
      let table: unknown;
      const chain = {
        from: (t: unknown) => {
          table = t;
          return chain;
        },
        where: (w: unknown) => {
          where.push(w);
          return chain;
        },
        limit: () => chain,
        for: async (mode: string) => {
          locks.push(mode);
          return table === browserSessionVaults
            ? [{ id: 5, userId: 9, revision: 7, document: { grants: [] } }]
            : [{ id: 9, status }];
        },
      };
      return chain;
    },
    update: () => ({
      set: (v: unknown) => {
        updates.push(v);
        return {
          where: async (w: unknown) => {
            where.push(w);
            return [{ affectedRows }];
          },
        };
      },
    }),
  };
  const db = { transaction: async (fn: (t: unknown) => unknown) => fn(tx) };
  return { store: new SqlVaultStore(db as never), locks, where, updates };
}
describe('durable vault transaction boundary', () => {
  it('locks active owner then vault and CAS-binds owner/id/revision', async () => {
    const f = fake();
    expect(await f.store.update('owner', async () => 42)).toBe(42);
    expect(f.locks).toEqual(['update', 'update']);
    const predicate = new MySqlDialect().sqlToQuery(f.where[2] as never);
    expect(predicate.params).toEqual([5, 9, 7]);
    expect(f.updates).toEqual([{ revision: 8, document: { grants: [] } }]);
  });
  it('rejects closure owners and lost CAS before committing', async () => {
    const f = fake('closure_pending');
    const callback = vi.fn();
    await expect(f.store.update('owner', callback)).rejects.toThrow('user_unavailable');
    expect(callback).not.toHaveBeenCalled();
    const conflict = fake('active', 0);
    await expect(conflict.store.update('owner', async () => {})).rejects.toThrow('cas_conflict');
  });
});
