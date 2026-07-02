/**
 * lane-integration helpers — unit tests.
 *
 * The two helpers wrap the response-layer for the three vision-loop
 * lanes (generate / scrape / handoff-generate) so each call site is
 * one-liner-trivial. Tests cover:
 *   - runResponseLayerForLane:
 *       * flag off → no-op (no metadata, no formatter call)
 *       * non-terminal status → no-op
 *       * empty summary → no-op
 *       * (real formatter integration is covered by
 *         openai-response-layer.test.ts; here we verify only the
 *         GATE behaviour because the formatter is dynamic-imported)
 *   - stampResponseLayerColumns:
 *       * metadata undefined → no UPDATE issued (flag-off contract)
 *       * metadata present → UPDATE writes all three columns
 *       * formatter rewrote text → original_summary carries the
 *         pre-format text + formatted_summary carries the final text
 *       * formatter fallback (original undefined) → both columns
 *         carry the final summary (so audits count fallbacks)
 *       * DB error swallowed (best-effort contract)
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  runResponseLayerForLane,
  stampResponseLayerColumns,
} from './lane-integration.js';

const fakeLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  child: vi.fn(),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any;

const savedEnv = { ...process.env };
beforeEach(() => {
  delete process.env.OPENAI_RESPONSE_LAYER_ENABLED;
  delete process.env.OPENAI_API_KEY;
});
afterEach(() => {
  process.env = { ...savedEnv };
});

describe('runResponseLayerForLane', () => {
  it('flag off → no-op (summary unchanged, metadata undefined)', async () => {
    process.env.OPENAI_RESPONSE_LAYER_ENABLED = 'false';
    process.env.OPENAI_API_KEY = 'sk-x';
    const r = await runResponseLayerForLane({
      taskId: 'tsk_x',
      status: 'completed',
      summary: 'a long enough body to be a plausible polish target',
      logger: fakeLogger,
    });
    expect(r.summary).toBe('a long enough body to be a plausible polish target');
    expect(r.responseLayerOriginal).toBeUndefined();
    expect(r.responseLayerMetadata).toBeUndefined();
  });

  it('flag missing → no-op (treats missing as off)', async () => {
    process.env.OPENAI_API_KEY = 'sk-x';
    const r = await runResponseLayerForLane({
      taskId: 'tsk_x',
      status: 'completed',
      summary: 'x'.repeat(300),
      logger: fakeLogger,
    });
    expect(r.responseLayerMetadata).toBeUndefined();
  });

  it('flag on but no API key → no-op (matches isResponseLayerEnabled)', async () => {
    process.env.OPENAI_RESPONSE_LAYER_ENABLED = 'true';
    const r = await runResponseLayerForLane({
      taskId: 'tsk_x',
      status: 'completed',
      summary: 'x'.repeat(300),
      logger: fakeLogger,
    });
    expect(r.responseLayerMetadata).toBeUndefined();
  });

  it('non-terminal status (awaiting_user) → no-op even when flag on', async () => {
    process.env.OPENAI_RESPONSE_LAYER_ENABLED = 'true';
    process.env.OPENAI_API_KEY = 'sk-x';
    const r = await runResponseLayerForLane({
      taskId: 'tsk_x',
      status: 'awaiting_user',
      summary: 'x'.repeat(300),
      logger: fakeLogger,
    });
    expect(r.responseLayerMetadata).toBeUndefined();
  });

  it('empty summary → no-op even when terminal + flag on', async () => {
    process.env.OPENAI_RESPONSE_LAYER_ENABLED = 'true';
    process.env.OPENAI_API_KEY = 'sk-x';
    const r = await runResponseLayerForLane({
      taskId: 'tsk_x',
      status: 'completed',
      summary: '',
      logger: fakeLogger,
    });
    expect(r.summary).toBe('');
    expect(r.responseLayerMetadata).toBeUndefined();
  });

  // Note: the "1 as truthy" flag-parsing variant is covered by
  // openai-response-layer.test.ts:isResponseLayerEnabled — testing
  // it through this helper would require a real OpenAI client (or
  // an injectable seam) which would expand scope. The inline flag
  // gate here mirrors isResponseLayerEnabled's contract.
});

describe('stampResponseLayerColumns', () => {
  function makeFakeDb(affectedRows = 1) {
    const updates: Array<{ setValues: unknown; predicate: unknown }> = [];
    let throwOnUpdate: Error | null = null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db: any = {
      update(_table: unknown) {
        return {
          set(setValues: Record<string, unknown>) {
            return {
              async where(predicate: unknown) {
                if (throwOnUpdate) {
                  const e = throwOnUpdate;
                  throwOnUpdate = null;
                  throw e;
                }
                updates.push({ setValues, predicate });
                return [{ affectedRows }];
              },
            };
          },
        };
      },
    };
    return {
      db,
      updates,
      setThrowOnUpdate: (e: Error) => {
        throwOnUpdate = e;
      },
    };
  }

  it('metadata undefined → NO UPDATE issued (flag-off contract)', async () => {
    const { db, updates } = makeFakeDb();
    const persisted = await stampResponseLayerColumns(
      db,
      'tsk_x',
      undefined,
      'final body',
      undefined,
      fakeLogger,
    );
    expect(persisted).toBe(false);
    expect(updates).toHaveLength(0);
  });

  it('formatter rewrote → original = pre-format, formatted = final, metadata stored', async () => {
    const { db, updates } = makeFakeDb();
    const metadata = { model: 'gpt-4o-mini', latencyMs: 1500, changes: ['length_delta'] };
    const persisted = await stampResponseLayerColumns(
      db,
      'tsk_x',
      'raw agent body',
      'polished body',
      metadata,
      fakeLogger,
    );
    expect(persisted).toBe(true);
    expect(updates).toHaveLength(1);
    const u = updates[0]!.setValues as Record<string, unknown>;
    expect(u.originalSummary).toBe('raw agent body');
    expect(u.formattedSummary).toBe('polished body');
    expect(u.responseLayerMetadata).toEqual(metadata);
  });

  it('formatter fallback (original undefined) → both columns carry final body', async () => {
    // Used when shouldFormat skipped (short_response / api_error /
    // post-check trip) — metadata is set with a fallbackReason so
    // audits can count fallback rates, but both summary columns
    // share the same text.
    const { db, updates } = makeFakeDb();
    const metadata = {
      model: 'gpt-4o-mini',
      latencyMs: 0,
      changes: [],
      fallbackReason: 'short_response',
    };
    const persisted = await stampResponseLayerColumns(
      db,
      'tsk_x',
      undefined,
      'short body',
      metadata,
      fakeLogger,
    );
    expect(persisted).toBe(true);
    expect(updates).toHaveLength(1);
    const u = updates[0]!.setValues as Record<string, unknown>;
    expect(u.originalSummary).toBe('short body');
    expect(u.formattedSummary).toBe('short body');
    expect(u.responseLayerMetadata).toEqual(metadata);
  });

  it('stale / non-terminal row → returns false without pretending to stamp', async () => {
    const { db, updates } = makeFakeDb(0);
    const persisted = await stampResponseLayerColumns(
      db,
      'tsk_x',
      undefined,
      'body',
      { model: 'gpt-4o-mini', latencyMs: 0, changes: [] },
      fakeLogger,
    );
    expect(persisted).toBe(false);
    expect(updates).toHaveLength(1);
  });

  it('DB error → swallowed (best-effort; logs warn)', async () => {
    const { db, setThrowOnUpdate } = makeFakeDb();
    setThrowOnUpdate(new Error('connection refused'));
    // Should NOT throw.
    await expect(
      stampResponseLayerColumns(
        db,
        'tsk_x',
        undefined,
        'body',
        { model: 'gpt-4o-mini', latencyMs: 0, changes: [] },
        fakeLogger,
      ),
    ).resolves.toBe(false);
    expect(fakeLogger.warn).toHaveBeenCalled();
  });
});
