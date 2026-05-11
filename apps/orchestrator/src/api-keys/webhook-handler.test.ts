/**
 * Phase 5d — webhook-handler unit tests.
 *
 * Covers the four spec-called-out paths:
 *   - 200 happy path → dispatch called with prompt, returns taskId
 *   - 401 missing / malformed / unknown / revoked / expired bearer
 *   - 429 quota_exceeded (tRPC throws TOO_MANY_REQUESTS)
 *   - 400 missing prompt / overlong prompt
 *
 * DB layer is faked at the row-shape level — same drizzle method
 * chain the handler uses (select.from.where.limit / update.set.where).
 */

import type { Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';
import { TRPCError } from '@trpc/server';
import { createWebhookTasksHandler, resolveApiKey } from './webhook-handler.js';
import { generateApiKey } from './api-key-service.js';

const fakeLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  child: vi.fn(),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any;

interface FakeApiKeyRow {
  id: number;
  userId: number;
  keyHash: string;
  revokedAt: Date | null;
  expiresAt: Date | null;
}
interface FakeUserRow {
  id: number;
  externalId: string;
}

/**
 * Tiny fake DB matching ONLY what the handler calls:
 *   1. select({id,userId,revokedAt,expiresAt}).from(apiKeys).where(eq(keyHash, X)).limit(1)
 *   2. select({externalId}).from(users).where(eq(id, N)).limit(1)
 *   3. update(apiKeys).set({lastUsedAt}).where(eq(id, N))
 */
function makeFakeDb(state: { keys: FakeApiKeyRow[]; users: FakeUserRow[] }) {
  let lastUpdate: { table: string; values: Record<string, unknown> } | null = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function select(_fields?: any) {
    return {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      from(table: any) {
        const name = tableName(table);
        return {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          where(predicate: any) {
            const s = inspect(predicate);
            return {
              async limit(_n: number): Promise<unknown[]> {
                if (name === 'api_keys') {
                  return state.keys
                    .filter((k) => s.includes(`value: '${k.keyHash}'`))
                    .map((k) => ({
                      id: k.id,
                      userId: k.userId,
                      revokedAt: k.revokedAt,
                      expiresAt: k.expiresAt,
                    }));
                }
                if (name === 'users') {
                  return state.users
                    .filter((u) => s.includes(`value: ${u.id}`))
                    .map((u) => ({ externalId: u.externalId }));
                }
                return [];
              },
            };
          },
        };
      },
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function update(table: any) {
    const name = tableName(table);
    return {
      set(values: Record<string, unknown>) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const ret = {
          async where(_predicate: any): Promise<void> {
            lastUpdate = { table: name, values };
          },
          then(
            onfulfilled?: (value: void) => unknown,
            onrejected?: (reason: unknown) => unknown,
          ) {
            // Support the handler's fire-and-forget update().catch
            // pattern — promises chained off a non-awaited update
            // need a usable then() so the chain doesn't NPE.
            return Promise.resolve()
              .then(() => {
                lastUpdate = { table: name, values };
              })
              .then(onfulfilled, onrejected);
          },
        };
        return ret;
      },
    };
  }

  function inspect(p: unknown): string {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('node:util').inspect(p, { depth: 6, getters: true });
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function tableName(table: any): string {
    return (
      table[Symbol.for('drizzle:Name')] ??
      table?._?.name ??
      String(table?.name ?? '')
    );
  }
  return {
    db: { select, update } as unknown as Parameters<typeof createWebhookTasksHandler>[0]['db'],
    getLastUpdate: () => lastUpdate,
  };
}

function makeRes() {
  const captured: { status?: number; json?: unknown } = {};
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const res: any = {
    status(code: number) {
      captured.status = code;
      return res;
    },
    json(payload: unknown) {
      captured.json = payload;
      return res;
    },
  };
  return { res: res as Response, captured };
}

function makeReq(opts: {
  auth?: string;
  body?: unknown;
  path?: string;
  headers?: Record<string, string>;
} = {}): Request {
  const lowerHeaders: Record<string, string> = {};
  for (const [k, v] of Object.entries(opts.headers ?? {})) {
    lowerHeaders[k.toLowerCase()] = v;
  }
  return {
    header(name: string) {
      const lower = name.toLowerCase();
      if (lower === 'authorization') return opts.auth;
      return lowerHeaders[lower];
    },
    body: opts.body,
    path: opts.path ?? '/webhooks/tasks',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

describe('resolveApiKey', () => {
  it('null bearer → missing', async () => {
    const { db } = makeFakeDb({ keys: [], users: [] });
    expect(await resolveApiKey(null, db)).toEqual({ ok: false, code: 'missing' });
  });

  it('malformed bearer → malformed', async () => {
    const { db } = makeFakeDb({ keys: [], users: [] });
    expect(await resolveApiKey('sk_test_abc', db)).toEqual({
      ok: false,
      code: 'malformed',
    });
  });

  it('valid-shape but unknown hash → unknown', async () => {
    const { db } = makeFakeDb({ keys: [], users: [] });
    const fresh = generateApiKey();
    expect(await resolveApiKey(fresh.plaintext, db)).toEqual({
      ok: false,
      code: 'unknown',
    });
  });

  it('found + not revoked + not expired → ok', async () => {
    const { plaintext, hash } = generateApiKey();
    const { db } = makeFakeDb({
      keys: [{ id: 1, userId: 42, keyHash: hash, revokedAt: null, expiresAt: null }],
      users: [{ id: 42, externalId: 'usr_test' }],
    });
    const r = await resolveApiKey(plaintext, db);
    expect(r).toEqual({ ok: true, userExternalId: 'usr_test', apiKeyInternalId: 1 });
  });

  it('revoked key → revoked', async () => {
    const { plaintext, hash } = generateApiKey();
    const { db } = makeFakeDb({
      keys: [
        {
          id: 2,
          userId: 42,
          keyHash: hash,
          revokedAt: new Date('2026-01-01'),
          expiresAt: null,
        },
      ],
      users: [{ id: 42, externalId: 'usr_test' }],
    });
    expect((await resolveApiKey(plaintext, db)).ok).toBe(false);
    const r = await resolveApiKey(plaintext, db);
    if (!r.ok) expect(r.code).toBe('revoked');
  });

  it('expired key → expired', async () => {
    const { plaintext, hash } = generateApiKey();
    const { db } = makeFakeDb({
      keys: [
        {
          id: 3,
          userId: 42,
          keyHash: hash,
          revokedAt: null,
          expiresAt: new Date('2020-01-01'),
        },
      ],
      users: [{ id: 42, externalId: 'usr_test' }],
    });
    const r = await resolveApiKey(plaintext, db);
    if (!r.ok) expect(r.code).toBe('expired');
  });
});

describe('createWebhookTasksHandler', () => {
  function setup(opts?: {
    revoked?: boolean;
    expired?: boolean;
    dispatchThrow?: TRPCError | Error | null;
  }) {
    const { plaintext, hash } = generateApiKey();
    const { db } = makeFakeDb({
      keys: [
        {
          id: 1,
          userId: 42,
          keyHash: hash,
          revokedAt: opts?.revoked ? new Date('2026-01-01') : null,
          expiresAt: opts?.expired ? new Date('2020-01-01') : null,
        },
      ],
      users: [{ id: 42, externalId: 'usr_test' }],
    });
    const dispatch = vi.fn(async () => ({ taskId: 'tsk_X', status: 'pending' }));
    if (opts?.dispatchThrow) {
      dispatch.mockImplementationOnce(async () => {
        throw opts.dispatchThrow as Error;
      });
    }
    const handler = createWebhookTasksHandler({
      db,
      logger: fakeLogger,
      buildContextForUser: (userExternalId) =>
        ({ userId: userExternalId }) as unknown as import('../trpc/context.js').Context,
      dispatch,
    });
    return { handler, plaintext, dispatch };
  }

  it('200: valid key + valid prompt → dispatch called, returns taskId + status', async () => {
    const { handler, plaintext, dispatch } = setup();
    const req = makeReq({
      auth: `Bearer ${plaintext}`,
      body: { prompt: 'translate hello world to chinese' },
    });
    const { res, captured } = makeRes();
    await handler(req, res);
    expect(captured.status).toBe(200);
    expect(captured.json).toEqual({ taskId: 'tsk_X', status: 'pending' });
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'usr_test' }),
      { intent: 'translate hello world to chinese' },
    );
  });

  it('401: missing Authorization header', async () => {
    const { handler } = setup();
    const { res, captured } = makeRes();
    await handler(makeReq({ body: { prompt: 'x' } }), res);
    expect(captured.status).toBe(401);
    expect(captured.json).toEqual({ error: 'invalid_api_key' });
  });

  it('401: malformed bearer (wrong prefix)', async () => {
    const { handler } = setup();
    const { res, captured } = makeRes();
    await handler(
      makeReq({ auth: 'Bearer sk_test_abc', body: { prompt: 'x' } }),
      res,
    );
    expect(captured.status).toBe(401);
  });

  it('401: revoked key', async () => {
    const { handler, plaintext } = setup({ revoked: true });
    const { res, captured } = makeRes();
    await handler(
      makeReq({ auth: `Bearer ${plaintext}`, body: { prompt: 'x' } }),
      res,
    );
    expect(captured.status).toBe(401);
  });

  it('401: expired key', async () => {
    const { handler, plaintext } = setup({ expired: true });
    const { res, captured } = makeRes();
    await handler(
      makeReq({ auth: `Bearer ${plaintext}`, body: { prompt: 'x' } }),
      res,
    );
    expect(captured.status).toBe(401);
  });

  it('400: missing prompt', async () => {
    const { handler, plaintext, dispatch } = setup();
    const { res, captured } = makeRes();
    await handler(makeReq({ auth: `Bearer ${plaintext}`, body: {} }), res);
    expect(captured.status).toBe(400);
    expect(captured.json).toEqual({ error: 'missing_prompt' });
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('400: prompt too long', async () => {
    const { handler, plaintext } = setup();
    const { res, captured } = makeRes();
    await handler(
      makeReq({
        auth: `Bearer ${plaintext}`,
        body: { prompt: 'x'.repeat(2_001) },
      }),
      res,
    );
    expect(captured.status).toBe(400);
    expect(captured.json).toEqual({ error: 'prompt_too_long' });
  });

  it('429: dispatch throws TOO_MANY_REQUESTS → quota_exceeded', async () => {
    const { handler, plaintext } = setup({
      dispatchThrow: new TRPCError({
        code: 'TOO_MANY_REQUESTS',
        message: 'daily quota exceeded (3/3)',
      }),
    });
    const { res, captured } = makeRes();
    await handler(
      makeReq({ auth: `Bearer ${plaintext}`, body: { prompt: 'x' } }),
      res,
    );
    expect(captured.status).toBe(429);
    expect((captured.json as { error: string }).error).toBe('quota_exceeded');
  });

  it('429: dispatch throws PRECONDITION_FAILED with "quota" message → quota_exceeded', async () => {
    const { handler, plaintext } = setup({
      dispatchThrow: new TRPCError({
        code: 'PRECONDITION_FAILED',
        message: '今日配额已用尽',
      }),
    });
    const { res, captured } = makeRes();
    await handler(
      makeReq({ auth: `Bearer ${plaintext}`, body: { prompt: 'x' } }),
      res,
    );
    expect(captured.status).toBe(429);
  });

  it('500: dispatch throws generic Error → internal_error', async () => {
    const { handler, plaintext } = setup({
      dispatchThrow: new Error('something broke'),
    });
    const { res, captured } = makeRes();
    await handler(
      makeReq({ auth: `Bearer ${plaintext}`, body: { prompt: 'x' } }),
      res,
    );
    expect(captured.status).toBe(500);
  });
});

describe('createWebhookTasksHandler — idempotency (Phase 5d follow-up)', () => {
  /**
   * Extended fake DB that supports select + insert + delete on
   * webhook_idempotency (the existing makeFakeDb above only handles
   * api_keys + users for the auth-only tests).
   *
   * State:
   *   - keys: api key rows (drives auth resolution)
   *   - users: user rows (drives owner resolution)
   *   - idempotency: webhook_idempotency rows
   * Mutations:
   *   - INSERT INTO webhook_idempotency appends to state.idempotency
   *   - UPDATE api_keys last_used_at is silently accepted
   */
  function setup() {
    const { plaintext, hash } = generateApiKey();
    interface IdemRow {
      userId: number;
      idempotencyKey: string;
      requestHash: string;
      taskId: string;
      responseJson: unknown;
      expiresAt: Date;
    }
    const state = {
      keys: [
        {
          id: 1,
          userId: 42,
          keyHash: hash,
          revokedAt: null as Date | null,
          expiresAt: null as Date | null,
        },
      ],
      users: [{ id: 42, externalId: 'usr_test' }],
      idempotency: [] as IdemRow[],
      // Track inserts so tests can assert on persistence.
      lastInsert: null as Record<string, unknown> | null,
    };
    function inspect(p: unknown): string {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      return require('node:util').inspect(p, { depth: 6, getters: true });
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    function tableName(table: any): string {
      return (
        table[Symbol.for('drizzle:Name')] ??
        table?._?.name ??
        String(table?.name ?? '')
      );
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db: any = {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      select(_fields?: any) {
        return {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          from(table: any) {
            const name = tableName(table);
            return {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              where(predicate: any) {
                const s = inspect(predicate);
                return {
                  async limit(_n: number): Promise<unknown[]> {
                    if (name === 'api_keys') {
                      return state.keys
                        .filter((k) => s.includes(`value: '${k.keyHash}'`))
                        .map((k) => ({
                          id: k.id,
                          userId: k.userId,
                          revokedAt: k.revokedAt,
                          expiresAt: k.expiresAt,
                        }));
                    }
                    if (name === 'users') {
                      return state.users
                        .filter((u) => s.includes(`value: ${u.id}`))
                        .map((u) => ({ id: u.id, externalId: u.externalId }));
                    }
                    if (name === 'webhook_idempotency') {
                      return state.idempotency
                        .filter(
                          (i) =>
                            s.includes(`value: ${i.userId}`) &&
                            s.includes(`value: '${i.idempotencyKey}'`),
                        )
                        .map(
                          ({ requestHash, taskId, responseJson, expiresAt }) => ({
                            requestHash,
                            taskId,
                            responseJson,
                            expiresAt,
                          }),
                        );
                    }
                    return [];
                  },
                };
              },
            };
          },
        };
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      update(_table: any) {
        return {
          set(_values: Record<string, unknown>) {
            return {
              async where(_predicate: unknown) {
                return {};
              },
              then(onfulfilled?: (v: void) => unknown, onrejected?: (e: unknown) => unknown) {
                return Promise.resolve().then(onfulfilled, onrejected);
              },
            };
          },
        };
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      insert(table: any) {
        const name = tableName(table);
        return {
          async values(values: Record<string, unknown>) {
            if (name === 'webhook_idempotency') {
              state.lastInsert = values;
              state.idempotency.push({
                userId: values.userId as number,
                idempotencyKey: values.idempotencyKey as string,
                requestHash: values.requestHash as string,
                taskId: values.taskId as string,
                responseJson: values.responseJson,
                expiresAt: values.expiresAt as Date,
              });
            }
          },
        };
      },
    };
    const dispatch = vi.fn(async () => ({
      taskId: 'tsk_fresh',
      status: 'pending',
    }));
    const handler = createWebhookTasksHandler({
      db,
      logger: fakeLogger,
      buildContextForUser: (userExternalId) =>
        ({ userId: userExternalId }) as unknown as import('../trpc/context.js').Context,
      dispatch,
    });
    return { handler, plaintext, dispatch, state };
  }

  it('no Idempotency-Key header → bypasses cache (back-compat)', async () => {
    const { handler, plaintext, dispatch, state } = setup();
    const { res, captured } = makeRes();
    await handler(
      makeReq({
        auth: `Bearer ${plaintext}`,
        body: { prompt: 'no key' },
      }),
      res,
    );
    expect(captured.status).toBe(200);
    expect(dispatch).toHaveBeenCalledTimes(1);
    // No idempotency row should be inserted.
    expect(state.idempotency).toHaveLength(0);
  });

  it('first call with Idempotency-Key → dispatch + record row', async () => {
    const { handler, plaintext, dispatch, state } = setup();
    const { res, captured } = makeRes();
    await handler(
      makeReq({
        auth: `Bearer ${plaintext}`,
        body: { prompt: 'first call' },
        headers: { 'Idempotency-Key': 'zap-abc-123' },
      }),
      res,
    );
    expect(captured.status).toBe(200);
    expect(captured.json).toEqual({ taskId: 'tsk_fresh', status: 'pending' });
    expect(dispatch).toHaveBeenCalledTimes(1);
    // Row inserted with hash + taskId.
    expect(state.idempotency).toHaveLength(1);
    expect(state.idempotency[0]?.taskId).toBe('tsk_fresh');
    expect(state.idempotency[0]?.idempotencyKey).toBe('zap-abc-123');
  });

  it('replay: second call with same key + same body → cached response, no second dispatch', async () => {
    const { handler, plaintext, dispatch, state } = setup();
    // Seed the cache by running the first call.
    const r1 = makeRes();
    await handler(
      makeReq({
        auth: `Bearer ${plaintext}`,
        body: { prompt: 'replay me' },
        headers: { 'Idempotency-Key': 'zap-456' },
      }),
      r1.res,
    );
    expect(r1.captured.status).toBe(200);
    // Reset dispatch count to assert the second call doesn't fire it.
    dispatch.mockClear();
    const r2 = makeRes();
    await handler(
      makeReq({
        auth: `Bearer ${plaintext}`,
        body: { prompt: 'replay me' },
        headers: { 'Idempotency-Key': 'zap-456' },
      }),
      r2.res,
    );
    expect(r2.captured.status).toBe(200);
    expect(r2.captured.json).toEqual({ taskId: 'tsk_fresh', status: 'pending' });
    expect(dispatch).not.toHaveBeenCalled();
    // Cache size stays 1.
    expect(state.idempotency).toHaveLength(1);
  });

  it('conflict: same key + different body → 409 with originalTaskId', async () => {
    const { handler, plaintext, dispatch } = setup();
    await handler(
      makeReq({
        auth: `Bearer ${plaintext}`,
        body: { prompt: 'first version' },
        headers: { 'Idempotency-Key': 'zap-999' },
      }),
      makeRes().res,
    );
    dispatch.mockClear();
    const r2 = makeRes();
    await handler(
      makeReq({
        auth: `Bearer ${plaintext}`,
        body: { prompt: 'DIFFERENT version' },
        headers: { 'Idempotency-Key': 'zap-999' },
      }),
      r2.res,
    );
    expect(r2.captured.status).toBe(409);
    expect((r2.captured.json as { error: string }).error).toBe(
      'idempotency_conflict',
    );
    expect((r2.captured.json as { originalTaskId: string }).originalTaskId).toBe(
      'tsk_fresh',
    );
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('400 invalid_idempotency_key for malformed key (whitespace / control chars)', async () => {
    const { handler, plaintext } = setup();
    const { res, captured } = makeRes();
    await handler(
      makeReq({
        auth: `Bearer ${plaintext}`,
        body: { prompt: 'x' },
        headers: { 'Idempotency-Key': 'has spaces!' },
      }),
      res,
    );
    expect(captured.status).toBe(400);
    expect((captured.json as { error: string }).error).toBe('invalid_idempotency_key');
  });

  it('body-key order insensitive — different JSON serialization order → same hash → replay', async () => {
    const { handler, plaintext, dispatch } = setup();
    await handler(
      makeReq({
        auth: `Bearer ${plaintext}`,
        body: { prompt: 'shared', roleId: 'r1' },
        headers: { 'Idempotency-Key': 'zap-order' },
      }),
      makeRes().res,
    );
    dispatch.mockClear();
    const r2 = makeRes();
    await handler(
      makeReq({
        auth: `Bearer ${plaintext}`,
        // Same fields, different key order → canonicalize produces
        // identical hash → replay.
        body: { roleId: 'r1', prompt: 'shared' },
        headers: { 'Idempotency-Key': 'zap-order' },
      }),
      r2.res,
    );
    expect(r2.captured.status).toBe(200);
    expect(dispatch).not.toHaveBeenCalled();
  });
});
