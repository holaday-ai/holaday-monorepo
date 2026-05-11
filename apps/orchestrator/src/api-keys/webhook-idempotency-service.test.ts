/**
 * Phase 5d follow-up + Codex P1 — webhook idempotency service tests.
 *
 * Covers:
 *   - canonicalize: object key order doesn't affect the hash
 *   - hashBody: deterministic + different bodies → different hashes
 *   - lookup: missing row → fresh, hit + same hash → replay, hit +
 *     different hash → replay-with-conflictsWith, expired → fresh,
 *     placeholder claim → in_flight
 *   - recordClaim: success → claimed, DUP + populated → replay,
 *     DUP + placeholder → in_flight, DUP + stale placeholder →
 *     orphan-takeover + claimed
 *   - finalizeClaim: UPDATE flips placeholder to real values;
 *     no-op when another process raced to finalize first
 *   - releaseClaim: deletes placeholder rows; idempotent against
 *     finalized rows
 *   - cleanup: returns affectedRows; DB error → 0 (non-fatal)
 *
 * DB is stubbed with a small object that mirrors drizzle's select/
 * insert/update/delete chains — same pattern used in the storage-
 * provider tests.
 */

import { describe, expect, it, vi } from 'vitest';
import {
  canonicalize,
  cleanup,
  CLAIM_PLACEHOLDER_TASK_ID,
  CLAIM_STALE_AFTER_MS,
  finalizeClaim,
  hashBody,
  lookup,
  recordClaim,
  releaseClaim,
} from './webhook-idempotency-service.js';

const fakeLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  child: vi.fn(),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any;

interface FakeRow {
  userId: number;
  idempotencyKey: string;
  requestHash: string;
  taskId: string;
  responseJson: unknown;
  expiresAt: Date;
  createdAt: Date;
}

/**
 * Builds an in-memory DB stub that mirrors the drizzle chain shapes
 * the service depends on. The stub maintains a `rows` array and
 * implements:
 *   - select(...).from(...).where(predicate).limit(n) — filters by
 *     parsing the predicate via util.inspect for value matches on
 *     userId + idempotencyKey + (optional) taskId + createdAt
 *   - insert(...).values(v) — pushes onto rows, throws ER_DUP_ENTRY
 *     when the (userId, key) already exists in rows
 *   - update(...).set(s).where(predicate) — finds matching rows and
 *     mutates them in place
 *   - delete(...).where(predicate) — splices matching rows out;
 *     returns { affectedRows: N }
 *
 * Tests override behavior via the helpers returned alongside the db.
 */
function makeFakeDb(initialRows: FakeRow[] = []) {
  const rows: FakeRow[] = [...initialRows];
  let throwOnInsert: 'ER_DUP_ENTRY' | Error | null = null;

  function predicateToFilter(predicate: unknown): (row: FakeRow) => boolean {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const s = require('node:util').inspect(predicate, {
      depth: 6,
      getters: true,
    });
    // util.inspect on a drizzle predicate dumps the predicate's
    // value bindings as `value: <serialized>`. We pick out the
    // bindings the service actually emits: userId (number), key
    // (string), and optionally task_id placeholder (empty string).
    // The table-column references include the whole columns map at
    // depth 6 (so "createdAt" / "request_hash" appear as STRINGS
    // describing the schema, not as predicate values) — we
    // intentionally don't try to filter on those. The narrower
    // user+key+optional-taskId match is enough for the service's
    // queries because it never selects more than one row at the
    // unique index `(user_id, idempotency_key)`.
    return (row) => {
      // userId predicate.
      if (!s.includes(`value: ${row.userId}`)) return false;
      // idempotency_key predicate.
      if (!s.includes(`value: '${row.idempotencyKey}'`)) return false;
      // Placeholder-task_id predicate (orphan DELETE + releaseClaim
      // + finalize WHERE-guard). `value: ''` only appears when one
      // of the eq calls binds the placeholder string.
      if (s.includes("value: ''")) {
        if (row.taskId !== CLAIM_PLACEHOLDER_TASK_ID) return false;
      }
      return true;
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db: any = {
    select(_fields?: unknown) {
      return {
        from(_table: unknown) {
          return {
            where(predicate: unknown) {
              const f = predicateToFilter(predicate);
              return {
                async limit(_n: number): Promise<FakeRow[]> {
                  return rows
                    .filter(f)
                    .slice(0, _n)
                    .map((r) => ({ ...r }));
                },
              };
            },
          };
        },
      };
    },
    insert(_table: unknown) {
      return {
        async values(values: Record<string, unknown>) {
          if (throwOnInsert === 'ER_DUP_ENTRY') {
            const err = new Error('duplicate') as Error & { code: string };
            err.code = 'ER_DUP_ENTRY';
            throwOnInsert = null; // one-shot
            throw err;
          }
          if (throwOnInsert instanceof Error) {
            const e = throwOnInsert;
            throwOnInsert = null;
            throw e;
          }
          // Default behavior: simulate the real unique-index by
          // throwing DUP if a row already exists for the same
          // (user, key).
          const dup = rows.find(
            (r) =>
              r.userId === values.userId &&
              r.idempotencyKey === values.idempotencyKey,
          );
          if (dup) {
            const err = new Error('duplicate') as Error & { code: string };
            err.code = 'ER_DUP_ENTRY';
            throw err;
          }
          rows.push({
            userId: values.userId as number,
            idempotencyKey: values.idempotencyKey as string,
            requestHash: values.requestHash as string,
            taskId: values.taskId as string,
            responseJson: values.responseJson,
            expiresAt: values.expiresAt as Date,
            createdAt: (values.createdAt as Date) ?? new Date(),
          });
        },
      };
    },
    update(_table: unknown) {
      return {
        set(setValues: Record<string, unknown>) {
          return {
            async where(predicate: unknown): Promise<{ affectedRows: number }> {
              const f = predicateToFilter(predicate);
              let affected = 0;
              for (const r of rows) {
                if (f(r)) {
                  if ('taskId' in setValues) r.taskId = setValues.taskId as string;
                  if ('responseJson' in setValues) r.responseJson = setValues.responseJson;
                  affected++;
                }
              }
              return { affectedRows: affected };
            },
          };
        },
      };
    },
    delete(_table: unknown) {
      return {
        async where(predicate: unknown): Promise<{ affectedRows: number }> {
          const f = predicateToFilter(predicate);
          let affected = 0;
          for (let i = rows.length - 1; i >= 0; i--) {
            const row = rows[i];
            if (row && f(row)) {
              rows.splice(i, 1);
              affected++;
            }
          }
          return { affectedRows: affected };
        },
      };
    },
  };
  return {
    db,
    rows,
    setNextInsertError: (e: 'ER_DUP_ENTRY' | Error) => {
      throwOnInsert = e;
    },
  };
}

describe('canonicalize', () => {
  it('produces identical output regardless of object key order', () => {
    const a = canonicalize({ a: 1, b: 'two', c: [3, 4] });
    const b = canonicalize({ c: [3, 4], b: 'two', a: 1 });
    expect(a).toBe(b);
  });

  it('drops undefined values (treats them as null for stability)', () => {
    const a = canonicalize({ a: 1, b: undefined, c: 3 });
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

describe('lookup', () => {
  const future = new Date(Date.now() + 60_000);
  const past = new Date(Date.now() - 60_000);

  it('no matching row → fresh', async () => {
    const { db } = makeFakeDb([]);
    const r = await lookup({ db, logger: fakeLogger }, 42, 'key-a', { prompt: 'x' });
    expect(r.kind).toBe('fresh');
  });

  it('hit + same hash + populated task_id → replay (conflictsWith=false)', async () => {
    const body = { prompt: 'hello' };
    const { db } = makeFakeDb([
      {
        userId: 42,
        idempotencyKey: 'key-a',
        requestHash: hashBody(body),
        taskId: 'tsk_cached',
        responseJson: { taskId: 'tsk_cached', status: 'pending' },
        expiresAt: future,
        createdAt: new Date(),
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

  it('hit + different hash + populated task_id → replay with conflictsWith=true', async () => {
    const { db } = makeFakeDb([
      {
        userId: 42,
        idempotencyKey: 'key-a',
        requestHash: hashBody({ prompt: 'original' }),
        taskId: 'tsk_original',
        responseJson: { taskId: 'tsk_original', status: 'pending' },
        expiresAt: future,
        createdAt: new Date(),
      },
    ]);
    const r = await lookup({ db, logger: fakeLogger }, 42, 'key-a', { prompt: 'something else' });
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
        createdAt: new Date(Date.now() - 25 * 60 * 60_000),
      },
    ]);
    const r = await lookup({ db, logger: fakeLogger }, 42, 'key-a', body);
    expect(r.kind).toBe('fresh');
  });

  it('placeholder task_id (claim in flight) → in_flight (NEW Codex P1)', async () => {
    const { db } = makeFakeDb([
      {
        userId: 42,
        idempotencyKey: 'key-a',
        requestHash: hashBody({ prompt: 'x' }),
        taskId: CLAIM_PLACEHOLDER_TASK_ID,
        responseJson: {},
        expiresAt: future,
        createdAt: new Date(),
      },
    ]);
    const r = await lookup({ db, logger: fakeLogger }, 42, 'key-a', { prompt: 'x' });
    expect(r.kind).toBe('in_flight');
  });
});

describe('recordClaim (atomic-claim flow, Codex P1)', () => {
  it('no existing row → claimed + row inserted with placeholder', async () => {
    const { db, rows } = makeFakeDb([]);
    const r = await recordClaim({ db, logger: fakeLogger }, 42, 'key-a', { prompt: 'hi' });
    expect(r.kind).toBe('claimed');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.taskId).toBe(CLAIM_PLACEHOLDER_TASK_ID);
    expect(rows[0]?.responseJson).toEqual({});
    expect(rows[0]?.requestHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('DUP + existing row populated + same hash → replay (no conflict)', async () => {
    const body = { prompt: 'hello' };
    const { db } = makeFakeDb([
      {
        userId: 42,
        idempotencyKey: 'key-a',
        requestHash: hashBody(body),
        taskId: 'tsk_first',
        responseJson: { taskId: 'tsk_first', status: 'pending' },
        expiresAt: new Date(Date.now() + 60_000),
        createdAt: new Date(),
      },
    ]);
    const r = await recordClaim({ db, logger: fakeLogger }, 42, 'key-a', body);
    expect(r.kind).toBe('replay');
    if (r.kind === 'replay') {
      expect(r.conflictsWith).toBe(false);
      expect(r.taskId).toBe('tsk_first');
    }
  });

  it('DUP + existing row populated + different hash → replay with conflictsWith=true', async () => {
    const { db } = makeFakeDb([
      {
        userId: 42,
        idempotencyKey: 'key-a',
        requestHash: hashBody({ prompt: 'original' }),
        taskId: 'tsk_first',
        responseJson: { taskId: 'tsk_first', status: 'pending' },
        expiresAt: new Date(Date.now() + 60_000),
        createdAt: new Date(),
      },
    ]);
    const r = await recordClaim({ db, logger: fakeLogger }, 42, 'key-a', { prompt: 'mismatch' });
    expect(r.kind).toBe('replay');
    if (r.kind === 'replay') expect(r.conflictsWith).toBe(true);
  });

  it('DUP + existing claim placeholder (recent) → in_flight', async () => {
    const { db } = makeFakeDb([
      {
        userId: 42,
        idempotencyKey: 'key-a',
        requestHash: hashBody({ prompt: 'x' }),
        taskId: CLAIM_PLACEHOLDER_TASK_ID,
        responseJson: {},
        expiresAt: new Date(Date.now() + 60_000),
        createdAt: new Date(Date.now() - 1_000), // 1s old — well within stale window
      },
    ]);
    const r = await recordClaim({ db, logger: fakeLogger }, 42, 'key-a', { prompt: 'x' });
    expect(r.kind).toBe('in_flight');
  });

  it('DUP + stale placeholder → orphan-takeover + claimed', async () => {
    const { db, rows } = makeFakeDb([
      {
        userId: 42,
        idempotencyKey: 'key-a',
        requestHash: hashBody({ prompt: 'x' }),
        taskId: CLAIM_PLACEHOLDER_TASK_ID,
        responseJson: {},
        expiresAt: new Date(Date.now() + 60_000),
        createdAt: new Date(Date.now() - CLAIM_STALE_AFTER_MS - 5_000),
      },
    ]);
    const r = await recordClaim({ db, logger: fakeLogger }, 42, 'key-a', { prompt: 'x' });
    expect(r.kind).toBe('claimed');
    // The orphan is replaced — one row remains, with our hash.
    expect(rows).toHaveLength(1);
    expect(rows[0]?.taskId).toBe(CLAIM_PLACEHOLDER_TASK_ID);
  });

  it('two parallel callers — only one wins claim (the other replays)', async () => {
    // Simulate: caller A INSERTs (succeeds); caller B INSERTs → DUP;
    // by the time B's collision-recovery looks up the row, A has
    // already finalized.
    const { db } = makeFakeDb([]);
    // First caller successfully claims.
    const a = await recordClaim({ db, logger: fakeLogger }, 42, 'key-a', { prompt: 'x' });
    expect(a.kind).toBe('claimed');
    // First caller finalizes (mimics dispatch + finalizeClaim).
    await finalizeClaim(
      { db, logger: fakeLogger },
      42,
      'key-a',
      'tsk_a',
      { taskId: 'tsk_a', status: 'pending' },
    );
    // Second caller collides — sees the populated row → replay.
    const b = await recordClaim({ db, logger: fakeLogger }, 42, 'key-a', { prompt: 'x' });
    expect(b.kind).toBe('replay');
    if (b.kind === 'replay') {
      expect(b.conflictsWith).toBe(false);
      expect(b.taskId).toBe('tsk_a');
    }
  });

  it('non-DUP DB error propagates (caller sees throw)', async () => {
    const { db, setNextInsertError } = makeFakeDb([]);
    setNextInsertError(new Error('connection refused'));
    await expect(
      recordClaim({ db, logger: fakeLogger }, 42, 'key-a', { prompt: 'x' }),
    ).rejects.toThrow(/connection refused/);
  });
});

describe('finalizeClaim', () => {
  it('flips placeholder → real task_id + response when row is still a claim', async () => {
    const { db, rows } = makeFakeDb([
      {
        userId: 42,
        idempotencyKey: 'key-a',
        requestHash: hashBody({ prompt: 'x' }),
        taskId: CLAIM_PLACEHOLDER_TASK_ID,
        responseJson: {},
        expiresAt: new Date(Date.now() + 60_000),
        createdAt: new Date(),
      },
    ]);
    const ok = await finalizeClaim(
      { db, logger: fakeLogger },
      42,
      'key-a',
      'tsk_real',
      { taskId: 'tsk_real', status: 'pending' },
    );
    expect(ok).toBe(true);
    expect(rows[0]?.taskId).toBe('tsk_real');
    expect(rows[0]?.responseJson).toEqual({ taskId: 'tsk_real', status: 'pending' });
  });

  it('no-op when row already has real task_id (another process finalized first)', async () => {
    const { db, rows } = makeFakeDb([
      {
        userId: 42,
        idempotencyKey: 'key-a',
        requestHash: hashBody({ prompt: 'x' }),
        taskId: 'tsk_existing',
        responseJson: { taskId: 'tsk_existing', status: 'pending' },
        expiresAt: new Date(Date.now() + 60_000),
        createdAt: new Date(),
      },
    ]);
    const ok = await finalizeClaim(
      { db, logger: fakeLogger },
      42,
      'key-a',
      'tsk_attempt_overwrite',
      { taskId: 'tsk_attempt_overwrite', status: 'pending' },
    );
    expect(ok).toBe(false);
    // Original row unchanged.
    expect(rows[0]?.taskId).toBe('tsk_existing');
  });
});

describe('releaseClaim', () => {
  it('deletes placeholder row so next retry sees fresh slot', async () => {
    const { db, rows } = makeFakeDb([
      {
        userId: 42,
        idempotencyKey: 'key-a',
        requestHash: hashBody({ prompt: 'x' }),
        taskId: CLAIM_PLACEHOLDER_TASK_ID,
        responseJson: {},
        expiresAt: new Date(Date.now() + 60_000),
        createdAt: new Date(),
      },
    ]);
    const ok = await releaseClaim({ db, logger: fakeLogger }, 42, 'key-a');
    expect(ok).toBe(true);
    expect(rows).toHaveLength(0);
  });

  it('does NOT delete a finalized row (idempotent against race-resolution)', async () => {
    const { db, rows } = makeFakeDb([
      {
        userId: 42,
        idempotencyKey: 'key-a',
        requestHash: hashBody({ prompt: 'x' }),
        taskId: 'tsk_real',
        responseJson: { taskId: 'tsk_real' },
        expiresAt: new Date(Date.now() + 60_000),
        createdAt: new Date(),
      },
    ]);
    const ok = await releaseClaim({ db, logger: fakeLogger }, 42, 'key-a');
    expect(ok).toBe(false);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.taskId).toBe('tsk_real');
  });
});

describe('cleanup', () => {
  it('returns affectedRows on success', async () => {
    // For cleanup the predicate-matcher in our fake DB needs to treat
    // `lt(expires_at, now)` correctly. Simpler: seed a row with past
    // expiry; our fake `delete().where(...)` will still treat any
    // matching predicate as match-all because the predicate string
    // doesn't carry userId/idempotencyKey terms. Override the db's
    // delete path with a simple stub for this case.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db: any = {
      delete() {
        return {
          async where() {
            return { affectedRows: 5 };
          },
        };
      },
    };
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
