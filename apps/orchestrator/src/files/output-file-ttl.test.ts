import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_OUTPUT_FILE_TTL_DAYS,
  FileService,
  TEMPORARY_OUTPUT_TTL_MS,
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
    update: () => ({
      set: (values: Record<string, unknown>) => ({
        where: () => {
          inserted = { ...inserted, ...values };
          return Promise.resolve();
        },
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
    pathFor: () => 'usr/output/file/clip.mp4',
    put: () => Promise.resolve({ storagePath: 'usr/output/file/clip.mp4' }),
    putFile: () => Promise.resolve({ storagePath: 'usr/output/file/clip.mp4' }),
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

  it('storeOutputFile streams a local artifact and records its real size', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'output-file-ttl-'));
    const sourcePath = path.join(dir, 'video.mp4');
    await fs.writeFile(sourcePath, Buffer.from('streamed-video'));
    try {
      const { db, logger, storage } = harness();
      const putFile = vi.spyOn(storage, 'putFile');
      const svc = new FileService(db, logger, storage as any);
      const row = await svc.storeOutputFile({
        userIdInternal: 7,
        userExternalId: 'usr_owner',
        taskIdInternal: 9,
        filename: 'video.mp4',
        mimetype: 'video/mp4',
        sourcePath,
      });

      expect(putFile).toHaveBeenCalledWith(
        expect.objectContaining({
          sourcePath,
          sizeBytes: 14,
          mimetype: 'video/mp4',
        }),
      );
      expect(row).toMatchObject({ kind: 'output', sizeBytes: 14 });
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});

describe('storeTemporaryOutput — crash-safe provider handoff', () => {
  it('streams a hidden temporary video to storage without buffering the artifact', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'temporary-output-file-'));
    const sourcePath = path.join(dir, 'provider-video.mp4');
    await fs.writeFile(sourcePath, Buffer.from('provider-video'));
    try {
      const { db, logger, storage } = harness();
      const putFile = vi.spyOn(storage, 'putFile');
      const svc = new FileService(db, logger, storage as any);
      const before = Date.now();
      const row = await svc.storeTemporaryOutputFile({
        userIdInternal: 7,
        userExternalId: 'usr_owner',
        taskIdInternal: 9,
        filename: 'provider-video.mp4',
        mimetype: 'video/mp4',
        sourcePath,
      });
      const after = Date.now();

      expect(putFile).toHaveBeenCalledWith(
        expect.objectContaining({
          sourcePath,
          sizeBytes: 14,
          mimetype: 'video/mp4',
        }),
      );
      expect(row).toMatchObject({ kind: 'temp', status: 'active', sizeBytes: 14 });
      const exp = (row.expiresAt as Date).getTime();
      expect(exp).toBeGreaterThanOrEqual(before + TEMPORARY_OUTPUT_TTL_MS - 50);
      expect(exp).toBeLessThanOrEqual(after + TEMPORARY_OUTPUT_TTL_MS + 50);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('leaves a pending cleanup row when a streamed temporary upload fails', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'temporary-output-file-failure-'));
    const sourcePath = path.join(dir, 'provider-video.mp4');
    await fs.writeFile(sourcePath, Buffer.from('provider-video'));
    try {
      const { db, logger, getInserted } = harness();
      const storage = {
        pathFor: () => 'usr/output/file/provider-video.mp4',
        putFile: vi.fn(async () => {
          throw new Error('R2 unavailable');
        }),
      } as any;
      const svc = new FileService(db, logger, storage);

      await expect(
        svc.storeTemporaryOutputFile({
          userIdInternal: 7,
          userExternalId: 'usr_owner',
          taskIdInternal: 9,
          filename: 'provider-video.mp4',
          mimetype: 'video/mp4',
          sourcePath,
        }),
      ).rejects.toThrow('R2 unavailable');

      expect(getInserted()).toMatchObject({
        kind: 'temp',
        status: 'pending',
        storagePath: 'usr/output/file/provider-video.mp4',
        sizeBytes: 14,
      });
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('stores a hidden temp row with a short cleanup TTL', async () => {
    const { db, logger, storage } = harness();
    const svc = new FileService(db, logger, storage);
    const before = Date.now();
    const row = await svc.storeTemporaryOutput({
      userIdInternal: 7,
      userExternalId: 'usr_owner',
      taskIdInternal: 9,
      filename: 'ip-voice.wav',
      mimetype: 'audio/wav',
      buffer: Buffer.from('temporary voice'),
    });
    const after = Date.now();

    expect(row.kind).toBe('temp');
    const exp = (row.expiresAt as Date).getTime();
    expect(exp).toBeGreaterThanOrEqual(before + TEMPORARY_OUTPUT_TTL_MS - 50);
    expect(exp).toBeLessThanOrEqual(after + TEMPORARY_OUTPUT_TTL_MS + 50);
  });

  it('reserves the cleanup row before uploading the temporary object', async () => {
    const db = {
      insert: () => ({
        values: () => Promise.reject(new Error('db unavailable')),
      }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
    const logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
    const storage = {
      pathFor: vi.fn(() => 'usr/output/file/ip-voice.wav'),
      put: vi.fn(async () => ({ storagePath: 'usr/output/file/ip-voice.wav' })),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
    const svc = new FileService(db, logger, storage);

    await expect(
      svc.storeTemporaryOutput({
        userIdInternal: 7,
        userExternalId: 'usr_owner',
        taskIdInternal: 9,
        filename: 'ip-voice.wav',
        mimetype: 'audio/wav',
        buffer: Buffer.from('temporary voice'),
      }),
    ).rejects.toThrow('db unavailable');

    expect(storage.pathFor).toHaveBeenCalled();
    expect(storage.put).not.toHaveBeenCalled();
  });

  it('leaves a pending short-TTL row when storage upload fails', async () => {
    const { db, logger, getInserted } = harness();
    const storage = {
      pathFor: () => 'usr/output/file/ip-voice.wav',
      put: vi.fn(async () => {
        throw new Error('R2 unavailable');
      }),
    } as any;
    const svc = new FileService(db, logger, storage);

    await expect(
      svc.storeTemporaryOutput({
        userIdInternal: 7,
        userExternalId: 'usr_owner',
        taskIdInternal: 9,
        filename: 'ip-voice.wav',
        mimetype: 'audio/wav',
        buffer: Buffer.from('temporary voice'),
      }),
    ).rejects.toThrow('R2 unavailable');

    expect(getInserted()).toMatchObject({
      kind: 'temp',
      status: 'pending',
      storagePath: 'usr/output/file/ip-voice.wav',
    });
  });

  it('retains the DB row when storage deletion fails so cleanup can retry', async () => {
    const deleteRow = vi.fn();
    const db = {
      select: () => ({
        from: () => ({
          where: () => ({
            limit: () =>
              Promise.resolve([
                {
                  externalId: 'file_temp',
                  userId: 7,
                  storagePath: 'usr/output/file/ip-voice.wav',
                },
              ]),
          }),
        }),
      }),
      delete: () => ({ where: deleteRow }),
    } as any;
    const storage = {
      delete: vi.fn(async () => {
        throw new Error('R2 delete failed');
      }),
    } as any;
    const svc = new FileService(db, {} as any, storage);

    await expect(svc.deleteForUser('file_temp', 7)).rejects.toThrow('R2 delete failed');
    expect(deleteRow).not.toHaveBeenCalled();
  });
});
