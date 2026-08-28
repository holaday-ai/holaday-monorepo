import { describe, expect, it, vi } from 'vitest';
import {
  DrizzleVideoEditRenderStore,
  type VideoEditRenderAttemptRecord,
  type VideoEditRenderFile,
  type VideoEditRenderFilePort,
  VideoEditRenderService,
  type VideoEditRenderStore,
} from './render-service.js';

const FILE: VideoEditRenderFile = {
  id: 71,
  externalId: 'file_output',
  filename: 'holaday-edited.mp4',
  mimetype: 'video/mp4',
  sizeBytes: 8_000_000,
  expiresAt: new Date('2026-09-27T00:00:00Z'),
};

const ATTEMPT: VideoEditRenderAttemptRecord = {
  id: 81,
  externalId: 'vedr_attempt',
  userId: 7,
  projectId: 41,
  versionId: 51,
  outputFileId: FILE.id,
  status: 'pending',
  expiresAt: new Date('2026-08-28T00:15:00Z'),
  completedAt: null,
};

function fixture(
  overrides: {
    store?: Partial<VideoEditRenderStore>;
    files?: Partial<VideoEditRenderFilePort>;
    metadata?: { durationMs: number; width: number; height: number };
  } = {},
) {
  const store: VideoEditRenderStore = {
    beginAttempt: vi.fn(async () => ({ status: 'started', attempt: ATTEMPT }) as const),
    findAttempt: vi.fn(async () => ({ status: 'pending', attempt: ATTEMPT }) as const),
    completeAttempt: vi.fn(
      async () => ({ status: 'completed', attempt: { ...ATTEMPT, status: 'completed' } }) as const,
    ),
    failAttempt: vi.fn(async () => ({ status: 'failed', attempt: ATTEMPT }) as const),
    ...overrides.store,
  };
  const files: VideoEditRenderFilePort = {
    begin: vi.fn(async () => ({
      file: { ...FILE, sizeBytes: 0, expiresAt: ATTEMPT.expiresAt },
      uploadUrl: 'https://upload.example/output',
      requiredHeaders: { 'Content-Type': 'video/mp4' },
    })),
    complete: vi.fn(async () => ({ status: 'completed', file: FILE }) as const),
    get: vi.fn(async () => FILE),
    discard: vi.fn(async () => undefined),
    ...overrides.files,
  };
  return {
    store,
    files,
    service: new VideoEditRenderService({
      store,
      files,
      probeVideoMetadata: vi.fn(
        async () => overrides.metadata ?? { durationMs: 30_000, width: 1080, height: 1920 },
      ),
      now: () => new Date('2026-08-28T00:00:00Z'),
    }),
  };
}

describe('VideoEditRenderService', () => {
  it('atomically releases an expired pending attempt before starting a retry', async () => {
    let selectIndex = 0;
    const updates: Array<Record<string, unknown>> = [];
    const transaction = {
      select: () => {
        selectIndex += 1;
        const rows =
          selectIndex === 1
            ? [{ id: 41, externalId: 'vedp_project', userId: 7, currentVersionId: 51 }]
            : [
                {
                  id: 51,
                  externalId: 'vedv_current',
                  sdkDocument: 'UBQ2-scene',
                  renderStatus: 'rendering',
                },
              ];
        const chain = {
          from: () => chain,
          where: () => chain,
          limit: () => chain,
          for: async () => rows,
        };
        return chain;
      },
      update: () => ({
        set: (values: Record<string, unknown>) => {
          updates.push(values);
          return { where: async () => [{ affectedRows: 1 }] };
        },
      }),
      insert: () => ({ values: async () => [{ insertId: 82 }] }),
    };
    const store = new DrizzleVideoEditRenderStore({
      transaction: async (run: (tx: typeof transaction) => unknown) => run(transaction),
    } as never);

    await expect(
      store.beginAttempt({
        userId: 7,
        projectId: 'vedp_project',
        versionId: 'vedv_current',
        renderAttemptId: 'vedr_retry',
        outputFileId: 72,
        expiresAt: new Date('2026-08-28T00:30:00Z'),
        createdAt: new Date('2026-08-28T00:15:01Z'),
      }),
    ).resolves.toMatchObject({ status: 'started', attempt: { externalId: 'vedr_retry' } });
    expect(updates).toEqual(
      expect.arrayContaining([
        { status: 'failed' },
        { renderStatus: 'failed' },
        { renderStatus: 'rendering' },
      ]),
    );
  });

  it('binds a new upload target to the owned current version', async () => {
    const f = fixture();
    await expect(
      f.service.beginExport({
        userId: 7,
        userExternalId: 'usr_one',
        projectId: 'vedp_project',
        versionId: 'vedv_current',
      }),
    ).resolves.toEqual({
      status: 'ready',
      renderAttemptId: 'vedr_attempt',
      uploadUrl: 'https://upload.example/output',
      requiredHeaders: { 'Content-Type': 'video/mp4' },
      expiresAt: ATTEMPT.expiresAt,
    });
    expect(f.store.beginAttempt).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 7,
        projectId: 'vedp_project',
        versionId: 'vedv_current',
        outputFileId: FILE.id,
      }),
    );
  });

  it('discards the reserved file when the project is foreign, stale, or already rendering', async () => {
    const f = fixture({
      store: { beginAttempt: vi.fn(async () => ({ status: 'not_found' }) as const) },
    });
    await expect(
      f.service.beginExport({
        userId: 8,
        userExternalId: 'usr_other',
        projectId: 'vedp_foreign',
        versionId: 'vedv_foreign',
      }),
    ).resolves.toEqual({ status: 'not_found' });
    expect(f.files.discard).toHaveBeenCalledWith(FILE.externalId, 8);
  });

  it('discards the reserved file when the immutable version has no editor materialization', async () => {
    const f = fixture({
      store: { beginAttempt: vi.fn(async () => ({ status: 'version_not_ready' }) as const) },
    });

    await expect(
      f.service.beginExport({
        userId: 7,
        userExternalId: 'usr_one',
        projectId: 'vedp_project',
        versionId: 'vedv_unmaterialized',
      }),
    ).resolves.toEqual({ status: 'version_not_ready' });
    expect(f.files.discard).toHaveBeenCalledWith(FILE.externalId, 7);
  });

  it('rejects a foreign, mismatched, or expired attempt before touching uploaded bytes', async () => {
    const f = fixture({
      store: { findAttempt: vi.fn(async () => ({ status: 'not_found' }) as const) },
    });
    await expect(
      f.service.completeClientExport({
        userId: 8,
        projectId: 'vedp_project',
        versionId: 'vedv_current',
        renderAttemptId: 'vedr_attempt',
      }),
    ).resolves.toEqual({ status: 'not_found' });
    expect(f.files.complete).not.toHaveBeenCalled();
  });

  it('verifies the real MP4, size, and duration before attaching output', async () => {
    const f = fixture();
    await expect(
      f.service.completeClientExport({
        userId: 7,
        projectId: 'vedp_project',
        versionId: 'vedv_current',
        renderAttemptId: 'vedr_attempt',
      }),
    ).resolves.toEqual({
      status: 'completed',
      file: {
        fileId: 'file_output',
        filename: 'holaday-edited.mp4',
        size: 8_000_000,
        downloadUrl: '/api/files/file_output/download',
        expiresAt: '2026-09-27T00:00:00.000Z',
      },
    });
    expect(f.store.completeAttempt).toHaveBeenCalledWith({
      userId: 7,
      projectId: 'vedp_project',
      versionId: 'vedv_current',
      renderAttemptId: 'vedr_attempt',
      outputFileId: FILE.id,
      completedAt: new Date('2026-08-28T00:00:00Z'),
    });
  });

  it('fails closed and preserves prior versions when file verification fails', async () => {
    const f = fixture({
      files: { complete: vi.fn(async () => ({ status: 'invalid_mime' }) as const) },
    });
    await expect(
      f.service.completeClientExport({
        userId: 7,
        projectId: 'vedp_project',
        versionId: 'vedv_current',
        renderAttemptId: 'vedr_attempt',
      }),
    ).resolves.toEqual({ status: 'invalid_output' });
    expect(f.store.failAttempt).toHaveBeenCalled();
    expect(f.store.completeAttempt).not.toHaveBeenCalled();
    expect(f.files.discard).toHaveBeenCalledWith(FILE.externalId, 7);
  });

  it('rejects an MP4-labelled object that has no decodable video frame dimensions', async () => {
    const f = fixture({ metadata: { durationMs: 30_000, width: 0, height: 0 } });

    await expect(
      f.service.completeClientExport({
        userId: 7,
        projectId: 'vedp_project',
        versionId: 'vedv_current',
        renderAttemptId: 'vedr_attempt',
      }),
    ).resolves.toEqual({ status: 'invalid_output' });
    expect(f.store.completeAttempt).not.toHaveBeenCalled();
    expect(f.files.discard).toHaveBeenCalledWith(FILE.externalId, 7);
  });

  it('returns the same output for a repeated completion', async () => {
    const f = fixture({
      store: {
        findAttempt: vi.fn(async () => ({
          status: 'completed' as const,
          attempt: {
            ...ATTEMPT,
            status: 'completed' as const,
            completedAt: new Date('2026-08-28T00:00:00Z'),
          },
        })),
      },
    });
    await expect(
      f.service.completeClientExport({
        userId: 7,
        projectId: 'vedp_project',
        versionId: 'vedv_current',
        renderAttemptId: 'vedr_attempt',
      }),
    ).resolves.toMatchObject({ status: 'completed', file: { fileId: 'file_output' } });
    expect(f.files.complete).not.toHaveBeenCalled();
    expect(f.store.completeAttempt).not.toHaveBeenCalled();
  });

  it('preserves and returns a completed output when a late failure report races completion', async () => {
    const completedAttempt = {
      ...ATTEMPT,
      status: 'completed' as const,
      completedAt: new Date('2026-08-28T00:00:00Z'),
    };
    const f = fixture({
      store: {
        failAttempt: vi.fn(async () => ({
          status: 'completed' as const,
          attempt: completedAttempt,
        })),
      },
    });

    await expect(
      f.service.failExport({
        userId: 7,
        projectId: 'vedp_project',
        versionId: 'vedv_current',
        renderAttemptId: 'vedr_attempt',
      }),
    ).resolves.toMatchObject({ status: 'completed', file: { fileId: 'file_output' } });
    expect(f.files.discard).not.toHaveBeenCalled();
  });

  it('locks and fails a pending attempt before discarding its reserved output', async () => {
    const f = fixture({
      store: {
        failAttempt: vi.fn(async () => ({ status: 'failed' as const, attempt: ATTEMPT })),
      },
    });

    await expect(
      f.service.failExport({
        userId: 7,
        projectId: 'vedp_project',
        versionId: 'vedv_current',
        renderAttemptId: 'vedr_attempt',
      }),
    ).resolves.toEqual({ status: 'failed' });
    expect(vi.mocked(f.store.failAttempt).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(f.files.discard).mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
    );
  });

  it('returns an owned retained output for project reload', async () => {
    const f = fixture();

    await expect(f.service.getOutput({ userId: 7, outputFileId: FILE.id })).resolves.toEqual({
      fileId: 'file_output',
      filename: 'holaday-edited.mp4',
      size: 8_000_000,
      downloadUrl: '/api/files/file_output/download',
      expiresAt: '2026-09-27T00:00:00.000Z',
    });
    expect(f.files.get).toHaveBeenCalledWith(FILE.id, 7);
  });
});
