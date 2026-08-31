import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { DB } from '../db/client.js';
import { taskFiles } from '../db/schema/task-files.js';
import { tasks } from '../db/schema/tasks.js';
import type { FileService } from '../files/file-service.js';
import type {
  VideoEditAspectRatio,
  VideoEditDocument,
  VideoEditGenerationContext,
  VideoEditSourceKind,
} from './types.js';

export type VideoSourceUnavailableReason =
  | 'expired'
  | 'inactive'
  | 'not_video'
  | 'task_unavailable'
  | 'backing_object_missing'
  | 'invalid_metadata'
  | 'related_file_unavailable'
  | 'missing_locked_subject'
  | 'duration_unavailable';

export class VideoSourceImportError extends Error {
  constructor(
    public readonly code: 'NOT_FOUND' | 'SOURCE_UNAVAILABLE',
    public readonly reason: VideoSourceUnavailableReason | null,
    message: string,
  ) {
    super(message);
    this.name = 'VideoSourceImportError';
  }
}

export interface OwnedVideoSource {
  internalFileId: number;
  fileId: string;
  userId: number;
  taskId: number | null;
  taskExternalId: string | null;
  filename: string;
  mimetype: string;
  status: string;
  expiresAt: Date | null;
  taskStatus: string | null;
  taskResult: unknown;
}

export interface ScopedVideoPreview {
  url: string;
  expiresAt: Date;
  delivery?: 'signed' | 'authenticated';
}

export interface VideoSourceImportDependencies {
  loadOwnedSource(input: {
    userId: number;
    sourceFileId: string;
  }): Promise<OwnedVideoSource | null>;
  getScopedPreview(
    sourceFileId: string,
    userId: number,
    ttlSeconds: number,
  ): Promise<ScopedVideoPreview | null>;
  probeVideoMetadata(source: OwnedVideoSource): Promise<{
    durationMs: number;
    width: number;
    height: number;
  }>;
  isOwnedReadableFile?(fileId: string, userId: number): Promise<boolean>;
}

export async function loadOwnedVideoSource(
  db: DB,
  input: { userId: number; sourceFileId: string },
): Promise<OwnedVideoSource | null> {
  const [row] = await db
    .select({
      internalFileId: taskFiles.id,
      fileId: taskFiles.externalId,
      userId: taskFiles.userId,
      taskId: taskFiles.taskId,
      taskExternalId: tasks.externalId,
      taskUserId: tasks.userId,
      filename: taskFiles.filename,
      mimetype: taskFiles.mimetype,
      status: taskFiles.status,
      expiresAt: taskFiles.expiresAt,
      taskStatus: tasks.status,
      taskResult: tasks.result,
    })
    .from(taskFiles)
    .leftJoin(tasks, eq(taskFiles.taskId, tasks.id))
    .where(and(eq(taskFiles.externalId, input.sourceFileId), eq(taskFiles.userId, input.userId)))
    .limit(1);
  if (!row || (row.taskUserId !== null && row.taskUserId !== input.userId)) return null;
  return {
    internalFileId: row.internalFileId,
    fileId: row.fileId,
    userId: row.userId,
    taskId: row.taskId,
    taskExternalId: row.taskExternalId,
    filename: row.filename,
    mimetype: row.mimetype,
    status: row.status,
    expiresAt: row.expiresAt,
    taskStatus: row.taskStatus,
    taskResult: row.taskResult,
  };
}

export function createVideoSourceImportDependencies(input: {
  db: DB;
  fileService: Pick<FileService, 'getScopedPreviewForUser' | 'isReadableForUser'>;
  probeVideoMetadata(source: OwnedVideoSource): Promise<{
    durationMs: number;
    width: number;
    height: number;
  }>;
}): VideoSourceImportDependencies {
  return {
    loadOwnedSource: (query) => loadOwnedVideoSource(input.db, query),
    getScopedPreview: (sourceFileId, userId, ttlSeconds) =>
      input.fileService.getScopedPreviewForUser(sourceFileId, userId, ttlSeconds),
    probeVideoMetadata: input.probeVideoMetadata,
    isOwnedReadableFile: (fileId, userId) => input.fileService.isReadableForUser(fileId, userId),
  };
}

export interface ImportVideoSourceInput {
  userId: number;
  sourceFileId: string;
  sourceTaskId?: string;
  now?: Date;
  previewTtlSeconds?: number;
}

export interface ImportedVideoSource {
  sourceKind: VideoEditSourceKind;
  sourceTaskId: number | null;
  sourceFileId: number;
  document: VideoEditDocument;
  capabilities: {
    sceneRegeneration: boolean;
  };
  preview: ScopedVideoPreview;
}

const generationContextSchema = z
  .object({
    sourceTaskId: z.string().trim().min(1).max(32).optional(),
    prompt: z.string().trim().min(1).max(4_000).optional(),
    referenceFileIds: z.array(z.string().trim().min(1).max(32)).max(12).optional(),
    lockedSubjectFileId: z.string().trim().min(1).max(32).optional(),
  })
  .strict();

const sceneSourceSchema = z
  .object({
    id: z.string().trim().min(1).max(80),
    sourceFileId: z.string().trim().min(1).max(32),
    sourceStartMs: z.number().int().min(0),
    sourceEndMs: z.number().int().positive(),
    caption: z.string().max(500).optional(),
    audioGain: z.number().min(0).max(1).optional(),
    generationContext: generationContextSchema.nullable().optional(),
  })
  .strict()
  .refine((scene) => scene.sourceEndMs > scene.sourceStartMs, {
    message: 'sourceEndMs must be greater than sourceStartMs',
  });

const editingSourceSchema = z
  .object({
    aspectRatio: z.enum(['16:9', '9:16', '1:1']).default('16:9'),
    lockedSubjectFileId: z.string().trim().min(1).max(32).optional(),
    scenes: z.array(sceneSourceSchema).min(1).max(24),
  })
  .strict();

const taskMetadataSchema = z
  .object({
    lane: z.string().optional(),
    videoType: z.enum(['normal', 'pet', 'ip_person']).optional(),
    videoEditingSource: z.unknown().optional(),
  })
  .passthrough();

function unavailable(reason: VideoSourceUnavailableReason, message: string): never {
  throw new VideoSourceImportError('SOURCE_UNAVAILABLE', reason, message);
}

function taskMetadata(value: unknown): z.infer<typeof taskMetadataSchema> | null {
  if (!value || typeof value !== 'object') return null;
  const metadata = (value as { metadata?: unknown }).metadata;
  const parsed = taskMetadataSchema.safeParse(metadata);
  return parsed.success ? parsed.data : null;
}

function sourceKindFor(metadata: z.infer<typeof taskMetadataSchema> | null): VideoEditSourceKind {
  if (metadata?.videoType === 'ip_person') return 'ip_person';
  if (metadata?.videoType === 'pet') return 'clone';
  if (metadata?.videoType === 'normal' || metadata?.lane === 'video_creation') return 'generated';
  return 'upload';
}

async function assertRelatedFilesOwned(input: {
  userId: number;
  sourceFileId: string;
  contexts: Array<VideoEditGenerationContext | null>;
  isOwnedReadableFile?: VideoSourceImportDependencies['isOwnedReadableFile'];
}): Promise<void> {
  if (!input.isOwnedReadableFile) return;
  const related = new Set<string>();
  for (const context of input.contexts) {
    for (const fileId of context?.referenceFileIds ?? []) related.add(fileId);
    if (context?.lockedSubjectFileId) related.add(context.lockedSubjectFileId);
  }
  related.delete(input.sourceFileId);
  for (const fileId of related) {
    if (!(await input.isOwnedReadableFile(fileId, input.userId))) {
      unavailable('related_file_unavailable', '关联素材已不可用，请重新选择素材');
    }
  }
}

function documentFromStructuredSource(input: {
  parsed: z.infer<typeof editingSourceSchema>;
  sourceKind: VideoEditSourceKind;
  sourceFileId: string;
}): VideoEditDocument {
  const lockedSubjectFileId = input.parsed.lockedSubjectFileId;
  const scenes = input.parsed.scenes.map((scene, order) => {
    if (scene.sourceFileId !== input.sourceFileId) {
      unavailable('invalid_metadata', '分段来源与当前视频不一致');
    }
    const generationContext = scene.generationContext
      ? {
          ...scene.generationContext,
          ...(lockedSubjectFileId && !scene.generationContext.lockedSubjectFileId
            ? { lockedSubjectFileId }
            : {}),
        }
      : null;
    return {
      id: scene.id,
      sourceFileId: scene.sourceFileId,
      sourceStartMs: scene.sourceStartMs,
      sourceEndMs: scene.sourceEndMs,
      order,
      caption: scene.caption ?? '',
      audioGain: scene.audioGain ?? 1,
      generationContext,
    };
  });
  if (
    input.sourceKind === 'ip_person' &&
    scenes.some((scene) => !scene.generationContext?.lockedSubjectFileId)
  ) {
    unavailable('missing_locked_subject', 'IP 人物视频缺少锁定主体来源，暂不能继续剪辑');
  }
  return { aspectRatio: input.parsed.aspectRatio, scenes };
}

function closestSupportedAspectRatio(width: number, height: number): VideoEditAspectRatio {
  const sourceRatio = width / height;
  const candidates: Array<{ id: VideoEditAspectRatio; ratio: number }> = [
    { id: '16:9', ratio: 16 / 9 },
    { id: '9:16', ratio: 9 / 16 },
    { id: '1:1', ratio: 1 },
  ];
  return candidates.reduce((closest, candidate) =>
    Math.abs(Math.log(sourceRatio / candidate.ratio)) <
    Math.abs(Math.log(sourceRatio / closest.ratio))
      ? candidate
      : closest,
  ).id;
}

async function finalOnlyDocument(input: {
  source: OwnedVideoSource;
  probeVideoMetadata: VideoSourceImportDependencies['probeVideoMetadata'];
}): Promise<VideoEditDocument> {
  let metadata: { durationMs: number; width: number; height: number };
  try {
    metadata = await input.probeVideoMetadata(input.source);
  } catch {
    return unavailable('duration_unavailable', '无法读取视频信息，请重新上传');
  }
  if (
    !Number.isSafeInteger(metadata.durationMs) ||
    metadata.durationMs <= 0 ||
    !Number.isSafeInteger(metadata.width) ||
    metadata.width <= 0 ||
    !Number.isSafeInteger(metadata.height) ||
    metadata.height <= 0
  ) {
    return unavailable('duration_unavailable', '无法读取视频信息，请重新上传');
  }
  return {
    aspectRatio: closestSupportedAspectRatio(metadata.width, metadata.height),
    scenes: [
      {
        id: `${input.source.fileId}:scene:1`,
        sourceFileId: input.source.fileId,
        sourceStartMs: 0,
        sourceEndMs: metadata.durationMs,
        order: 0,
        caption: '',
        audioGain: 1,
        generationContext: null,
      },
    ],
  };
}

export async function importVideoSource(
  input: ImportVideoSourceInput,
  dependencies: VideoSourceImportDependencies,
): Promise<ImportedVideoSource> {
  const now = input.now ?? new Date();
  const source = await dependencies.loadOwnedSource({
    userId: input.userId,
    sourceFileId: input.sourceFileId,
  });
  if (!source) {
    throw new VideoSourceImportError('NOT_FOUND', null, '视频不存在');
  }
  if (source.userId !== input.userId) {
    throw new VideoSourceImportError('NOT_FOUND', null, '视频不存在');
  }
  if (input.sourceTaskId && source.taskExternalId !== input.sourceTaskId) {
    throw new VideoSourceImportError('NOT_FOUND', null, '视频不存在');
  }
  if (source.status !== 'active') unavailable('inactive', '视频已不可用');
  if (source.expiresAt && source.expiresAt.getTime() <= now.getTime()) {
    unavailable('expired', '视频已过期');
  }
  if (!source.mimetype.toLowerCase().startsWith('video/')) {
    unavailable('not_video', '所选文件不是可剪辑视频');
  }
  if (
    source.taskId !== null &&
    (!source.taskExternalId || !['completed', 'partial_success'].includes(source.taskStatus ?? ''))
  ) {
    unavailable('task_unavailable', '原视频任务尚未生成可用成片');
  }

  const preview = await dependencies.getScopedPreview(
    source.fileId,
    input.userId,
    input.previewTtlSeconds ?? 900,
  );
  if (!preview) unavailable('backing_object_missing', '视频文件已不可用');

  const metadata = taskMetadata(source.taskResult);
  const sourceKind = sourceKindFor(metadata);
  let document: VideoEditDocument;
  if (metadata?.videoEditingSource !== undefined) {
    const parsed = editingSourceSchema.safeParse(metadata.videoEditingSource);
    if (!parsed.success) unavailable('invalid_metadata', '视频分段信息不完整');
    document = documentFromStructuredSource({
      parsed: parsed.data,
      sourceKind,
      sourceFileId: source.fileId,
    });
  } else {
    if (sourceKind === 'ip_person') {
      unavailable('missing_locked_subject', 'IP 人物视频缺少锁定主体来源，暂不能继续剪辑');
    }
    document = await finalOnlyDocument({
      source,
      probeVideoMetadata: dependencies.probeVideoMetadata,
    });
  }
  await assertRelatedFilesOwned({
    userId: input.userId,
    sourceFileId: source.fileId,
    contexts: document.scenes.map((scene) => scene.generationContext),
    ...(dependencies.isOwnedReadableFile
      ? { isOwnedReadableFile: dependencies.isOwnedReadableFile }
      : {}),
  });
  if (
    source.taskExternalId &&
    document.scenes.some(
      (scene) =>
        scene.generationContext !== null &&
        scene.generationContext.sourceTaskId !== source.taskExternalId,
    )
  ) {
    unavailable('invalid_metadata', '视频分段来源任务不一致');
  }
  return {
    sourceKind,
    sourceTaskId: source.taskId,
    sourceFileId: source.internalFileId,
    document,
    capabilities: {
      sceneRegeneration:
        sourceKind !== 'upload' &&
        document.scenes.some((scene) => scene.generationContext !== null),
    },
    preview,
  };
}
