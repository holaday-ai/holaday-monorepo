/**
 * Phase 5d follow-up — webhook idempotency service unit tests.
 *
 * Covers:
 *   - canonicalize: object key order doesn't affect the hash
 *   - hashBody: deterministic + different bodies → different hashes
 *   - lookup: missing row → fresh, hit + same hash → replay, hit +
 *     different hash → replay-with-conflictsWith, expired → fresh
 *   - record: ER_DUP_ENTRY (parallel-call race) returns false
 *     instead of throwing
 *   - cleanup: returns affectedRows; DB error → 0 (non-fatal)
 *
 * DB is stubbed with a small object that mirrors drizzle's select/
 * insert/delete chains — same pattern used in the storage-provider
 * tests.
 */

import { describe, expect, it, vi } from 'vitest';
import {
  canonicalize,
  cleanup,
  hashBody,
  lookup,
  record,
} from './webhook-idempotency-service.js';

const fakeLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  child: vi.fn(),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any;

describe('canonicalize', () => {
  it('produces identical output regardless of object key order', () => {
    const a = canonicalize({ a: 1, b: 'two', c: [3, 4] });
    const b = canonicalize({ c: [3, 4], b: 'two', a: 1 });
    expect(a).toBe(b);
  });

  it('drops undefined values (treats them as null for stability)', () => {
    const a = canonicalize({ a: 1, b: undefined, c: 3 });
    // `undefined` becomes `null` in the canonical form.
    expect(a).toBe('{"a":1,"b":null,"c":3}');
  });

  it('keeps array order (arrays are positional)', () => {
    expect(canonicalize({ x: [1, 2, 3] })).toBe('{"x":[1,2,3]}');
    expect(canonicalize({ x: [3, 2, 1] })).toBe('{"x":[3,2,1]}');
  });
});

describe('hashBody', () => {
  it('deterministic — same body → same hash', () => {
    expect(hashBody({ prompt: 'hi' })).toBe(hashBody({ prompt: 'hi' }));
  });

  it('order-insensitive — same hash regardless of key order', () => {
    expect(hashBody({ a: 1, b: 2 })).toBe(hashBody({ b: 2, a: 1 }));
  });

  it('different bodies → different hashes', () => {
    expect(hashBody({ prompt: 'a' })).not.toBe(hashBody({ prompt: 'b' }));
  });

  it('hex shape (sha256)', () => {
    expect(hashBody({})).toMatch(/^[0-9a-f]{64}$/);
  });
});

interface FakeRow {
  requestHash: string;
  taskId: string;
  responseJson: unknown;
  expiresAt: Date;
}
function makeFakeDb(rows: Array<FakeRow & { userId: number; idempotencyKey: string }>) {
  let lastInsertValues: Record<string, unknown> | null = null;
  let dupOnInsert = false;
  let deleteAffected = 0;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db: any = {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    select(_fields?: any) {
      return {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        from(_table: any) {
          return {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            where(predicate: any) {
              // eslint-disable-next-line @typescript-eslint/no-require-imports
              const s = require('node:util').inspect(predicate, {
                depth: 6,
                getters: true,
              });
              return {
                async limit(_n: number): Promise<unknown[]> {
                  return rows
                    .filter(
                      (r) =>
                        s.includes(`value: ${r.userId}`) &&
                        s.includes(`value: '${r.idempotencyKey}'`),
                    )
                    .map(({ requestHash, taskId, responseJson, expiresAt }) => ({
                      requestHash,
                      taskId,
                      responseJson,
                      expiresAt,
                    }));
                },
              };
            },
          };
        },
      };
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    insert(_table: any) {
      return {
        async values(values: Record<string, unknown>) {
          if (dupOnInsert) {
            const err = new Error('duplicate') as Error & { code: string };
            err.code = 'ER_DUP_ENTRY';
            throw err;
          }
          lastInsertValues = values;
        },
      };
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete(_table: any) {
      return {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        async where(_predicate: any) {
          return { affectedRows: deleteAffected };
        },
      };
    },
  };
  return {
    db,
    getLastInsertValues: () => lastInsertValues,
    setDupOnInsert: (v: boolean) => {
      dupOnInsert = v;
    },
    setDeleteAffected: (n: number) => {
      deleteAffected = n;
    },
  };
}

describe('lookup', () => {
  const future = new Date(Date.now() + 60_000);
  const past = new Date(Date.now() - 60_000);

  it('no matching row → fresh', async () => {
    const { db } = makeFakeDb([]);
    const r = await lookup({ db, logger: fakeLogger }, 42, 'key-a', {
      prompt: 'x',
    });
    expect(r.kind).toBe('fresh');
  });

  it('hit + same hash → replay (conflictsWith=false)', async () => {
    const body = { prompt: 'hello' };
    const { db } = makeFakeDb([
      {
        userId: 42,
        idempotencyKey: 'key-a',
        requestHash: hashBody(body),
        taskId: 'tsk_cached',
        responseJson: { taskId: 'tsk_cached', status: 'pending' },
        expiresAt: future,
      },
    ]);
    const r = await lookup({ db, logger: fakeLogger }, 42, 'key-a', body);
    expect(r.kind).toBe('replay');
    if (r.kind === 'replay') {
      expect(r.conflictsWith).toBe(false);
      expect(r.taskId).toBe('tsk_cached');
      expect(r.response).toEqual({ taskId: 'tsk_cached', status: 'pending' });
    }
  });

  it('hit + different hash → replay with conflictsWith=true (caller 409s)', async () => {
    const { db } = makeFakeDb([
      {
        userId: 42,
        idempotencyKey: 'key-a',
        requestHash: hashBody({ prompt: 'original' }),
        taskId: 'tsk_original',
        responseJson: { taskId: 'tsk_original', status: 'pending' },
        expiresAt: future,
      },
    ]);
    const r = await lookup({ db, logger: fakeLogger }, 42, 'key-a', {
      prompt: 'something else',
    });
    expect(r.kind).toBe('replay');
    if (r.kind === 'replay') {
      expect(r.conflictsWith).toBe(true);
      expect(r.taskId).toBe('tsk_original');
    }
  });

  it('hit but expired → fresh (treats expired as missing)', async () => {
    const body = { prompt: 'hello' };
    const { db } = makeFakeDb([
      {
        userId: 42,
        idempotencyKey: 'key-a',
        requestHash: hashBody(body),
        taskId: 'tsk_stale',
        responseJson: { taskId: 'tsk_stale', status: 'pending' },
        expiresAt: past,
      },
    ]);
    const r = await lookup({ db, logger: fakeLogger }, 42, 'key-a', body);
    expect(r.kind).toBe('fresh');
  });
});

describe('record', () => {
  it('inserts row + returns true on success', async () => {
    const { db, getLastInsertValues } = makeFakeDb([]);
    const ok = await record(
      { db, logger: fakeLogger },
      42,
      'key-a',
      { prompt: 'hi' },
      'tsk_new',
      { taskId: 'tsk_new', status: 'pending' },
    );
    expect(ok).toBe(true);
    const v = getLastInsertValues();
    expect(v).toMatchObject({
      userId: 42,
      idempotencyKey: 'key-a',
      taskId: 'tsk_new',
    });
    expect((v as { requestHash: string }).requestHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('ER_DUP_ENTRY (parallel-call race) → false, no throw', async () => {
    const { db, setDupOnInsert } = makeFakeDb([]);
    setDupOnInsert(true);
    const ok = await record(
      { db, logger: fakeLogger },
      42,
      'key-a',
      { prompt: 'x' },
      'tsk_z',
      {},
    );
    expect(ok).toBe(false);
  });
});

describe('cleanup', () => {
  it('returns affectedRows on success', async () => {
    const { db, setDeleteAffected } = makeFakeDb([]);
    setDeleteAffected(5);
    const n = await cleanup({ db, logger: fakeLogger });
    expect(n).toBe(5);
  });

  it('DB error returns 0 + does not throw', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db: any = {
      delete() {
        return {
          async where() {
            throw new Error('connection refused');
          },
        };
      },
    };
    const n = await cleanup({ db, logger: fakeLogger });
    expect(n).toBe(0);
  });
});
