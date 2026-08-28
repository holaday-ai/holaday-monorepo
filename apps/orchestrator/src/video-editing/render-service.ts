import { newExternalId } from '@holaday/shared-types';
import { and, eq, lte } from 'drizzle-orm';
import type { DB } from '../db/client.js';
import { readAffectedRows, readInsertId } from '../db/mysql-result.js';
import type { taskFiles } from '../db/schema/task-files.js';
import {
  videoEditProjects,
  videoEditRenderAttempts,
  videoEditVersions,
} from '../db/schema/video-editing.js';
import type { FileService } from '../files/file-service.js';

export type VideoEditRenderAttemptStatus = 'pending' | 'completed' | 'failed';

export interface VideoEditRenderAttemptRecord {
  id: number;
  externalId: string;
  userId: number;
  projectId: number;
  versionId: number;
  outputFileId: number;
  status: VideoEditRenderAttemptStatus;
  expiresAt: Date;
  completedAt: Date | null;
}

export interface VideoEditRenderFile {
  id: number;
  externalId: string;
  filename: string;
  mimetype: string;
  sizeBytes: number;
  expiresAt: Date | null;
}

export interface VideoEditRenderStore {
  beginAttempt(input: {
    userId: number;
    projectId: string;
    versionId: string;
    renderAttemptId: string;
    outputFileId: number;
    expiresAt: Date;
    createdAt: Date;
  }): Promise<
    | { status: 'started'; attempt: VideoEditRenderAttemptRecord }
    | { status: 'not_found' | 'stale_version' | 'version_not_ready' | 'already_rendering' }
  >;
  findAttempt(input: {
    userId: number;
    projectId: string;
    versionId: string;
    renderAttemptId: string;
    now: Date;
  }): Promise<
    | { status: 'pending'; attempt: VideoEditRenderAttemptRecord }
    | { status: 'completed'; attempt: VideoEditRenderAttemptRecord }
    | { status: 'not_found' | 'expired' | 'failed' | 'stale_version' }
  >;
  completeAttempt(input: {
    userId: number;
    projectId: string;
    versionId: string;
    renderAttemptId: string;
    outputFileId: number;
    completedAt: Date;
  }): Promise<
    | { status: 'completed'; attempt: VideoEditRenderAttemptRecord }
    | { status: 'not_found' | 'failed' | 'stale_version' }
  >;
  failAttempt(input: {
    userId: number;
    projectId: string;
    versionId: string;
    renderAttemptId: string;
    failedAt: Date;
  }): Promise<
    | { status: 'failed'; attempt: VideoEditRenderAttemptRecord }
    | { status: 'completed'; attempt: VideoEditRenderAttemptRecord }
    | { status: 'not_found' }
  >;
}

export interface VideoEditRenderFilePort {
  begin(input: {
    userId: number;
    userExternalId: string;
    filename: string;
    mimetype: 'video/mp4';
    expiresAt: Date;
  }): Promise<{
    file: VideoEditRenderFile;
    uploadUrl: string;
    requiredHeaders: Record<string, string>;
  } | null>;
  complete(
    fileExternalId: string,
    userId: number,
  ): Promise<
    | { status: 'completed'; file: VideoEditRenderFile }
    | { status: 'not_found' | 'not_uploaded' | 'too_large' | 'invalid_mime' }
  >;
  get(fileId: number, userId: number): Promise<VideoEditRenderFile | null>;
  discard(fileExternalId: string, userId: number): Promise<void>;
}

const EXPORT_ATTEMPT_TTL_MS = 15 * 60 * 1_000;
const MAX_EXPORT_DURATION_MS = 60 * 60 * 1_000;

export type VideoEditDownloadPayload = {
  fileId: string;
  filename: string;
  size: number;
  downloadUrl: string;
  expiresAt?: string;
};

function outputPayload(file: VideoEditRenderFile): VideoEditDownloadPayload {
  return {
    fileId: file.externalId,
    filename: file.filename,
    size: file.sizeBytes,
    downloadUrl: `/api/files/${encodeURIComponent(file.externalId)}/download`,
    ...(file.expiresAt ? { expiresAt: file.expiresAt.toISOString() } : {}),
  };
}

export class VideoEditRenderService {
  constructor(
    private readonly dependencies: {
      store: VideoEditRenderStore;
      files: VideoEditRenderFilePort;
      probeVideoMetadata(
        file: VideoEditRenderFile,
        userId: number,
      ): Promise<{ durationMs: number; width: number; height: number }>;
      now?: () => Date;
    },
  ) {}

  async beginExport(input: {
    userId: number;
    userExternalId: string;
    projectId: string;
    versionId: string;
  }): Promise<
    | {
        status: 'ready';
        renderAttemptId: string;
        uploadUrl: string;
        requiredHeaders: Record<string, string>;
        expiresAt: Date;
      }
    | {
        status:
          | 'not_found'
          | 'stale_version'
          | 'version_not_ready'
          | 'already_rendering'
          | 'upload_unavailable';
      }
  > {
    const now = this.dependencies.now?.() ?? new Date();
    const expiresAt = new Date(now.getTime() + EXPORT_ATTEMPT_TTL_MS);
    const pending = await this.dependencies.files.begin({
      userId: input.userId,
      userExternalId: input.userExternalId,
      filename: 'holaday-edited.mp4',
      mimetype: 'video/mp4',
      expiresAt,
    });
    if (!pending) return { status: 'upload_unavailable' };
    const renderAttemptId = newExternalId('videoEditRender');
    const started = await this.dependencies.store.beginAttempt({
      userId: input.userId,
      projectId: input.projectId,
      versionId: input.versionId,
      renderAttemptId,
      outputFileId: pending.file.id,
      expiresAt,
      createdAt: now,
    });
    if (started.status !== 'started') {
      await this.dependencies.files.discard(pending.file.externalId, input.userId);
      return started;
    }
    return {
      status: 'ready',
      renderAttemptId: started.attempt.externalId,
      uploadUrl: pending.uploadUrl,
      requiredHeaders: pending.requiredHeaders,
      expiresAt,
    };
  }

  async completeClientExport(input: {
    userId: number;
    projectId: string;
    versionId: string;
    renderAttemptId: string;
  }): Promise<
    | { status: 'completed'; file: VideoEditDownloadPayload }
    | { status: 'not_found' | 'stale_version' | 'expired' | 'failed' | 'invalid_output' }
  > {
    const now = this.dependencies.now?.() ?? new Date();
    const found = await this.dependencies.store.findAttempt({ ...input, now });
    if (found.status === 'completed') {
      const existing = await this.dependencies.files.get(found.attempt.outputFileId, input.userId);
      return existing
        ? { status: 'completed', file: outputPayload(existing) }
        : { status: 'failed' };
    }
    if (found.status !== 'pending') return found;
    const pendingFile = await this.dependencies.files.get(found.attempt.outputFileId, input.userId);
    if (!pendingFile) {
      await this.fail(input, now);
      return { status: 'invalid_output' };
    }
    const completed = await this.dependencies.files.complete(pendingFile.externalId, input.userId);
    if (completed.status !== 'completed') {
      await this.dependencies.files.discard(pendingFile.externalId, input.userId);
      await this.fail(input, now);
      return { status: 'invalid_output' };
    }
    try {
      const metadata = await this.dependencies.probeVideoMetadata(completed.file, input.userId);
      if (
        !Number.isFinite(metadata.durationMs) ||
        metadata.durationMs <= 0 ||
        metadata.durationMs > MAX_EXPORT_DURATION_MS ||
        !Number.isFinite(metadata.width) ||
        metadata.width <= 0 ||
        !Number.isFinite(metadata.height) ||
        metadata.height <= 0
      ) {
        throw new Error('invalid export video stream');
      }
    } catch {
      await this.dependencies.files.discard(completed.file.externalId, input.userId);
      await this.fail(input, now);
      return { status: 'invalid_output' };
    }
    const attached = await this.dependencies.store.completeAttempt({
      ...input,
      outputFileId: completed.file.id,
      completedAt: now,
    });
    if (attached.status !== 'completed') {
      await this.dependencies.files.discard(completed.file.externalId, input.userId);
      return attached;
    }
    return { status: 'completed', file: outputPayload(completed.file) };
  }

  async failExport(input: {
    userId: number;
    projectId: string;
    versionId: string;
    renderAttemptId: string;
  }): Promise<
    { status: 'failed' | 'not_found' } | { status: 'completed'; file: VideoEditDownloadPayload }
  > {
    const now = this.dependencies.now?.() ?? new Date();
    const failed = await this.dependencies.store.failAttempt({ ...input, failedAt: now });
    if (failed.status === 'not_found') return failed;
    const file = await this.dependencies.files.get(failed.attempt.outputFileId, input.userId);
    if (failed.status === 'completed') {
      return file ? { status: 'completed', file: outputPayload(file) } : { status: 'failed' };
    }
    if (file) await this.dependencies.files.discard(file.externalId, input.userId);
    return { status: 'failed' };
  }

  async getOutput(input: {
    userId: number;
    outputFileId: number;
  }): Promise<VideoEditDownloadPayload | null> {
    const file = await this.dependencies.files.get(input.outputFileId, input.userId);
    return file ? outputPayload(file) : null;
  }

  private fail(
    input: { userId: number; projectId: string; versionId: string; renderAttemptId: string },
    failedAt: Date,
  ) {
    return this.dependencies.store.failAttempt({ ...input, failedAt });
  }
}

function renderFile(row: typeof taskFiles.$inferSelect): VideoEditRenderFile {
  return {
    id: row.id,
    externalId: row.externalId,
    filename: row.filename,
    mimetype: row.mimetype,
    sizeBytes: row.sizeBytes,
    expiresAt: row.expiresAt,
  };
}

function renderAttempt(
  row: typeof videoEditRenderAttempts.$inferSelect,
): VideoEditRenderAttemptRecord {
  return {
    id: row.id,
    externalId: row.externalId,
    userId: row.userId,
    projectId: row.projectId,
    versionId: row.versionId,
    outputFileId: row.outputFileId,
    status: row.status as VideoEditRenderAttemptStatus,
    expiresAt: row.expiresAt,
    completedAt: row.completedAt,
  };
}

export function createVideoEditRenderFilePort(fileService: FileService): VideoEditRenderFilePort {
  return {
    async begin(input) {
      const pending = await fileService.createPendingClientOutput({
        userIdInternal: input.userId,
        userExternalId: input.userExternalId,
        filename: input.filename,
        expiresAt: input.expiresAt,
      });
      return pending
        ? {
            file: renderFile(pending.row),
            uploadUrl: pending.uploadUrl,
            requiredHeaders: pending.requiredHeaders,
          }
        : null;
    },
    async complete(fileExternalId, userId) {
      const completed = await fileService.confirmClientOutput(fileExternalId, userId);
      return completed.status === 'completed'
        ? { status: 'completed', file: renderFile(completed.row) }
        : completed;
    },
    async get(fileId, userId) {
      const row = await fileService.getClientOutputForUser(fileId, userId);
      return row ? renderFile(row) : null;
    },
    discard: (fileExternalId, userId) => fileService.discardClientOutput(fileExternalId, userId),
  };
}

export class DrizzleVideoEditRenderStore implements VideoEditRenderStore {
  constructor(private readonly db: DB) {}

  async beginAttempt(input: Parameters<VideoEditRenderStore['beginAttempt']>[0]) {
    return this.db.transaction(async (transaction) => {
      const [project] = await transaction
        .select()
        .from(videoEditProjects)
        .where(
          and(
            eq(videoEditProjects.externalId, input.projectId),
            eq(videoEditProjects.userId, input.userId),
          ),
        )
        .limit(1)
        .for('update');
      if (!project || project.currentVersionId === null) return { status: 'not_found' as const };
      const [version] = await transaction
        .select()
        .from(videoEditVersions)
        .where(
          and(
            eq(videoEditVersions.id, project.currentVersionId),
            eq(videoEditVersions.externalId, input.versionId),
          ),
        )
        .limit(1)
        .for('update');
      if (!version) return { status: 'stale_version' as const };
      if (version.sdkDocument === null) return { status: 'version_not_ready' as const };
      let renderStatus = version.renderStatus;
      if (renderStatus === 'rendering') {
        const expired = await transaction
          .update(videoEditRenderAttempts)
          .set({ status: 'failed' })
          .where(
            and(
              eq(videoEditRenderAttempts.projectId, project.id),
              eq(videoEditRenderAttempts.versionId, version.id),
              eq(videoEditRenderAttempts.status, 'pending'),
              lte(videoEditRenderAttempts.expiresAt, input.createdAt),
            ),
          );
        if (readAffectedRows(expired) > 0) {
          await transaction
            .update(videoEditVersions)
            .set({ renderStatus: 'failed' })
            .where(eq(videoEditVersions.id, version.id));
          renderStatus = 'failed';
        }
      }
      if (renderStatus !== 'idle' && renderStatus !== 'failed') {
        return { status: 'already_rendering' as const };
      }
      const result = await transaction.insert(videoEditRenderAttempts).values({
        externalId: input.renderAttemptId,
        userId: input.userId,
        projectId: project.id,
        versionId: version.id,
        outputFileId: input.outputFileId,
        status: 'pending',
        expiresAt: input.expiresAt,
        completedAt: null,
        createdAt: input.createdAt,
      });
      const attemptId = readInsertId(result);
      await transaction
        .update(videoEditVersions)
        .set({ renderStatus: 'rendering' })
        .where(eq(videoEditVersions.id, version.id));
      return {
        status: 'started' as const,
        attempt: renderAttempt({
          id: attemptId,
          externalId: input.renderAttemptId,
          userId: input.userId,
          projectId: project.id,
          versionId: version.id,
          outputFileId: input.outputFileId,
          status: 'pending',
          expiresAt: input.expiresAt,
          completedAt: null,
          createdAt: input.createdAt,
        }),
      };
    });
  }

  async findAttempt(input: Parameters<VideoEditRenderStore['findAttempt']>[0]) {
    return this.db.transaction(async (transaction) => {
      const [row] = await transaction
        .select({
          attempt: videoEditRenderAttempts,
          projectExternalId: videoEditProjects.externalId,
          currentVersionId: videoEditProjects.currentVersionId,
          versionExternalId: videoEditVersions.externalId,
        })
        .from(videoEditRenderAttempts)
        .innerJoin(videoEditProjects, eq(videoEditRenderAttempts.projectId, videoEditProjects.id))
        .innerJoin(videoEditVersions, eq(videoEditRenderAttempts.versionId, videoEditVersions.id))
        .where(
          and(
            eq(videoEditRenderAttempts.externalId, input.renderAttemptId),
            eq(videoEditRenderAttempts.userId, input.userId),
            eq(videoEditProjects.externalId, input.projectId),
            eq(videoEditVersions.externalId, input.versionId),
          ),
        )
        .limit(1)
        .for('update');
      if (!row) return { status: 'not_found' as const };
      if (row.currentVersionId !== row.attempt.versionId)
        return { status: 'stale_version' as const };
      if (row.attempt.status === 'completed') {
        return { status: 'completed' as const, attempt: renderAttempt(row.attempt) };
      }
      if (row.attempt.status === 'failed') return { status: 'failed' as const };
      if (row.attempt.expiresAt <= input.now) {
        await transaction
          .update(videoEditRenderAttempts)
          .set({ status: 'failed' })
          .where(
            and(
              eq(videoEditRenderAttempts.id, row.attempt.id),
              eq(videoEditRenderAttempts.status, 'pending'),
            ),
          );
        await transaction
          .update(videoEditVersions)
          .set({ renderStatus: 'failed' })
          .where(eq(videoEditVersions.id, row.attempt.versionId));
        return { status: 'expired' as const };
      }
      return { status: 'pending' as const, attempt: renderAttempt(row.attempt) };
    });
  }

  async completeAttempt(input: Parameters<VideoEditRenderStore['completeAttempt']>[0]) {
    return this.db.transaction(async (transaction) => {
      const [row] = await transaction
        .select({
          attempt: videoEditRenderAttempts,
          currentVersionId: videoEditProjects.currentVersionId,
          projectExternalId: videoEditProjects.externalId,
          versionExternalId: videoEditVersions.externalId,
        })
        .from(videoEditRenderAttempts)
        .innerJoin(videoEditProjects, eq(videoEditRenderAttempts.projectId, videoEditProjects.id))
        .innerJoin(videoEditVersions, eq(videoEditRenderAttempts.versionId, videoEditVersions.id))
        .where(
          and(
            eq(videoEditRenderAttempts.externalId, input.renderAttemptId),
            eq(videoEditRenderAttempts.userId, input.userId),
            eq(videoEditProjects.externalId, input.projectId),
            eq(videoEditVersions.externalId, input.versionId),
          ),
        )
        .limit(1)
        .for('update');
      if (!row) return { status: 'not_found' as const };
      if (row.currentVersionId !== row.attempt.versionId)
        return { status: 'stale_version' as const };
      if (row.attempt.status === 'completed') {
        return { status: 'completed' as const, attempt: renderAttempt(row.attempt) };
      }
      if (row.attempt.status !== 'pending' || row.attempt.outputFileId !== input.outputFileId) {
        return { status: 'failed' as const };
      }
      const attemptUpdate = await transaction
        .update(videoEditRenderAttempts)
        .set({ status: 'completed', completedAt: input.completedAt })
        .where(
          and(
            eq(videoEditRenderAttempts.id, row.attempt.id),
            eq(videoEditRenderAttempts.status, 'pending'),
          ),
        );
      if (readAffectedRows(attemptUpdate) !== 1) return { status: 'failed' as const };
      await transaction
        .update(videoEditVersions)
        .set({ renderStatus: 'completed', outputFileId: input.outputFileId })
        .where(eq(videoEditVersions.id, row.attempt.versionId));
      return {
        status: 'completed' as const,
        attempt: renderAttempt({
          ...row.attempt,
          status: 'completed',
          completedAt: input.completedAt,
        }),
      };
    });
  }

  async failAttempt(input: Parameters<VideoEditRenderStore['failAttempt']>[0]) {
    return this.db.transaction(async (transaction) => {
      const [row] = await transaction
        .select({
          attempt: videoEditRenderAttempts,
          currentVersionId: videoEditProjects.currentVersionId,
        })
        .from(videoEditRenderAttempts)
        .innerJoin(videoEditProjects, eq(videoEditRenderAttempts.projectId, videoEditProjects.id))
        .innerJoin(videoEditVersions, eq(videoEditRenderAttempts.versionId, videoEditVersions.id))
        .where(
          and(
            eq(videoEditRenderAttempts.externalId, input.renderAttemptId),
            eq(videoEditRenderAttempts.userId, input.userId),
            eq(videoEditProjects.externalId, input.projectId),
            eq(videoEditVersions.externalId, input.versionId),
          ),
        )
        .limit(1)
        .for('update');
      if (!row) return { status: 'not_found' as const };
      if (row.attempt.status === 'completed') {
        return { status: 'completed' as const, attempt: renderAttempt(row.attempt) };
      }
      if (row.attempt.status !== 'pending') {
        return { status: 'failed' as const, attempt: renderAttempt(row.attempt) };
      }
      await transaction
        .update(videoEditRenderAttempts)
        .set({ status: 'failed' })
        .where(
          and(
            eq(videoEditRenderAttempts.id, row.attempt.id),
            eq(videoEditRenderAttempts.status, 'pending'),
          ),
        );
      if (row.currentVersionId === row.attempt.versionId) {
        await transaction
          .update(videoEditVersions)
          .set({ renderStatus: 'failed' })
          .where(eq(videoEditVersions.id, row.attempt.versionId));
      }
      return { status: 'failed' as const, attempt: renderAttempt(row.attempt) };
    });
  }
}
