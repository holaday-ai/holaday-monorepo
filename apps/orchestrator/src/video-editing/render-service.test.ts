import { describe, expect, it, vi } from 'vitest';
import {
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
    failAttempt: vi.fn(async () => ({ status: 'failed' }) as const),
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
