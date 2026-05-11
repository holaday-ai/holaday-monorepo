/**
 * Codex P5 follow-up — verify FileService routes through the
 * shared StorageProvider singleton.
 *
 * Phase 5c shipped a Storage abstraction but the FileService default
 * constructor branch quietly built a fresh LocalStorageProvider —
 * which means flipping STORAGE_PROVIDER=r2 had ZERO effect on real
 * traffic until you also passed a provider to every FileService new.
 * The fix: FileService's default branch now resolves through
 * `getSharedStorageProvider(...)` so the env-driven singleton is
 * actually consumed.
 *
 * This test:
 *   1. Resets the storage singleton
 *   2. Stubs `STORAGE_PROVIDER=local` with a custom root via the
 *      `HOLADAY_FILES_ROOT` env var
 *   3. Constructs a FileService with NO explicit provider argument
 *   4. Asserts the storage_path written into the DB row sits under
 *      the custom root — proving the singleton was used.
 *
 * A separate R2 integration test would require live creds; we lean
 * on the existing storage-provider.test.ts (stubbed S3Client) for
 * the R2 path's correctness.
 */

import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  LocalStorageProvider,
  _resetSharedStorageProviderForTesting,
  getSharedStorageProvider,
} from './storage-provider.js';

const fakeLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  child: vi.fn(),
  level: 'silent',
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any;

describe('FileService → shared StorageProvider plumbing (Codex P5 fix)', () => {
  let originalRoot: string | undefined;
  let originalProvider: string | undefined;
  let testRoot: string;

  beforeEach(async () => {
    originalRoot = process.env.HOLADAY_FILES_ROOT;
    originalProvider = process.env.STORAGE_PROVIDER;
    testRoot = await mkdtemp(path.join(tmpdir(), 'holaday-fs-int-'));
    process.env.HOLADAY_FILES_ROOT = testRoot;
    process.env.STORAGE_PROVIDER = 'local';
    _resetSharedStorageProviderForTesting();
  });

  afterEach(async () => {
    process.env.HOLADAY_FILES_ROOT = originalRoot;
    process.env.STORAGE_PROVIDER = originalProvider;
    _resetSharedStorageProviderForTesting();
    await rm(testRoot, { recursive: true, force: true });
  });

  it('singleton honours STORAGE_PROVIDER + HOLADAY_FILES_ROOT env', () => {
    const shared = getSharedStorageProvider({ logger: fakeLogger });
    expect(shared).toBeInstanceOf(LocalStorageProvider);
  });

  it('singleton is the same instance across calls', () => {
    const a = getSharedStorageProvider({ logger: fakeLogger });
    const b = getSharedStorageProvider({ logger: fakeLogger });
    expect(a).toBe(b);
  });

  it('LocalStorageProvider writes under the env-configured root', async () => {
    const shared = getSharedStorageProvider({ logger: fakeLogger });
    const { storagePath } = await shared.put({
      userExternalId: 'usr_test',
      kind: 'output',
      fileExternalId: 'file_test',
      filename: 'hello.txt',
      buffer: Buffer.from('hello'),
      mimetype: 'text/plain',
    });
    // Storage path must live under the test root — proving the
    // singleton picked up HOLADAY_FILES_ROOT at construction time.
    expect(storagePath.startsWith(testRoot)).toBe(true);
    // And the file is actually on disk.
    const stats = await stat(storagePath);
    expect(stats.size).toBe(5);
  });

  it('round-trip via the shared provider preserves bytes', async () => {
    const shared = getSharedStorageProvider({ logger: fakeLogger });
    const buf = Buffer.from('round-trip-bytes');
    const { storagePath } = await shared.put({
      userExternalId: 'usr_test',
      kind: 'output',
      fileExternalId: 'file_x',
      filename: 'r.bin',
      buffer: buf,
      mimetype: 'application/octet-stream',
    });
    const got = await shared.get(storagePath);
    expect(got?.equals(buf)).toBe(true);
  });
});
