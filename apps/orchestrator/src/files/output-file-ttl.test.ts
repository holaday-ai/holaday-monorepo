import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_OUTPUT_FILE_TTL_DAYS,
  FileService,
  outputFileTtlMs,
} from './file-service.js';

const DAY_MS = 24 * 60 * 60 * 1000;

describe('outputFileTtlMs — env-configurable output (成片) TTL', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('defaults to 30 days', () => {
    expect(DEFAULT_OUTPUT_FILE_TTL_DAYS).toBe(30);
    expect(outputFileTtlMs()).toBe(30 * DAY_MS);
  });

  it('honours OUTPUT_FILE_TTL_DAYS=7 → 7 days', () => {
    vi.stubEnv('OUTPUT_FILE_TTL_DAYS', '7');
    expect(outputFileTtlMs()).toBe(7 * DAY_MS);
  });

  it('falls back to 30d for invalid / non-positive values', () => {
    for (const bad of ['', 'abc', '0', '-5', 'NaN', 'Infinity']) {
      vi.stubEnv('OUTPUT_FILE_TTL_DAYS', bad);
      expect(outputFileTtlMs()).toBe(30 * DAY_MS);
    }
  });
});

/**
 * Real `storeOutput` path — a minimal in-memory db/storage harness (same shape
 * as upload-allowlist.test.ts) so we exercise the actual expires_at stamp, not
 * a mock of it.
 */
function harness() {
  let inserted: Record<string, unknown> | undefined;
  const db = {
    insert: () => ({
      values: (row: Record<string, unknown>) => {
        inserted = { ...row, id: 1 };
        return Promise.resolve();
      },
    }),
    select: () => ({
      from: () => ({
        where: () => ({ limit: () => Promise.resolve([inserted]) }),
      }),
    }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
  const logger = {
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
    debug: () => undefined,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
  const storage = {
    put: () => Promise.resolve({ storagePath: 'usr/output/file/clip.mp4' }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
  return { db, logger, storage, getInserted: () => inserted };
}

function callStoreOutput(svc: FileService) {
  return svc.storeOutput({
    userIdInternal: 7,
    userExternalId: 'usr_owner',
    taskIdInternal: 9,
    filename: 'clip.mp4',
    mimetype: 'video/mp4',
    buffer: Buffer.from('hello'),
  });
}

describe('storeOutput — stamps the configurable output TTL', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('default: kind=output + expires_at ≈ now + 30d', async () => {
    const { db, logger, storage } = harness();
    const svc = new FileService(db, logger, storage);
    const before = Date.now();
    const row = await callStoreOutput(svc);
    const after = Date.now();

    expect(row.kind).toBe('output');
    const exp = (row.expiresAt as Date).getTime();
    // Tolerance: bounded by the before/after window, not a millisecond match.
    expect(exp).toBeGreaterThanOrEqual(before + 30 * DAY_MS - 50);
    expect(exp).toBeLessThanOrEqual(after + 30 * DAY_MS + 50);
  });

  it('OUTPUT_FILE_TTL_DAYS=7 → expires_at ≈ now + 7d', async () => {
    vi.stubEnv('OUTPUT_FILE_TTL_DAYS', '7');
    const { db, logger, storage } = harness();
    const svc = new FileService(db, logger, storage);
    const before = Date.now();
    const row = await callStoreOutput(svc);
    const after = Date.now();

    const exp = (row.expiresAt as Date).getTime();
    expect(exp).toBeGreaterThanOrEqual(before + 7 * DAY_MS - 50);
    expect(exp).toBeLessThanOrEqual(after + 7 * DAY_MS + 50);
  });
});
